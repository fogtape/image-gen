import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareProxyRequest, runProxyUpstream } from '../proxy-executor.js';

const encoder = new TextEncoder();

function upstreamInput() {
  return {
    target: new URL('https://api.openai.com/v1/models'),
    opts: { method: 'GET', headers: {} },
  };
}

function assertProxyError(status, pattern) {
  return (error) => {
    assert.equal(error?.status, status);
    assert.match(error?.message || '', pattern);
    return true;
  };
}

test('proxy executor rejects upstream responses whose content-length exceeds the limit', async () => {
  await assert.rejects(
    runProxyUpstream(upstreamInput(), {
      fetchImpl: async () => new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': '2048',
        },
      }),
      limits: { timeoutMs: 1000, maxResponseBytes: 1024 },
    }),
    assertProxyError(502, /too large/i),
  );
});

test('proxy executor returns normal JSON responses within the configured byte limit', async () => {
  const result = await runProxyUpstream(upstreamInput(), {
    fetchImpl: async () => new Response('{"ok":true}', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }),
    limits: { timeoutMs: 1000, maxResponseBytes: 1024 },
  });
  assert.deepEqual(result, {
    status: 201,
    contentType: 'application/json',
    body: '{"ok":true}',
    stream: false,
  });
});

test('proxy executor checks SSE content-length before committing stream headers', async () => {
  let started = false;
  await assert.rejects(
    runProxyUpstream(upstreamInput(), {
      fetchImpl: async () => new Response('data: ok\n\n', {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'content-length': '2048',
        },
      }),
      limits: { timeoutMs: 1000, maxResponseBytes: 1024 },
      onStreamStart: () => { started = true; },
      onStreamChunk: () => {},
    }),
    assertProxyError(502, /too large/i),
  );
  assert.equal(started, false);
});

test('proxy executor rejects streamed non-SSE bodies that exceed the limit while reading', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('0123456789'));
      controller.enqueue(encoder.encode('overflow'));
      controller.close();
    },
  });

  await assert.rejects(
    runProxyUpstream(upstreamInput(), {
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      limits: { timeoutMs: 1000, maxResponseBytes: 12 },
    }),
    assertProxyError(502, /too large/i),
  );
});

test('proxy executor converts upstream aborts into a 504 timeout', async () => {
  await assert.rejects(
    runProxyUpstream(upstreamInput(), {
      fetchImpl: async (_url, opts) => new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
      limits: { timeoutMs: 5, maxResponseBytes: 1024 },
    }),
    assertProxyError(504, /timed out/i),
  );
});

test('proxy executor applies the same byte limit to SSE streams', async () => {
  const chunks = [];
  let started = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: a\n\n'));
      controller.enqueue(encoder.encode('data: overflow\n\n'));
      controller.close();
    },
  });

  await assert.rejects(
    runProxyUpstream(upstreamInput(), {
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
      limits: { timeoutMs: 1000, maxResponseBytes: 12 },
      onStreamStart: () => { started = true; },
      onStreamChunk: (chunk) => chunks.push(chunk),
    }),
    assertProxyError(502, /too large/i),
  );
  assert.equal(started, true);
  assert.deepEqual(chunks, ['data: a\n\n']);
});

test('serverless proxy preparation rejects multipart bodies instead of silently dropping them', () => {
  assert.throws(
    () => prepareProxyRequest({
      url: 'https://api.openai.com/v1/images/edits',
      method: 'POST',
      multipartBody: {
        fields: { model: 'gpt-image-2', prompt: '改成水彩风' },
        images: [],
      },
    }, {
      allowedHosts: new Set(['api.openai.com']),
      allowMultipart: false,
    }),
    assertProxyError(400, /multipart proxy is not supported/i),
  );
});

test('proxy executor normalizes JSON content-type and allowlist includes default API env host', () => {
  const prepared = prepareProxyRequest({
    url: 'https://relay.example/v1/responses',
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      Authorization: 'Bearer ok',
    },
    body: { input: 'hello' },
  }, {
    allowedHosts: new Set(['relay.example']),
    allowMultipart: false,
  });
  assert.equal(prepared.opts.headers['Content-Type'], 'application/json');
  assert.equal(prepared.opts.headers['content-type'], undefined);
  assert.equal(prepared.opts.headers.Authorization, 'Bearer ok');
  assert.equal(prepared.opts.body, JSON.stringify({ input: 'hello' }));
});

test('proxy executor treats multipart bodies without fields as multipart and checks top-level mask size', () => {
  const imageData = `data:image/png;base64,${Buffer.alloc(8, 1).toString('base64')}`;
  assert.throws(
    () => prepareProxyRequest({
      url: 'https://api.openai.com/v1/images/edits',
      method: 'POST',
      multipartBody: { images: [{ data: imageData, filename: 'reference.png' }] },
    }, {
      allowedHosts: new Set(['api.openai.com']),
      allowMultipart: false,
    }),
    assertProxyError(400, /multipart proxy is not supported/i),
  );

  const largeMask = `data:image/png;base64,${Buffer.alloc(1500, 1).toString('base64')}`;
  const previousLimit = process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES;
  process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES = '1024';
  try {
    assert.throws(
      () => prepareProxyRequest({
        url: 'https://api.openai.com/v1/images/edits',
        method: 'POST',
        multipartBody: {
          fields: { model: 'gpt-image-2', prompt: '改成水彩风' },
          images: [],
          mask: largeMask,
        },
      }, {
        allowedHosts: new Set(['api.openai.com']),
        allowMultipart: true,
        buildMultipartBody: () => new FormData(),
      }),
      assertProxyError(413, /参考图|过大/),
    );
  } finally {
    if (previousLimit === undefined) delete process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES;
    else process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES = previousLimit;
  }
});

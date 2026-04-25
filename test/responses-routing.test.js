import test from 'node:test';
import assert from 'node:assert/strict';

import { imageJobStore } from '../server.js';

const ONE_BY_ONE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

async function waitForJobDone(jobId, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = imageJobStore.get(jobId);
    if (job?.status === 'completed' || job?.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

function makeImagesPayload({ mode = 'images', stream = true, hasRef = false } = {}) {
  return {
    mode,
    prompt: '画一个红点',
    cfg: { apiUrl: 'https://example.test', apiKey: 'test-key', model: 'gpt-image-2' },
    quality: 'low',
    size: 'auto',
    background: 'auto',
    format: 'png',
    stream,
    refImagesBase64: hasRef ? ['abc123'] : undefined,
    storageSettings: { enabled: false },
  };
}

test('API Key 流式文生图走 /v1/images/generations 并在 Images 请求体传 stream=true', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return new Response(`data: {"type":"image_generation.completed","b64_json":"${ONE_BY_ONE_PNG_B64}"}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    const created = imageJobStore.create(makeImagesPayload({ stream: true }));
    const job = await waitForJobDone(created.id);
    assert.equal(job.status, 'completed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.test/v1/images/generations');
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.stream, true);
    assert.equal(body.model, 'gpt-image-2');
    assert.equal(body.tools, undefined);
    assert.equal(body.input, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API Key 图生图走 /v1/images/edits 且只提交 images[].image_url', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return new Response(JSON.stringify({ data: [{ b64_json: ONE_BY_ONE_PNG_B64 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const created = imageJobStore.create(makeImagesPayload({ mode: 'edits', stream: false, hasRef: true }));
    const job = await waitForJobDone(created.id);
    assert.equal(job.status, 'completed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.test/v1/images/edits');
    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(body.images, [{ image_url: 'data:image/png;base64,abc123' }]);
    assert.equal(body.image, undefined);
    assert.equal(body.stream, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('不支持旧 responses job mode，避免无意义端点兜底', async () => {
  const created = imageJobStore.create({ ...makeImagesPayload(), mode: 'responses' });
  const job = await waitForJobDone(created.id);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /Unsupported job mode: responses/);
});

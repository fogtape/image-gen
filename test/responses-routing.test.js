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

function makeResponsesPayload(model = 'gpt-image-2', responsesModel = 'gpt-5.4') {
  return {
    mode: 'responses',
    prompt: '画一个红点',
    cfg: { apiUrl: 'https://api.openai.com', apiKey: 'test-key', model, responsesModel },
    quality: 'low',
    size: 'auto',
    background: 'auto',
    format: 'png',
    storageSettings: { enabled: false },
  };
}

test('Responses image jobs use relay-compatible Codex-style headers and store=false', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return new Response(`event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"${ONE_BY_ONE_PNG_B64}"}}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    const created = imageJobStore.create(makeResponsesPayload());
    const job = await waitForJobDone(created.id);
    assert.equal(job.status, 'completed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');

    const headers = calls[0].opts.headers;
    assert.equal(headers.Authorization, 'Bearer test-key');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers.Accept, 'text/event-stream');
    assert.equal(headers['OpenAI-Beta'], 'responses=experimental');
    assert.equal(headers.Originator, 'codex_cli_rs');
    assert.equal(headers.Version, '0.104.0');
    assert.equal(headers['User-Agent'], 'codex_cli_rs/0.104.0');
    assert.match(headers.session_id, /^[0-9a-f-]{36}$/i);

    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.model, 'gpt-5.4');
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.deepEqual(body.tool_choice, { type: 'image_generation' });
    assert.equal(body.tools[0].model, 'gpt-image-2');
    assert.equal(body.tools[0].partial_images, 3);
    assert.ok(job.progress.some((item) => item.phase === 'response:image_done'));
    assert.ok(!job.progress.some((item) => item.phase === 'response.output_item.done'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Responses image jobs with non-image models preserve upstream error instead of falling back to Images API', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/v1/responses')) {
      return new Response('<html>502 Bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });
    }
    return new Response(JSON.stringify({ error: { message: 'images endpoint requires an image model, got "gpt-5.4"' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const created = imageJobStore.create(makeResponsesPayload('gpt-image-2', 'gpt-5.4'));
    const job = await waitForJobDone(created.id);
    assert.equal(job.status, 'failed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
    assert.match(job.error, /HTTP 502|502 Bad gateway/i);
    assert.doesNotMatch(job.error, /images endpoint requires an image model/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('后台图片任务拒绝本机 apiUrl 且不会触发上游 fetch', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const created = imageJobStore.create({
      ...makeResponsesPayload(),
      cfg: {
        apiUrl: 'http://127.0.0.1:9',
        apiKey: 'test-key',
        model: 'gpt-image-2',
        responsesModel: 'gpt-5.4',
      },
    });
    const job = await waitForJobDone(created.id);
    assert.equal(job.status, 'failed');
    assert.equal(callCount, 0);
    assert.match(job.error, /API address protocol|API address host/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('后台图片任务支持 count/batchId 批量生成并给每张结果标记序号', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return new Response(`event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"${ONE_BY_ONE_PNG_B64}"}}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    const created = imageJobStore.create({
      ...makeResponsesPayload(),
      count: 3,
      batchId: 'batch-test-3',
    });
    const job = await waitForJobDone(created.id);
    assert.equal(job.status, 'completed');
    assert.equal(calls.length, 3);
    assert.equal(job.result.batchId, 'batch-test-3');
    assert.equal(job.result.batchCount, 3);
    assert.equal(job.result.data.length, 3);
    assert.deepEqual(job.result.data.map((item) => item.batchIndex), [1, 2, 3]);
    assert.deepEqual(job.result.data.map((item) => item.batchCount), [3, 3, 3]);
    assert.deepEqual(job.result.data.map((item) => item.batchId), ['batch-test-3', 'batch-test-3', 'batch-test-3']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('后台批量生成单张失败不影响其他成功结果', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 2) {
      return new Response(JSON.stringify({ error: { message: 'upstream one image failed' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(`event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"${ONE_BY_ONE_PNG_B64}"}}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    const created = imageJobStore.create({
      ...makeResponsesPayload(),
      count: 3,
      batchId: 'batch-partial',
    });
    const job = await waitForJobDone(created.id);
    assert.equal(job.status, 'completed');
    assert.equal(callCount, 3);
    assert.equal(job.result.data.filter((item) => !item.failed).length, 2);
    assert.equal(job.result.data.filter((item) => item.failed).length, 1);
    assert.equal(job.result.data[1].failed, true);
    assert.match(job.result.data[1].error, /upstream one image failed|HTTP 500/);
    const partialProgress = job.progress.find((item) => item.phase === 'batch:partial');
    assert.ok(partialProgress);
    assert.equal(partialProgress.current, 3);
    assert.equal(partialProgress.total, 3);
    assert.equal(partialProgress.percent, 100);
    assert.equal(partialProgress.progressKind, 'real');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

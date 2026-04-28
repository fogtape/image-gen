import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

function listen(server, host = '127.0.0.1') {
  return new Promise((resolve) => server.listen(0, host, resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function postJson(baseUrl, pathname, body = {}) {
  const resp = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

test('POST /api/jobs/:id/cancel marks a running job cancelled and aborts upstream fetch', async () => {
  let resolveReceived;
  let resolveClosed;
  const upstreamReceived = new Promise((resolve) => { resolveReceived = resolve; });
  const upstreamClosed = new Promise((resolve) => { resolveClosed = resolve; });
  const sockets = new Set();
  const upstream = http.createServer((req, res) => {
    resolveReceived({ req, res });
    res.on('close', resolveClosed);
  });
  upstream.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token-job-cancel';
  process.env.IMAGE_GEN_PROXY_ALLOWED_HOSTS = '127.0.0.1';
  process.env.IMAGE_GEN_PROXY_ALLOW_LOCAL_HTTP = 'true';
  const { server } = await import('../server.js');

  await listen(upstream);
  await listen(server);
  try {
    const upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const created = await postJson(baseUrl, '/api/jobs', {
      mode: 'images',
      prompt: 'cancel integration test',
      cfg: {
        apiUrl: upstreamBase,
        apiKey: 'test-key',
        model: 'gpt-image-2',
      },
      storageSettings: { enabled: false },
    });
    assert.equal(created.resp.status, 202);
    const jobId = created.data.jobId || created.data.id;
    assert.ok(jobId);

    await withTimeout(upstreamReceived, 1_000, 'upstream image request was not started');

    const cancelled = await postJson(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}/cancel`);
    assert.equal(cancelled.resp.status, 200);
    assert.equal(cancelled.data.ok, true);
    assert.equal(cancelled.data.job.status, 'cancelled');
    assert.equal(cancelled.data.job.error, null);

    const statusResp = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`);
    const status = await statusResp.json();
    assert.equal(statusResp.status, 200);
    assert.equal(status.status, 'cancelled');

    await withTimeout(upstreamClosed, 1_000, 'upstream fetch was not aborted after cancellation');
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await close(server).catch(() => {});
    await close(upstream).catch(() => {});
  }
});

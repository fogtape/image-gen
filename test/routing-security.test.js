import assert from 'node:assert/strict';
import test from 'node:test';

process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token-routing-security';

const { server } = await import('../server.js');

function listen(server, host = '127.0.0.1') {
  return new Promise((resolve) => server.listen(0, host, resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('畸形 URL 编码路径返回 400 且服务保持可用', async () => {
  await listen(server);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const bad = await fetch(`${baseUrl}/api/jobs/%E0%A4%A/cancel`, { method: 'POST' });
    const data = await bad.json();
    assert.equal(bad.status, 400);
    assert.match(data.error, /Bad request path/);

    const ok = await fetch(`${baseUrl}/api/config/runtime`);
    assert.equal(ok.status, 200);
    const runtime = await ok.json();
    assert.ok(runtime.runtime || runtime.config || runtime.meta);
  } finally {
    await close(server).catch(() => {});
  }
});

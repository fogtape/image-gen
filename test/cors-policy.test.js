import assert from 'node:assert/strict';
import test from 'node:test';

process.env.VERCEL = '1';
process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token-cors-policy';

const { server } = await import('../server.js');

test('Node API CORS only reflects same-origin, local dev, or configured origins', async () => {
  const previousAllowed = process.env.IMAGE_GEN_ALLOWED_ORIGINS;
  process.env.IMAGE_GEN_ALLOWED_ORIGINS = 'https://allowed.example';

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;

    const unknown = await fetch(`${base}/api/config/runtime`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.headers.get('access-control-allow-origin'), null);
    assert.notEqual(unknown.headers.get('access-control-allow-origin'), '*');

    const configured = await fetch(`${base}/api/config/runtime`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://allowed.example' },
    });
    assert.equal(configured.headers.get('access-control-allow-origin'), 'https://allowed.example');
    assert.match(configured.headers.get('vary') || '', /Origin/);

    const local = await fetch(`${base}/api/config/runtime`, {
      method: 'OPTIONS',
      headers: { Origin: `http://localhost:${server.address().port}` },
    });
    assert.equal(local.headers.get('access-control-allow-origin'), `http://localhost:${server.address().port}`);

    const sameOrigin = await fetch(`${base}/api/config/runtime`, {
      method: 'OPTIONS',
      headers: { Origin: base },
    });
    assert.equal(sameOrigin.headers.get('access-control-allow-origin'), base);
  } finally {
    if (previousAllowed === undefined) delete process.env.IMAGE_GEN_ALLOWED_ORIGINS;
    else process.env.IMAGE_GEN_ALLOWED_ORIGINS = previousAllowed;
    await new Promise((resolve) => server.close(resolve));
  }
});

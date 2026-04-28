import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function get(baseUrl, pathname) {
  const resp = await fetch(`${baseUrl}${pathname}`);
  return { resp, text: await resp.text() };
}

test('静态服务只从静态根返回前端资源，并拦截源码、配置、隐藏文件和路径穿越', async () => {
  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-static-'));
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>static-ok</title>', 'utf8');
  fs.writeFileSync(path.join(staticRoot, 'app.js'), 'console.log("static app ok");', 'utf8');
  fs.writeFileSync(path.join(staticRoot, 'style.css'), 'body { color: #111; }', 'utf8');
  fs.mkdirSync(path.join(staticRoot, 'config'));
  fs.writeFileSync(path.join(staticRoot, 'config', '.env'), 'SHOULD_NOT_BE_SERVED=1', 'utf8');
  fs.writeFileSync(path.join(staticRoot, '.oauth-sessions.json'), '{}', 'utf8');

  process.env.VERCEL = '1';
  process.env.IMAGE_GEN_STATIC_DIR = staticRoot;
  process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token-static-security';

  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const home = await get(baseUrl, '/');
    assert.equal(home.resp.status, 200);
    assert.match(home.text, /static-ok/);

    const app = await get(baseUrl, '/app.js?cache=1');
    assert.equal(app.resp.status, 200);
    assert.equal(app.resp.headers.get('content-type'), 'application/javascript');
    assert.match(app.text, /static app ok/);

    const source = await get(baseUrl, '/server.js');
    assert.equal(source.resp.status, 403);
    assert.doesNotMatch(source.text, /OAUTH_CLIENT_ID|createServer/);

    const config = await get(baseUrl, '/config/.env');
    assert.equal(config.resp.status, 403);
    assert.doesNotMatch(config.text, /SHOULD_NOT_BE_SERVED/);

    const sessions = await get(baseUrl, '/.oauth-sessions.json');
    assert.equal(sessions.resp.status, 403);

    const traversal = await get(baseUrl, '/%2e%2e/server.js');
    assert.equal(traversal.resp.status, 403);
    assert.doesNotMatch(traversal.text, /OAUTH_CLIENT_ID|createServer/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(staticRoot, { recursive: true, force: true });
  }
});

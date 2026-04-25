import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function oauthBranchSource() {
  const start = app.indexOf('if (cfg.isOAuth) {', app.indexOf('async function testConnection'));
  const end = app.indexOf('} else {', start);
  assert.ok(start > 0 && end > start, 'OAuth branch in testConnection should be found');
  return app.slice(start, end);
}

test('OAuth 连接测试走 ChatGPT backend 探活，不调用需要 api.responses.write scope 的 /v1/responses', () => {
  const branch = oauthBranchSource();
  assert.match(branch, /fetch\('\/api\/oauth\/test'/);
  assert.doesNotMatch(branch, /\/v1\/responses/);
  assert.doesNotMatch(branch, /api\.responses\.write/);
});

test('服务端提供 /api/oauth/test 探活路由，供 Vercel OAuth 连接测试返回 JSON', () => {
  assert.match(server, /url\.pathname === '\/api\/oauth\/test'/);
  assert.match(server, /handleOAuthTest/);
  assert.ok(fs.existsSync(new URL('../api/oauth/test.js', import.meta.url)), 'Vercel explicit OAuth test route should exist');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

test('API Key 账号流式模式默认关闭，只有用户显式开启才走 Responses', () => {
  assert.match(app, /streamMode: old\.streamMode === true/);
  assert.match(app, /streamMode: acc \? acc\.streamMode === true : false/);
  assert.match(app, /\$\('#editStream'\)\.checked = acc \? acc\.streamMode === true : false/);
  assert.doesNotMatch(html, /id="editStream" checked/);
});

test('OAuth 账号隐藏流式开关并显示真实 ChatGPT 后端流程说明', () => {
  assert.match(html, /id="routeModeInfo"/);
  assert.match(html, /id="editStreamSection"/);
  assert.match(html, /id="editOAuthFlowInfo"/);
  assert.match(html, /chat-requirements[\s\S]*conversation\/prepare[\s\S]*conversation/);
  assert.match(app, /function syncAccountModeUi\(/);
  assert.match(app, /editStreamSection[\s\S]*classList\.toggle\('hidden', isOAuth\)/);
  assert.match(app, /editOAuthFlowInfo[\s\S]*classList\.toggle\('hidden', !isOAuth\)/);
  assert.match(app, /ChatGPT 后端图片流程/);
});

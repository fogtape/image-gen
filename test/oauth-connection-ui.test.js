import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stateSource = fs.readFileSync(new URL('../frontend/state.js', import.meta.url), 'utf8');

function oauthBranchSource() {
  const start = app.indexOf('if (cfg.isOAuth) {', app.indexOf('async function testConnection'));
  const end = app.indexOf('} else {', start);
  assert.ok(start > 0 && end > start, 'OAuth branch in testConnection should be found');
  return app.slice(start, end);
}

test('OAuth 连接测试走 ChatGPT backend 探活，不调用需要 api.responses.write scope 的 /v1/responses', () => {
  const branch = oauthBranchSource();
  assert.match(branch, /adminFetch\('\/api\/oauth\/test'/);
  assert.doesNotMatch(branch, /\/v1\/responses/);
  assert.doesNotMatch(branch, /api\.responses\.write/);
});

test('服务端提供 /api/oauth/test 探活路由，供 Vercel OAuth 连接测试返回 JSON', () => {
  assert.match(server, /'\/api\/oauth\/test'/);
  assert.match(server, /handleOAuthTest/);
  assert.ok(fs.existsSync(new URL('../api/oauth/test.js', import.meta.url)), 'Vercel explicit OAuth test route should exist');
});

test('API Key 账号流式模式默认关闭，只有用户显式开启才走 Responses', () => {
  assert.match(app, /streamMode: old\.streamMode === true/);
  assert.match(app, /streamMode: acc \? acc\.streamMode === true : false/);
  assert.match(app, /\$\('#editStream'\)\.checked = acc \? acc\.streamMode === true : false/);
  assert.doesNotMatch(html, /id="editStream" checked/);
});

test('账号级兼容开关默认保持官方图生图写法，但允许单独开启旧版 multipart 与流式回退控制', () => {
  assert.match(app, /imageEditsCompatMode: old\.imageEditsCompatMode === true/);
  assert.match(app, /responsesAutoFallback: old\.responsesAutoFallback !== false/);
  assert.match(app, /imageEditsCompatMode: acc \? acc\.imageEditsCompatMode === true : false/);
  assert.match(app, /responsesAutoFallback: acc \? acc\.responsesAutoFallback !== false : true/);
  assert.match(app, /\$\('#editResponsesAutoFallback'\)\.checked = acc \? acc\.responsesAutoFallback !== false : true/);
  assert.match(app, /\$\('#editImageEditsCompat'\)\.checked = acc \? acc\.imageEditsCompatMode === true : false/);
  assert.match(app, /responsesAutoFallback: \$\('#editResponsesAutoFallback'\)\.checked/);
  assert.match(app, /imageEditsCompatMode: \$\('#editImageEditsCompat'\)\.checked/);
  assert.match(html, /id="editResponsesAutoFallback"/);
  assert.match(html, /id="editImageEditsCompat"/);
});

test('手动账号默认图片模型与流式主模型已拆分', () => {
  assert.match(app, /const DEFAULT_IMAGE_MODEL = 'gpt-image-2'/);
  assert.match(app, /const DEFAULT_RESPONSES_MODEL = 'gpt-5.4'/);
  assert.match(html, /id="editModel" value="gpt-image-2"/);
  assert.match(html, /id="editResponsesModel" value="gpt-5.4"/);
});

test('OAuth 账号编辑页隐藏流式开关并显示真实 ChatGPT 后端流程说明，首页不展示突兀流程条', () => {
  assert.doesNotMatch(html, /id="routeModeInfo"/);
  assert.match(html, /id="editStreamSection"/);
  assert.match(html, /id="editFallbackSection"/);
  assert.match(html, /id="editCompatSection"/);
  assert.match(html, /id="editOAuthFlowInfo"/);
  assert.match(html, /chat-requirements[\s\S]*conversation\/prepare[\s\S]*conversation/);
  assert.match(app, /function syncAccountModeUi\(/);
  assert.match(app, /editStreamSection[\s\S]*classList\.toggle\('hidden', isOAuth\)/);
  assert.match(app, /editFallbackSection[\s\S]*classList\.toggle\('hidden', isOAuth\)/);
  assert.match(app, /editCompatSection[\s\S]*classList\.toggle\('hidden', isOAuth\)/);
  assert.match(app, /editOAuthFlowInfo[\s\S]*classList\.toggle\('hidden', !isOAuth\)/);
  assert.match(app, /ChatGPT 后端图片流程/);
});

test('OAuth 轮询支持取消、去重和登录按钮防重入', () => {
  assert.match(stateSource, /oauthPollTimer:\s*null/);
  assert.match(stateSource, /oauthPollSessionId:\s*null/);
  assert.match(stateSource, /oauthPollGeneration:\s*0/);
  assert.match(stateSource, /oauthLoginInProgress:\s*false/);
  assert.match(stateSource, /oauthCompletedKeys:\s*new Set\(\)/);
  assert.match(app, /function clearOAuthPolling\(\)/);
  assert.match(app, /clearTimeout\(state\.oauthPollTimer\)/);
  assert.match(app, /function beginOAuthPolling\(sessionId\)/);
  assert.match(app, /state\.oauthPollGeneration = \(state\.oauthPollGeneration \|\| 0\) \+ 1/);
  assert.match(app, /function isCurrentOAuthPoll\(sessionId, generation\)/);
  assert.match(app, /state\.oauthPendingSessionId === sessionId/);
  assert.match(app, /function scheduleOAuthPoll\(callback, delayMs\)/);
  assert.match(app, /if \(state\.oauthLoginInProgress\) return/);
  assert.match(app, /setOAuthLoginBusy\(true\)/);
  assert.match(app, /setAttribute\('aria-busy', isBusy \? 'true' : 'false'\)/);
  assert.match(app, /async function pollOAuthStatus\(oauthState, generation = beginOAuthPolling\(oauthState\)\)/);
  assert.match(app, /if \(!isCurrentOAuthPoll\(oauthState, generation\)\) return/);
  assert.match(app, /scheduleOAuthPoll\(poll, 2000\)/);
  assert.match(app, /scheduleOAuthPoll\(poll, 3000\)/);
  assert.match(app, /clearOAuthPolling\(\);\s*\n\s*\$\('#oauthExchangeBtn'\)\.disabled = true/);
  assert.match(app, /state\.oauthCompletedKeys\.has\(dedupeKey\)/);
});

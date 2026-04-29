import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

function assertFunctionUsesAdminFetch(name, path) {
  const pattern = new RegExp(`async function ${name}\\([\\s\\S]*?adminFetch\\(${path}`);
  assert.match(app, pattern, `${name} should call adminFetch(${path}`);
}

test('前端管理 API 统一走 adminFetch 和 Bearer 会话', () => {
  assert.match(app, /from '\.\/frontend\/admin-api\.js'/);
  assert.match(app, /from '\.\/frontend\/admin-session\.js'/);
  assertFunctionUsesAdminFetch('fetchEditableRuntimeConfig', "'\\/api\\/config\\/editable'");
  assertFunctionUsesAdminFetch('saveServerRuntimeConfig', "'\\/api\\/config\\/save'");
  assertFunctionUsesAdminFetch('runPlatformAction', '`\\/api\\/config\\/platform\\/\\$\\{action\\}`');
  assertFunctionUsesAdminFetch('clearStorageData', "'\\/api\\/storage\\/clear'");
  assertFunctionUsesAdminFetch('patchStoredImageMeta', '`\\/api\\/images\\/\\$\\{encodeURIComponent\\(id\\)\\}\\/meta`');
  assertFunctionUsesAdminFetch('deleteStoredImage', '`\\/api\\/images\\/\\$\\{encodeURIComponent\\(id\\)\\}`');
  assert.doesNotMatch(app, /\$\('#configAdminToken'\)/);
});

test('前端先进入管理员登录页，登录后再显示主应用并拥有全部管理权限', () => {
  for (const id of ['adminLoginShell', 'adminGateTokenInput', 'adminGateLoginBtn', 'adminGateStatus', 'mainAppShell']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
  assert.match(html, /id="mainAppShell"[^>]*class="[^"]*hidden/);
  assert.match(app, /function syncAdminGateUi\(\)/);
  assert.match(app, /hasValidAdminSession\(\)/);
  assert.match(app, /mainShell\.classList\.toggle\('hidden', !unlocked\)/);
  assert.match(app, /loginShell\.classList\.toggle\('hidden', unlocked\)/);
  assert.match(app, /document\.documentElement\.dataset\.adminSession = unlocked \? 'active' : 'locked'/);
  assert.match(app, /async function loginAdminFromGate\(\)/);
  assert.match(app, /persistAdminSession\(token\)/);
  assert.match(app, /await hydrateAdminUnlockedState\(/);
  assert.match(html, /document\.documentElement\.dataset\.adminSession = hasActiveSession \? 'active' : 'locked'/);
  assert.match(html, /img-gen-admin-token/);
  assert.match(html, /img-gen-admin-token-expires-at/);
  assert.match(css, /html\[data-admin-session="active"\] \.admin-gate-shell\s*\{\s*display: none;/);
  assert.match(css, /html\[data-admin-session="active"\] \.app-shell\.hidden\s*\{\s*display: block;/);
  assert.doesNotMatch(html, /Docker \/ Node 可在环境变量或 config\/\.env 配置|云平台按 metapi 类似方式配置环境变量/);
  assert.doesNotMatch(html, /id="adminTokenInput"|id="adminLoginBtn"|id="adminLogoutBtn"|id="adminSessionStatus"/);
  assert.doesNotMatch(html, /id="configAdminToken"/);
  const deploySection = html.match(/<section class="settings-section account-deploy-section">[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(deploySection, /管理员|口令|adminTokenInput|configAdminToken/);
});

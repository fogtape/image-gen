import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

test('设置页有独立管理员解锁入口，不再把管理口令放在部署平台配置里', () => {
  assert.match(html, />管理员解锁</);
  for (const id of ['adminTokenInput', 'adminLoginBtn', 'adminLogoutBtn', 'adminSessionStatus']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
  assert.doesNotMatch(html, /id="configAdminToken"/);
  const deploySection = html.match(/<section class="settings-section account-deploy-section">[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(deploySection, /管理员|口令|adminTokenInput|configAdminToken/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

function sectionById(id) {
  const start = html.indexOf(`<section id="${id}"`);
  if (start < 0) return '';
  const next = html.indexOf('<section id="settingsPanel', start + 1);
  const end = next >= 0 ? next : html.indexOf('<div class="modal-footer"', start);
  return html.slice(start, end >= 0 ? end : undefined);
}

function accountOverlay() {
  const start = html.indexOf('<div id="accountOverlay"');
  if (start < 0) return '';
  const end = html.indexOf('<!-- Add/Edit Account Modal -->', start);
  return html.slice(start, end >= 0 ? end : undefined);
}

test('设置和账号管理分成两个入口，账号下拉打开独立账号管理弹窗', () => {
  assert.match(html, /<h2 id="settingsTitle">设置<\/h2>/);
  assert.match(html, /id="settingsCenterNav"[^>]*role="tablist"[^>]*aria-label="设置导航"/);
  assert.match(html, /id="accountOverlay"[^>]*role="dialog"[^>]*aria-labelledby="accountManagerTitle"/);
  assert.match(html, /<h2 id="accountManagerTitle">账号管理<\/h2>/);
  assert.match(app, /async function openAccountManager\(initialTab = 'api'/);
  assert.match(app, /openDialog\(\$\('#accountOverlay'\)/);
  assert.match(app, /closeDialog\(\$\('#accountOverlay'\)/);
  assert.match(app, /openAccountManager\('api', \{[^}]*restoreFocus: '#switcherBtn'[^}]*\}\)/);
  assert.doesNotMatch(app, /openSettingsCenter\('accounts'/);
});

test('账号管理弹窗先打开，再后台刷新服务端账号数据，避免被慢接口阻塞', () => {
  const fnMatch = app.match(/async function openAccountManager\(initialTab = 'api', options = \{\}\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'openAccountManager function should exist');
  const fn = fnMatch[0];
  const openIndex = fn.indexOf("openDialog($('#accountOverlay')");
  const refreshIndex = fn.indexOf('refreshAccountManagerData');
  const firstAwaitIndex = fn.indexOf('await ');
  assert.ok(openIndex >= 0, 'account dialog should be opened by openAccountManager');
  assert.ok(refreshIndex > openIndex, 'refresh should be scheduled after opening the dialog');
  assert.equal(firstAwaitIndex, -1, 'openAccountManager should not await network requests before opening the dialog');
  assert.match(app, /async function refreshAccountManagerData\(/);
});

test('设置页面只保留生成、外观、存储、部署、备份，不再混入管理员和账号分区', () => {
  const sections = [
    ['generation', '生成'],
    ['appearance', '外观'],
    ['storage', '图片存储'],
    ['deploy', '部署'],
    ['backup', '备份'],
  ];
  for (const [key, label] of sections) {
    assert.match(html, new RegExp(`id="settingsNav${key[0].toUpperCase()}${key.slice(1)}"[\\s\\S]*role="tab"[\\s\\S]*>${label}`), `${label} nav should exist`);
    assert.match(html, new RegExp(`id="settingsPanel${key[0].toUpperCase()}${key.slice(1)}"[\\s\\S]*role="tabpanel"`), `${label} panel should exist`);
  }
  for (const removed of ['settingsNavQuick', 'settingsNavAdmin', 'settingsNavAccounts', 'settingsPanelQuick', 'settingsPanelAdmin', 'settingsPanelAccounts']) {
    assert.doesNotMatch(html, new RegExp(`id="${removed}"`), `${removed} should be removed`);
  }
  assert.doesNotMatch(html, /服务端默认配置|id="serverDefaultImageModel"|id="serverDefaultResponsesModel"|id="serverDefaultStreamMode"|id="serverDefaultForceProxy"/);
  assert.match(css, /\.settings-center-shell/);
  assert.match(css, /\.settings-center-nav/);
  assert.match(app, /function setSettingsPanel\(panel\)/);
});

test('账号管理承载 API Key、ChatGPT 登录、保存位置和连接测试', () => {
  const account = accountOverlay();
  assert.match(account, /API Key 账号/);
  assert.match(account, /ChatGPT 登录/);
  assert.match(account, /保存位置/);
  assert.match(account, /id="accountTabApi"[^>]*role="tab"[^>]*aria-controls="accountPanelApi"/);
  assert.match(account, /id="accountTabOauth"[^>]*role="tab"[^>]*aria-controls="accountPanelOauth"/);
  assert.match(account, /id="accountTabAdvanced"[^>]*role="tab"[^>]*aria-controls="accountPanelAdvanced"/);
  assert.match(account, /id="accountList"/);
  assert.match(account, /id="oauthAccountList"/);
  assert.match(account, /id="testConnection"/);
  assert.match(account, /id="accountTestResult" class="toast hidden"/);
  assert.match(app, /function setConnectionTestResult\(/);
  assert.match(html, /id="switcherName">未配置账号<\/span>/);
  assert.match(app, /name\.textContent = '未配置账号'/);
});

test('Upstash 与浏览器迁移入口放在账号管理的保存位置里，设置页不再承载账号存储配置', () => {
  const account = accountOverlay();
  const storage = sectionById('settingsPanelStorage');

  assert.match(account, /账号保存位置/);
  assert.match(account, /Node \/ Docker 将优先保存到服务端账号存储/);
  assert.match(account, /未配置时继续保存到当前浏览器/);
  assert.match(account, /id="accountStoreTypeSelect"/);
  assert.match(account, /id="accountStoreUpstashRestUrl"/);
  assert.match(account, /id="accountStoreUpstashRestToken"/);
  assert.match(account, /id="accountStoreEncryptionKey"/);
  assert.match(account, /id="saveAccountStoreConfig"/);
  assert.match(account, /id="testAccountStoreConfig"/);
  assert.match(account, /迁移当前浏览器账号到服务端/);
  assert.doesNotMatch(storage, /账号存储配置|Upstash REST URL|accountStoreTypeSelect|migrateBrowserAccountsBtn/);

  assert.match(app, /accountStore:\s*readAccountStoreConfigForm\(\)/);
  assert.match(app, /async function saveAccountStoreConfigFromForm/);
  assert.match(app, /function readAccountStoreConfigForm/);
  assert.match(app, /function fillAccountStoreConfigForm/);
  assert.match(app, /async function testAccountStoreConfigFromForm/);
});

test('登录态失效保存设置时提示重新登录，而不是让用户去设置页找管理员入口', () => {
  assert.match(app, /const serverSaveSkippedBecauseAdminLocked = !hasValidAdminSession\(\)/);
  assert.match(app, /请重新登录管理员/);
  assert.match(app, /当前部署不支持服务端配置保存/);
});

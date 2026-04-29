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

test('设置入口打开的是统一设置中心，不再维护独立账号管理弹窗', () => {
  assert.match(html, /<h2 id="settingsTitle">设置中心<\/h2>/);
  assert.match(html, /id="settingsCenterNav"[^>]*role="tablist"[^>]*aria-label="设置中心导航"/);
  assert.doesNotMatch(html, /id="accountOverlay"/);
  assert.doesNotMatch(app, /openDialog\(\$\('#accountOverlay'\)/);
  assert.match(app, /async function openSettingsCenter\(initialPanel = 'quick'/);
  assert.match(app, /openSettingsCenter\('accounts', \{[^}]*restoreFocus: '#switcherBtn'[^}]*\}\)/);
});

test('设置中心提供新用户可理解的九个语义分区', () => {
  const sections = [
    ['quick', '快速开始'],
    ['admin', '管理员'],
    ['accounts', '账号'],
    ['generation', '生成默认值'],
    ['connection', '连接与代理'],
    ['storage', '存储与同步'],
    ['deploy', '部署同步'],
    ['appearance', '增强与外观'],
    ['backup', '导入 / 导出'],
  ];
  for (const [key, label] of sections) {
    assert.match(html, new RegExp(`id="settingsNav${key[0].toUpperCase()}${key.slice(1)}"[\\s\\S]*role="tab"[\\s\\S]*>${label}`), `${label} nav should exist`);
    assert.match(html, new RegExp(`id="settingsPanel${key[0].toUpperCase()}${key.slice(1)}"[\\s\\S]*role="tabpanel"`), `${label} panel should exist`);
  }
  assert.match(css, /\.settings-center-shell/);
  assert.match(css, /\.settings-center-nav/);
  assert.match(app, /function setSettingsPanel\(panel\)/);
});

test('快速开始明确提示先添加生成账号，并提供管理员、API Key、OAuth 和测试连接入口', () => {
  const quick = sectionById('settingsPanelQuick');
  assert.match(quick, /未配置账号/);
  assert.match(quick, /添加 API Key 或登录 ChatGPT 后才能生成图片/);
  assert.match(quick, /解锁管理员/);
  assert.match(quick, /添加 API Key 账号/);
  assert.match(quick, /登录 ChatGPT 账号/);
  assert.match(quick, /测试当前账号连接/);
  assert.match(html, /id="accountTestResult" class="toast hidden"/);
  assert.match(app, /function setConnectionTestResult\(/);
  assert.match(html, /id="switcherName">未配置账号<\/span>/);
  assert.match(app, /name\.textContent = '未配置账号'/);
});

test('管理员、连接、存储和部署能力从账号高级区拆出到对应分区', () => {
  const admin = sectionById('settingsPanelAdmin');
  const connection = sectionById('settingsPanelConnection');
  const storage = sectionById('settingsPanelStorage');
  const deploy = sectionById('settingsPanelDeploy');
  const accounts = sectionById('settingsPanelAccounts');

  assert.match(admin, /管理员解锁/);
  assert.match(admin, /登录后，?默认拥有全部管理权限/);
  assert.match(connection, /全局代理/);
  assert.match(connection, /CORS 失败时会自动回退代理/);
  assert.match(storage, /Upstash/);
  assert.match(storage, /未配置时继续保存到当前浏览器/);
  assert.match(storage, /id="accountStoreTypeSelect"/);
  assert.match(storage, /id="accountStoreUpstashRestUrl"/);
  assert.match(storage, /id="accountStoreUpstashRestToken"/);
  assert.match(storage, /id="accountStoreEncryptionKey"/);
  assert.match(storage, /id="testAccountStoreConfig"/);
  assert.match(deploy, /部署同步/);
  assert.match(deploy, /同步环境变量/);
  assert.doesNotMatch(accounts, /部署平台配置|deployApiToken|configPlatformSync/);
});

test('设置中心提供 Upstash 配置保存和连接测试入口', () => {
  const storage = sectionById('settingsPanelStorage');
  assert.match(storage, /账号存储配置/);
  assert.match(storage, /账号保存策略/);
  assert.match(storage, /Upstash REST URL/);
  assert.match(storage, /Upstash REST Token/);
  assert.match(storage, /账号加密 Key/);
  assert.match(storage, /测试账号存储/);
  assert.match(app, /accountStore:\s*readAccountStoreConfigForm\(\)/);
  assert.match(app, /function readAccountStoreConfigForm/);
  assert.match(app, /function fillAccountStoreConfigForm/);
  assert.match(app, /async function testAccountStoreConfigFromForm/);
});

test('未解锁管理员保存设置时提示先解锁，而不是误报部署不支持服务端配置', () => {
  assert.match(app, /const serverSaveSkippedBecauseAdminLocked = !hasValidAdminSession\(\)/);
  assert.match(app, /如需写入服务端配置，请先解锁管理员/);
  assert.match(app, /当前部署不支持服务端配置保存/);
});

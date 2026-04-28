import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function installBrowserStubs() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  };
  globalThis.document = {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return {
        click() {},
        appendChild() {},
        classList: { add() {}, remove() {}, toggle() {} },
        dataset: {},
        setAttribute() {},
        style: {},
      };
    },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.confirm = () => true;
  globalThis.alert = () => {};
}

async function loadApp() {
  installBrowserStubs();
  const app = await import(`../app.js?settingsBackup=${Date.now()}`);
  const { state } = await import('../frontend/state.js');
  state.data = { activeId: null, accounts: [], useProxy: false };
  localStorage.clear();
  return { app, state };
}

test('设置页提供安全导出、完整加密导出和导入预览入口', () => {
  for (const id of [
    'backupSettingsSection',
    'backupPassword',
    'exportSafeBackup',
    'exportEncryptedBackup',
    'importBackupPick',
    'importBackupFile',
    'importBackupPreview',
    'confirmImportBackup',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /\.backup-actions/);
  assert.match(css, /\.backup-preview/);
});

test('安全导出会剔除 key、OAuth token 和 session 字段，完整 payload 才保留', async () => {
  const { app, state } = await loadApp();
  state.data.accounts = [{
    id: 'acc-1',
    type: 'oauth',
    name: 'OAuth',
    apiUrl: 'https://example.invalid',
    apiKey: 'dummy-api-key',
    refreshToken: 'dummy-refresh-token',
    openaiDeviceId: 'dummy-device',
    openaiSessionId: 'dummy-session',
    email: 'person@example.invalid',
    model: 'gpt-image-2',
  }];

  const safeAccount = app.sanitizeAccountForExport(state.data.accounts[0], false);
  assert.equal('apiKey' in safeAccount, false);
  assert.equal('refreshToken' in safeAccount, false);
  assert.equal('openaiDeviceId' in safeAccount, false);
  assert.equal('openaiSessionId' in safeAccount, false);
  assert.equal('email' in safeAccount, false);

  const safePayload = app.buildBackupPayload({ includeSecrets: false });
  assert.equal(safePayload.containsSecrets, false);
  assert.equal('apiKey' in safePayload.accounts[0], false);

  const fullPayload = app.buildBackupPayload({ includeSecrets: true });
  assert.equal(fullPayload.containsSecrets, true);
  assert.equal(fullPayload.accounts[0].apiKey, 'dummy-api-key');
});

test('完整备份必须加密，解密后才能恢复敏感字段', async () => {
  const { app } = await loadApp();
  const payload = app.normalizeBackupPayload({
    app: 'image-gen',
    accounts: [{ id: 'acc-1', apiKey: 'dummy-api-key', refreshToken: 'dummy-refresh-token' }],
    settings: {},
    promptHistory: [],
    containsSecrets: true,
  });

  await assert.rejects(() => app.encryptBackupPayload(payload, ''), /完整导出需要输入加密密码/);
  const envelope = await app.encryptBackupPayload(payload, 'test-password');
  assert.equal(envelope.encrypted, true);
  assert.equal(JSON.stringify(envelope).includes('dummy-api-key'), false);

  const decrypted = await app.decryptBackupEnvelope(envelope, 'test-password');
  assert.equal(decrypted.accounts[0].apiKey, 'dummy-api-key');
  await assert.rejects(() => app.decryptBackupEnvelope(envelope, 'wrong-password'));
});

test('导入支持只应用提示词历史或只应用设置', async () => {
  const { app, state } = await loadApp();
  state.appSettings.generation.size = '1024x1024';

  const payload = app.normalizeBackupPayload({
    app: 'image-gen',
    accounts: [{ id: 'imported-account', apiUrl: 'https://example.invalid' }],
    settings: { generation: { size: '1536x864' } },
    promptHistory: [{ id: 'hist-1', source: 'prompt', final: 'prompt', createdAt: 1 }],
  });
  const summary = app.summarizeBackupPayload(payload);
  assert.match(summary, /账号：1 个/);
  assert.match(summary, /提示词历史：1 条/);

  const result = app.applyImportedBackup(payload, { accounts: false, settings: true, promptHistory: false });
  assert.deepEqual(result, { accounts: 0, settings: 1, promptHistory: 0 });
  assert.equal(state.data.accounts.length, 0);
  assert.equal(state.appSettings.generation.size, '1536x864');
});

test('备份功能绑定到设置页按钮', () => {
  assert.match(appSource, /exportSafeBackup/);
  assert.match(appSource, /exportEncryptedBackup/);
  assert.match(appSource, /previewBackupImportFromFile/);
  assert.match(appSource, /confirmImportBackup/);
  assert.match(appSource, /PBKDF2/);
  assert.match(appSource, /AES-GCM/);
});

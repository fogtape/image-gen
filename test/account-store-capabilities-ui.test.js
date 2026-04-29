import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const state = fs.readFileSync(new URL('../frontend/state.js', import.meta.url), 'utf8');

test('设置中心账号保存位置接入服务端能力接口并保留浏览器 fallback 文案', () => {
  assert.match(html, /id="settingsAccountStorageStatus"/);
  assert.match(html, /id="accountStoreType"/);
  assert.match(html, /id="accountStoreDetail"/);
  assert.match(html, /id="accountStoreEncrypted"/);
  assert.match(html, /未配置时继续保存到当前浏览器/);

  assert.match(state, /accountStoreCapabilities:\s*null/);
  assert.match(app, /async function fetchAccountStoreCapabilities/);
  assert.match(app, /\/api\/accounts\/capabilities/);
  assert.match(app, /function syncAccountStoreUi/);
  assert.match(app, /账号当前保存位置：浏览器缓存/);
  assert.match(app, /accountStoreCapabilities/);
});

test('账号存储能力缺失或不可用时继续使用浏览器缓存路径', () => {
  assert.match(app, /resp\.status === 404/);
  assert.match(app, /fallbackAccountStoreCapabilities\('api-not-found'\)/);
  assert.match(app, /fallbackAccountStoreCapabilities\('api-error'\)/);
  assert.match(app, /store\.available === true[\s\S]*store\.type !== 'browser'/);
  assert.match(app, /当前部署未启用可写的服务端账号存储，账号会继续保存在浏览器缓存/);
  assert.match(app, /\.catch\(\(error\) => accountStoreSyncWarning\('create', error\)\)/);
  assert.match(app, /\.catch\(\(error\) => accountStoreSyncWarning\('update', error\)\)/);
  assert.match(app, /\.catch\(\(error\) => accountStoreSyncWarning\('delete', error\)\)/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAccountStore } from '../account-store.js';
import { createFileAccountStore } from '../account-store-file.js';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `image-gen-${name}-`));
}

const manualAccount = {
  id: 'manual-1',
  type: 'manual',
  name: 'Primary API',
  apiUrl: 'https://api.example.invalid',
  apiKey: 'sk-test-secret-value',
  model: 'gpt-image-2',
  responsesModel: 'gpt-5.4',
  streamMode: false,
  responsesAutoFallback: true,
  imageEditsCompatMode: false,
  createdAt: 1710000000000,
};

const oauthAccount = {
  id: 'oauth-1',
  type: 'oauth',
  name: 'ChatGPT User',
  apiUrl: 'https://api.openai.com',
  apiKey: 'oauth-access-token-secret',
  refreshToken: 'oauth-refresh-token-secret',
  email: 'user@example.invalid',
  accountId: 'acct-test',
  planType: 'plus',
  openaiDeviceId: 'device-secret',
  openaiSessionId: 'session-secret',
  tokenExpiresAt: 1710003600000,
  createdAt: 1710000000000,
};

test('文件账号存储加密落盘，读取列表只返回脱敏账号', async () => {
  const root = tempRoot('account-store-file-encrypted');
  const filePath = path.join(root, 'accounts.enc.json');
  const store = createFileAccountStore({
    filePath,
    encryptionKey: 'unit-test-account-store-key',
  });

  await store.saveAccounts({ activeId: 'oauth-1', accounts: [manualAccount, oauthAccount] });

  const raw = fs.readFileSync(filePath, 'utf8');
  const envelope = JSON.parse(raw);
  assert.equal(envelope.encrypted, true);
  assert.equal(envelope.app, 'image-gen');
  assert.equal(envelope.store, 'accounts');
  assert.doesNotMatch(raw, /sk-test-secret-value/);
  assert.doesNotMatch(raw, /oauth-access-token-secret/);
  assert.doesNotMatch(raw, /oauth-refresh-token-secret/);
  assert.doesNotMatch(raw, /session-secret/);

  const listing = await store.listAccounts();
  assert.equal(listing.activeId, 'oauth-1');
  assert.equal(listing.accounts.length, 2);
  const listedManual = listing.accounts.find((item) => item.id === 'manual-1');
  const listedOauth = listing.accounts.find((item) => item.id === 'oauth-1');
  assert.equal(listedManual.hasApiKey, true);
  assert.equal(listedOauth.hasRefreshToken, true);
  assert.equal('apiKey' in listedManual, false);
  assert.equal('refreshToken' in listedOauth, false);
  assert.equal('openaiSessionId' in listedOauth, false);

  const full = await store.loadAccounts({ includeSecrets: true });
  assert.equal(full.accounts.find((item) => item.id === 'manual-1').apiKey, 'sk-test-secret-value');
  assert.equal(full.accounts.find((item) => item.id === 'oauth-1').refreshToken, 'oauth-refresh-token-secret');
});

test('文件账号存储支持原子更新、删除并清理临时文件', async () => {
  const root = tempRoot('account-store-file-atomic');
  const filePath = path.join(root, 'nested', 'accounts.enc.json');
  const store = createFileAccountStore({
    filePath,
    encryptionKey: 'unit-test-account-store-key',
  });

  await store.upsertAccount(manualAccount, { activeId: 'manual-1' });
  await store.upsertAccount({ ...manualAccount, name: 'Renamed', apiKey: 'new-secret' });
  let full = await store.loadAccounts({ includeSecrets: true });
  assert.equal(full.activeId, 'manual-1');
  assert.equal(full.accounts.length, 1);
  assert.equal(full.accounts[0].name, 'Renamed');
  assert.equal(full.accounts[0].apiKey, 'new-secret');

  await store.deleteAccount('manual-1');
  full = await store.loadAccounts({ includeSecrets: true });
  assert.equal(full.activeId, null);
  assert.equal(full.accounts.length, 0);

  const leftovers = fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('Node/Docker 账号存储会生成本地加密 key，复用挂载目录后可重新读取', async () => {
  const root = tempRoot('account-store-node-factory');
  const dataDir = path.join(root, 'data');
  const configDir = path.join(root, 'config');

  const first = createAccountStore({
    env: {},
    isServerless: false,
    dataDir,
    configDir,
  });
  assert.equal(first.capabilities.store.type, 'file');
  assert.equal(first.capabilities.store.available, true);
  assert.equal(first.capabilities.store.encrypted, true);

  await first.store.saveAccounts({ activeId: 'manual-1', accounts: [manualAccount] });
  assert.equal(fs.existsSync(path.join(configDir, '.account-store-key')), true);

  const second = createAccountStore({
    env: {},
    isServerless: false,
    dataDir,
    configDir,
  });
  const full = await second.store.loadAccounts({ includeSecrets: true });
  assert.equal(full.activeId, 'manual-1');
  assert.equal(full.accounts[0].apiKey, 'sk-test-secret-value');
});

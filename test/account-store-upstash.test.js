import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountStore } from '../account-store.js';
import { createUpstashAccountStore } from '../account-store-upstash.js';

const manualAccount = {
  id: 'manual-upstash',
  type: 'manual',
  name: 'Remote API',
  apiUrl: 'https://api.example.invalid',
  apiKey: 'sk-upstash-secret-value',
  model: 'gpt-image-2',
  responsesModel: 'gpt-5.4',
  createdAt: 1710000000000,
};

const oauthAccount = {
  id: 'oauth-upstash',
  type: 'oauth',
  name: 'Remote ChatGPT',
  apiUrl: 'https://api.openai.com',
  apiKey: 'oauth-upstash-access-secret',
  refreshToken: 'oauth-upstash-refresh-secret',
  openaiSessionId: 'oauth-upstash-session-secret',
  email: 'remote@example.invalid',
  accountId: 'acct-upstash',
  createdAt: 1710000000000,
};

function createMockFetch() {
  const calls = [];
  const redis = new Map();
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(init.body || '[]');
    calls.push({ url, init, body });
    const [command, key, value] = body;
    if (command === 'GET') return Response.json({ result: redis.get(key) || null });
    if (command === 'SET') {
      redis.set(key, value);
      return Response.json({ result: 'OK' });
    }
    return Response.json({ error: 'unsupported command' }, { status: 400 });
  };
  return { calls, redis, fetchImpl };
}

function assertNoSecrets(text) {
  for (const secret of [
    manualAccount.apiKey,
    oauthAccount.apiKey,
    oauthAccount.refreshToken,
    oauthAccount.openaiSessionId,
    'upstash-rest-secret-token',
    'upstash-account-encryption-key',
  ]) {
    assert.doesNotMatch(text, new RegExp(secret));
  }
}

test('Upstash 账号存储使用 Redis REST 加密保存并只返回脱敏列表', async () => {
  const mock = createMockFetch();
  const store = createUpstashAccountStore({
    restUrl: 'https://upstash.example.invalid',
    restToken: 'upstash-rest-secret-token',
    encryptionKey: 'upstash-account-encryption-key',
    namespace: 'image-gen-test',
    deploymentId: 'deploy-a',
    fetchImpl: mock.fetchImpl,
  });

  await store.saveAccounts({ activeId: 'oauth-upstash', accounts: [manualAccount, oauthAccount] });

  assert.equal(mock.calls[0].url, 'https://upstash.example.invalid');
  assert.deepEqual(mock.calls[0].body.slice(0, 2), ['SET', 'image-gen-test:accounts:deploy-a']);
  assert.equal(mock.calls[0].init.headers.Authorization, 'Bearer upstash-rest-secret-token');
  assertNoSecrets(mock.calls[0].init.body);

  const listing = await store.listAccounts();
  assert.equal(listing.activeId, 'oauth-upstash');
  assert.equal(listing.accounts.length, 2);
  assert.equal(listing.accounts.find((item) => item.id === 'manual-upstash').hasApiKey, true);
  assert.equal(listing.accounts.find((item) => item.id === 'oauth-upstash').hasRefreshToken, true);
  assert.equal('apiKey' in listing.accounts[0], false);
  assertNoSecrets(JSON.stringify(listing));

  const full = await store.loadAccounts({ includeSecrets: true });
  assert.equal(full.accounts.find((item) => item.id === 'manual-upstash').apiKey, manualAccount.apiKey);
  assert.equal(full.accounts.find((item) => item.id === 'oauth-upstash').refreshToken, oauthAccount.refreshToken);
});

test('Upstash 账号存储支持 upsert、patch 和 delete 并保持 secret 不回显', async () => {
  const mock = createMockFetch();
  const store = createUpstashAccountStore({
    restUrl: 'https://upstash.example.invalid',
    restToken: 'upstash-rest-secret-token',
    encryptionKey: 'upstash-account-encryption-key',
    fetchImpl: mock.fetchImpl,
  });

  await store.upsertAccount(manualAccount, { activeId: 'manual-upstash' });
  await store.patchAccount('manual-upstash', { name: 'Renamed Remote API' });
  let full = await store.loadAccounts({ includeSecrets: true });
  assert.equal(full.accounts[0].name, 'Renamed Remote API');
  assert.equal(full.accounts[0].apiKey, manualAccount.apiKey);

  await store.deleteAccount('manual-upstash');
  const listing = await store.listAccounts();
  assert.equal(listing.activeId, null);
  assert.equal(listing.accounts.length, 0);
  assertNoSecrets(JSON.stringify(listing));
});

test('账号存储工厂在 Upstash 可用时创建远程存储且不生成本地文件存储', async () => {
  const mock = createMockFetch();
  const context = createAccountStore({
    env: {
      IMAGE_GEN_ACCOUNT_STORE: 'upstash',
      IMAGE_GEN_UPSTASH_REDIS_REST_URL: 'https://upstash.example.invalid',
      IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN: 'upstash-rest-secret-token',
      IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY: 'upstash-account-encryption-key',
      IMAGE_GEN_ACCOUNT_STORE_NAMESPACE: 'image-gen-test',
      IMAGE_GEN_DEPLOYMENT_ID: 'deploy-factory',
    },
    isServerless: true,
    fetchImpl: mock.fetchImpl,
  });

  assert.equal(context.capabilities.store.type, 'upstash');
  assert.equal(context.capabilities.store.available, true);
  assert.equal(context.capabilities.store.encrypted, true);
  await context.store.saveAccounts({ activeId: 'manual-upstash', accounts: [manualAccount] });
  assert.deepEqual(mock.calls[0].body.slice(0, 2), ['SET', 'image-gen-test:accounts:deploy-factory']);
});

test('Upstash 错误信息不泄露 URL、Token 或账号加密 key', async () => {
  const store = createUpstashAccountStore({
    restUrl: 'https://upstash-secret-host.invalid',
    restToken: 'upstash-rest-secret-token',
    encryptionKey: 'upstash-account-encryption-key',
    fetchImpl: async () => Response.json({ error: 'denied' }, { status: 403 }),
  });

  await assert.rejects(
    () => store.listAccounts(),
    (error) => {
      const text = `${error.message} ${error.stack || ''}`;
      assert.match(error.message, /Upstash account store request failed/);
      assertNoSecrets(text);
      assert.doesNotMatch(text, /upstash-secret-host/);
      return true;
    },
  );
});

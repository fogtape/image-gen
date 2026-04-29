import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-upstash-config-api-'));
process.env.IMAGE_GEN_CONFIG_DIR = path.join(tmpRoot, 'config');
process.env.IMAGE_GEN_DATA_DIR = path.join(tmpRoot, 'data');
process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token-upstash-config';
process.env.VERCEL = '1';
delete process.env.IMAGE_GEN_ACCOUNT_STORE;
delete process.env.IMAGE_GEN_ACCOUNT_STORE_NAMESPACE;
delete process.env.IMAGE_GEN_DEPLOYMENT_ID;
delete process.env.IMAGE_GEN_UPSTASH_REDIS_REST_URL;
delete process.env.IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN;
delete process.env.IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const ADMIN_TOKEN = process.env.IMAGE_GEN_ADMIN_TOKEN;
const UPSTASH_URL = 'https://upstash-config.example.invalid';
const UPSTASH_TOKEN = 'upstash-config-rest-token-secret';
const ENCRYPTION_KEY = 'upstash-config-encryption-key-secret';

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function postJson(url, body, headers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { resp, text, data };
}

async function getJson(url, headers = {}) {
  const resp = await fetch(url, { headers });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { resp, text, data };
}

function assertNoSecrets(text) {
  assert.doesNotMatch(text, new RegExp(ADMIN_TOKEN));
  assert.doesNotMatch(text, new RegExp(UPSTASH_TOKEN));
  assert.doesNotMatch(text, new RegExp(ENCRYPTION_KEY));
  assert.doesNotMatch(text, /upstash-config\.example\.invalid/);
}

test('Upstash 配置可通过服务端配置保存、脱敏返回，并驱动账号存储能力与连接测试', async () => {
  const originalFetch = globalThis.fetch;
  const redis = new Map();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    calls.push({ target, options });
    assert.equal(target, UPSTASH_URL);
    assert.equal(options.headers?.Authorization, `Bearer ${UPSTASH_TOKEN}`);
    const [command, key, value] = JSON.parse(options.body || '[]');
    if (command === 'GET') return jsonResponse({ result: redis.get(key) || null });
    if (command === 'SET') {
      redis.set(key, value);
      return jsonResponse({ result: 'OK' });
    }
    return jsonResponse({ error: 'unsupported command' }, { status: 400 });
  };

  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'X-Image-Gen-Admin-Token': ADMIN_TOKEN };

    const saved = await postJson(`${base}/api/config/save`, {
      config: {
        accountStore: {
          type: 'upstash',
          namespace: 'image-gen-test',
          deploymentId: 'deploy-config',
          upstashRestUrl: UPSTASH_URL,
          upstashRestToken: UPSTASH_TOKEN,
          encryptionKey: ENCRYPTION_KEY,
        },
      },
    }, headers);

    assert.equal(saved.resp.status, 200, saved.text);
    assert.equal(saved.data.ok, true);
    assert.equal(saved.data.runtime?.accountStore?.type, 'upstash');
    assert.equal(saved.data.runtime?.accountStore?.upstashRestUrlConfigured, true);
    assert.equal(saved.data.runtime?.accountStore?.upstashRestTokenConfigured, true);
    assert.equal(saved.data.runtime?.accountStore?.encryptionKeyConfigured, true);
    assertNoSecrets(saved.text);
    assert.equal('upstashRestToken' in (saved.data.runtime?.accountStore || {}), false);
    assert.equal('encryptionKey' in (saved.data.runtime?.accountStore || {}), false);

    const capabilities = await getJson(`${base}/api/accounts/capabilities`);
    assert.equal(capabilities.resp.status, 200, capabilities.text);
    assert.equal(capabilities.data.store?.type, 'upstash');
    assert.equal(capabilities.data.store?.available, true);
    assert.equal(capabilities.data.store?.encrypted, true);
    assertNoSecrets(capabilities.text);

    const tested = await postJson(`${base}/api/accounts/store/test`, {
      config: {
        accountStore: {
          type: 'upstash',
          namespace: 'image-gen-test',
          deploymentId: 'deploy-config',
        },
      },
    }, headers);
    assert.equal(tested.resp.status, 200, tested.text);
    assert.equal(tested.data.ok, true);
    assert.equal(tested.data.store?.type, 'upstash');
    assert.equal(tested.data.accountCount, 0);
    assertNoSecrets(tested.text);
    assert.ok(calls.some((call) => JSON.parse(call.options.body || '[]')[0] === 'GET'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
  }
});

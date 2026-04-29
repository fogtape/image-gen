import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveAccountStoreCapabilities } from '../account-store-capabilities.js';

function tempDataDir(name) {
  return path.join(os.tmpdir(), `image-gen-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test('Node/Docker 默认提供服务端文件账号存储能力并保留浏览器 fallback', () => {
  const result = resolveAccountStoreCapabilities({
    env: {},
    isServerless: false,
    dataDir: tempDataDir('account-store-file'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.store.type, 'file');
  assert.equal(result.store.available, true);
  assert.equal(result.store.encrypted, true);
  assert.equal(result.store.fallback, 'browser');
  assert.equal(result.store.scope, 'server');
  assert.equal(result.store.reason, 'node-file-store');
});

test('Serverless 未配置 Upstash 时明确回退浏览器缓存', () => {
  const result = resolveAccountStoreCapabilities({
    env: {},
    isServerless: true,
    dataDir: tempDataDir('account-store-serverless'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.store.type, 'browser');
  assert.equal(result.store.available, true);
  assert.equal(result.store.encrypted, false);
  assert.equal(result.store.fallback, 'browser');
  assert.equal(result.store.scope, 'browser');
  assert.equal(result.store.reason, 'serverless-without-upstash');
});

test('配置 Upstash 时返回远程存储能力且不泄露 URL、Token 或加密 Key', () => {
  const secretUrl = 'https://example-upstash.invalid';
  const secretToken = 'secret-upstash-token';
  const secretKey = 'secret-account-encryption-key';
  const result = resolveAccountStoreCapabilities({
    env: {
      IMAGE_GEN_UPSTASH_REDIS_REST_URL: secretUrl,
      IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN: secretToken,
      IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY: secretKey,
    },
    isServerless: true,
    dataDir: tempDataDir('account-store-upstash'),
  });
  const text = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal(result.store.type, 'upstash');
  assert.equal(result.store.available, true);
  assert.equal(result.store.encrypted, true);
  assert.equal(result.store.fallback, 'browser');
  assert.equal(result.store.scope, 'remote');
  assert.equal(result.store.reason, 'upstash-configured');
  assert.doesNotMatch(text, new RegExp(secretUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, new RegExp(secretToken));
  assert.doesNotMatch(text, new RegExp(secretKey));
});

test('显式要求 Upstash 但缺少配置时暴露不可用状态并指向浏览器 fallback', () => {
  const result = resolveAccountStoreCapabilities({
    env: { IMAGE_GEN_ACCOUNT_STORE: 'upstash' },
    isServerless: true,
    dataDir: tempDataDir('account-store-upstash-missing'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.store.type, 'upstash');
  assert.equal(result.store.available, false);
  assert.equal(result.store.encrypted, false);
  assert.equal(result.store.fallback, 'browser');
  assert.equal(result.store.scope, 'remote');
  assert.equal(result.store.reason, 'upstash-not-configured');
});

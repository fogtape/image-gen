import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchJsonWithTimeout, getPlatformApiTimeoutMs } from '../handlers/platform-fetch.js';

test('platform fetch applies timeout and returns a readable safe error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  try {
    await assert.rejects(
      fetchJsonWithTimeout('https://platform.example.test/api', {
        headers: { Authorization: 'Bearer platform-timeout-secret' },
      }, { timeoutMs: 5 }),
      (error) => {
        assert.match(error.message, /超时/);
        assert.doesNotMatch(error.message, /platform-timeout-secret/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('platform fetch redacts bearer token from upstream error messages', async () => {
  const originalFetch = globalThis.fetch;
  const token = 'platform-error-secret';
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: `invalid token ${token}` },
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    await assert.rejects(
      fetchJsonWithTimeout('https://platform.example.test/api', {
        headers: { Authorization: `Bearer ${token}` },
      }, { timeoutMs: 100 }),
      (error) => {
        assert.match(error.message, /invalid token/);
        assert.doesNotMatch(error.message, new RegExp(token));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('platform fetch redacts sensitive environment values echoed from request body', async () => {
  const originalFetch = globalThis.fetch;
  const upstashToken = 'upstash-body-secret-token';
  const encryptionKey = 'account-encryption-secret-key';
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      message: `invalid env values ${upstashToken} and ${encryptionKey}`,
    },
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    await assert.rejects(
      fetchJsonWithTimeout('https://platform.example.test/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN',
          value: upstashToken,
          values: [{ context: 'all', value: encryptionKey, key: 'IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY' }],
        }),
      }, { timeoutMs: 100 }),
      (error) => {
        assert.match(error.message, /invalid env values/);
        assert.doesNotMatch(error.message, new RegExp(upstashToken));
        assert.doesNotMatch(error.message, new RegExp(encryptionKey));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('platform fetch redacts EdgeOne uppercase Key/Value env values echoed by upstream', async () => {
  const originalFetch = globalThis.fetch;
  const upstashToken = 'edgeone-upstash-body-secret';
  const encryptionKey = 'edgeone-encryption-body-secret';
  globalThis.fetch = async () => new Response(JSON.stringify({
    Message: `invalid EnvVars ${upstashToken} ${encryptionKey}`,
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    await assert.rejects(
      fetchJsonWithTimeout('https://platform.example.test/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Action: 'ModifyPagesProjectEnvs',
          EnvVars: [
            { Key: 'IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN', Value: upstashToken },
            { Key: 'IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY', Value: encryptionKey },
          ],
        }),
      }, { timeoutMs: 100 }),
      (error) => {
        assert.match(error.message, /invalid EnvVars/);
        assert.doesNotMatch(error.message, new RegExp(upstashToken));
        assert.doesNotMatch(error.message, new RegExp(encryptionKey));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('platform fetch redacts Cloudflare FormData settings env values echoed by upstream', async () => {
  const originalFetch = globalThis.fetch;
  const upstashToken = 'cloudflare-upstash-body-secret';
  const encryptionKey = 'cloudflare-encryption-body-secret';
  globalThis.fetch = async () => new Response(JSON.stringify({
    errors: [{ message: `invalid bindings ${upstashToken} ${encryptionKey}` }],
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  const formData = new FormData();
  formData.append('settings', new Blob([JSON.stringify({
    bindings: [
      { name: 'IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN', text: upstashToken, type: 'plain_text' },
      { name: 'IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY', text: encryptionKey, type: 'plain_text' },
    ],
  })], { type: 'application/json' }), 'settings.json');
  try {
    await assert.rejects(
      fetchJsonWithTimeout('https://platform.example.test/api', {
        method: 'PATCH',
        body: formData,
      }, { timeoutMs: 100 }),
      (error) => {
        assert.match(error.message, /invalid bindings/);
        assert.doesNotMatch(error.message, new RegExp(upstashToken));
        assert.doesNotMatch(error.message, new RegExp(encryptionKey));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('platform fetch timeout env is bounded', () => {
  const previous = process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS;
  process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS = '1';
  assert.equal(getPlatformApiTimeoutMs(), 1000);
  process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS = '999999';
  assert.equal(getPlatformApiTimeoutMs(), 120000);
  if (previous == null) delete process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS;
  else process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS = previous;
});

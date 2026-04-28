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

test('platform fetch timeout env is bounded', () => {
  const previous = process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS;
  process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS = '1';
  assert.equal(getPlatformApiTimeoutMs(), 1000);
  process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS = '999999';
  assert.equal(getPlatformApiTimeoutMs(), 120000);
  if (previous == null) delete process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS;
  else process.env.IMAGE_GEN_PLATFORM_API_TIMEOUT_MS = previous;
});

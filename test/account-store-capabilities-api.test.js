import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-account-capabilities-api-'));
process.env.IMAGE_GEN_CONFIG_DIR = path.join(tmpRoot, 'config');
process.env.IMAGE_GEN_DATA_DIR = path.join(tmpRoot, 'data');
process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token-account-capabilities';
delete process.env.VERCEL;
delete process.env.NETLIFY;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;
delete process.env.AWS_EXECUTION_ENV;

const { server } = await import('../server.js');

async function getJson(url) {
  const resp = await fetch(url);
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { resp, text, data };
}

test('账号存储能力接口返回脱敏能力信息', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const result = await getJson(`${base}/api/accounts/capabilities`);

    assert.equal(result.resp.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.store.type, 'file');
    assert.equal(result.data.store.available, true);
    assert.equal(result.data.store.fallback, 'browser');
    assert.equal(typeof result.data.store.encrypted, 'boolean');
    assert.doesNotMatch(result.text, /test-admin-token-account-capabilities/);
    assert.doesNotMatch(result.text, /IMAGE_GEN_ADMIN_TOKEN/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

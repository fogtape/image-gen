import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-account-import-api-'));
const adminToken = 'test-admin-token-account-import';
const manualSecret = 'sk-import-manual-secret';
const oauthAccessToken = 'oauth-import-access-secret';
const oauthRefreshToken = 'oauth-import-refresh-secret';
const oauthSession = 'oauth-import-session-secret';

process.env.IMAGE_GEN_CONFIG_DIR = path.join(tmpRoot, 'config');
process.env.IMAGE_GEN_DATA_DIR = path.join(tmpRoot, 'data');
process.env.IMAGE_GEN_ADMIN_TOKEN = adminToken;
delete process.env.VERCEL;
delete process.env.NETLIFY;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;
delete process.env.AWS_EXECUTION_ENV;

const { server } = await import('../server.js');

async function requestJson(base, pathname, { method = 'GET', token = adminToken, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { resp, text, data };
}

function assertNoSecrets(text) {
  for (const secret of [adminToken, manualSecret, oauthAccessToken, oauthRefreshToken, oauthSession]) {
    assert.doesNotMatch(text, new RegExp(secret));
  }
}

test('浏览器账号迁移接口需要管理员鉴权，合并账号并保持响应与落盘脱敏', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const payload = {
      activeId: 'oauth-local',
      accounts: [
        {
          id: 'manual-local',
          type: 'manual',
          name: 'Local API',
          apiUrl: 'https://api.example.invalid',
          apiKey: manualSecret,
          model: 'gpt-image-2',
          responsesModel: 'gpt-5.4',
        },
        {
          id: 'oauth-local',
          type: 'oauth',
          name: 'Local ChatGPT',
          apiKey: oauthAccessToken,
          refreshToken: oauthRefreshToken,
          openaiSessionId: oauthSession,
          email: 'local@example.invalid',
          accountId: 'acct-import',
        },
      ],
    };

    const noAuth = await requestJson(base, '/api/accounts/import-local', {
      method: 'POST',
      token: '',
      body: payload,
    });
    assert.equal(noAuth.resp.status, 401);

    const imported = await requestJson(base, '/api/accounts/import-local', {
      method: 'POST',
      body: payload,
    });
    assert.equal(imported.resp.status, 200);
    assert.equal(imported.data.ok, true);
    assert.equal(imported.data.imported, 2);
    assert.equal(imported.data.activeId, 'oauth-local');
    assert.deepEqual(imported.data.accounts.map((item) => item.id).sort(), ['manual-local', 'oauth-local']);
    assert.equal(imported.data.accounts.find((item) => item.id === 'manual-local').hasApiKey, true);
    assert.equal(imported.data.accounts.find((item) => item.id === 'oauth-local').hasRefreshToken, true);
    assertNoSecrets(imported.text);

    const importedAgain = await requestJson(base, '/api/accounts/import-local', {
      method: 'POST',
      body: payload,
    });
    assert.equal(importedAgain.resp.status, 200);
    assert.equal(importedAgain.data.accounts.length, 2);
    assert.equal(importedAgain.data.imported, 2);
    assertNoSecrets(importedAgain.text);

    const rawStore = fs.readFileSync(path.join(tmpRoot, 'data', 'accounts.enc.json'), 'utf8');
    assert.match(rawStore, /"encrypted": true/);
    assertNoSecrets(rawStore);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

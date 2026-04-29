import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-account-crud-api-'));
const adminToken = 'test-admin-token-account-crud';
const firstSecret = 'sk-crud-first-secret';
const secondSecret = 'sk-crud-second-secret';
const oauthAccessToken = 'oauth-crud-access-secret';
const oauthRefreshToken = 'oauth-crud-refresh-secret';
const oauthSession = 'oauth-crud-session-secret';

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
  for (const secret of [adminToken, firstSecret, secondSecret, oauthAccessToken, oauthRefreshToken, oauthSession]) {
    assert.doesNotMatch(text, new RegExp(secret));
  }
}

test('服务端账号 CRUD 需要管理员鉴权，响应和落盘文件都不回显 secret', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;

    const noAuthList = await requestJson(base, '/api/accounts', { token: '' });
    assert.equal(noAuthList.resp.status, 401);

    const noAuthCreate = await requestJson(base, '/api/accounts', {
      method: 'POST',
      token: '',
      body: { account: { id: 'manual-1', name: 'No Auth', apiKey: firstSecret } },
    });
    assert.equal(noAuthCreate.resp.status, 401);

    const created = await requestJson(base, '/api/accounts', {
      method: 'POST',
      body: {
        activeId: 'manual-1',
        account: {
          id: 'manual-1',
          type: 'manual',
          name: 'Primary API',
          apiUrl: 'https://api.example.invalid',
          apiKey: firstSecret,
          model: 'gpt-image-2',
          responsesModel: 'gpt-5.4',
        },
      },
    });
    assert.equal(created.resp.status, 201);
    assert.equal(created.data.ok, true);
    assert.equal(created.data.activeId, 'manual-1');
    assert.equal(created.data.account.id, 'manual-1');
    assert.equal(created.data.account.hasApiKey, true);
    assert.equal('apiKey' in created.data.account, false);
    assertNoSecrets(created.text);

    const listed = await requestJson(base, '/api/accounts');
    assert.equal(listed.resp.status, 200);
    assert.equal(listed.data.ok, true);
    assert.equal(listed.data.accounts.length, 1);
    assert.equal(listed.data.accounts[0].hasApiKey, true);
    assert.equal('apiKey' in listed.data.accounts[0], false);
    assertNoSecrets(listed.text);

    const rawStore = fs.readFileSync(path.join(tmpRoot, 'data', 'accounts.enc.json'), 'utf8');
    assert.match(rawStore, /"encrypted": true/);
    assertNoSecrets(rawStore);

    const patchedNameOnly = await requestJson(base, '/api/accounts/manual-1', {
      method: 'PATCH',
      body: { account: { name: 'Renamed API' } },
    });
    assert.equal(patchedNameOnly.resp.status, 200);
    assert.equal(patchedNameOnly.data.account.name, 'Renamed API');
    assert.equal(patchedNameOnly.data.account.hasApiKey, true);
    assertNoSecrets(patchedNameOnly.text);

    const patchedSecret = await requestJson(base, '/api/accounts/manual-1', {
      method: 'PATCH',
      body: { account: { apiKey: secondSecret } },
    });
    assert.equal(patchedSecret.resp.status, 200);
    assert.equal(patchedSecret.data.account.hasApiKey, true);
    assertNoSecrets(patchedSecret.text);

    const createdOauth = await requestJson(base, '/api/accounts', {
      method: 'POST',
      body: {
        account: {
          id: 'oauth-1',
          type: 'oauth',
          name: 'ChatGPT',
          apiKey: oauthAccessToken,
          refreshToken: oauthRefreshToken,
          openaiSessionId: oauthSession,
          email: 'user@example.invalid',
          accountId: 'acct-crud',
        },
      },
    });
    assert.equal(createdOauth.resp.status, 201);
    assert.equal(createdOauth.data.account.hasApiKey, true);
    assert.equal(createdOauth.data.account.hasRefreshToken, true);
    assert.equal(createdOauth.data.account.hasOAuthSession, true);
    assert.equal('apiKey' in createdOauth.data.account, false);
    assert.equal('refreshToken' in createdOauth.data.account, false);
    assert.equal('openaiSessionId' in createdOauth.data.account, false);
    assertNoSecrets(createdOauth.text);

    const deletedNoAuth = await requestJson(base, '/api/accounts/manual-1', { method: 'DELETE', token: '' });
    assert.equal(deletedNoAuth.resp.status, 401);

    const deleted = await requestJson(base, '/api/accounts/manual-1', { method: 'DELETE' });
    assert.equal(deleted.resp.status, 200);
    assert.equal(deleted.data.ok, true);
    assert.equal(deleted.data.deletedId, 'manual-1');
    assertNoSecrets(deleted.text);

    const afterDelete = await requestJson(base, '/api/accounts');
    assert.equal(afterDelete.data.accounts.length, 1);
    assert.equal(afterDelete.data.accounts[0].id, 'oauth-1');
    assertNoSecrets(afterDelete.text);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

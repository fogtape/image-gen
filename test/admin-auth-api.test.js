import assert from 'node:assert/strict';
import test from 'node:test';

const adminToken = 'test-admin-token-bearer-session';
process.env.VERCEL = '1';
process.env.IMAGE_GEN_ADMIN_TOKEN = adminToken;
delete process.env.IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN;

const { server } = await import('../server.js');

async function getJson(url, headers = {}) {
  const resp = await fetch(url, { method: 'GET', headers });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { resp, text, data };
}

test('管理员 session 接口使用 Bearer 校验且不泄露 token', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;

    const noToken = await getJson(`${base}/api/admin/session`);
    assert.equal(noToken.resp.status, 401);
    assert.doesNotMatch(noToken.text, new RegExp(adminToken));

    const wrong = await getJson(`${base}/api/admin/session`, { Authorization: 'Bearer wrong-admin-token' });
    assert.equal(wrong.resp.status, 401);
    assert.doesNotMatch(wrong.text, new RegExp(adminToken));

    const ok = await getJson(`${base}/api/admin/session`, { Authorization: `Bearer ${adminToken}` });
    assert.equal(ok.resp.status, 200);
    assert.equal(ok.data.ok, true);
    assert.equal(ok.data.role, 'admin');
    assert.doesNotMatch(ok.text, new RegExp(adminToken));

    const editableWithBearer = await getJson(`${base}/api/config/editable`, { Authorization: `Bearer ${adminToken}` });
    assert.equal(editableWithBearer.resp.status, 200);
    assert.equal(editableWithBearer.data.ok, true);

    const editableWithLegacyHeader = await getJson(`${base}/api/config/editable`, { 'X-Image-Gen-Admin-Token': adminToken });
    assert.equal(editableWithLegacyHeader.resp.status, 200);
    assert.equal(editableWithLegacyHeader.data.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('管理员安全状态接口只返回脱敏能力信息', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const status = await getJson(`${base}/api/admin/security`);

    assert.equal(status.resp.status, 200);
    assert.equal(status.data.ok, true);
    assert.equal(status.data.security.adminTokenConfigured, true);
    assert.equal(typeof status.data.capabilities.canManageConfig, 'boolean');
    assert.doesNotMatch(status.text, new RegExp(adminToken));
    assert.equal('adminToken' in status.data.security, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

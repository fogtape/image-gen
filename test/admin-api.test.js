import assert from 'node:assert/strict';
import test from 'node:test';

function installStorage() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  };
}

async function loadModules() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const session = await import(`../frontend/admin-session.js?adminApiTest=${suffix}`);
  const api = await import(`../frontend/admin-api.js?adminApiTest=${suffix}`);
  return { session, api };
}

test('adminFetch 未登录时拒绝请求并提示先完成管理员登录', async () => {
  installStorage();
  const { api } = await loadModules();
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not fetch'); };

  await assert.rejects(() => api.adminFetch('/api/config/editable'), (error) => {
    assert.equal(error.code, 'ADMIN_AUTH_REQUIRED');
    assert.equal(error.status, 401);
    assert.match(error.message, /管理员登录/);
    return true;
  });
  assert.equal(called, false);
});

test('adminFetch 会自动附加 Bearer 管理员会话', async () => {
  installStorage();
  const { session, api } = await loadModules();
  session.persistAdminSession('admin-session-token', 60_000);
  let captured = null;
  globalThis.fetch = async (url, init = {}) => {
    captured = { url, init };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const resp = await api.adminFetch('/api/config/save', { method: 'POST', body: JSON.stringify({ config: {} }) });

  assert.equal(resp.status, 200);
  assert.equal(captured.url, '/api/config/save');
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get('Authorization'), 'Bearer admin-session-token');
  assert.equal(headers.get('Content-Type'), 'application/json');
});

test('adminFetch 遇到 401/403 会清理管理员会话', async () => {
  installStorage();
  const { session, api } = await loadModules();
  session.persistAdminSession('expired-admin-token', 60_000);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Admin authentication required' }), { status: 401 });

  await assert.rejects(() => api.adminFetch('/api/config/editable'), (error) => {
    assert.equal(error.code, 'ADMIN_AUTH_EXPIRED');
    assert.equal(error.status, 401);
    assert.match(error.message, /重新登录/);
    return true;
  });
  assert.equal(session.getAdminToken(), '');
});

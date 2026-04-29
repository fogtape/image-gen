import assert from 'node:assert/strict';
import test from 'node:test';

const ADMIN_TOKEN_KEY = 'img-gen-admin-token';
const ADMIN_EXPIRES_KEY = 'img-gen-admin-token-expires-at';
const LEGACY_TOKEN_KEY = 'img-gen-config-admin-token';

function installStorage() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  };
  return storage;
}

async function loadModule() {
  return import(`../frontend/admin-session.js?adminSessionTest=${Date.now()}-${Math.random()}`);
}

test('管理员会话保存 token 并在 TTL 内可读取', async () => {
  installStorage();
  const session = await loadModule();

  session.persistAdminSession('  session-token  ', 60_000);

  assert.equal(localStorage.getItem(ADMIN_TOKEN_KEY), 'session-token');
  assert.ok(Number(localStorage.getItem(ADMIN_EXPIRES_KEY)) > Date.now());
  assert.equal(session.getAdminToken(), 'session-token');
  assert.equal(session.hasValidAdminSession(), true);
});

test('管理员会话过期后自动清理并视为未登录', async () => {
  installStorage();
  const session = await loadModule();
  localStorage.setItem(ADMIN_TOKEN_KEY, 'expired-token');
  localStorage.setItem(ADMIN_EXPIRES_KEY, String(Date.now() - 1));

  assert.equal(session.getAdminToken(), '');
  assert.equal(session.hasValidAdminSession(), false);
  assert.equal(localStorage.getItem(ADMIN_TOKEN_KEY), null);
  assert.equal(localStorage.getItem(ADMIN_EXPIRES_KEY), null);
});

test('退出管理员模式会清理新旧会话 key', async () => {
  installStorage();
  const session = await loadModule();
  localStorage.setItem(ADMIN_TOKEN_KEY, 'token');
  localStorage.setItem(ADMIN_EXPIRES_KEY, String(Date.now() + 60_000));
  localStorage.setItem(LEGACY_TOKEN_KEY, 'legacy-token');

  session.clearAdminSession();

  assert.equal(localStorage.getItem(ADMIN_TOKEN_KEY), null);
  assert.equal(localStorage.getItem(ADMIN_EXPIRES_KEY), null);
  assert.equal(localStorage.getItem(LEGACY_TOKEN_KEY), null);
  assert.equal(session.hasValidAdminSession(), false);
});

test('首次读取时会把旧 configAdminToken 迁移为 12 小时管理员会话', async () => {
  installStorage();
  const session = await loadModule();
  localStorage.setItem(LEGACY_TOKEN_KEY, 'legacy-admin-token');

  assert.equal(session.ADMIN_SESSION_DURATION_MS, 12 * 60 * 60 * 1000);
  assert.equal(session.getAdminToken(), 'legacy-admin-token');
  assert.equal(localStorage.getItem(ADMIN_TOKEN_KEY), 'legacy-admin-token');
  assert.equal(localStorage.getItem(LEGACY_TOKEN_KEY), null);
  const ttl = Number(localStorage.getItem(ADMIN_EXPIRES_KEY)) - Date.now();
  assert.ok(ttl > session.ADMIN_SESSION_DURATION_MS - 5_000);
  assert.ok(ttl <= session.ADMIN_SESSION_DURATION_MS);
});

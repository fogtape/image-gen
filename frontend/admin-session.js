export const ADMIN_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
export const ADMIN_TOKEN_KEY = 'img-gen-admin-token';
export const ADMIN_TOKEN_EXPIRES_AT_KEY = 'img-gen-admin-token-expires-at';
export const LEGACY_CONFIG_ADMIN_TOKEN_KEY = 'img-gen-config-admin-token';

function getStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeToken(token = '') {
  return String(token || '').trim();
}

function expiresAtFromTtl(ttlMs = ADMIN_SESSION_DURATION_MS) {
  const ttl = Number(ttlMs);
  return Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : ADMIN_SESSION_DURATION_MS);
}

export function clearAdminSession() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(ADMIN_TOKEN_KEY);
  storage.removeItem(ADMIN_TOKEN_EXPIRES_AT_KEY);
  storage.removeItem(LEGACY_CONFIG_ADMIN_TOKEN_KEY);
}

export function persistAdminSession(token, ttlMs = ADMIN_SESSION_DURATION_MS) {
  const storage = getStorage();
  if (!storage) return '';
  const text = normalizeToken(token);
  if (!text) {
    clearAdminSession();
    return '';
  }
  storage.setItem(ADMIN_TOKEN_KEY, text);
  storage.setItem(ADMIN_TOKEN_EXPIRES_AT_KEY, String(expiresAtFromTtl(ttlMs)));
  storage.removeItem(LEGACY_CONFIG_ADMIN_TOKEN_KEY);
  return text;
}

function migrateLegacySession(storage) {
  const legacy = normalizeToken(storage.getItem(LEGACY_CONFIG_ADMIN_TOKEN_KEY));
  if (!legacy) return '';
  persistAdminSession(legacy);
  return legacy;
}

function isExpired(expiresAt) {
  const value = Number(expiresAt || 0);
  return !Number.isFinite(value) || value <= Date.now();
}

export function getAdminToken() {
  const storage = getStorage();
  if (!storage) return '';
  let token = normalizeToken(storage.getItem(ADMIN_TOKEN_KEY));
  if (!token) token = migrateLegacySession(storage);
  if (!token) return '';
  if (isExpired(storage.getItem(ADMIN_TOKEN_EXPIRES_AT_KEY))) {
    clearAdminSession();
    return '';
  }
  return token;
}

export function hasValidAdminSession() {
  return !!getAdminToken();
}

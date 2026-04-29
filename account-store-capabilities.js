const VALID_ACCOUNT_STORE_TYPES = new Set(['auto', 'browser', 'file', 'upstash']);

function text(value = '') {
  return String(value || '').trim();
}

function normalizeRequestedStore(value = '') {
  const requested = text(value).toLowerCase() || 'auto';
  return VALID_ACCOUNT_STORE_TYPES.has(requested) ? requested : 'auto';
}

function hasValue(value) {
  return text(value).length > 0;
}

function isHttpsUrl(value = '') {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getUpstashEnv(env = {}) {
  const url = text(env.IMAGE_GEN_UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_REST_URL);
  const token = text(env.IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN || env.UPSTASH_REDIS_REST_TOKEN);
  return {
    urlConfigured: isHttpsUrl(url),
    tokenConfigured: hasValue(token),
  };
}

function hasEncryptionKey(env = {}) {
  return hasValue(env.IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY || env.IMAGE_GEN_ACCOUNT_STORE_ENCRYPTION_KEY);
}

function store({ requested, type, available, encrypted = false, scope, reason }) {
  return {
    requested,
    type,
    available: available === true,
    encrypted: encrypted === true,
    fallback: 'browser',
    fallbackActive: type === 'browser' || available !== true,
    scope,
    reason,
  };
}

function fileStore(requested, isServerless, encrypted) {
  if (isServerless) {
    return store({
      requested,
      type: 'file',
      available: false,
      encrypted,
      scope: 'server',
      reason: 'file-not-supported-on-serverless',
    });
  }
  return store({
    requested,
    type: 'file',
    available: true,
    encrypted: true,
    scope: 'server',
    reason: 'node-file-store',
  });
}

function upstashStore(requested, env) {
  const upstash = getUpstashEnv(env);
  const encrypted = hasEncryptionKey(env);
  if (!upstash.urlConfigured || !upstash.tokenConfigured) {
    return store({
      requested,
      type: 'upstash',
      available: false,
      encrypted,
      scope: 'remote',
      reason: 'upstash-not-configured',
    });
  }
  if (!encrypted) {
    return store({
      requested,
      type: 'upstash',
      available: false,
      encrypted: false,
      scope: 'remote',
      reason: 'upstash-encryption-key-missing',
    });
  }
  return store({
    requested,
    type: 'upstash',
    available: true,
    encrypted: true,
    scope: 'remote',
    reason: 'upstash-configured',
  });
}

function browserStore(requested, reason) {
  return store({
    requested,
    type: 'browser',
    available: true,
    encrypted: false,
    scope: 'browser',
    reason,
  });
}

export function resolveAccountStoreCapabilities({
  env = process.env,
  isServerless = false,
} = {}) {
  const requested = normalizeRequestedStore(env.IMAGE_GEN_ACCOUNT_STORE);
  const encrypted = hasEncryptionKey(env);

  if (requested === 'browser') {
    return { ok: true, schemaVersion: 1, store: browserStore(requested, 'browser-forced') };
  }
  if (requested === 'file') {
    return { ok: true, schemaVersion: 1, store: fileStore(requested, isServerless, encrypted) };
  }
  if (requested === 'upstash') {
    return { ok: true, schemaVersion: 1, store: upstashStore(requested, env) };
  }

  const upstash = upstashStore(requested, env);
  if (upstash.available) {
    return { ok: true, schemaVersion: 1, store: upstash };
  }
  if (!isServerless) {
    return { ok: true, schemaVersion: 1, store: fileStore(requested, false, encrypted) };
  }
  return { ok: true, schemaVersion: 1, store: browserStore(requested, 'serverless-without-upstash') };
}

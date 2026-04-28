// Public HTTPS OpenAI-compatible API hosts are allowed by default.
// This list is kept only for compatibility with existing configuration/UI;
// request validation no longer requires the hostname to be pre-allowlisted.
const DEFAULT_ALLOWED_HOSTS = ['api.openai.com'];
const ALLOWED_PATHS = new Set([
  '/v1/images/generations',
  '/v1/images/edits',
  '/v1/responses',
  '/v1/chat/completions',
  '/v1/models',
]);
const ALLOWED_METHODS = new Set(['GET', 'POST']);
const BLOCKED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'cookie',
  'set-cookie',
  'forwarded',
  'via',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'proxy-authorization',
  'proxy-authenticate',
]);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function normalizeHostname(hostname = '') {
  return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function hostFromUrlLike(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return normalizeHostname(new URL(text.includes('://') ? text : `https://${text}`).hostname);
  } catch {
    return '';
  }
}

function parseIPv4(hostname = '') {
  const parts = normalizeHostname(hostname).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return null;
  return nums;
}

function isPrivateIPv4(hostname = '') {
  const nums = parseIPv4(hostname);
  if (!nums) return false;
  const [a, b] = nums;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIPv6(hostname = '') {
  const host = normalizeHostname(hostname);
  return host === '::'
    || host === '::1'
    || host.startsWith('fe80:')
    || host.startsWith('fc')
    || host.startsWith('fd');
}

export function isLocalOrPrivateHost(hostname = '') {
  const host = normalizeHostname(hostname);
  return host === 'localhost'
    || host.endsWith('.localhost')
    || isPrivateIPv4(host)
    || isPrivateIPv6(host);
}

export function isExplicitLocalDevProxyAllowed(env = process.env) {
  return parseBoolean(env.IMAGE_GEN_PROXY_ALLOW_LOCAL_HTTP, false);
}

export function getProxyAllowedHosts({ runtimeConfig = null, env = process.env } = {}) {
  const hosts = new Set(DEFAULT_ALLOWED_HOSTS.map(normalizeHostname));
  const runtimeHost = hostFromUrlLike(runtimeConfig?.providerDefaults?.apiUrl);
  if (runtimeHost) hosts.add(runtimeHost);
  const envDefaultHost = hostFromUrlLike(env.IMAGE_GEN_DEFAULT_API_URL);
  if (envDefaultHost) hosts.add(envDefaultHost);
  for (const item of String(env.IMAGE_GEN_PROXY_ALLOWED_HOSTS || '').split(',')) {
    const host = hostFromUrlLike(item);
    if (host) hosts.add(host);
  }
  return hosts;
}

export function sanitizeProxyHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = String(key || '').trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (BLOCKED_HEADERS.has(lower) || lower.startsWith('x-forwarded-')) continue;
    if (value === undefined || value === null) continue;
    out[name] = String(value);
  }
  return out;
}

export function validateProxyTarget(rawUrl, {
  method = 'POST',
  allowedHosts = getProxyAllowedHosts(),
  allowLocalHttp = isExplicitLocalDevProxyAllowed(),
} = {}) {
  let target;
  try {
    target = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('Proxy target URL is invalid');
  }

  const fetchMethod = String(method || 'POST').toUpperCase();
  if (!ALLOWED_METHODS.has(fetchMethod)) throw new Error('Proxy method is not allowed');

  const hostname = normalizeHostname(target.hostname);
  const localDevTarget = allowLocalHttp && target.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');
  if (target.protocol !== 'https:' && !localDevTarget) throw new Error('Proxy protocol is not allowed');
  if (isLocalOrPrivateHost(hostname) && !localDevTarget) throw new Error('Proxy target host is not allowed');
  if (!ALLOWED_PATHS.has(target.pathname)) throw new Error('Proxy target path is not allowed');

  return { target, method: fetchMethod, hostname };
}

export function validateApiBaseUrl(rawUrl, {
  allowedHosts = getProxyAllowedHosts(),
  allowLocalHttp = isExplicitLocalDevProxyAllowed(),
} = {}) {
  const text = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!text) throw new Error('Missing API address');

  let target;
  try {
    target = new URL(text);
  } catch {
    throw new Error('API address is invalid');
  }

  const hostname = normalizeHostname(target.hostname);
  const localDevTarget = allowLocalHttp
    && target.protocol === 'http:'
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');

  if (target.username || target.password) throw new Error('API address credentials are not allowed');
  if (target.protocol !== 'https:' && !localDevTarget) throw new Error('API address protocol is not allowed');
  if (isLocalOrPrivateHost(hostname) && !localDevTarget) throw new Error('API address host is not allowed');
  if (target.search || target.hash) throw new Error('API address must not include query or hash');

  return {
    target,
    hostname,
    baseUrl: target.href.replace(/\/+$/, ''),
  };
}

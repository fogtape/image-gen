function boundedIntEnv(name, fallback, min, max) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

export function getPlatformApiTimeoutMs() {
  return boundedIntEnv('IMAGE_GEN_PLATFORM_API_TIMEOUT_MS', 15_000, 1_000, 120_000);
}

export function redactMessage(message = '', redactions = []) {
  let text = String(message || '');
  for (const value of redactions) {
    const secret = String(value || '');
    if (!secret) continue;
    text = text.split(secret).join('***已隐藏***');
  }
  return text;
}

const SENSITIVE_BODY_NAME_RE = /(?:TOKEN|SECRET|PASSWORD|COOKIE|UPSTASH|ACCOUNT[_-]?ENCRYPTION|ENCRYPTION[_-]?KEY|API[_-]?KEY|PRIVATE[_-]?KEY)/i;

function collectSensitiveValue(value, candidates) {
  const text = String(value || '');
  if (text) candidates.push(text);
}

function normalizeFieldName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[_-]/g, '');
}

function isDeclaredNameField(key = '') {
  return ['key', 'name', 'env', 'envname'].includes(normalizeFieldName(key));
}

function isSecretValueField(key = '') {
  return ['value', 'values', 'text'].includes(normalizeFieldName(key));
}

function getDeclaredSensitiveName(node = {}) {
  for (const [key, value] of Object.entries(node || {})) {
    if (isDeclaredNameField(key) && typeof value === 'string') return value;
  }
  return '';
}

function collectNestedValueFields(value, candidates) {
  if (Array.isArray(value)) {
    for (const item of value) collectNestedValueFields(item, candidates);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!isSecretValueField(key)) continue;
    if (typeof nestedValue === 'string') collectSensitiveValue(nestedValue, candidates);
    else collectNestedValueFields(nestedValue, candidates);
  }
}

function tryParseJsonBody(text = '') {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return null;
  }
}

function collectParsedBodyRedactions(parsed) {
  if (!parsed) return [];
  const candidates = [];
  const visit = (node, inheritedSensitive = false) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, inheritedSensitive);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const declaredName = getDeclaredSensitiveName(node);
    const objectSensitive = inheritedSensitive || SENSITIVE_BODY_NAME_RE.test(declaredName);
    if (objectSensitive) collectNestedValueFields(node, candidates);
    for (const [key, value] of Object.entries(node)) {
      const fieldSensitive = objectSensitive || SENSITIVE_BODY_NAME_RE.test(key);
      if (fieldSensitive && typeof value === 'string' && !isDeclaredNameField(key)) {
        collectSensitiveValue(value, candidates);
      }
      visit(value, fieldSensitive);
    }
  };
  visit(parsed, false);
  return candidates;
}

async function collectFormDataRedactions(body) {
  const candidates = [];
  for (const [name, value] of body.entries()) {
    const formFieldSensitive = SENSITIVE_BODY_NAME_RE.test(String(name || ''));
    if (typeof value === 'string') {
      if (formFieldSensitive) collectSensitiveValue(value, candidates);
      const parsed = tryParseJsonBody(value);
      candidates.push(...collectParsedBodyRedactions(parsed));
      continue;
    }
    if (!value || typeof value.text !== 'function') continue;
    let text = '';
    try {
      text = await value.text();
    } catch {
      continue;
    }
    if (formFieldSensitive) collectSensitiveValue(text, candidates);
    const parsed = tryParseJsonBody(text);
    candidates.push(...collectParsedBodyRedactions(parsed));
  }
  return candidates;
}

async function collectBodyRedactions(body) {
  if (typeof body === 'string') return collectParsedBodyRedactions(tryParseJsonBody(body));
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return collectParsedBodyRedactions(Object.fromEntries(body.entries()));
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return collectFormDataRedactions(body);
  }
  return [];
}

export async function collectRequestBodyRedactions(body) {
  const candidates = await collectBodyRedactions(body);
  return Array.from(new Set(candidates.filter(Boolean)));
}

function collectHeaderRedactions(headers = {}) {
  const candidates = [];
  const authorization = headers?.Authorization || headers?.authorization;
  const authText = String(authorization || '');
  if (authText) {
    candidates.push(authText);
    const bearer = authText.match(/^Bearer\s+(.+)$/i);
    if (bearer?.[1]) candidates.push(bearer[1]);
  }
  return candidates;
}

export async function fetchJsonWithTimeout(url, options = {}, {
  timeoutMs = getPlatformApiTimeoutMs(),
  redactions = [],
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const bodyRedactions = await collectRequestBodyRedactions(options.body);
  const allRedactions = [...redactions, ...collectHeaderRedactions(options.headers), ...bodyRedactions];

  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!resp.ok) {
      const message = typeof data === 'object' && data
        ? (data.error?.message || data.message || data.Message || data.error?.code || data.errors?.[0]?.message || data.messages?.[0]?.message)
        : text;
      throw new Error(redactMessage(message || `HTTP ${resp.status}`, allRedactions));
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`平台 API 请求超时（${timeoutMs}ms），请检查网络或稍后重试`);
    }
    const message = redactMessage(error?.message || String(error), allRedactions);
    throw new Error(message || '平台 API 请求失败');
  } finally {
    clearTimeout(timer);
  }
}

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
  const allRedactions = [...redactions, ...collectHeaderRedactions(options.headers)];

  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!resp.ok) {
      const message = typeof data === 'object' && data
        ? (data.error?.message || data.message || data.error?.code || data.errors?.[0]?.message || data.messages?.[0]?.message)
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

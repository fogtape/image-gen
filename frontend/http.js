export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeTimeoutError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw makeTimeoutError(`请求超时（>${Math.ceil(timeoutMs / 1000)} 秒）`, {
        code: 'TIMEOUT',
        isTimeout: true,
      });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function backgroundJobBackoffMs(attempt = 1, baseMs = 1_200) {
  const normalized = Math.max(1, Number(attempt) || 1);
  return Math.min(8_000, baseMs * (2 ** (normalized - 1)));
}

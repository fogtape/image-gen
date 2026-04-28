import {
  getProxyAllowedHosts,
  isExplicitLocalDevProxyAllowed,
  sanitizeProxyHeaders,
  validateProxyTarget,
} from './proxy-policy.js';
import {
  assertEmbeddedDataImagesWithinLimits,
  assertMultipartImagesWithinLimits,
} from './request-limits.js';

export class ProxyRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ProxyRequestError';
    this.status = status;
  }
}

function boundedEnvNumber(name, fallback, min, max, env = process.env) {
  const raw = Number(env?.[name] || fallback);
  const value = Number.isFinite(raw) ? raw : fallback;
  return Math.min(max, Math.max(min, value));
}

export function getProxyExecutionLimits(env = process.env) {
  return {
    timeoutMs: boundedEnvNumber('IMAGE_GEN_PROXY_TIMEOUT_MS', 300_000, 1_000, 300_000, env),
    maxResponseBytes: boundedEnvNumber('IMAGE_GEN_PROXY_MAX_RESPONSE_BYTES', 50 * 1024 * 1024, 1024 * 1024, 100 * 1024 * 1024, env),
  };
}

export function prepareProxyRequest({
  url,
  method = 'POST',
  headers = {},
  body,
  multipartBody,
} = {}, {
  allowedHosts = getProxyAllowedHosts(),
  allowLocalHttp = isExplicitLocalDevProxyAllowed(),
  allowMultipart = false,
  buildMultipartBody = null,
} = {}) {
  if (!url) throw new ProxyRequestError(400, 'Missing url');

  const fetchMethod = String(method || 'POST').toUpperCase();
  let target;
  try {
    target = validateProxyTarget(url, {
      method: fetchMethod,
      allowedHosts,
      allowLocalHttp,
    }).target;
  } catch {
    throw new ProxyRequestError(403, 'Proxy target is not allowed');
  }

  const opts = { method: fetchMethod, headers: sanitizeProxyHeaders(headers) };
  const hasMultipartBody = multipartBody != null && typeof multipartBody === 'object';
  try {
    if (fetchMethod !== 'GET' && hasMultipartBody) {
      assertMultipartImagesWithinLimits(multipartBody);
      if (!allowMultipart) throw new ProxyRequestError(400, 'Multipart proxy is not supported on this platform');
      if (typeof buildMultipartBody !== 'function') throw new ProxyRequestError(500, 'Multipart proxy builder is not configured');
      deleteHeader(opts.headers, 'Content-Type');
      opts.body = buildMultipartBody(multipartBody);
    } else if (fetchMethod !== 'GET' && body != null) {
      assertEmbeddedDataImagesWithinLimits(body);
      deleteHeader(opts.headers, 'Content-Type');
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  } catch (error) {
    if (error instanceof ProxyRequestError) throw error;
    const status = Number(error?.status || 0);
    throw new ProxyRequestError(status >= 400 && status < 600 ? status : 400, error?.message || 'Proxy request body is invalid');
  }

  return { target, opts, method: fetchMethod };
}

function responseContentLength(resp) {
  const value = Number(resp.headers?.get?.('content-length') || 0);
  return Number.isFinite(value) ? value : 0;
}

function deleteHeader(headers, name) {
  const lowerName = String(name || '').toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === lowerName) delete headers[key];
  }
}

function assertResponseContentLengthWithinLimit(resp, maxBytes, controller) {
  const contentLength = responseContentLength(resp);
  if (contentLength > maxBytes) {
    controller?.abort?.();
    throw new ProxyRequestError(502, 'Proxy upstream response is too large');
  }
}

async function readResponseTextWithLimit(resp, maxBytes, controller) {
  assertResponseContentLengthWithinLimit(resp, maxBytes, controller);

  if (!resp.body?.getReader) {
    const text = await resp.text();
    if (Buffer.byteLength(text) > maxBytes) {
      controller?.abort?.();
      throw new ProxyRequestError(502, 'Proxy upstream response is too large');
    }
    return text;
  }

  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        controller?.abort?.();
        throw new ProxyRequestError(502, 'Proxy upstream response is too large');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function streamResponseWithLimit(resp, maxBytes, controller, onChunk) {
  assertResponseContentLengthWithinLimit(resp, maxBytes, controller);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value?.byteLength || 0;
      if (receivedBytes > maxBytes) {
        controller?.abort?.();
        throw new ProxyRequestError(502, 'Proxy upstream response is too large');
      }
      onChunk(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
  } finally {
    reader.releaseLock?.();
  }
}

export async function runProxyUpstream({ target, opts }, {
  fetchImpl = fetch,
  limits = getProxyExecutionLimits(),
  onStreamStart = null,
  onStreamChunk = null,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    const resp = await fetchImpl(target.href, { ...opts, signal: controller.signal });
    const contentType = resp.headers.get('content-type') || 'application/json';

    if (contentType.includes('text/event-stream') && resp.body?.getReader && onStreamChunk) {
      assertResponseContentLengthWithinLimit(resp, limits.maxResponseBytes, controller);
      onStreamStart?.({ status: resp.status, contentType });
      await streamResponseWithLimit(resp, limits.maxResponseBytes, controller, onStreamChunk);
      return { status: resp.status, contentType, stream: true };
    }

    const body = await readResponseTextWithLimit(resp, limits.maxResponseBytes, controller);
    return { status: resp.status, contentType, body, stream: false };
  } catch (error) {
    if (error instanceof ProxyRequestError) throw error;
    if (error?.name === 'AbortError') throw new ProxyRequestError(504, 'Proxy upstream request timed out');
    throw new ProxyRequestError(502, 'Proxy upstream request failed');
  } finally {
    clearTimeout(timeout);
  }
}

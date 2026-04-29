/**
 * Simple in-memory sliding window rate limiter for Node.js HTTP servers.
 *
 * @param {object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000 = 1 min)
 * @param {number} options.maxRequests - Max requests per window per key (default: 60)
 * @param {function} options.keyFn - Function to extract key from req (default: IP-based)
 * @param {string} options.message - Error message on limit exceeded
 * @param {boolean} options.trustProxy - When true, read X-Forwarded-For for client IP;
 *                                       when false (default), use socket remoteAddress only.
 */
export function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 60,
  keyFn,
  message = '请求过于频繁，请稍后再试',
  trustProxy = false,
} = {}) {
  // Resolve key function: explicit keyFn takes priority, otherwise use trustProxy setting
  const resolveKey = keyFn || (trustProxy ? proxyAwareKeyFn : directSocketKeyFn);

  // Map<key, number[]> of request timestamps
  const hits = new Map();

  // Periodic cleanup to prevent memory leak
  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const filtered = timestamps.filter((t) => t > cutoff);
      if (filtered.length === 0) hits.delete(key);
      else hits.set(key, filtered);
    }
  }, Math.max(windowMs, 30_000));
  cleanupInterval.unref();

  return function rateLimit(req, res) {
    const key = resolveKey(req);
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = hits.get(key) || [];
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      });
      res.end(JSON.stringify({ error: message, retryAfter }));
      return true; // indicates request was rejected
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    return false; // request allowed
  };
}

/**
 * Key function that trusts X-Forwarded-For (for reverse proxy setups).
 */
function proxyAwareKeyFn(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

/**
 * Key function that uses only the real socket remoteAddress (no proxy trust).
 */
function directSocketKeyFn(req) {
  return req.socket?.remoteAddress || 'unknown';
}

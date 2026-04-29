/**
 * Shared CORS origin resolution for Vercel serverless functions.
 * Returns the validated origin if it matches the request host, or empty string.
 */
export function resolveCorsOrigin(req) {
  const origin = String(req.headers?.origin || '').trim();
  if (!origin) return '';
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';

  const requestHost = String(req.headers?.host || '').toLowerCase();
  if (parsed.host.toLowerCase() === requestHost) return origin;

  // Allow localhost variants for dev
  const isLocalhost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1';
  if (isLocalhost(parsed.hostname) && isLocalhost(new URL(`http://${requestHost}`).hostname)) return origin;

  return '';
}

/**
 * Apply CORS headers to a Vercel response using origin validation.
 */
export function applyVercelCors(req, res) {
  const origin = resolveCorsOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

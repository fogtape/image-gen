import { handleOAuthImageRequestBody } from '../../openai-oauth-image.js';
import { applyVercelCors } from '../_cors.js';
import {
  assertOAuthBodySize,
  getOAuthMaxBodyBytes,
  validateOAuthImageRequest,
} from '../../oauth-request-limits.js';

function readAdminToken(req) {
  const authorization = String(req.headers?.authorization || '').trim();
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  const headerValue = req.headers?.['x-image-gen-token'] || req.headers?.['x-image-gen-token'.toLowerCase()];
  return String(headerValue || '').trim();
}

function verifyAdminToken(token, configService) {
  // If no config service available, fall back to env-based check
  const adminToken = process.env.IMAGE_GEN_ADMIN_TOKEN || '';
  if (!adminToken) return true; // No admin token configured = open access
  return token === adminToken;
}

export default async function handler(req, res) {
  applyVercelCors(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin authentication check
  const token = readAdminToken(req);
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  // Validate request body size
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  try {
    assertOAuthBodySize(rawBody);
  } catch (e) {
    return res.status(413).json({ error: e.message || '请求体过大' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : (() => {
    try { return JSON.parse(rawBody); } catch { return null; }
  })();

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Validate reference image limits
  try {
    validateOAuthImageRequest(body);
  } catch (e) {
    const status = e.status || 400;
    return res.status(status).json({ error: e.message });
  }

  try {
    const data = await handleOAuthImageRequestBody(body);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(data);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ error: e.message || 'OAuth image generation failed' });
  }
}

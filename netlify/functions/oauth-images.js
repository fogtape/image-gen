import { handleOAuthImageRequestBody } from '../../openai-oauth-image.js';
import {
  assertTextBodyWithinLimit,
  getImageJobBodyLimitBytes,
  validateImagePayloadLimits,
} from '../../request-limits.js';

function verifyAdminToken(event) {
  const adminToken = process.env.IMAGE_GEN_ADMIN_TOKEN || '';
  if (!adminToken) return false; // No admin token configured = deny access (fail-closed)

  const auth = String(event.headers?.authorization || '').trim();
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer === adminToken;

  const headerValue = event.headers?.['x-image-gen-admin-token']
    || event.headers?.['x-image-gen-admin-token'.toLowerCase()];
  return String(headerValue || '').trim() === adminToken;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-image-gen-admin-token',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Admin authentication check
  if (!verifyAdminToken(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Admin authentication required' }) };
  }

  let parsed;
  try {
    assertTextBodyWithinLimit(event.body || '', { maxBytes: getImageJobBodyLimitBytes() });
    parsed = JSON.parse(event.body || '{}');
    validateImagePayloadLimits(parsed);
  } catch (e) {
    if (e.status === 413) {
      return {
        statusCode: 413,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: e.message || '请求体过大' }),
      };
    }
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  try {
    const data = await handleOAuthImageRequestBody(parsed);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return {
      statusCode: status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'OAuth image generation failed' }),
    };
  }
}

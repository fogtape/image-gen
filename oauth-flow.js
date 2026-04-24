import crypto from 'crypto';

export function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('hex');
}

export function generateCodeChallenge(verifier) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

export function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return {};
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

export function extractOpenAIUserInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  const nested = payload['https://api.openai.com/auth'] || {};
  return {
    email: payload.email || '',
    name: payload.name || payload.email || '',
    sub: payload.sub || '',
    accountId: nested.chatgpt_account_id || payload.chatgpt_account_id || '',
    chatgptUserId: nested.chatgpt_user_id || payload.chatgpt_user_id || '',
    organizationId: nested.organization_id || payload.organization_id || '',
    planType: nested.chatgpt_plan_type || payload.chatgpt_plan_type || '',
  };
}

export function formatOAuthTokenError(data, fallback = 'Token exchange failed') {
  if (!data || typeof data !== 'object') return fallback;
  if (typeof data.error_description === 'string' && data.error_description.trim()) return data.error_description.trim();
  if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  if (data.error && typeof data.error === 'object') {
    if (typeof data.error.message === 'string' && data.error.message.trim()) return data.error.message.trim();
    if (typeof data.error.code === 'string' && data.error.code.trim()) return data.error.code.trim();
    try {
      const serialized = JSON.stringify(data.error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore
    }
  }
  return fallback;
}
export function parseOAuthCallbackInput(input, fallbackState = '') {
  const raw = String(input || '').trim();
  if (!raw) return { code: '', state: String(fallbackState || '').trim() };

  const parseParams = (text) => {
    const params = new URLSearchParams(text.startsWith('?') ? text.slice(1) : text);
    return {
      code: (params.get('code') || '').trim(),
      state: (params.get('state') || fallbackState || '').trim(),
    };
  };

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return parseParams(url.search);
    } catch {
      // fall through
    }
  }

  if (raw.includes('code=') || raw.includes('state=')) {
    const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw;
    return parseParams(query);
  }

  return { code: raw, state: String(fallbackState || '').trim() };
}

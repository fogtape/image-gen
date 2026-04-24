import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOAuthCallbackInput,
  extractOpenAIUserInfo,
  formatOAuthTokenError,
} from '../oauth-flow.js';

function unsignedJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    '',
  ].join('.');
}

test('parseOAuthCallbackInput accepts a full localhost callback URL', () => {
  const parsed = parseOAuthCallbackInput('http://localhost:1455/auth/callback?code=abc123&state=state-xyz');
  assert.deepEqual(parsed, { code: 'abc123', state: 'state-xyz' });
});

test('parseOAuthCallbackInput accepts a raw authorization code when state is supplied separately', () => {
  const parsed = parseOAuthCallbackInput('raw-code-123', 'state-xyz');
  assert.deepEqual(parsed, { code: 'raw-code-123', state: 'state-xyz' });
});

test('extractOpenAIUserInfo reads ChatGPT fields from nested OpenAI auth claims', () => {
  const idToken = unsignedJwt({
    email: 'user@example.com',
    name: 'User Name',
    sub: 'user-sub',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acc_123',
      chatgpt_user_id: 'user_123',
      chatgpt_plan_type: 'plus',
      organization_id: 'org_123',
    },
  });

  assert.deepEqual(extractOpenAIUserInfo(idToken), {
    email: 'user@example.com',
    name: 'User Name',
    sub: 'user-sub',
    accountId: 'acc_123',
    chatgptUserId: 'user_123',
    organizationId: 'org_123',
    planType: 'plus',
  });
});

test('formatOAuthTokenError returns readable text for OpenAI object errors', () => {
  assert.equal(formatOAuthTokenError({ error: { message: 'invalid authorization code' } }), 'invalid authorization code');
  assert.equal(formatOAuthTokenError({ error_description: 'expired code' }), 'expired code');
  assert.equal(formatOAuthTokenError({ error: 'access_denied' }), 'access_denied');
});

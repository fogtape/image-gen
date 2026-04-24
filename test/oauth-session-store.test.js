import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setOAuthSession,
  getOAuthSessionById,
  getOAuthSessionByState,
  deleteOAuthSession,
  cleanSessions,
} from '../server.js';

test('OAuth session store resolves by sessionId and state', () => {
  const sessionId = 'test-session-' + Date.now();
  const state = 'test-state-' + Date.now();
  setOAuthSession(sessionId, {
    state,
    codeVerifier: 'verifier',
    redirectUri: 'http://localhost:1455/auth/callback',
    status: 'pending',
    createdAt: Date.now(),
  });

  assert.equal(getOAuthSessionById(sessionId)?.state, state);
  assert.equal(getOAuthSessionByState(state).sessionId, sessionId);
  assert.equal(getOAuthSessionByState(state).session?.codeVerifier, 'verifier');

  deleteOAuthSession(sessionId);
  assert.equal(getOAuthSessionById(sessionId), null);
  assert.equal(getOAuthSessionByState(state).session, null);
});

test('OAuth session cleanup removes expired sessions and state index', () => {
  const sessionId = 'expired-session-' + Date.now();
  const state = 'expired-state-' + Date.now();
  setOAuthSession(sessionId, {
    state,
    codeVerifier: 'verifier',
    status: 'pending',
    createdAt: Date.now() - 31 * 60 * 1000,
  });

  cleanSessions();
  assert.equal(getOAuthSessionById(sessionId), null);
  assert.equal(getOAuthSessionByState(state).session, null);
});

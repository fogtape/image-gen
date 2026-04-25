import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setOAuthSession,
  getOAuthSessionById,
  getOAuthSessionByState,
  deleteOAuthSession,
  cleanSessions,
  formatSseEvent,
  makeStatelessOAuthSessionId,
  getOAuthSessionFromStatelessId,
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

test('stateless OAuth session id carries PKCE data for serverless exchange fallback', () => {
  const createdAt = Date.now();
  const sessionId = makeStatelessOAuthSessionId({
    state: 'state-serverless',
    codeVerifier: 'verifier-serverless',
    redirectUri: 'http://localhost:1455/auth/callback',
    createdAt,
  });

  assert.match(sessionId, /^pkce_/);
  const session = getOAuthSessionFromStatelessId(sessionId);
  assert.equal(session.state, 'state-serverless');
  assert.equal(session.codeVerifier, 'verifier-serverless');
  assert.equal(session.redirectUri, 'http://localhost:1455/auth/callback');
  assert.equal(session.status, 'pending');
  assert.equal(session.createdAt, createdAt);
});

test('formatSseEvent serializes named events as SSE chunks', () => {
  assert.equal(
    formatSseEvent('progress', { phase: 'request:send', message: '正在提交请求到后端' }),
    'event: progress\ndata: {"phase":"request:send","message":"正在提交请求到后端"}\n\n',
  );
  assert.equal(
    formatSseEvent('progress', { message: 'a\nb' }),
    'event: progress\ndata: {"message":"a\\nb"}\n\n',
  );
});

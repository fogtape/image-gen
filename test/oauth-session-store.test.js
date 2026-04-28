import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  setOAuthSession,
  getOAuthSessionById,
  getOAuthSessionByState,
  deleteOAuthSession,
  cleanSessions,
  formatSseEvent,
  makeStatelessOAuthSessionId,
  getOAuthSessionFromStatelessId,
  server,
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
  assert.match(sessionId, /^pkce_[^.]+\.[A-Za-z0-9_-]+$/);
  const session = getOAuthSessionFromStatelessId(sessionId);
  assert.equal(session.state, 'state-serverless');
  assert.equal(session.codeVerifier, 'verifier-serverless');
  assert.equal(session.redirectUri, 'http://localhost:1455/auth/callback');
  assert.equal(session.status, 'pending');
  assert.equal(session.createdAt, createdAt);
  assert.equal(getOAuthSessionFromStatelessId(sessionId.replace(/\.[^.]+$/, '.bad-signature')), null);
});

test('OAuth status 只允许 sessionId 读取结果，不能再用 state 抢读 token', async () => {
  const sessionId = 'status-session-' + Date.now();
  const state = 'status-state-' + Date.now();
  const accessToken = 'status-access-token-secret';
  setOAuthSession(sessionId, {
    state,
    codeVerifier: 'verifier',
    redirectUri: 'http://localhost:1455/auth/callback',
    status: 'success',
    result: { accessToken, email: 'tester@example.com' },
    createdAt: Date.now(),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const byState = await fetch(`${baseUrl}/api/oauth/status/${encodeURIComponent(state)}`);
    const byStateText = await byState.text();
    assert.equal(byState.status, 404);
    assert.doesNotMatch(byStateText, new RegExp(accessToken));
    assert.equal(getOAuthSessionById(sessionId)?.status, 'success');

    const bySession = await fetch(`${baseUrl}/api/oauth/status/${encodeURIComponent(sessionId)}`);
    const bySessionData = await bySession.json();
    assert.equal(bySession.status, 200);
    assert.equal(bySessionData.status, 'success');
    assert.equal(bySessionData.result.accessToken, accessToken);
    assert.equal(getOAuthSessionById(sessionId), null);
  } finally {
    deleteOAuthSession(sessionId);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('OAuth session 持久化使用原子写入且不落盘成功结果或 token 字段', () => {
  const sessionId = 'persist-session-' + Date.now();
  const state = 'persist-state-' + Date.now();
  const accessToken = 'persist-access-token-secret-' + Date.now();
  const refreshToken = 'persist-refresh-token-secret-' + Date.now();

  setOAuthSession(sessionId, {
    state,
    codeVerifier: 'verifier',
    redirectUri: 'http://localhost:1455/auth/callback',
    status: 'success',
    result: { accessToken, refreshToken, email: 'tester@example.com' },
    createdAt: Date.now(),
  });

  try {
    assert.equal(getOAuthSessionById(sessionId)?.result?.accessToken, accessToken);
    const sessionFile = new URL('../.oauth-sessions.json', import.meta.url);
    const raw = fs.readFileSync(sessionFile, 'utf8');
    assert.doesNotMatch(raw, new RegExp(accessToken));
    assert.doesNotMatch(raw, new RegExp(refreshToken));
    assert.doesNotMatch(raw, new RegExp(sessionId));
    assert.equal(fs.readdirSync(new URL('../', import.meta.url)).some((name) => /^\.oauth-sessions\.json\..*\.tmp$/.test(name)), false);
  } finally {
    deleteOAuthSession(sessionId);
  }
});

test('OAuth session 坏 JSON 会备份并重置为空文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-session-corrupt-'));
  const sessionFile = path.join(dir, '.oauth-sessions.json');
  fs.writeFileSync(sessionFile, '{"truncated"', { mode: 0o600 });
  const serverUrl = pathToFileURL(path.resolve('server.js')).href;

  execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(serverUrl)});`], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      VERCEL: '1',
      IMAGE_GEN_ADMIN_TOKEN: 'test-admin-token-oauth-corrupt',
      IMAGE_GEN_OAUTH_SESSION_FILE: sessionFile,
    },
    stdio: 'pipe',
  });

  assert.deepEqual(JSON.parse(fs.readFileSync(sessionFile, 'utf8')), []);
  assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith('.oauth-sessions.json.corrupt.')).length, 1);
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

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { handleOAuthImageRequestBody } from './openai-oauth-image.js';
import {
  generateCodeVerifier as makeOAuthCodeVerifier,
  generateCodeChallenge as makeOAuthCodeChallenge,
  parseOAuthCallbackInput,
  extractOpenAIUserInfo,
  formatOAuthTokenError,
} from './oauth-flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const OAUTH_LOOPBACK_PORT = 1455;
const OAUTH_SESSION_FILE = path.join(__dirname, '.oauth-sessions.json');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_SCOPES = 'openid email profile offline_access';
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_LOOPBACK_PORT}/auth/callback`;

// --- OAuth session store (sessionId -> session, state -> sessionId, persisted, 30 min TTL) ---

const oauthSessions = new Map();
const oauthStateIndex = new Map();
const SESSION_TTL = 30 * 60 * 1000;

export function newOAuthSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function indexOAuthSession(sessionId, session) {
  if (session?.state) oauthStateIndex.set(session.state, sessionId);
}

export function setOAuthSession(sessionId, session) {
  oauthSessions.set(sessionId, session);
  indexOAuthSession(sessionId, session);
  saveOAuthSessions();
}

export function getOAuthSessionById(sessionId) {
  return sessionId ? oauthSessions.get(sessionId) || null : null;
}

export function getOAuthSessionByState(state) {
  if (!state) return { sessionId: '', session: null };
  const sessionId = oauthStateIndex.get(state) || '';
  return { sessionId, session: sessionId ? getOAuthSessionById(sessionId) : null };
}

export function deleteOAuthSession(sessionId) {
  const session = getOAuthSessionById(sessionId);
  if (session?.state) oauthStateIndex.delete(session.state);
  if (sessionId) oauthSessions.delete(sessionId);
  saveOAuthSessions();
}

function saveOAuthSessions() {
  try {
    const data = [...oauthSessions.entries()].map(([sessionId, session]) => [sessionId, session]);
    fs.writeFileSync(OAUTH_SESSION_FILE, JSON.stringify(data), { mode: 0o600 });
  } catch (e) {
    console.warn('Failed to save OAuth sessions:', e.message);
  }
}

function loadOAuthSessions() {
  try {
    if (!fs.existsSync(OAUTH_SESSION_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(OAUTH_SESSION_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const item of parsed) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const [sessionId, session] = item;
      if (!sessionId || !session || now - Number(session.createdAt || 0) > SESSION_TTL) continue;
      oauthSessions.set(sessionId, session);
      indexOAuthSession(sessionId, session);
    }
  } catch (e) {
    console.warn('Failed to load OAuth sessions:', e.message);
  }
}

export function cleanSessions() {
  const now = Date.now();
  let changed = false;
  for (const [sessionId, s] of oauthSessions) {
    if (now - Number(s.createdAt || 0) > SESSION_TTL) {
      if (s?.state) oauthStateIndex.delete(s.state);
      oauthSessions.delete(sessionId);
      changed = true;
    }
  }
  if (changed) saveOAuthSessions();
}

loadOAuthSessions();
setInterval(cleanSessions, 60_000).unref();

// --- Loopback callback server ---

let loopbackServer = null;

function ensureLoopbackServer() {
  if (loopbackServer) return Promise.resolve();
  return new Promise((resolve, reject) => {
  loopbackServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!req.url.startsWith('/auth/callback')) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const url = new URL(req.url, `http://localhost:${OAUTH_LOOPBACK_PORT}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    const { sessionId, session } = getOAuthSessionByState(state);

    if (error || !code || !session) {
      if (session) {
        session.status = 'error';
        session.error = error || 'Missing code';
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>登录失败</h2><p>请关闭此窗口重试。</p><script>window.close()</script></body></html>');
      return;
    }

    try {
      session.result = await exchangeOAuthCodeForResult(code, session);
      session.status = 'success';
      saveOAuthSessions();

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>登录成功</h2><p>可以关闭此窗口了。</p><script>window.close()</script></body></html>');
    } catch (e) {
      session.status = 'error';
      session.error = e.message;
      saveOAuthSessions();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>登录失败</h2><p>' + e.message + '</p><script>window.close()</script></body></html>');
    }
  });

  loopbackServer.listen(OAUTH_LOOPBACK_PORT, '127.0.0.1', () => {
    console.log(`OAuth loopback server on http://127.0.0.1:${OAUTH_LOOPBACK_PORT}`);
    resolve();
  });

  loopbackServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Port ${OAUTH_LOOPBACK_PORT} in use, loopback server skipped`);
      loopbackServer = null;
      resolve();
    } else {
      reject(e);
    }
  });
  });
}

// --- Static file serving ---

function serveStatic(req, res) {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

// --- Proxy handler ---

async function handleProxy(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { url, method, headers, body: reqBody } = parsed;
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url' }));
    return;
  }

  const fetchMethod = (method || 'POST').toUpperCase();
  const opts = { method: fetchMethod, headers: { ...headers } };
  if (fetchMethod !== 'GET' && reqBody != null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(reqBody);
  }

  try {
    const resp = await fetch(url, opts);
    const ct = resp.headers.get('content-type') || 'application/json';

    if (ct.includes('text/event-stream')) {
      res.writeHead(resp.status, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } else {
      const data = await resp.text();
      res.writeHead(resp.status, {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// --- OAuth route handlers ---

function buildOAuthResult(tokenData, fallbackRefreshToken = null) {
  const userInfo = tokenData.id_token ? extractOpenAIUserInfo(tokenData.id_token) : {};
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || fallbackRefreshToken,
    expiresIn: tokenData.expires_in || 3600,
    email: userInfo.email || '',
    name: userInfo.name || userInfo.email || '',
    sub: userInfo.sub || '',
    accountId: userInfo.accountId || '',
    planType: userInfo.planType || '',
  };
}

async function exchangeOAuthCodeForResult(code, session) {
  const tokenResp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OAUTH_CLIENT_ID,
      code,
      code_verifier: session.codeVerifier,
      redirect_uri: session.redirectUri || OAUTH_REDIRECT_URI,
    }).toString(),
  });

  const tokenData = await tokenResp.json().catch(() => ({}));
  if (!tokenResp.ok || !tokenData.access_token) {
    const err = new Error(formatOAuthTokenError(tokenData, 'Token exchange failed'));
    err.status = tokenResp.status || 400;
    throw err;
  }
  return buildOAuthResult(tokenData, null);
}

async function handleOAuthStart(req, res) {
  const codeVerifier = makeOAuthCodeVerifier();
  const codeChallenge = makeOAuthCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(24).toString('base64url');
  const sessionId = newOAuthSessionId();

  setOAuthSession(sessionId, {
    state,
    codeVerifier,
    redirectUri: OAUTH_REDIRECT_URI,
    status: 'pending',
    result: null,
    error: null,
    createdAt: Date.now(),
  });

  await ensureLoopbackServer();

  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
  });

  const authorizationUrl = `${OAUTH_AUTH_URL}?${params}`;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ authorizationUrl, sessionId, state, redirectUri: OAUTH_REDIRECT_URI }));
}

function handleOAuthStatus(req, res, sessionKey) {
  let sessionId = sessionKey;
  let session = getOAuthSessionById(sessionId);
  if (!session) {
    const found = getOAuthSessionByState(sessionKey);
    sessionId = found.sessionId;
    session = found.session;
  }
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (session.status === 'success') {
    res.end(JSON.stringify({ status: 'success', result: session.result }));
    deleteOAuthSession(sessionId);
  } else if (session.status === 'error') {
    res.end(JSON.stringify({ status: 'error', error: session.error }));
    deleteOAuthSession(sessionId);
  } else {
    res.end(JSON.stringify({ status: 'pending' }));
  }
}

async function handleOAuthExchange(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try { parsed = JSON.parse(body || '{}'); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const callbackInput = parsed.callbackUrl || parsed.code || '';
  const sessionId = String(parsed.sessionId || '').trim();
  const sessionById = getOAuthSessionById(sessionId);
  const parsedCallback = parseOAuthCallbackInput(callbackInput, parsed.state || sessionById?.state || '');
  const code = parsedCallback.code;
  const state = parsedCallback.state;

  if (!code || !state) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing authorization code or state' }));
    return;
  }

  let resolvedSessionId = sessionId;
  let session = sessionById;
  if (!session) {
    const found = getOAuthSessionByState(state);
    resolvedSessionId = found.sessionId;
    session = found.session;
  }
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found or expired' }));
    return;
  }
  if (session.state && state && session.state !== state) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid oauth state' }));
    return;
  }

  try {
    const result = await exchangeOAuthCodeForResult(code, session);
    deleteOAuthSession(resolvedSessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', result }));
  } catch (e) {
    session.lastError = e.message || 'Token exchange failed';
    saveOAuthSessions();
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: session.lastError }));
  }
}

async function handleOAuthRefresh(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { refreshToken } = parsed;
  if (!refreshToken) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing refreshToken' }));
    return;
  }

  try {
    const resp = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
    });

    const data = await resp.json();
    if (!resp.ok || !data.access_token) {
      res.writeHead(resp.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatOAuthTokenError(data, 'Refresh failed') }));
      return;
    }

    const userInfo = data.id_token ? extractOpenAIUserInfo(data.id_token) : {};

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in || 3600,
      email: userInfo.email || '',
      name: userInfo.name || userInfo.email || '',
      accountId: userInfo.accountId || '',
      planType: userInfo.planType || '',
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// --- OAuth image generation handler ---

async function handleOAuthImages(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try { parsed = JSON.parse(body || '{}'); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  try {
    const data = await handleOAuthImageRequestBody(parsed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'OAuth image generation failed' }));
  }
}

// --- Main server ---

export const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/proxy' && req.method === 'POST') {
    handleProxy(req, res);
  } else if (url.pathname === '/api/oauth/start' && req.method === 'POST') {
    handleOAuthStart(req, res);
  } else if (url.pathname.startsWith('/api/oauth/status/') && req.method === 'GET') {
    const state = url.pathname.split('/api/oauth/status/')[1];
    handleOAuthStatus(req, res, state);
  } else if (url.pathname === '/api/oauth/exchange' && req.method === 'POST') {
    handleOAuthExchange(req, res);
  } else if (url.pathname === '/api/oauth/refresh' && req.method === 'POST') {
    handleOAuthRefresh(req, res);
  } else if (url.pathname === '/api/oauth/images' && req.method === 'POST') {
    handleOAuthImages(req, res);
  } else {
    serveStatic(req, res);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Proxy enabled at /api/proxy');
    console.log('OAuth endpoints: /api/oauth/start, /api/oauth/status/:state, /api/oauth/refresh');
  });
}

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const OAUTH_LOOPBACK_PORT = 1455;

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

// --- PKCE helpers ---

function generateCodeVerifier() {
  return crypto.randomBytes(48).toString('base64url');
}

async function generateCodeChallenge(verifier) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch { return {}; }
}

// --- OAuth session store (in-memory, 10 min TTL) ---

const oauthSessions = new Map();
const SESSION_TTL = 10 * 60 * 1000;

function cleanSessions() {
  const now = Date.now();
  for (const [key, s] of oauthSessions) {
    if (now - s.createdAt > SESSION_TTL) oauthSessions.delete(key);
  }
}

setInterval(cleanSessions, 60_000);

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

    const session = state ? oauthSessions.get(state) : null;

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
      const tokenResp = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: OAUTH_CLIENT_ID,
          code,
          code_verifier: session.codeVerifier,
          redirect_uri: OAUTH_REDIRECT_URI,
        }).toString(),
      });

      const tokenData = await tokenResp.json();

      if (!tokenResp.ok || !tokenData.access_token) {
        session.status = 'error';
        session.error = tokenData.error_description || tokenData.error || 'Token exchange failed';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h2>登录失败</h2><p>' + session.error + '</p><script>window.close()</script></body></html>');
        return;
      }

      const idPayload = tokenData.id_token ? decodeJwtPayload(tokenData.id_token) : {};

      session.status = 'success';
      session.result = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        expiresIn: tokenData.expires_in || 3600,
        email: idPayload.email || '',
        name: idPayload.name || idPayload.email || '',
        sub: idPayload.sub || '',
        accountId: idPayload.chatgpt_account_id || '',
        planType: idPayload.chatgpt_plan_type || '',
      };

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>登录成功</h2><p>可以关闭此窗口了。</p><script>window.close()</script></body></html>');
    } catch (e) {
      session.status = 'error';
      session.error = e.message;
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
  if (!fs.existsSync(filePath)) {
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

async function handleOAuthStart(req, res) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(24).toString('base64url');

  oauthSessions.set(state, {
    codeVerifier,
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
  res.end(JSON.stringify({ authorizationUrl, state }));
}

function handleOAuthStatus(req, res, state) {
  const session = oauthSessions.get(state);
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (session.status === 'success') {
    res.end(JSON.stringify({ status: 'success', result: session.result }));
    oauthSessions.delete(state);
  } else if (session.status === 'error') {
    res.end(JSON.stringify({ status: 'error', error: session.error }));
    oauthSessions.delete(state);
  } else {
    res.end(JSON.stringify({ status: 'pending' }));
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
      res.end(JSON.stringify({ error: data.error_description || data.error || 'Refresh failed' }));
      return;
    }

    const idPayload = data.id_token ? decodeJwtPayload(data.id_token) : {};

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in || 3600,
      email: idPayload.email || '',
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// --- Main server ---

const server = http.createServer((req, res) => {
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
  } else if (url.pathname === '/api/oauth/refresh' && req.method === 'POST') {
    handleOAuthRefresh(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Proxy enabled at /api/proxy');
  console.log('OAuth endpoints: /api/oauth/start, /api/oauth/status/:state, /api/oauth/refresh');
});

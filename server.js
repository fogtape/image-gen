import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { testOAuthAccessToken } from './openai-oauth-image.js';
import { createJobStore } from './background-jobs.js';
import { createImageStore } from './image-storage.js';
import {
  getGenerationProgressMessage,
  getResponseStreamProgressMessage,
  isPolicyViolationText,
  normalizeGenerationError,
} from './ui-feedback.js';
import {
  generateCodeVerifier as makeOAuthCodeVerifier,
  generateCodeChallenge as makeOAuthCodeChallenge,
  parseOAuthCallbackInput,
  extractOpenAIUserInfo,
  formatOAuthTokenError,
} from './oauth-flow.js';
import { enhancePrompt } from './prompt-enhancement.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.IMAGE_GEN_DATA_DIR || path.join(__dirname, 'data');
const MAX_REF_IMAGES = 3;
const imageStore = createImageStore({ dataDir: DATA_DIR });
const OAUTH_LOOPBACK_PORT = 1455;
const OAUTH_SESSION_FILE = path.join(__dirname, '.oauth-sessions.json');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
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

export function makeStatelessOAuthSessionId(session) {
  const payload = {
    state: session?.state || '',
    codeVerifier: session?.codeVerifier || '',
    redirectUri: session?.redirectUri || OAUTH_REDIRECT_URI,
    createdAt: Number(session?.createdAt || Date.now()),
  };
  return `pkce_${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

export function getOAuthSessionFromStatelessId(sessionId) {
  if (!sessionId || !String(sessionId).startsWith('pkce_')) return null;
  try {
    const raw = Buffer.from(String(sessionId).slice(5), 'base64url').toString('utf8');
    const payload = JSON.parse(raw);
    const createdAt = Number(payload.createdAt || 0);
    if (!payload.state || !payload.codeVerifier || !createdAt) return null;
    if (Date.now() - createdAt > SESSION_TTL) return null;
    return {
      state: String(payload.state),
      codeVerifier: String(payload.codeVerifier),
      redirectUri: String(payload.redirectUri || OAUTH_REDIRECT_URI),
      status: 'pending',
      result: null,
      error: null,
      createdAt,
    };
  } catch {
    return null;
  }
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

function shouldStartOAuthLoopbackServer() {
  return !process.env.VERCEL;
}

function isServerlessRuntime() {
  return !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV);
}

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
  const createdAt = Date.now();
  const session = {
    state,
    codeVerifier,
    redirectUri: OAUTH_REDIRECT_URI,
    status: 'pending',
    result: null,
    error: null,
    createdAt,
  };
  const sessionId = makeStatelessOAuthSessionId(session);

  setOAuthSession(sessionId, session);

  if (shouldStartOAuthLoopbackServer()) await ensureLoopbackServer();

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
    session = getOAuthSessionFromStatelessId(sessionKey);
    if (session) sessionId = sessionKey;
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
  const sessionById = getOAuthSessionById(sessionId) || getOAuthSessionFromStatelessId(sessionId);
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

export function formatSseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function readJsonBody(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    return JSON.parse(body || '{}');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return null;
  }
}

async function handleOAuthTest(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  try {
    const data = await testOAuthAccessToken(parsed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'OAuth test failed' }));
  }
}

async function handleOAuthImages(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;

  try {
    const data = await runOAuthCodexImagesJob(normalizeOAuthPayload(parsed), () => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'OAuth image generation failed' }));
  }
}

async function handlePromptEnhance(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;

  try {
    const result = await enhancePrompt(parsed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 400;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Prompt enhancement failed' }));
  }
}

async function handleOAuthImagesStream(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(formatSseEvent(event, data));
  };
  try {
    send('progress', { phase: 'request:accepted', message: '后端已接收请求' });
    const data = await runOAuthCodexImagesJob(normalizeOAuthPayload(parsed), (phase, message, extra = {}) => {
      send('progress', { phase, message, ...extra });
    });
    send('result', data);
    send('done', { ok: true });
    res.end();
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    send('error', { status, error: e.message || 'OAuth image generation failed' });
    res.end();
  }
}

// --- Background image jobs ---

function baseApiUrl(apiUrl) {
  const text = String(apiUrl || '').trim().replace(/\/+$/, '');
  if (!text) throw new Error('Missing API address');
  return text;
}

const CODEX_CLIENT_VERSION = '0.104.0';
const CODEX_CLIENT_USER_AGENT = `codex_cli_rs/${CODEX_CLIENT_VERSION}`;

function buildApiHeaders(cfg = {}, extra = {}) {
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) throw new Error('Missing API key');
  return { Authorization: `Bearer ${apiKey}`, ...extra };
}

export function buildOAuthCodexHeaders(cfg = {}, extra = {}) {
  const headers = buildApiHeaders(cfg, {
    Accept: 'text/event-stream',
    'OpenAI-Beta': 'responses=experimental',
    Originator: 'codex_cli_rs',
    Version: CODEX_CLIENT_VERSION,
    'User-Agent': CODEX_CLIENT_USER_AGENT,
    session_id: crypto.randomUUID(),
    ...extra,
  });
  const accountId = String(cfg.accountId || '').trim();
  if (accountId) headers['chatgpt-account-id'] = accountId;
  return headers;
}

function buildImagesApiHeaders(cfg = {}, extra = {}) {
  const headers = buildApiHeaders(cfg, extra);
  const accountId = String(cfg.accountId || '').trim();
  if (accountId) headers['chatgpt-account-id'] = accountId;
  return headers;
}

function imageOptionsFromPayload(payload) {
  const out = {};
  if (payload.stream === true) out.stream = true;
  if (payload.quality) out.quality = payload.quality;
  if (payload.background && payload.background !== 'auto') out.background = payload.background;
  if (payload.size && payload.size !== 'auto') out.size = payload.size;
  if (payload.format && payload.format !== 'png') out.output_format = payload.format;
  return out;
}

export function toImageDataUrl(data, mime = 'image/png') {
  const value = String(data || '').trim();
  if (/^data:image\/[^;]+;base64,/i.test(value)) return value;
  return `data:${mime};base64,${value}`;
}

function normalizeRefImages(payload = {}) {
  const raw = Array.isArray(payload.refImagesBase64)
    ? payload.refImagesBase64
    : (payload.refImageBase64 ? [payload.refImageBase64] : []);
  if (raw.length > MAX_REF_IMAGES) throw new Error('最多只能上传 3 张参考图');
  return raw.filter((item) => typeof item === 'string' && item.trim()).slice(0, MAX_REF_IMAGES);
}

function extractImagesFromResponsesText(rawText, format = 'png') {
  const found = [];
  const addResult = (result, extra = {}) => {
    if (result) found.push({ b64_json: result, ...extra });
  };
  const collectResponseOutput = (response) => {
    for (const item of (response?.output || [])) {
      if (item.type === 'image_generation_call' && item.result) {
        addResult(item.result, {
          revised_prompt: item.revised_prompt,
          output_format: item.output_format,
        });
      }
    }
  };

  try {
    const data = JSON.parse(rawText);
    collectResponseOutput(data);
    collectResponseOutput(data.response);
    if (found.length) return { created: Math.floor(Date.now() / 1000), data: found };
  } catch {}

  for (const line of String(rawText || '').split('\n')) {
    if (!line.startsWith('data:')) continue;
    const s = line.slice(5).trim();
    if (!s || s === '[DONE]') continue;
    try {
      const ev = JSON.parse(s);
      if (ev.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call' && ev.item.result) {
        addResult(ev.item.result, { revised_prompt: ev.item.revised_prompt, output_format: ev.item.output_format });
      }
      if (ev.type === 'response.completed') collectResponseOutput(ev.response);
      if (ev.error) throw new Error(normalizeGenerationError(ev.error.message || JSON.stringify(ev.error)));
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
    }
  }

  if (found.length) return { created: Math.floor(Date.now() / 1000), data: found };
  if (isPolicyViolationText(rawText)) throw new Error(normalizeGenerationError(rawText));
  throw new Error(`未能从 ${format || '图片'} 响应中提取到图片`);
}

function extractImagesFromImagesApiSse(rawText, format = 'png') {
  const found = [];
  for (const line of String(rawText || '').split('\n')) {
    if (!line.startsWith('data:')) continue;
    const s = line.slice(5).trim();
    if (!s || s === '[DONE]') continue;
    try {
      const ev = JSON.parse(s);
      if (ev.type === 'image_generation.completed' && ev.b64_json) {
        found.push({ b64_json: ev.b64_json, revised_prompt: ev.revised_prompt, url: ev.url });
      } else if (ev.type === 'response.completed') {
        const converted = extractImagesFromResponsesText(`data: ${JSON.stringify(ev)}\n\n`, format);
        found.push(...(converted.data || []));
      }
      if (ev.error) throw new Error(normalizeGenerationError(ev.error.message || JSON.stringify(ev.error)));
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
    }
  }
  if (found.length) return { created: Math.floor(Date.now() / 1000), data: found };
  if (isPolicyViolationText(rawText)) throw new Error(normalizeGenerationError(rawText));
  throw new Error(`未能从 Images API 流式响应中提取到图片`);
}

async function readResponseTextWithProgress(resp, onProgress) {
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream') || !resp.body?.getReader) return await resp.text();

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';

  const consumeBlock = (block) => {
    if (!String(block || '').trim()) return;
    rawText += `${block}\n\n`;
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim() || 'message';
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    const dataText = dataLines.join('\n').trim();
    if (!dataText || dataText === '[DONE]') return;
    try {
      const data = JSON.parse(dataText);
      const normalized = data.type ? data : { ...data, type: event };
      const message = getResponseStreamProgressMessage(normalized);
      if (message) onProgress(normalized.type || event, message);
    } catch {}
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || '';
    for (const part of parts) consumeBlock(part);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeBlock(buffer);
  return rawText;
}

async function readUpstreamJson(resp, label = 'API') {
  const text = await resp.text();
  try {
    return JSON.parse(text || '{}');
  } catch {
    const prefix = String(text || '').trim().slice(0, 120).replace(/\s+/g, ' ');
    if (/^<!doctype html|^<html|^</i.test(prefix)) {
      throw new Error(`${label} 上游返回了 HTML 错误页面（HTTP ${resp.status}）。这通常是 API 站点/CDN 返回 502、404 或网关错误，不是图片 JSON 结果。`);
    }
    throw new Error(`${label} 返回的不是有效 JSON（HTTP ${resp.status}）：${prefix || '空响应'}`);
  }
}

export function buildImagesApiBody(payload = {}) {
  const cfg = payload.cfg || {};
  const mode = payload.mode;
  const refImages = normalizeRefImages(payload);
  if (mode === 'edits') {
    return {
      model: cfg.model,
      prompt: payload.prompt,
      n: 1,
      response_format: 'b64_json',
      images: refImages.map((data) => ({ image_url: toImageDataUrl(data) })),
      ...imageOptionsFromPayload(payload),
    };
  }
  return {
    model: cfg.model,
    prompt: payload.prompt,
    n: 1,
    response_format: 'b64_json',
    ...imageOptionsFromPayload(payload),
  };
}

function effectiveOAuthImageModel(payload = {}) {
  const model = String(payload.cfg?.model || payload.model || '').trim();
  return /^gpt-image-/i.test(model) ? model : 'gpt-image-2';
}

export function buildOAuthCodexImagesRequest(payload = {}) {
  const refImages = normalizeRefImages(payload);
  const hasRef = refImages.length > 0;
  const prompt = String(payload.prompt || '').trim();
  const tool = {
    type: 'image_generation',
    action: hasRef ? 'edit' : 'generate',
    model: effectiveOAuthImageModel(payload),
  };
  const options = imageOptionsFromPayload({ ...payload, stream: false });
  delete options.stream;
  Object.assign(tool, options);
  if (payload.format && payload.format !== 'png') tool.output_format = payload.format;
  else if (payload.format === 'png') tool.output_format = 'png';

  return {
    instructions: '',
    stream: true,
    reasoning: { effort: 'medium', summary: 'auto' },
    parallel_tool_calls: true,
    include: ['reasoning.encrypted_content'],
    model: 'gpt-5.4-mini',
    store: false,
    tool_choice: { type: 'image_generation' },
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        ...refImages.map((data) => ({ type: 'input_image', image_url: toImageDataUrl(data) })),
      ],
    }],
    tools: [tool],
  };
}

function normalizeOAuthPayload(input = {}) {
  const cfg = input.cfg || {};
  const rawApiUrl = String(input.apiUrl || cfg.apiUrl || '').trim().replace(/\/+$/, '');
  const codexApiUrl = /chatgpt\.com\/backend-api\/codex/i.test(rawApiUrl)
    ? rawApiUrl.replace(/\/responses$/i, '')
    : 'https://chatgpt.com/backend-api/codex';
  return {
    ...input,
    cfg: {
      apiUrl: codexApiUrl,
      apiKey: input.accessToken || input.apiKey || cfg.apiKey,
      accountId: input.accountId || cfg.accountId,
      model: input.model || cfg.model || 'gpt-image-2',
    },
  };
}

async function runImagesApiJob(payload, onProgress) {
  const cfg = payload.cfg || {};
  const format = payload.format || 'png';
  const mode = payload.mode;
  const body = buildImagesApiBody(payload);

  const endpoint = mode === 'edits' ? '/v1/images/edits' : '/v1/images/generations';
  onProgress('request:send', getGenerationProgressMessage('request:send'));
  const resp = await fetch(`${baseApiUrl(cfg.apiUrl)}${endpoint}`, {
    method: 'POST',
    headers: buildImagesApiHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  onProgress('request:accepted', getGenerationProgressMessage('request:accepted'));
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const rawText = await readResponseTextWithProgress(resp, onProgress);
    if (!resp.ok) throw new Error(normalizeGenerationError(rawText || `HTTP ${resp.status}`));
    return extractImagesFromImagesApiSse(rawText, format);
  }
  const data = await readUpstreamJson(resp, 'Images API');
  if (!resp.ok) throw new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`));
  return data;
}

async function runOAuthCodexImagesJob(payload, onProgress) {
  const normalized = normalizeOAuthPayload(payload);
  const cfg = normalized.cfg || {};
  const format = normalized.format || 'png';
  const body = buildOAuthCodexImagesRequest(normalized);

  onProgress('request:send', getGenerationProgressMessage('request:send'));
  const resp = await fetch(`${baseApiUrl(cfg.apiUrl)}/responses`, {
    method: 'POST',
    headers: buildOAuthCodexHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  onProgress('request:accepted', getGenerationProgressMessage('request:accepted'));
  const rawText = await readResponseTextWithProgress(resp, onProgress);
  if (!resp.ok) {
    try {
      const data = JSON.parse(rawText);
      throw new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`));
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
      throw new Error(normalizeGenerationError(rawText || `HTTP ${resp.status}`));
    }
  }
  return extractImagesFromResponsesText(rawText, format);
}

export async function handleOAuthCodexImageRequestBody(body = {}) {
  return await runOAuthCodexImagesJob(normalizeOAuthPayload(body), () => {});
}

async function persistJobResultIfEnabled(result, payload, onProgress) {
  if (payload.storageSettings?.enabled === false) return result;
  onProgress('storage:save', '正在保存图片到历史记录');
  return await imageStore.persistGenerationResult(result, {
    prompt: payload.prompt,
    format: payload.format || 'png',
    watermarkSettings: payload.watermarkSettings || {},
  });
}

async function runImageJob(payload, onProgress) {
  const mode = payload.mode || (normalizeRefImages(payload).length ? 'edits' : 'images');
  if (!String(payload.prompt || '').trim()) throw new Error('Missing prompt');
  let result;
  if (mode === 'oauth') {
    result = await runOAuthCodexImagesJob(payload, onProgress);
    return await persistJobResultIfEnabled(result, payload, onProgress);
  }
  if (mode === 'images' || mode === 'edits') {
    result = await runImagesApiJob(payload, onProgress);
    return await persistJobResultIfEnabled(result, payload, onProgress);
  }
  throw new Error(`Unsupported job mode: ${mode}`);
}

export const imageJobStore = createJobStore({ runner: runImageJob });

async function handleCreateImageJob(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  try {
    if (isServerlessRuntime()) {
      const progress = [];
      const onProgress = (phase, message, extra = {}) => {
        progress.push({ phase, message, ...extra, at: Date.now() });
      };
      const serverlessPayload = {
        ...parsed,
        storageSettings: { ...(parsed.storageSettings || {}), enabled: false },
      };
      const result = await runImageJob(serverlessPayload, onProgress);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', result, progress, serverless: true }));
      return;
    }

    const job = imageJobStore.create(parsed);
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobId: job.id, ...job }));
  } catch (e) {
    const status = /missing prompt|missing api|missing oauth|missing access token/i.test(e.message || '') ? 400 : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Failed to create job' }));
  }
}

function handleGetImageJob(req, res, jobId) {
  const job = imageJobStore.get(jobId);
  if (!job) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Job not found or expired' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(job));
}

function handleStorageStats(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(imageStore.getStats()));
}

async function handleStorageClear(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  try {
    const result = imageStore.clear(parsed.scope || 'images');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Failed to clear storage' }));
  }
}

function handleStoredImage(req, res, imageId) {
  const found = imageStore.getImagePath(imageId);
  if (!found) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Image not found' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': found.record.mime || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(found.filePath).pipe(res);
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
  } else if (url.pathname === '/api/prompt/enhance' && req.method === 'POST') {
    handlePromptEnhance(req, res);
  } else if (url.pathname === '/api/jobs' && req.method === 'POST') {
    handleCreateImageJob(req, res);
  } else if (url.pathname.startsWith('/api/jobs/') && req.method === 'GET') {
    const jobId = decodeURIComponent(url.pathname.split('/api/jobs/')[1] || '');
    handleGetImageJob(req, res, jobId);
  } else if (url.pathname === '/api/storage' && req.method === 'GET') {
    handleStorageStats(req, res);
  } else if (url.pathname === '/api/storage/clear' && req.method === 'POST') {
    handleStorageClear(req, res);
  } else if (url.pathname.startsWith('/api/images/') && req.method === 'GET') {
    const imageId = decodeURIComponent(url.pathname.split('/api/images/')[1] || '');
    handleStoredImage(req, res, imageId);
  } else if (url.pathname === '/api/oauth/start' && req.method === 'POST') {
    handleOAuthStart(req, res);
  } else if (url.pathname.startsWith('/api/oauth/status/') && req.method === 'GET') {
    const state = url.pathname.split('/api/oauth/status/')[1];
    handleOAuthStatus(req, res, state);
  } else if (url.pathname === '/api/oauth/exchange' && req.method === 'POST') {
    handleOAuthExchange(req, res);
  } else if (url.pathname === '/api/oauth/refresh' && req.method === 'POST') {
    handleOAuthRefresh(req, res);
  } else if (url.pathname === '/api/oauth/test' && req.method === 'POST') {
    handleOAuthTest(req, res);
  } else if (url.pathname === '/api/oauth/images' && req.method === 'POST') {
    handleOAuthImages(req, res);
  } else if (url.pathname === '/api/oauth/images/stream' && req.method === 'POST') {
    handleOAuthImagesStream(req, res);
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

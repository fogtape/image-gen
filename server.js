import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { handleOAuthImageRequestBody, testOAuthAccessToken } from './openai-oauth-image.js';
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
import { createConfigService } from './config-service.js';
import { createPlatformHandler, getSupportedPlatforms } from './handlers/handler-factory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.IMAGE_GEN_DATA_DIR || path.join(__dirname, 'data');
const MAX_REF_IMAGES = 3;
const IMAGES_API_TIMEOUT_MS = 300_000;
const RESPONSES_API_TIMEOUT_MS = 300_000;
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

const ADMIN_TOKEN_HEADER = 'x-image-gen-admin-token';
const configService = createConfigService({
  isServerless: isServerlessRuntime(),
  onReload: (nextConfig) => {
    console.log(`[config] reloaded ${configService?.envFile || ''} (${nextConfig?.providerDefaults?.imageModel || 'gpt-image-2'})`);
  },
});
if (!isServerlessRuntime()) {
  configService.startWatcher();
}

function getRuntimeConfig() {
  return configService.getRuntimeConfig();
}

function getPlatformHandler(platform) {
  return createPlatformHandler(platform || getRuntimeConfig()?.deploy?.platform || 'node', {
    configService,
    runtimeResolver: getRuntimeConfig,
  });
}

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

  const { url, method, headers, body: reqBody, multipartBody } = parsed;
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url' }));
    return;
  }

  const fetchMethod = (method || 'POST').toUpperCase();
  const opts = { method: fetchMethod, headers: { ...headers } };
  if (fetchMethod !== 'GET' && reqBody != null) {
    if (multipartBody?.fields) {
      delete opts.headers['Content-Type'];
      delete opts.headers['content-type'];
      opts.body = buildProxyMultipartFormData(multipartBody);
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(reqBody);
    }
  } else if (fetchMethod !== 'GET' && multipartBody?.fields) {
    delete opts.headers['Content-Type'];
    delete opts.headers['content-type'];
    opts.body = buildProxyMultipartFormData(multipartBody);
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
    const data = await handleOAuthImageRequestBody(parsed);
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
    const data = await handleOAuthImageRequestBody({
      ...parsed,
      onProgress: (event) => send(event.type || 'progress', event),
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

async function runWithTimeout(task, timeoutMs, timeoutMessage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } catch (e) {
    if (e?.name === 'AbortError') {
      const error = new Error(timeoutMessage || `上游请求超时（>${Math.ceil(timeoutMs / 1000)} 秒）`);
      error.status = 504;
      error.code = 'UPSTREAM_TIMEOUT';
      throw error;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const CODEX_CLIENT_VERSION = '0.104.0';
const CODEX_CLIENT_USER_AGENT = `codex_cli_rs/${CODEX_CLIENT_VERSION}`;

function buildApiHeaders(cfg = {}, extra = {}) {
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) throw new Error('Missing API key');
  return { Authorization: `Bearer ${apiKey}`, ...extra };
}

function buildResponsesApiHeaders(cfg = {}, extra = {}) {
  return buildApiHeaders(cfg, {
    Accept: 'text/event-stream',
    'OpenAI-Beta': 'responses=experimental',
    Originator: 'codex_cli_rs',
    Version: CODEX_CLIENT_VERSION,
    'User-Agent': CODEX_CLIENT_USER_AGENT,
    session_id: crypto.randomUUID(),
    ...extra,
  });
}

function isImagesApiModel(model) {
  return /^gpt-image-/i.test(String(model || '').trim());
}

function imageOptionsFromPayload(payload) {
  const out = {};
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

function parseImageInputData(data, fallbackMime = 'image/png') {
  const value = String(data || '').trim();
  const match = value.match(/^data:(image\/[^;]+);base64,(.*)$/is);
  if (match) return { mime: match[1].toLowerCase(), base64: match[2] };
  return { mime: fallbackMime, base64: value };
}

function imageExtensionFromMime(mime = 'image/png') {
  if (/image\/jpe?g/i.test(mime)) return 'jpg';
  if (/image\/webp/i.test(mime)) return 'webp';
  return 'png';
}

function appendMultipartImage(form, image, index = 0, fieldName = 'image') {
  const source = image?.data ?? image?.dataUrl ?? image;
  const parsed = parseImageInputData(source);
  const name = image?.fieldName || fieldName;
  const filename = image?.filename || `reference-${index + 1}.${imageExtensionFromMime(parsed.mime)}`;
  form.append(name, new Blob([Buffer.from(parsed.base64, 'base64')], { type: parsed.mime }), filename);
}

function buildImagesEditsMultipartFields(payload = {}) {
  const cfg = payload.cfg || {};
  const fields = {
    model: cfg.model,
    prompt: payload.prompt,
    n: '1',
    response_format: 'b64_json',
  };
  if (payload.quality) fields.quality = payload.quality;
  if (payload.background && payload.background !== 'auto') fields.background = payload.background;
  if (payload.size && payload.size !== 'auto') fields.size = payload.size;
  if (payload.format && payload.format !== 'png') fields.output_format = payload.format;
  return fields;
}

function buildImagesEditsMultipartFormData(payload = {}) {
  const form = new FormData();
  const fields = buildImagesEditsMultipartFields(payload);
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && String(value) !== '') form.append(key, String(value));
  }
  normalizeRefImages(payload).forEach((data, index) => appendMultipartImage(form, data, index));
  return form;
}

function buildProxyMultipartFormData(multipartBody = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(multipartBody.fields || {})) {
    if (value != null && String(value) !== '') form.append(key, String(value));
  }
  (multipartBody.images || []).forEach((image, index) => appendMultipartImage(form, image, index));
  return form;
}

function shouldUseCompatImageEdits(cfg = {}) {
  return cfg.imageEditsCompatMode === true;
}

function shouldAutoFallbackFromResponses(cfg = {}) {
  return cfg.responsesAutoFallback !== false;
}

function isImageEditsCompatError(value) {
  return /failed to parse multipart form|convert_request_failed/i.test(normalizeGenerationError(value || ''));
}

function withImageEditsCompatHint(value, cfg = {}) {
  const message = normalizeGenerationError(value);
  if (cfg.imageEditsCompatMode === true || !isImageEditsCompatError(message)) return message;
  return `${message}。这个站点的 /v1/images/edits 可能只支持旧版 multipart 兼容模式，请到账号设置里开启“图生图兼容模式（旧版 multipart）”。`;
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
  const addResult = (result) => {
    if (result) found.push({ b64_json: result });
  };

  try {
    const data = JSON.parse(rawText);
    for (const item of (data.output || [])) {
      if (item.type === 'image_generation_call' && item.result) addResult(item.result);
    }
    if (found.length) return { created: Math.floor(Date.now() / 1000), data: found };
  } catch {}

  for (const line of String(rawText || '').split('\n')) {
    if (!line.startsWith('data:')) continue;
    const s = line.slice(5).trim();
    if (!s || s === '[DONE]') continue;
    try {
      const ev = JSON.parse(s);
      if (ev.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call' && ev.item.result) {
        addResult(ev.item.result);
      }
      if (ev.error) throw new Error(normalizeGenerationError(ev.error.message || JSON.stringify(ev.error)));
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
    }
  }

  if (found.length) return { created: Math.floor(Date.now() / 1000), data: found };
  if (isPolicyViolationText(rawText)) throw new Error(normalizeGenerationError(rawText));
  throw new Error(`未能从 ${format || '图片'} 响应中提取到图片`);
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

async function runImagesApiJob(payload, onProgress) {
  const cfg = payload.cfg || {};
  const format = payload.format || 'png';
  const mode = payload.mode;
  const compatMode = mode === 'edits' && shouldUseCompatImageEdits(cfg);
  const body = compatMode ? null : buildImagesApiBody(payload);

  const endpoint = mode === 'edits' ? '/v1/images/edits' : '/v1/images/generations';
  onProgress('request:send', getGenerationProgressMessage('request:send'));
  const { resp, data } = await runWithTimeout(async (signal) => {
    const resp = await fetch(`${baseApiUrl(cfg.apiUrl)}${endpoint}`, {
      method: 'POST',
      headers: compatMode ? buildApiHeaders(cfg) : buildApiHeaders(cfg, { 'Content-Type': 'application/json' }),
      body: compatMode ? buildImagesEditsMultipartFormData(payload) : JSON.stringify(body),
      signal,
    });
    onProgress('request:accepted', getGenerationProgressMessage('request:accepted'));
    const data = await readUpstreamJson(resp, 'Images API');
    return { resp, data };
  }, IMAGES_API_TIMEOUT_MS, 'Images API 上游响应超时，请稍后重试');
  if (!resp.ok) throw new Error(withImageEditsCompatHint(data.error?.message || data.message || `HTTP ${resp.status}`, cfg));
  return data;
}

async function runResponsesJob(payload, onProgress) {
  const cfg = payload.cfg || {};
  const refImages = normalizeRefImages(payload);
  const hasRef = refImages.length > 0;
  const format = payload.format || 'png';
  const input = hasRef
    ? [{ role: 'user', content: [
        ...refImages.map((data) => ({ type: 'input_image', image_url: toImageDataUrl(data) })),
        { type: 'input_text', text: payload.prompt },
      ]}]
    : payload.prompt;

  const body = {
    model: cfg.responsesModel || 'gpt-5.4',
    input,
    stream: true,
    store: false,
    tool_choice: { type: 'image_generation' },
    tools: [{
      type: 'image_generation',
      action: hasRef ? 'edit' : 'generate',
      model: cfg.model,
      quality: payload.quality || 'medium',
      size: payload.size === 'auto' ? 'auto' : payload.size,
      background: payload.background || 'auto',
      output_format: format,
    }],
  };

  onProgress('request:send', getGenerationProgressMessage('request:send'));
  const { resp, rawText } = await runWithTimeout(async (signal) => {
    const resp = await fetch(`${baseApiUrl(cfg.apiUrl)}/v1/responses`, {
      method: 'POST',
      headers: buildResponsesApiHeaders(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal,
    });
    onProgress('request:accepted', getGenerationProgressMessage('request:accepted'));
    const rawText = await readResponseTextWithProgress(resp, onProgress);
    return { resp, rawText };
  }, RESPONSES_API_TIMEOUT_MS, 'Responses 图片请求超时，请稍后重试');
  if (!resp.ok) {
    try {
      const data = JSON.parse(rawText);
      throw new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`));
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
      throw new Error(`HTTP ${resp.status}`);
    }
  }
  return extractImagesFromResponsesText(rawText, format);
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
  const mode = payload.mode || 'responses';
  if (!String(payload.prompt || '').trim()) throw new Error('Missing prompt');
  let result;
  if (mode === 'oauth') {
    const cfg = payload.cfg || {};
    result = await handleOAuthImageRequestBody({
      accessToken: cfg.apiKey,
      accountId: cfg.accountId,
      openaiDeviceId: cfg.openaiDeviceId,
      openaiSessionId: cfg.openaiSessionId,
      model: cfg.model,
      prompt: payload.prompt,
      refImagesBase64: payload.refImagesBase64,
      n: 1,
      quality: payload.quality,
      background: payload.background,
      size: payload.size,
      format: payload.format,
      onProgress: (event) => onProgress(event.phase || event.type || 'progress', event.message || '处理中', event),
    });
    return await persistJobResultIfEnabled(result, payload, onProgress);
  }
  if (mode === 'responses') {
    try {
      result = await runResponsesJob(payload, onProgress);
    } catch (e) {
      if (normalizeGenerationError(e) === '非常抱歉，生成的图片可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。') throw e;
      if (!shouldAutoFallbackFromResponses(payload.cfg)) throw new Error(withImageEditsCompatHint(e?.message || e, payload.cfg || {}));
      if (!isImagesApiModel(payload.cfg?.model)) throw e;
      onProgress('fallback:images', getGenerationProgressMessage('fallback:images'));
      result = await runImagesApiJob({ ...payload, mode: normalizeRefImages(payload).length ? 'edits' : 'images' }, onProgress);
    }
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



function readAdminToken(req, parsedBody = null) {
  const headerValue = req.headers?.[ADMIN_TOKEN_HEADER] || req.headers?.[ADMIN_TOKEN_HEADER.toLowerCase()];
  return String(headerValue || parsedBody?.adminToken || '').trim();
}

function requireConfigAdmin(req, res, parsedBody = null) {
  const token = readAdminToken(req, parsedBody);
  if (!configService.verifyAdminToken(token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Config admin token invalid' }));
    return false;
  }
  return true;
}

function handleConfigRuntime(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    runtime: configService.getResolvedConfig(),
    editable: configService.getEditableRuntimeConfig(),
    schema: configService.getSchema(),
    platforms: getSupportedPlatforms(),
  }));
}

function handleConfigSchema(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    schema: configService.getSchema(),
    platforms: getSupportedPlatforms(),
  }));
}

async function handleConfigSave(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  if (!requireConfigAdmin(req, res, parsed)) return;
  try {
    const saved = configService.setRuntimeConfig(parsed.config || parsed.runtime || parsed, { preserveSecrets: true });
    const handler = getPlatformHandler(saved?.deploy?.platform);
    const operations = [];
    if (saved?.deploy?.autoSync === true) {
      operations.push(await handler.sync());
    }
    if (saved?.deploy?.autoRedeploy === true) {
      operations.push(await handler.deploy());
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, runtime: configService.getResolvedConfig(), operations }));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'Failed to save runtime config' }));
  }
}

async function handlePlatformCheck(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  if (!requireConfigAdmin(req, res, parsed)) return;
  try {
    if (parsed.config) configService.setRuntimeConfig(parsed.config, { preserveSecrets: true });
    const handler = getPlatformHandler(parsed.platform || parsed.config?.deploy?.platform);
    const result = await handler.check();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'Platform check failed' }));
  }
}

async function handlePlatformSync(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  if (!requireConfigAdmin(req, res, parsed)) return;
  try {
    if (parsed.config) configService.setRuntimeConfig(parsed.config, { preserveSecrets: true });
    const handler = getPlatformHandler(parsed.platform || parsed.config?.deploy?.platform);
    const result = await handler.sync();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'Platform sync failed' }));
  }
}

async function handlePlatformDeploy(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  if (!requireConfigAdmin(req, res, parsed)) return;
  try {
    if (parsed.config) configService.setRuntimeConfig(parsed.config, { preserveSecrets: true });
    const handler = getPlatformHandler(parsed.platform || parsed.config?.deploy?.platform);
    const result = await handler.deploy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'Platform deploy failed' }));
  }
}

// --- Main server ---

export const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Image-Gen-Admin-Token');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/proxy' && req.method === 'POST') {
    handleProxy(req, res);
  } else if (url.pathname === '/api/config/runtime' && req.method === 'GET') {
    handleConfigRuntime(req, res);
  } else if (url.pathname === '/api/config/schema' && req.method === 'GET') {
    handleConfigSchema(req, res);
  } else if (url.pathname === '/api/config/save' && req.method === 'POST') {
    handleConfigSave(req, res);
  } else if (url.pathname === '/api/config/platform/check' && req.method === 'POST') {
    handlePlatformCheck(req, res);
  } else if (url.pathname === '/api/config/platform/sync' && req.method === 'POST') {
    handlePlatformSync(req, res);
  } else if (url.pathname === '/api/config/platform/deploy' && req.method === 'POST') {
    handlePlatformDeploy(req, res);
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

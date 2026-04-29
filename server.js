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
import {
  getProxyAllowedHosts,
  isExplicitLocalDevProxyAllowed,
  validateApiBaseUrl,
} from './proxy-policy.js';
import { prepareProxyRequest, runProxyUpstream } from './proxy-executor.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.IMAGE_GEN_DATA_DIR || path.join(__dirname, 'data');
const STATIC_ROOT = path.resolve(process.env.IMAGE_GEN_STATIC_DIR || path.join(__dirname, 'dist'));
const MAX_REF_IMAGES = 3;
const IMAGES_API_TIMEOUT_MS = 300_000;
const RESPONSES_API_TIMEOUT_MS = 300_000;

function boundedIntEnv(name, fallback, min, max) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

const IMAGE_JOB_MAX_CONCURRENCY = boundedIntEnv('IMAGE_JOB_MAX_CONCURRENCY', 3, 1, 10);
const IMAGE_JOB_MAX_QUEUE = boundedIntEnv('IMAGE_JOB_MAX_QUEUE', 12, 1, 100);
const IMAGE_JOB_TTL_MS = boundedIntEnv('IMAGE_JOB_TTL_MS', 30 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
const IMAGE_JOB_PENDING_TIMEOUT_MS = boundedIntEnv('IMAGE_JOB_PENDING_TIMEOUT_MS', 15 * 60 * 1000, 10_000, 60 * 60 * 1000);
const IMAGE_JOB_RUNNING_TIMEOUT_MS = boundedIntEnv('IMAGE_JOB_RUNNING_TIMEOUT_MS', 15 * 60 * 1000, 10_000, 60 * 60 * 1000);
const IMAGE_JOB_MAX_COUNT = 4;
const JSON_BODY_LIMIT_BYTES = Math.min(50 * 1024 * 1024, Math.max(1024, Number(process.env.IMAGE_GEN_JSON_BODY_LIMIT_BYTES || 10 * 1024 * 1024)));
const IMAGE_JOB_BODY_LIMIT_BYTES = Math.min(80 * 1024 * 1024, Math.max(1024 * 1024, Number(process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES || 30 * 1024 * 1024)));
const REF_IMAGE_MAX_BYTES = Math.min(30 * 1024 * 1024, Math.max(1024, Number(process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES || 8 * 1024 * 1024)));
const REF_IMAGES_TOTAL_MAX_BYTES = Math.min(80 * 1024 * 1024, Math.max(1024, Number(process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES || 24 * 1024 * 1024)));
const ALLOWED_REF_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const imageStore = createImageStore({ dataDir: DATA_DIR });
const OAUTH_LOOPBACK_PORT = 1455;
const OAUTH_SESSION_FILE = process.env.IMAGE_GEN_OAUTH_SESSION_FILE || path.join(__dirname, '.oauth-sessions.json');

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
const STATIC_DENY_SEGMENTS = new Set(['config', 'data', 'api', 'handlers', 'node_modules', 'scripts', 'test', 'netlify']);
const STATIC_DENY_FILES = new Set([
  'server.js',
  'config-service.js',
  'openai-oauth-image.js',
  'oauth-flow.js',
  'package.json',
  'package-lock.json',
  '.oauth-sessions.json',
]);
const configService = createConfigService({
  isServerless: isServerlessRuntime(),
  onReload: (nextConfig) => {
    console.log(`[config] reloaded ${configService?.envFile || ''} (${nextConfig?.providerDefaults?.imageModel || 'gpt-image-2'})`);
  },
});

function parseOriginList(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function parseHostHeader(value = '') {
  try {
    return new URL(`http://${String(value || '').trim()}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLocalDevHostname(hostname = '') {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function resolveAllowedCorsOrigin(req) {
  const origin = String(req.headers.origin || '').trim().replace(/\/+$/, '');
  if (!origin) return '';
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';

  const explicitOrigins = new Set(parseOriginList(process.env.IMAGE_GEN_ALLOWED_ORIGINS));
  if (explicitOrigins.has(origin)) return origin;

  const requestHost = String(req.headers.host || '').toLowerCase();
  if (parsed.host.toLowerCase() === requestHost) return origin;

  const requestHostname = parseHostHeader(requestHost);
  if (isLocalDevHostname(parsed.hostname) && isLocalDevHostname(requestHostname)) return origin;
  return '';
}

function applyCorsHeaders(req, res) {
  const allowedOrigin = resolveAllowedCorsOrigin(req);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Image-Gen-Admin-Token');
}
if (!isServerlessRuntime()) {
  configService.startWatcher();
}

function getRuntimeConfig() {
  return configService.getRuntimeConfig();
}

function getResolvedRuntimeConfig() {
  return configService.getResolvedConfig();
}

function getPlatformHandler(platform) {
  const resolved = getResolvedRuntimeConfig();
  return createPlatformHandler(platform || resolved?.deploy?.platform || 'node', {
    configService,
    runtimeResolver: getResolvedRuntimeConfig,
  });
}

// --- OAuth session store (sessionId -> session, state -> sessionId, persisted, 30 min TTL) ---

const oauthSessions = new Map();
const oauthStateIndex = new Map();
const SESSION_TTL = 30 * 60 * 1000;

export function newOAuthSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function oauthSessionSigningSecret() {
  return String(
    process.env.IMAGE_GEN_OAUTH_SESSION_SECRET
    || process.env.IMAGE_GEN_ADMIN_TOKEN
    || `image-gen-oauth-session:${OAUTH_CLIENT_ID}`
  );
}

function signOAuthSessionPayload(payload) {
  return crypto.createHmac('sha256', oauthSessionSigningSecret()).update(payload).digest('base64url');
}

function safeEqualString(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function makeStatelessOAuthSessionId(session) {
  const payload = {
    state: session?.state || '',
    codeVerifier: session?.codeVerifier || '',
    redirectUri: session?.redirectUri || OAUTH_REDIRECT_URI,
    createdAt: Number(session?.createdAt || Date.now()),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `pkce_${encoded}.${signOAuthSessionPayload(encoded)}`;
}

export function getOAuthSessionFromStatelessId(sessionId) {
  if (!sessionId || !String(sessionId).startsWith('pkce_')) return null;
  try {
    const [encoded, signature] = String(sessionId).slice(5).split('.');
    if (!encoded || !signature || !safeEqualString(signOAuthSessionPayload(encoded), signature)) return null;
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
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

function isTokenLikeOAuthKey(key = '') {
  return /^(accessToken|refreshToken|access_token|refresh_token|id_token|token)$/i.test(String(key || ''))
    || /token$/i.test(String(key || ''));
}

function sanitizeOAuthPersistedValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeOAuthPersistedValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'result' || isTokenLikeOAuthKey(key)) continue;
    out[key] = sanitizeOAuthPersistedValue(child);
  }
  return out;
}

function sanitizeOAuthSessionForDisk(session = {}) {
  if (!session || typeof session !== 'object') return null;
  if (session.status === 'success') return null;
  return sanitizeOAuthPersistedValue(session);
}

function writeOAuthSessionsAtomic(data) {
  const tmp = `${OAUTH_SESSION_FILE}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, OAUTH_SESSION_FILE);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}

function saveOAuthSessions() {
  try {
    const data = [];
    for (const [sessionId, session] of oauthSessions.entries()) {
      const persistedSession = sanitizeOAuthSessionForDisk(session);
      if (persistedSession) data.push([sessionId, persistedSession]);
    }
    writeOAuthSessionsAtomic(data);
  } catch (e) {
    console.warn('Failed to save OAuth sessions:', e.message);
  }
}

function backupCorruptOAuthSessionFile() {
  try {
    if (!fs.existsSync(OAUTH_SESSION_FILE)) return;
    const backup = `${OAUTH_SESSION_FILE}.corrupt.${Date.now()}`;
    fs.renameSync(OAUTH_SESSION_FILE, backup);
    writeOAuthSessionsAtomic([]);
  } catch (error) {
    console.warn('Failed to backup corrupt OAuth sessions:', error.message);
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
      const persistedSession = sanitizeOAuthSessionForDisk(session);
      if (!persistedSession) continue;
      oauthSessions.set(sessionId, persistedSession);
      indexOAuthSession(sessionId, persistedSession);
    }
  } catch (e) {
    console.warn('Failed to load OAuth sessions:', e.message);
    backupCorruptOAuthSessionFile();
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
      res.end(renderOAuthLoopbackPage('登录失败', '请关闭此窗口重试。'));
      return;
    }

    try {
      session.result = await exchangeOAuthCodeForResult(code, session);
      session.status = 'success';
      saveOAuthSessions();

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderOAuthLoopbackPage('登录成功', '可以关闭此窗口了。'));
    } catch (e) {
      session.status = 'error';
      session.error = e.message;
      saveOAuthSessions();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderOAuthLoopbackPage('登录失败', e.message || '请关闭此窗口重试。'));
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

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function renderOAuthLoopbackPage(title, message) {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>',
    escapeHtml(title),
    '</title></head><body><h2>',
    escapeHtml(title),
    '</h2><p>',
    escapeHtml(message),
    '</p><script>window.close()</script></body></html>',
  ].join('');
}

// --- Static file serving ---

function serveStatic(req, res) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const segments = pathname.split('/').filter(Boolean);
  const blocked = segments.some((segment) => (
    segment === '.'
    || segment === '..'
    || segment.startsWith('.')
    || STATIC_DENY_SEGMENTS.has(segment)
    || STATIC_DENY_FILES.has(segment)
  ));
  const filePath = path.resolve(STATIC_ROOT, `.${pathname}`);
  const insideStaticRoot = filePath === STATIC_ROOT || filePath.startsWith(`${STATIC_ROOT}${path.sep}`);
  if (blocked || !insideStaticRoot) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {}
  if (!stat || stat.isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

// --- Proxy handler ---

async function handleProxy(req, res) {
  const body = await readRequestText(req, res, { limitBytes: IMAGE_JOB_BODY_LIMIT_BYTES });
  if (body == null) return;

  let parsed;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  let prepared;
  try {
    prepared = prepareProxyRequest(parsed, {
      allowedHosts: getProxyAllowedHosts({ runtimeConfig: configService.getResolvedConfig() }),
      allowLocalHttp: isExplicitLocalDevProxyAllowed(),
      allowMultipart: true,
      buildMultipartBody: buildProxyMultipartFormData,
    });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 400;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Proxy request is invalid' }));
    return;
  }

  try {
    const result = await runProxyUpstream(prepared, {
      onStreamStart: ({ status, contentType }) => res.writeHead(status, {
        'Content-Type': contentType || 'text/event-stream',
        'Cache-Control': 'no-cache',
      }),
      onStreamChunk: (chunk) => res.write(chunk),
    });
    if (result.stream) {
      res.end();
    } else {
      res.writeHead(result.status, {
        'Content-Type': result.contentType,
      });
      res.end(result.body);
    }
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Proxy upstream request failed' }));
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
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;

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
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;

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

function payloadTooLargeError(message = '请求体过大') {
  const error = new Error(message);
  error.status = 413;
  return error;
}

async function readRequestText(req, res, { limitBytes = JSON_BODY_LIMIT_BYTES } = {}) {
  const declaredLength = Number(req.headers?.['content-length'] || 0);
  if (declaredLength > limitBytes) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '请求体过大，请减少参考图数量或换用更小图片' }));
    return null;
  }

  let body = '';
  let receivedBytes = 0;
  for await (const chunk of req) {
    receivedBytes += Buffer.byteLength(chunk);
    if (receivedBytes > limitBytes) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '请求体过大，请减少参考图数量或换用更小图片' }));
      return null;
    }
    body += chunk;
  }
  return body;
}

async function readJsonBody(req, res, { limitBytes = JSON_BODY_LIMIT_BYTES, allowEmpty = true, emptyValue = {} } = {}) {
  const body = await readRequestText(req, res, { limitBytes });
  if (body == null) return null;
  if (!String(body).trim()) {
    if (allowEmpty) return emptyValue;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return null;
  }
}

function decodedBase64Bytes(base64 = '') {
  const clean = String(base64 || '').replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function imageDataByteLength(data, fallbackMime = 'image/png') {
  const parsed = parseImageInputData(data, fallbackMime);
  return decodedBase64Bytes(parsed.base64);
}

function normalizeImageMime(mime = 'image/png') {
  const value = String(mime || 'image/png').trim().toLowerCase();
  if (value === 'image/jpg') return 'image/jpeg';
  return value;
}

function assertImageMimeAllowed(mime = 'image/png') {
  const normalized = normalizeImageMime(mime);
  if (!ALLOWED_REF_IMAGE_MIME_TYPES.has(normalized)) {
    const err = new Error('参考图格式不支持，请上传 PNG、JPEG 或 WebP 图片');
    err.status = 400;
    throw err;
  }
  return normalized;
}

function assertImageDataSize(data, { maxBytes = REF_IMAGE_MAX_BYTES, message = '参考图过大，请换用更小图片' } = {}) {
  const parsed = parseImageInputData(data);
  assertImageMimeAllowed(parsed.mime);
  const bytes = decodedBase64Bytes(parsed.base64);
  if (bytes > maxBytes) throw payloadTooLargeError(message);
  return bytes;
}

function assertRefImagesWithinLimits(images = []) {
  let totalBytes = 0;
  for (const image of images) {
    totalBytes += assertImageDataSize(image);
    if (totalBytes > REF_IMAGES_TOTAL_MAX_BYTES) throw payloadTooLargeError('参考图总大小过大，请减少数量或换用更小图片');
  }
}

function collectDataImageStrings(value, out = [], depth = 0) {
  if (depth > 8 || value == null) return out;
  if (typeof value === 'string') {
    if (/^data:image\/[^;]+;base64,/i.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDataImageStrings(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectDataImageStrings(item, out, depth + 1));
  }
  return out;
}

function assertEmbeddedDataImagesWithinLimits(value) {
  const images = collectDataImageStrings(value);
  assertRefImagesWithinLimits(images);
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
  const parsed = await readJsonBody(req, res, { limitBytes: IMAGE_JOB_BODY_LIMIT_BYTES });
  if (!parsed) return;

  try {
    assertRefImagesWithinLimits(normalizeRefImages(parsed));
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
    const result = await enhancePrompt({
      ...parsed,
      allowedHosts: getProxyAllowedHosts({ runtimeConfig: configService.getResolvedConfig() }),
      allowLocalHttp: isExplicitLocalDevProxyAllowed(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 400;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Prompt enhancement failed' }));
  }
}

async function handleOAuthImagesStream(req, res) {
  const parsed = await readJsonBody(req, res, { limitBytes: IMAGE_JOB_BODY_LIMIT_BYTES });
  if (!parsed) return;

  try {
    assertRefImagesWithinLimits(normalizeRefImages(parsed));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 400;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'OAuth image request is invalid' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
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
  return validateApiBaseUrl(apiUrl, {
    allowedHosts: getProxyAllowedHosts({ runtimeConfig: configService.getResolvedConfig() }),
    allowLocalHttp: isExplicitLocalDevProxyAllowed(),
  }).baseUrl;
}

function makeJobCancelledError(message = '后台任务已取消') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'JOB_CANCELLED';
  error.status = 499;
  return error;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'JOB_CANCELLED';
}

function throwIfJobAborted(signal) {
  if (signal?.aborted) throw makeJobCancelledError();
}

async function runWithTimeout(task, timeoutMs, timeoutMessage, externalSignal = null) {
  throwIfJobAborted(externalSignal);
  const controller = new AbortController();
  let abortReason = '';
  const abortFromExternal = () => {
    abortReason = 'external';
    try { controller.abort(externalSignal?.reason || makeJobCancelledError()); } catch { controller.abort(); }
  };
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });
  const timer = setTimeout(() => {
    abortReason = 'timeout';
    controller.abort();
  }, timeoutMs);
  try {
    return await task(controller.signal);
  } catch (e) {
    if (isAbortError(e)) {
      if (abortReason === 'external' || externalSignal?.aborted || e?.code === 'JOB_CANCELLED') {
        throw makeJobCancelledError();
      }
      const error = new Error(timeoutMessage || `上游请求超时（>${Math.ceil(timeoutMs / 1000)} 秒）`);
      error.status = 504;
      error.code = 'UPSTREAM_TIMEOUT';
      throw error;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromExternal);
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

function markError(error, fields = {}) {
  if (!error || typeof error !== 'object') return error;
  Object.assign(error, fields);
  return error;
}

function shouldFallbackResponsesError(error) {
  const message = normalizeGenerationError(error?.message || error || '');
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403 || status === 429 || status === 504) return false;
  if (/content policy|内容政策/i.test(message)) return false;
  if (/HTTP\s+(401|403|429|504)/i.test(message)) return false;
  return /HTTP\s+(404|405)/i.test(message)
    || /not supported|unsupported|html 错误页面|网关错误|Bad gateway|text\/html/i.test(message);
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
  if (match) return { mime: normalizeImageMime(match[1]), base64: match[2] };
  return { mime: normalizeImageMime(fallbackMime), base64: value };
}

function imageExtensionFromMime(mime = 'image/png') {
  if (/image\/jpe?g/i.test(mime)) return 'jpg';
  if (/image\/webp/i.test(mime)) return 'webp';
  return 'png';
}

function appendMultipartImage(form, image, index = 0, fieldName = 'image', options = {}) {
  const source = image?.data ?? image?.dataUrl ?? image;
  assertImageDataSize(source, { message: options.message || '参考图过大，请换用更小图片' });
  const parsed = parseImageInputData(source);
  const name = image?.fieldName || fieldName;
  const filename = image?.filename || `reference-${index + 1}.${imageExtensionFromMime(parsed.mime)}`;
  form.append(name, new Blob([Buffer.from(parsed.base64, 'base64')], { type: parsed.mime }), filename);
}

function getMultipartImageSource(image) {
  return image?.data ?? image?.dataUrl ?? image;
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

export function buildImagesEditsMultipartFormData(payload = {}) {
  const form = new FormData();
  const fields = buildImagesEditsMultipartFields(payload);
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && String(value) !== '') form.append(key, String(value));
  }
  const refImages = normalizeRefImages(payload);
  refImages.forEach((data, index) => appendMultipartImage(form, data, index));
  return form;
}


function buildProxyMultipartFormData(multipartBody = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(multipartBody.fields || {})) {
    if (value != null && String(value) !== '') form.append(key, String(value));
  }
  const images = Array.isArray(multipartBody.images) ? multipartBody.images : [];
  assertRefImagesWithinLimits(images.map(getMultipartImageSource));
  images.forEach((image, index) => appendMultipartImage(form, image, index));
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
  const images = raw.filter((item) => typeof item === 'string' && item.trim()).slice(0, MAX_REF_IMAGES);
  assertRefImagesWithinLimits(images);
  return images;
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

async function runImagesApiJob(payload, onProgress, signal = null) {
  throwIfJobAborted(signal);
  const cfg = payload.cfg || {};
  const format = payload.format || 'png';
  const mode = payload.mode;
  const compatMode = mode === 'edits' && shouldUseCompatImageEdits(cfg);
  const body = compatMode ? null : buildImagesApiBody(payload);

  const endpoint = mode === 'edits' ? '/v1/images/edits' : '/v1/images/generations';
  onProgress('route:selected', `当前链路：${compatMode ? 'images-multipart' : 'images-json'}`, {
    protocol: compatMode ? 'images-multipart' : 'images-json',
    endpoint,
    hasRef: mode === 'edits',
    compatMode,
  });
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
  }, IMAGES_API_TIMEOUT_MS, 'Images API 上游响应超时，请稍后重试', signal);
  if (!resp.ok) throw new Error(withImageEditsCompatHint(data.error?.message || data.message || `HTTP ${resp.status}`, cfg));
  return data;
}

async function runResponsesJob(payload, onProgress, signal = null) {
  throwIfJobAborted(signal);
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
  onProgress('route:selected', '当前链路：responses-sse', {
    protocol: 'responses-sse',
    endpoint: '/v1/responses',
    hasRef,
    compatMode: false,
  });
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
  }, RESPONSES_API_TIMEOUT_MS, 'Responses 图片请求超时，请稍后重试', signal);
  if (!resp.ok) {
    try {
      const data = JSON.parse(rawText);
      throw markError(new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`)), { status: resp.status, errorType: 'responses_http_error' });
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
      throw markError(new Error(`HTTP ${resp.status}`), { status: resp.status, errorType: 'responses_http_error' });
    }
  }
  return extractImagesFromResponsesText(rawText, format);
}

function createJobTrace(payload = {}) {
  const refImages = normalizeRefImages(payload);
  return {
    mode: payload.mode || 'responses',
    protocol: '',
    flow: '',
    phase: '',
    phases: [],
    endpoint: '',
    compatMode: false,
    fallbackAttempted: false,
    hasRef: refImages.length > 0,
    apiUrl: payload.cfg?.apiUrl || '',
  };
}

function sanitizeBatchId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
}

function normalizeImageJobCount(value) {
  if (value == null || value === '') return 1;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > IMAGE_JOB_MAX_COUNT) {
    throw markError(new Error(`生成数量必须是 1-${IMAGE_JOB_MAX_COUNT}`), { status: 400, code: 'INVALID_IMAGE_JOB_COUNT' });
  }
  return count;
}

function normalizeImageJobPayload(payload = {}) {
  const count = normalizeImageJobCount(payload.count);
  return {
    ...payload,
    count,
    batchId: sanitizeBatchId(payload.batchId) || `batch_${crypto.randomUUID()}`,
    batchCount: count,
  };
}

async function persistJobResultIfEnabled(result, payload, onProgress, trace = null) {
  if (payload.storageSettings?.enabled === false) return result;
  onProgress('storage:save', '正在保存图片到历史记录');
  const cfg = payload.cfg || {};
  const hasRef = normalizeRefImages(payload).length > 0;
  const stored = await imageStore.persistGenerationResult(result, {
    prompt: payload.prompt,
    format: payload.format || 'png',
    size: payload.size || 'auto',
    quality: payload.quality || '',
    background: payload.background || 'auto',
    mode: payload.mode || '',
    hasRef,
    watermarkSettings: payload.watermarkSettings || {},
    trace,
    batchId: payload.batchId,
    batchIndex: payload.batchIndex,
    batchCount: payload.batchCount || payload.count,
    model: cfg.model || payload.model || '',
    accountName: cfg.accountName || '',
    accountHost: cfg.accountHost || cfg.apiUrl || '',
    generation: {
      prompt: payload.prompt,
      size: payload.size || 'auto',
      quality: payload.quality || '',
      format: payload.format || 'png',
      background: payload.background || 'auto',
      mode: payload.mode || '',
      model: cfg.model || payload.model || '',
      hasRef,
    },
  });
  const items = Array.isArray(stored?.data) ? stored.data : [];
  const failures = items.filter((item) => item?.storageError);
  const successes = items.filter((item) => item?.persisted === true);
  if (failures.length && successes.length) {
    onProgress('storage:partial', `图片历史部分保存失败（${failures.length} 张）`, {
      storageErrors: failures.slice(0, 3).map((item) => item.storageError),
    });
  } else if (failures.length) {
    onProgress('storage:error', `图片历史保存失败（${failures.length} 张）`, {
      storageErrors: failures.slice(0, 3).map((item) => item.storageError),
    });
  } else if (successes.length) {
    onProgress('storage:done', `已保存 ${successes.length} 张图片到历史记录`);
  }
  return stored;
}

async function runSingleImageJob(payload, onProgress, signal = null) {
  throwIfJobAborted(signal);
  const mode = payload.mode || 'responses';
  const refImages = normalizeRefImages(payload);
  assertRefImagesWithinLimits(refImages);
  if (!String(payload.prompt || '').trim()) throw new Error('Missing prompt');
  const trace = createJobTrace(payload);
  const tracedProgress = (phase, message, extra = {}) => {
    if (String(phase || '').startsWith('oauth:')) {
      trace.flow = 'chatgpt-web';
      trace.phase = phase;
      if (!trace.phases.includes(phase)) trace.phases.push(phase);
      if (trace.phases.length > 20) trace.phases.splice(0, trace.phases.length - 20);
    }
    if (phase === 'route:selected') {
      trace.protocol = extra.protocol || trace.protocol;
      trace.endpoint = extra.endpoint || trace.endpoint;
      trace.compatMode = extra.compatMode === true;
      trace.hasRef = extra.hasRef === true || trace.hasRef;
      if (trace.protocol === 'images-multipart') trace.mode = 'edits';
      else if (trace.protocol === 'images-json' && extra.hasRef === true) trace.mode = 'edits';
      else if (trace.protocol === 'images-json') trace.mode = 'images';
      else if (trace.protocol === 'responses-sse') trace.mode = 'responses';
    }
    if (phase === 'fallback:images') trace.fallbackAttempted = true;
    onProgress(phase, message, extra);
  };
  let result;
  if (mode === 'oauth') {
    const cfg = payload.cfg || {};
    trace.mode = 'oauth';
    trace.protocol = 'oauth-stream';
    trace.flow = 'chatgpt-web';
    trace.endpoint = '/api/oauth/images/stream';
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
      signal,
      onProgress: (event) => tracedProgress(event.phase || event.type || 'progress', event.message || '处理中', event),
    });
    return await persistJobResultIfEnabled(result, payload, tracedProgress, trace);
  }
  if (mode === 'responses') {
    try {
      result = await runResponsesJob(payload, tracedProgress, signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (normalizeGenerationError(e) === '非常抱歉，生成的图片可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。') throw e;
      if (!shouldAutoFallbackFromResponses(payload.cfg)) throw new Error(withImageEditsCompatHint(e?.message || e, payload.cfg || {}));
      if (!isImagesApiModel(payload.cfg?.model)) throw e;
      if (!shouldFallbackResponsesError(e)) throw e;
      e.fallbackAttempted = true;
      trace.fallbackAttempted = true;
      tracedProgress('fallback:images', getGenerationProgressMessage('fallback:images'));
      result = await runImagesApiJob({ ...payload, mode: normalizeRefImages(payload).length ? 'edits' : 'images' }, tracedProgress, signal);
    }
    return await persistJobResultIfEnabled(result, payload, tracedProgress, trace);
  }
  if (mode === 'images' || mode === 'edits') {
    trace.mode = mode;
    result = await runImagesApiJob(payload, tracedProgress, signal);
    return await persistJobResultIfEnabled(result, payload, tracedProgress, trace);
  }
  throw new Error(`Unsupported job mode: ${mode}`);
}

async function runImageJob(payload, onProgress, signal = null) {
  throwIfJobAborted(signal);
  const normalized = normalizeImageJobPayload(payload);
  const count = normalized.count;
  const batchId = normalized.batchId;
  if (count === 1) {
    return await runSingleImageJob({
      ...normalized,
      batchIndex: normalized.batchIndex || 1,
      batchCount: normalized.batchCount || 1,
    }, onProgress, signal);
  }

  const data = [];
  const errors = [];
  for (let index = 1; index <= count; index += 1) {
    throwIfJobAborted(signal);
    onProgress('batch:item:start', `正在生成第 ${index}/${count} 张`, { batchId, batchIndex: index, batchCount: count });
    try {
      const single = await runSingleImageJob({
        ...normalized,
        count: 1,
        batchId,
        batchIndex: index,
        batchCount: count,
      }, onProgress, signal);
      const items = Array.isArray(single?.data) ? single.data : [];
      for (const item of items) {
        data.push({ ...item, batchId, batchIndex: item?.batchIndex || index, batchCount: item?.batchCount || count });
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      const message = normalizeGenerationError(error?.message || error || '生成失败');
      errors.push({ batchIndex: index, message });
      data.push({ failed: true, error: message, batchId, batchIndex: index, batchCount: count });
      onProgress('batch:item:error', `第 ${index}/${count} 张生成失败`, { batchId, batchIndex: index, batchCount: count, error: message });
    }
  }

  const successCount = data.filter((item) => !item?.failed).length;
  if (!successCount) {
    const error = new Error(`批量生成失败：${errors[0]?.message || '没有成功生成图片'}`);
    error.code = 'BATCH_ALL_FAILED';
    error.batchId = batchId;
    error.batchErrors = errors;
    throw error;
  }
  if (errors.length) {
    onProgress('batch:partial', `批量生成部分完成：成功 ${successCount}/${count} 张`, {
      batchId,
      batchCount: count,
      batchErrors: errors.slice(0, 3),
    });
  } else {
    onProgress('batch:done', `批量生成完成：${successCount}/${count} 张`, { batchId, batchCount: count });
  }
  return {
    created: Math.floor(Date.now() / 1000),
    data,
    batchId,
    batchCount: count,
    errors,
  };
}

export const imageJobStore = createJobStore({
  runner: runImageJob,
  ttlMs: IMAGE_JOB_TTL_MS,
  maxPendingMs: IMAGE_JOB_PENDING_TIMEOUT_MS,
  maxRunningMs: IMAGE_JOB_RUNNING_TIMEOUT_MS,
  maxConcurrency: IMAGE_JOB_MAX_CONCURRENCY,
  maxQueue: IMAGE_JOB_MAX_QUEUE,
});

async function handleCreateImageJob(req, res) {
  const parsed = await readJsonBody(req, res, { limitBytes: IMAGE_JOB_BODY_LIMIT_BYTES });
  if (!parsed) return;
  try {
    const jobPayload = normalizeImageJobPayload(parsed);
    assertRefImagesWithinLimits(normalizeRefImages(jobPayload));
    if (isServerlessRuntime()) {
      const progress = [];
      const onProgress = (phase, message, extra = {}) => {
        progress.push({ phase, message, ...extra, at: Date.now() });
      };
      const serverlessPayload = {
        ...jobPayload,
        storageSettings: { ...(jobPayload.storageSettings || {}), enabled: false },
      };
      const result = await runImageJob(serverlessPayload, onProgress);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', result, progress, serverless: true }));
      return;
    }

    const job = imageJobStore.create(jobPayload);
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobId: job.id, ...job }));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600
      ? e.status
      : (/missing prompt|missing api|missing oauth|missing access token|最多只能上传/i.test(e.message || '') ? 400 : 500);
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

function handleCancelImageJob(req, res, jobId) {
  const job = imageJobStore.cancel(jobId);
  if (!job) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Job not found or expired' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, jobId: job.id, job }));
}

function handleStorageStats(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(imageStore.getStats()));
}

function parseFavoriteQuery(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  return null;
}

function handleStorageHistory(req, res, url) {
  const result = imageStore.listHistory({
    query: url.searchParams.get('query') || '',
    favorite: parseFavoriteQuery(url.searchParams.get('favorite')),
    limit: url.searchParams.get('limit') || 60,
    cursor: url.searchParams.get('cursor') || 0,
    batchId: url.searchParams.get('batchId') || '',
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

async function handleStorageClear(req, res) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  if (!requireConfigAdmin(req, res, parsed)) return;
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

async function handleImageMetaPatch(req, res, imageId) {
  const parsed = await readJsonBody(req, res);
  if (!parsed) return;
  if (!requireConfigAdmin(req, res, parsed)) return;
  try {
    const image = await imageStore.updateMeta(imageId, {
      favorite: parsed.favorite,
      tags: parsed.tags,
    });
    if (!image) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Image not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, image }));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Failed to update image metadata' }));
  }
}

async function handleDeleteStoredImage(req, res, imageId) {
  const parsed = await readJsonBody(req, res, { allowEmpty: true, emptyValue: {} });
  if (!parsed) return;
  if (!requireConfigAdmin(req, res, parsed)) return;
  try {
    const result = await imageStore.deleteImage(imageId);
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Image not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Failed to delete image' }));
  }
}



function readAdminToken(req, parsedBody = null) {
  const headerValue = req.headers?.[ADMIN_TOKEN_HEADER] || req.headers?.[ADMIN_TOKEN_HEADER.toLowerCase()];
  return String(headerValue || parsedBody?.adminToken || '').trim();
}

function normalizeRemoteAddress(address = '') {
  const value = String(address || '').trim();
  if (!value) return '';
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length);
  if (value === '0:0:0:0:0:0:0:1') return '::1';
  return value;
}

function isLocalAdminRequest(req) {
  const address = normalizeRemoteAddress(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');
  return address === '::1' || address === 'localhost' || address === '127.0.0.1' || /^127\./.test(address);
}

function requireConfigAdmin(req, res, parsedBody = null) {
  const token = readAdminToken(req, parsedBody);
  if (!configService.verifyAdminToken(token, { isLocalRequest: isLocalAdminRequest(req) })) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Admin authentication required' }));
    return false;
  }
  return true;
}

function handleConfigRuntime(req, res) {
  const runtime = configService.getRuntimeConfig();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    runtime: runtime.config,
    meta: {
      schemaVersion: runtime.schemaVersion,
      configVersion: runtime.configVersion,
      capabilities: runtime.capabilities,
    },
    schema: configService.getSchema(),
    platforms: getSupportedPlatforms(),
  }));
}

function handleConfigEditable(req, res) {
  if (!requireConfigAdmin(req, res)) return;
  const editable = configService.getEditableRuntimeConfig();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    runtime: editable.config,
    meta: {
      schemaVersion: editable.schemaVersion,
      configVersion: editable.configVersion,
      capabilities: editable.capabilities,
    },
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
    configService.setRuntimeConfig(parsed.config || parsed.runtime || parsed, { preserveSecrets: true });
    const saved = configService.getResolvedConfig();
    const handler = getPlatformHandler(saved?.deploy?.platform);
    const operations = [];
    if (saved?.deploy?.autoSync === true) {
      operations.push(await handler.sync());
    }
    if (saved?.deploy?.autoRedeploy === true) {
      operations.push(await handler.deploy());
    }
    const editable = configService.getEditableRuntimeConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      runtime: editable.config,
      meta: {
        schemaVersion: editable.schemaVersion,
        configVersion: editable.configVersion,
        capabilities: editable.capabilities,
      },
      operations,
    }));
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
    const saved = configService.getResolvedConfig();
    const handler = getPlatformHandler(parsed.platform || saved?.deploy?.platform);
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
    const saved = configService.getResolvedConfig();
    const handler = getPlatformHandler(parsed.platform || saved?.deploy?.platform);
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
    const saved = configService.getResolvedConfig();
    const handler = getPlatformHandler(parsed.platform || saved?.deploy?.platform);
    const result = await handler.deploy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'Platform deploy failed' }));
  }
}

// --- Main server ---

function sendJsonError(res, status, message) {
  if (res.writableEnded) return;
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function dispatchRoute(req, res, handler) {
  Promise.resolve()
    .then(handler)
    .catch((error) => {
      console.error('Unhandled route error:', error?.message || error);
      sendJsonError(res, 500, 'Internal Server Error');
    });
}

function safeDecodePathComponent(value, res) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    sendJsonError(res, 400, 'Bad request path');
    return null;
  }
}

export const server = http.createServer((req, res) => {
  try {
    applyCorsHeaders(req, res);

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const run = (handler) => dispatchRoute(req, res, handler);

    if (url.pathname === '/api/proxy' && req.method === 'POST') {
      return run(() => handleProxy(req, res));
    } else if (url.pathname === '/api/config/runtime' && req.method === 'GET') {
      return run(() => handleConfigRuntime(req, res));
    } else if (url.pathname === '/api/config/editable' && req.method === 'GET') {
      return run(() => handleConfigEditable(req, res));
    } else if (url.pathname === '/api/config/schema' && req.method === 'GET') {
      return run(() => handleConfigSchema(req, res));
    } else if (url.pathname === '/api/config/save' && req.method === 'POST') {
      return run(() => handleConfigSave(req, res));
    } else if (url.pathname === '/api/config/platform/check' && req.method === 'POST') {
      return run(() => handlePlatformCheck(req, res));
    } else if (url.pathname === '/api/config/platform/sync' && req.method === 'POST') {
      return run(() => handlePlatformSync(req, res));
    } else if (url.pathname === '/api/config/platform/deploy' && req.method === 'POST') {
      return run(() => handlePlatformDeploy(req, res));
    } else if (url.pathname === '/api/prompt/enhance' && req.method === 'POST') {
      return run(() => handlePromptEnhance(req, res));
    } else if (url.pathname === '/api/jobs' && req.method === 'POST') {
      return run(() => handleCreateImageJob(req, res));
    } else if (url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/cancel') && req.method === 'POST') {
      const rawJobId = url.pathname.slice('/api/jobs/'.length, -'/cancel'.length).replace(/\/+$/, '');
      const jobId = safeDecodePathComponent(rawJobId, res);
      if (jobId === null) return;
      return run(() => handleCancelImageJob(req, res, jobId));
    } else if (url.pathname.startsWith('/api/jobs/') && req.method === 'GET') {
      const jobId = safeDecodePathComponent(url.pathname.split('/api/jobs/')[1] || '', res);
      if (jobId === null) return;
      return run(() => handleGetImageJob(req, res, jobId));
    } else if (url.pathname === '/api/storage/history' && req.method === 'GET') {
      return run(() => handleStorageHistory(req, res, url));
    } else if (url.pathname === '/api/storage' && req.method === 'GET') {
      return run(() => handleStorageStats(req, res));
    } else if (url.pathname === '/api/storage/clear' && req.method === 'POST') {
      return run(() => handleStorageClear(req, res));
    } else if (url.pathname.startsWith('/api/images/') && url.pathname.endsWith('/meta') && req.method === 'PATCH') {
      const rawImageId = url.pathname.slice('/api/images/'.length, -'/meta'.length).replace(/\/+$/, '');
      const imageId = safeDecodePathComponent(rawImageId, res);
      if (imageId === null) return;
      return run(() => handleImageMetaPatch(req, res, imageId));
    } else if (url.pathname.startsWith('/api/images/') && req.method === 'DELETE') {
      const imageId = safeDecodePathComponent(url.pathname.split('/api/images/')[1] || '', res);
      if (imageId === null) return;
      return run(() => handleDeleteStoredImage(req, res, imageId));
    } else if (url.pathname.startsWith('/api/images/') && req.method === 'GET') {
      const imageId = safeDecodePathComponent(url.pathname.split('/api/images/')[1] || '', res);
      if (imageId === null) return;
      return run(() => handleStoredImage(req, res, imageId));
    } else if (url.pathname === '/api/oauth/start' && req.method === 'POST') {
      return run(() => handleOAuthStart(req, res));
    } else if (url.pathname.startsWith('/api/oauth/status/') && req.method === 'GET') {
      const state = safeDecodePathComponent(url.pathname.split('/api/oauth/status/')[1] || '', res);
      if (state === null) return;
      return run(() => handleOAuthStatus(req, res, state));
    } else if (url.pathname === '/api/oauth/exchange' && req.method === 'POST') {
      return run(() => handleOAuthExchange(req, res));
    } else if (url.pathname === '/api/oauth/refresh' && req.method === 'POST') {
      return run(() => handleOAuthRefresh(req, res));
    } else if (url.pathname === '/api/oauth/test' && req.method === 'POST') {
      return run(() => handleOAuthTest(req, res));
    } else if (url.pathname === '/api/oauth/images' && req.method === 'POST') {
      return run(() => handleOAuthImages(req, res));
    } else if (url.pathname === '/api/oauth/images/stream' && req.method === 'POST') {
      return run(() => handleOAuthImagesStream(req, res));
    }
    return run(() => serveStatic(req, res));
  } catch (error) {
    console.error('Unhandled request dispatch error:', error?.message || error);
    sendJsonError(res, 500, 'Internal Server Error');
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Proxy enabled at /api/proxy');
    console.log('OAuth endpoints: /api/oauth/start, /api/oauth/status/:state, /api/oauth/refresh');
  });
}

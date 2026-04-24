import crypto from 'crypto';
import { isPolicyViolationText, normalizeGenerationError } from './ui-feedback.js';

const CHATGPT_BASE = 'https://chatgpt.com';
const CHATGPT_START_URL = `${CHATGPT_BASE}/`;
const CHATGPT_FILES_URL = `${CHATGPT_BASE}/backend-api/files`;
const CHATGPT_CONVERSATION_INIT_URL = `${CHATGPT_BASE}/backend-api/conversation/init`;
const CHATGPT_CONVERSATION_URL = `${CHATGPT_BASE}/backend-api/f/conversation`;
const CHATGPT_CONVERSATION_PREPARE_URL = `${CHATGPT_BASE}/backend-api/f/conversation/prepare`;
const CHATGPT_CHAT_REQUIREMENTS_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements`;
const IMAGE_BACKEND_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUIREMENTS_DIFF = '0fffff';
const MAX_DOWNLOAD_BYTES = 20 << 20;

function randomUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function coalesce(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64urlSafeDecode(text) {
  return Buffer.from(String(text || ''), 'base64').toString('utf8');
}

function compactJSON(value) {
  return JSON.stringify(value);
}

function sha3Hex(input) {
  return crypto.createHash('sha3-512').update(input).digest('hex');
}

function timezoneOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}

function timezoneName() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}


export function isChatChallengeRequired(challenge) {
  if (!challenge || typeof challenge !== 'object') return false;
  const required = challenge.required;
  if (required === true || required === 1) return true;
  if (required === false || required === 0 || required == null) return false;
  if (typeof required === 'string') {
    const text = required.trim().toLowerCase();
    if (!text || text === 'false' || text === '0' || text === 'no' || text === 'none') return false;
    return text === 'true' || text === '1' || text === 'yes' || text === 'required';
  }
  return false;
}

export function buildChatGPTBackendHeaders({ accessToken, accountId, deviceId, sessionId, userAgent } = {}) {
  if (!String(accessToken || '').trim()) throw new Error('Missing OAuth access token');
  const headers = {
    Authorization: `Bearer ${String(accessToken).trim()}`,
    Accept: 'application/json',
    Origin: CHATGPT_BASE,
    Referer: `${CHATGPT_BASE}/`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': coalesce(userAgent, IMAGE_BACKEND_USER_AGENT),
  };
  if (String(accountId || '').trim()) headers['chatgpt-account-id'] = String(accountId).trim();
  if (String(deviceId || '').trim()) {
    headers['oai-device-id'] = String(deviceId).trim();
    headers.Cookie = `oai-did=${String(deviceId).trim()}`;
  }
  if (String(sessionId || '').trim()) headers['oai-session-id'] = String(sessionId).trim();
  return headers;
}

export function buildConversationRequest({ prompt, parentMessageId, messageId } = {}) {
  const text = coalesce(prompt, 'Generate an image.');
  return {
    action: 'next',
    client_prepare_state: 'sent',
    parent_message_id: parentMessageId || randomUUID(),
    model: 'auto',
    timezone_offset_min: timezoneOffsetMinutes(),
    timezone: timezoneName(),
    conversation_mode: { kind: 'primary_assistant' },
    enable_message_followups: true,
    system_hints: ['picture_v2'],
    supports_buffering: true,
    supported_encodings: ['v1'],
    paragen_cot_summary_display_override: 'allow',
    force_parallel_switch: 'auto',
    client_contextual_info: {
      is_dark_mode: false,
      time_since_loaded: 200,
      page_height: 900,
      page_width: 1440,
      pixel_ratio: 1,
      screen_height: 1080,
      screen_width: 1920,
      app_name: 'chatgpt.com',
    },
    messages: [{
      id: messageId || randomUUID(),
      author: { role: 'user' },
      content: { content_type: 'text', parts: [text] },
      metadata: {
        developer_mode_connector_ids: [],
        selected_github_repos: [],
        selected_all_github_repos: false,
        system_hints: ['picture_v2'],
        serialization_metadata: { custom_symbol_offsets: [] },
      },
      create_time: Date.now() / 1000,
    }],
  };
}

function buildPrepareRequest({ prompt, parentMessageId, messageId } = {}) {
  return {
    action: 'next',
    client_prepare_state: 'success',
    fork_from_shared_post: false,
    parent_message_id: parentMessageId,
    model: 'auto',
    timezone_offset_min: timezoneOffsetMinutes(),
    timezone: timezoneName(),
    conversation_mode: { kind: 'primary_assistant' },
    system_hints: ['picture_v2'],
    supports_buffering: true,
    supported_encodings: ['v1'],
    partial_query: {
      id: messageId || randomUUID(),
      author: { role: 'user' },
      content: { content_type: 'text', parts: [coalesce(prompt, 'Generate an image.')] },
    },
    client_contextual_info: { app_name: 'chatgpt.com' },
  };
}

function mergeHeaders(base, extra = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null || value === '') delete out[key];
    else out[key] = value;
  }
  return out;
}

async function fetchWithTimeout(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 180_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const { timeoutMs: _timeoutMs, ...fetchOpts } = opts;
    return await fetch(url, { ...fetchOpts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseText(resp) {
  try { return await resp.text(); } catch { return ''; }
}

function sanitizeErrorText(text) {
  return String(text || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/g, 'Bearer [redacted]')
    .replace(/access_token["'=:\s]+[A-Za-z0-9._~+\/-]+/gi, 'access_token=[redacted]')
    .replace(/refresh_token["'=:\s]+[A-Za-z0-9._~+\/-]+/gi, 'refresh_token=[redacted]');
}

async function statusError(resp, label) {
  const body = await readResponseText(resp);
  let message = '';
  try {
    const parsed = JSON.parse(body);
    message = parsed?.detail || parsed?.error?.message || parsed?.error || parsed?.message || '';
  } catch {
    message = body.slice(0, 300);
  }
  message = sanitizeErrorText(message);
  message = normalizeGenerationError(message, message);
  const suffix = message ? `: ${message}` : '';
  const err = new Error(`${label} (${resp.status})${suffix}`);
  err.status = resp.status;
  err.body = sanitizeErrorText(body);
  return err;
}

function getPath(obj, path) {
  let current = obj;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function normalizeBase64Image(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (text.toLowerCase().startsWith('data:')) {
    const idx = text.indexOf(',');
    if (idx >= 0) text = text.slice(idx + 1);
  }
  text = text.trim();
  if (!text) return '';
  text = text.replace(/\s+/g, '').replace(/=+$/, '');
  text = text + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    Buffer.from(text, 'base64');
    return text;
  } catch {
    return '';
  }
}

function identityKey(item) {
  if (item.pointer) return `pointer:${item.pointer}`;
  if (item.downloadURL) return `download:${item.downloadURL}`;
  if (item.b64JSON) return `b64:${item.b64JSON.slice(0, 64)}`;
  return '';
}

function mergePointers(existing = [], next = []) {
  const out = [];
  const seen = new Map();
  for (const item of [...existing, ...next]) {
    const normalized = {
      pointer: String(item.pointer || '').trim(),
      downloadURL: String(item.downloadURL || '').trim(),
      b64JSON: normalizeBase64Image(item.b64JSON || ''),
      mimeType: String(item.mimeType || '').trim(),
      prompt: String(item.prompt || '').trim(),
    };
    const key = identityKey(normalized);
    if (!key) continue;
    if (seen.has(key)) {
      const prev = seen.get(key);
      Object.assign(prev, {
        pointer: prev.pointer || normalized.pointer,
        downloadURL: prev.downloadURL || normalized.downloadURL,
        b64JSON: prev.b64JSON || normalized.b64JSON,
        mimeType: prev.mimeType || normalized.mimeType,
        prompt: prev.prompt || normalized.prompt,
      });
      continue;
    }
    seen.set(key, normalized);
    out.push(normalized);
  }
  return out;
}

function collectPointerMatches(text, prompt = '') {
  const out = [];
  const re = /(?:file-service:\/\/|sediment:\/\/)[A-Za-z0-9_-]+/g;
  for (const match of String(text || '').matchAll(re)) {
    out.push({ pointer: match[0], prompt });
  }
  return out;
}

function isLikelyImageDownloadURL(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (text.toLowerCase().startsWith('data:image/')) return true;
  if (!/^https?:\/\//i.test(text)) return false;
  const lower = text.toLowerCase();
  return lower.includes('/download') || /\.(png|jpe?g|webp)(\?|$)/.test(lower);
}

function walkInlineAssets(node, prompt = '', out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) walkInlineAssets(child, prompt, out);
    return out;
  }

  let localPrompt = prompt;
  for (const key of ['revised_prompt', 'image_gen_title', 'prompt']) {
    if (typeof node[key] === 'string' && node[key].trim()) {
      localPrompt = node[key].trim();
      break;
    }
  }

  const item = {
    pointer: firstString(node.asset_pointer, node.image_asset_pointer, node.pointer),
    downloadURL: firstString(node.download_url, node.url, node.image_url),
    b64JSON: normalizeBase64Image(firstString(node.b64_json, node.base64, node.image_base64)),
    mimeType: firstString(node.mime_type, node.mimeType, node.content_type),
    prompt: localPrompt,
  };
  if (
    item.pointer.startsWith('file-service://') ||
    item.pointer.startsWith('sediment://') ||
    isLikelyImageDownloadURL(item.downloadURL) ||
    item.b64JSON
  ) {
    out.push(item);
  }
  for (const child of Object.values(node)) walkInlineAssets(child, localPrompt, out);
  return out;
}

export function collectImagePointersFromText(text) {
  const raw = String(text || '');
  let conversationId = '';
  let prompt = '';
  let pointers = collectPointerMatches(raw);

  const parseJSON = (s) => {
    try { return JSON.parse(s); } catch { return null; }
  };

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!payload || payload === '[DONE]') continue;
    const obj = parseJSON(payload);
    if (!obj) continue;
    conversationId ||= firstString(getPath(obj, 'v.conversation_id'), obj.conversation_id);
    prompt ||= firstString(getPath(obj, 'message.metadata.dalle.prompt'), getPath(obj, 'metadata.dalle.prompt'), obj.revised_prompt);
    pointers = mergePointers(pointers, collectPointerMatches(JSON.stringify(obj), prompt));
    pointers = mergePointers(pointers, walkInlineAssets(obj, prompt));
  }

  const wholeObj = parseJSON(raw);
  if (wholeObj) {
    conversationId ||= firstString(getPath(wholeObj, 'v.conversation_id'), wholeObj.conversation_id);
    pointers = mergePointers(pointers, walkInlineAssets(wholeObj, prompt));
  }

  return { conversationId, pointers: mergePointers([], pointers) };
}

function hasFileServicePointer(pointers) {
  return pointers.some((p) => String(p.pointer || '').startsWith('file-service://'));
}

function preferFileServicePointers(pointers) {
  const filePointers = pointers.filter((p) => String(p.pointer || '').startsWith('file-service://'));
  return filePointers.length ? mergePointers([], filePointers) : mergePointers([], pointers);
}

export function generateRequirementsToken(userAgent = IMAGE_BACKEND_USER_AGENT) {
  const now = new Date();
  const config = [
    'core3008',
    now.toUTCString(),
    null,
    0.123456,
    coalesce(userAgent, IMAGE_BACKEND_USER_AGENT),
    null,
    'prod-openai-images',
    'en-US',
    'en-US,en',
    0,
    'navigator.webdriver',
    'location',
    'document.body',
    Date.now() / 1000,
    randomUUID(),
    '',
    8,
    Math.floor(Date.now() / 1000),
  ];
  const answer = generateChallengeAnswer(String(process.hrtime.bigint()), REQUIREMENTS_DIFF, config);
  return answer ? `gAAAAAC${answer}` : '';
}

function generateChallengeAnswer(seed, difficulty, config) {
  const diffLen = difficulty.length;
  const p1 = compactJSON(config.slice(0, 3)).replace(/\]$/, '');
  const p2 = compactJSON(config.slice(4, 9)).replace(/^\[/, '');
  const p3 = compactJSON(config.slice(10)).replace(/^\[/, '');
  for (let i = 0; i < 100000; i++) {
    const payload = `${p1}${i},${p2},${i >> 1},${p3}`;
    const encoded = Buffer.from(payload).toString('base64');
    if (sha3Hex(seed + encoded).slice(0, diffLen) <= difficulty) return encoded;
  }
  return '';
}

export function generateProofToken({ required, seed, difficulty, userAgent = IMAGE_BACKEND_USER_AGENT } = {}) {
  if (!required || !String(seed || '').trim() || !String(difficulty || '').trim()) return '';
  const screen = String(seed).length % 2 === 0 ? 4010 : 3008;
  const token = [
    screen,
    new Date().toUTCString(),
    null,
    0,
    coalesce(userAgent, IMAGE_BACKEND_USER_AGENT),
    `${CHATGPT_BASE}/`,
    'dpl=openai-images',
    'en',
    'en-US',
    null,
    'plugins[object PluginArray]',
    '_reactListening',
    'alert',
  ];
  const diffLen = String(difficulty).length;
  for (let i = 0; i < 100000; i++) {
    token[3] = i;
    const encoded = Buffer.from(JSON.stringify(token)).toString('base64');
    if (sha3Hex(String(seed) + encoded).slice(0, diffLen) <= String(difficulty)) return `gAAAAAB${encoded}`;
  }
  const fallbackBase = Buffer.from(JSON.stringify(String(seed))).toString('base64');
  return `gAAAAA...xZ4D${fallbackBase}`;
}

async function bootstrap(headers) {
  const resp = await fetchWithTimeout(CHATGPT_START_URL, { method: 'GET', headers, timeoutMs: 30_000 });
  await readResponseText(resp);
}

async function fetchChatRequirements(headers) {
  let lastErr = null;
  const payloads = [{ p: null }, { p: generateRequirementsToken(headers['User-Agent']) }];
  for (const payload of payloads) {
    const resp = await fetchWithTimeout(CHATGPT_CHAT_REQUIREMENTS_URL, {
      method: 'POST',
      headers: mergeHeaders(headers, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      timeoutMs: 60_000,
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (data.token) return data;
      lastErr = new Error('chat-requirements did not return token');
    } else {
      lastErr = await statusError(resp, 'chat-requirements failed');
    }
  }
  throw lastErr || new Error('chat-requirements failed');
}

async function initializeConversation(headers) {
  const payload = {
    gizmo_id: null,
    requested_default_model: null,
    conversation_id: null,
    timezone_offset_min: timezoneOffsetMinutes(),
    system_hints: ['picture_v2'],
  };
  const resp = await fetchWithTimeout(CHATGPT_CONVERSATION_INIT_URL, {
    method: 'POST',
    headers: mergeHeaders(headers, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    timeoutMs: 60_000,
  });
  if (!resp.ok) throw await statusError(resp, 'conversation init failed');
  await readResponseText(resp);
}

async function prepareConversation({ headers, prompt, parentMessageId, chatToken, proofToken }) {
  const prepareHeaders = mergeHeaders(headers, {
    Accept: '*/*',
    'Content-Type': 'application/json',
    'openai-sentinel-chat-requirements-token': chatToken,
    'openai-sentinel-proof-token': proofToken || undefined,
  });
  const payload = buildPrepareRequest({ prompt, parentMessageId });
  const resp = await fetchWithTimeout(CHATGPT_CONVERSATION_PREPARE_URL, {
    method: 'POST',
    headers: prepareHeaders,
    body: JSON.stringify(payload),
    timeoutMs: 60_000,
  });
  if (!resp.ok) throw await statusError(resp, 'conversation prepare failed');
  const data = await resp.json().catch(() => ({}));
  return String(data.conduit_token || '').trim();
}

async function pollConversation(headers, conversationId) {
  if (!conversationId) return [];
  const deadline = Date.now() + 90_000;
  let lastErr = null;
  while (Date.now() < deadline) {
    const resp = await fetchWithTimeout(`${CHATGPT_BASE}/backend-api/conversation/${conversationId}`, {
      method: 'GET',
      headers,
      timeoutMs: 60_000,
    });
    if (resp.ok) {
      const text = await resp.text();
      const result = collectImagePointersFromText(text);
      if (hasFileServicePointer(result.pointers) || result.pointers.length) return preferFileServicePointers(result.pointers);
    } else {
      lastErr = await statusError(resp, 'conversation poll failed');
      if (resp.status !== 404) throw lastErr;
    }
    await sleep(3000);
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchDownloadURL(headers, conversationId, pointer) {
  let url = '';
  if (pointer.startsWith('file-service://')) {
    url = `${CHATGPT_FILES_URL}/${pointer.slice('file-service://'.length)}/download`;
  } else if (pointer.startsWith('sediment://')) {
    url = `${CHATGPT_BASE}/backend-api/conversation/${conversationId}/attachment/${pointer.slice('sediment://'.length)}/download`;
  } else {
    throw new Error(`Unsupported image pointer: ${pointer}`);
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const resp = await fetchWithTimeout(url, { method: 'GET', headers, timeoutMs: 60_000 });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (String(data.download_url || '').trim()) return String(data.download_url).trim();
      throw new Error('fetch image download url failed: empty download_url');
    }
    if (attempt === 7 || resp.status !== 404) throw await statusError(resp, 'fetch image download url failed');
    await sleep(750);
  }
  throw new Error('fetch image download url failed');
}

async function downloadBytes(headers, url) {
  if (String(url || '').toLowerCase().startsWith('data:image/')) {
    const b64 = normalizeBase64Image(url);
    if (!b64) throw new Error('invalid data image url');
    return Buffer.from(b64, 'base64');
  }
  const downloadHeaders = String(url || '').startsWith(CHATGPT_BASE)
    ? mergeHeaders(headers, { Accept: 'image/*,*/*;q=0.8', 'Content-Type': undefined })
    : { 'User-Agent': headers['User-Agent'] || IMAGE_BACKEND_USER_AGENT };
  const resp = await fetchWithTimeout(url, { method: 'GET', headers: downloadHeaders, timeoutMs: 120_000 });
  if (!resp.ok) throw await statusError(resp, 'download image bytes failed');
  const len = Number(resp.headers.get('content-length') || 0);
  if (len > MAX_DOWNLOAD_BYTES) throw new Error('download image is too large');
  const arrayBuffer = await resp.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new Error('download image is too large');
  return buf;
}

async function resolvePointerBytes(headers, conversationId, pointer) {
  if (pointer.b64JSON) return Buffer.from(pointer.b64JSON, 'base64');
  if (pointer.downloadURL) return downloadBytes(headers, pointer.downloadURL);
  if (!pointer.pointer) throw new Error('image asset is missing pointer, url, and base64 data');
  const downloadURL = await fetchDownloadURL(headers, conversationId, pointer.pointer);
  return downloadBytes(headers, downloadURL);
}

async function generateOneImage({ headers, prompt, chatReqs }) {
  const parentMessageId = randomUUID();
  const proofToken = generateProofToken({
    required: !!chatReqs?.proofofwork?.required,
    seed: chatReqs?.proofofwork?.seed,
    difficulty: chatReqs?.proofofwork?.difficulty,
    userAgent: headers['User-Agent'],
  });

  await initializeConversation(headers).catch(() => {});
  const conduitToken = await prepareConversation({
    headers,
    prompt,
    parentMessageId,
    chatToken: chatReqs.token,
    proofToken,
  });

  const convReq = buildConversationRequest({ prompt, parentMessageId });
  const convHeaders = mergeHeaders(headers, {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    'openai-sentinel-chat-requirements-token': chatReqs.token,
    'x-conduit-token': conduitToken || undefined,
    'openai-sentinel-proof-token': proofToken || undefined,
  });
  const resp = await fetchWithTimeout(CHATGPT_CONVERSATION_URL, {
    method: 'POST',
    headers: convHeaders,
    body: JSON.stringify(convReq),
    timeoutMs: 180_000,
  });
  if (!resp.ok) throw await statusError(resp, 'image conversation request failed');
  const rawText = await resp.text();
  const streamResult = collectImagePointersFromText(rawText);
  let pointers = streamResult.pointers;
  if (streamResult.conversationId && !hasFileServicePointer(pointers)) {
    const polled = await pollConversation(headers, streamResult.conversationId);
    pointers = mergePointers(pointers, polled);
  }
  pointers = preferFileServicePointers(pointers);
  if (!pointers.length) {
    if (isPolicyViolationText(rawText)) throw new Error(normalizeGenerationError(rawText));
    throw new Error('ChatGPT image conversation returned no downloadable images');
  }

  const data = [];
  for (const pointer of pointers) {
    const bytes = await resolvePointerBytes(headers, streamResult.conversationId, pointer);
    data.push({
      b64_json: bytes.toString('base64'),
      ...(pointer.prompt ? { revised_prompt: pointer.prompt } : {}),
    });
  }
  return data;
}

export async function generateOAuthImage(input = {}) {
  const accessToken = String(input.accessToken || input.apiKey || '').trim();
  const prompt = String(input.prompt || '').trim();
  if (!accessToken) {
    const err = new Error('Missing OAuth access token');
    err.status = 400;
    throw err;
  }
  if (!prompt) {
    const err = new Error('Missing prompt');
    err.status = 400;
    throw err;
  }

  const openaiDeviceId = String(input.deviceId || input.openaiDeviceId || '').trim() || randomUUID();
  const openaiSessionId = String(input.sessionId || input.openaiSessionId || '').trim() || randomUUID();
  const headers = buildChatGPTBackendHeaders({
    accessToken,
    accountId: input.accountId,
    deviceId: openaiDeviceId,
    sessionId: openaiSessionId,
    userAgent: input.userAgent,
  });

  await bootstrap(headers).catch(() => {});
  const chatReqs = await fetchChatRequirements(headers);
  if (isChatChallengeRequired(chatReqs?.arkose)) {
    throw new Error('ChatGPT 要求人机验证（arkose），当前 OAuth 生图代理无法自动完成。请先在官方 ChatGPT 网页端使用同一账号完成一次消息/图片请求后再重试，或更换网络/账号。');
  }
  if (isChatChallengeRequired(chatReqs?.turnstile)) {
    throw new Error('ChatGPT 要求人机验证（turnstile），当前 OAuth 生图代理无法自动完成。请先在官方 ChatGPT 网页端使用同一账号完成一次消息/图片请求后再重试，或更换网络/账号。');
  }

  const count = Math.max(1, Math.min(4, Number.parseInt(input.n || 1, 10) || 1));
  const data = [];
  for (let i = 0; i < count; i++) {
    const items = await generateOneImage({ headers, prompt, chatReqs });
    data.push(...items);
    if (data.length >= count) break;
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data: data.slice(0, count),
    openaiDeviceId,
    openaiSessionId,
  };
}

export async function handleOAuthImageRequestBody(body = {}) {
  return generateOAuthImage(body);
}

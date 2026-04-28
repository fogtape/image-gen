import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { applyWatermarkToBuffer, normalizeWatermarkSettings } from './image-watermark.js';
import { isLocalOrPrivateHost } from './proxy-policy.js';

const IMAGE_DIR_NAME = 'images';
const INDEX_FILE_NAME = 'image-store.json';
const MAX_HISTORY = 500;
const DEFAULT_REMOTE_IMAGE_TIMEOUT_MS = 30_000;
const DEFAULT_REMOTE_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const ALLOWED_REMOTE_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const REMOTE_IMAGE_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_REMOTE_IMAGE_MAX_REDIRECTS = 5;

const MIME_BY_FORMAT = {
  png: 'image/png',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
};

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeJsonRead(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', 0o644);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw error;
  }
}

function safeFormat(format = 'png') {
  const text = String(format || 'png').toLowerCase();
  if (text === 'jpg') return 'jpeg';
  return MIME_BY_FORMAT[text] ? text : 'png';
}

function stripDataUrl(base64) {
  const text = String(base64 || '').trim();
  const match = text.match(/^data:([^;]+);base64,(.*)$/s);
  if (match) return { mime: match[1].toLowerCase(), base64: match[2] };
  return { mime: '', base64: text };
}

function detectFormatFromMime(mime, fallback) {
  return EXT_BY_MIME[mime] || fallback;
}

function sanitizeTrace(trace = {}) {
  if (!trace || typeof trace !== 'object') return null;
  const apiHost = (() => {
    try {
      return trace.apiUrl ? new URL(String(trace.apiUrl)).host : '';
    } catch {
      return '';
    }
  })();
  const normalized = {
    mode: trace.mode ? String(trace.mode) : '',
    protocol: trace.protocol ? String(trace.protocol) : '',
    endpoint: trace.endpoint ? String(trace.endpoint) : '',
    compatMode: trace.compatMode === true,
    fallbackAttempted: trace.fallbackAttempted === true,
    hasRef: trace.hasRef === true,
    apiHost,
  };
  if (!Object.values(normalized).some((value) => value)) return null;
  return normalized;
}

function sanitizeBatchId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
}

function sanitizeMetaText(value, max = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function sanitizeHost(value) {
  const text = sanitizeMetaText(value, 160);
  if (!text) return '';
  try {
    return new URL(text).host.slice(0, 120);
  } catch {
    return text.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 120);
  }
}

function sanitizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const seen = new Set();
  const tags = [];
  for (const item of list) {
    const tag = sanitizeMetaText(item, 24);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function sanitizeGenerationSnapshot(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const generation = {
    prompt: sanitizePrompt(source.prompt),
    size: sanitizeMetaText(source.size, 40),
    quality: sanitizeMetaText(source.quality, 40),
    format: safeFormat(source.format || 'png'),
    background: sanitizeMetaText(source.background, 40),
    mode: sanitizeMetaText(source.mode, 40),
    model: sanitizeMetaText(source.model, 80),
    hasRef: source.hasRef === true,
  };
  if (!generation.prompt && !generation.size && !generation.quality && !generation.background && !generation.mode && !generation.model && !generation.hasRef) return null;
  return generation;
}

function sanitizePositiveInt(value, fallback = null, max = 1000) {
  const raw = Number(value);
  if (!Number.isInteger(raw) || raw < 1) return fallback;
  return Math.min(max, raw);
}

function normalizeHistoryLimit(value, fallback = 60, max = 100) {
  const raw = Number(value || fallback);
  if (!Number.isInteger(raw) || raw < 1) return fallback;
  return Math.min(max, raw);
}

function normalizeCursor(value) {
  const raw = Number(value || 0);
  if (!Number.isInteger(raw) || raw < 0) return 0;
  return raw;
}

function publicRecord(record) {
  return {
    id: record.id,
    url: record.url,
    format: record.format,
    mime: record.mime,
    bytes: record.bytes,
    prompt: record.prompt || '',
    createdAt: record.createdAt,
    watermark: record.watermark || null,
    relativePath: record.relativePath,
    trace: record.trace || null,
    batchId: record.batchId || '',
    batchIndex: sanitizePositiveInt(record.batchIndex),
    batchCount: sanitizePositiveInt(record.batchCount),
    favorite: record.favorite === true,
    tags: sanitizeTags(record.tags),
    model: sanitizeMetaText(record.model, 80),
    accountName: sanitizeMetaText(record.accountName, 80),
    accountHost: sanitizeHost(record.accountHost),
    generation: sanitizeGenerationSnapshot(record.generation || {
      prompt: record.prompt,
      format: record.format,
      model: record.model,
      mode: record.trace?.mode,
      hasRef: record.trace?.hasRef === true,
    }),
  };
}

function sanitizePrompt(prompt) {
  return String(prompt || '').trim().slice(0, 300);
}

function sanitizeStorageError(error) {
  const raw = String(error?.message || error || '图片保存失败');
  const message = raw
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/\b(api[-_]?key|access_token|refresh_token|token|key)=([^&\s]+)/gi, '$1=***')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, 'sk-***')
    .slice(0, 240);
  return { message: message || '图片保存失败' };
}

function boundedEnvNumber(name, fallback, min, max, env = process.env) {
  const raw = Number(env?.[name] || fallback);
  const value = Number.isFinite(raw) ? raw : fallback;
  return Math.min(max, Math.max(min, value));
}

function getRemoteImageDownloadLimits(env = process.env) {
  return {
    timeoutMs: boundedEnvNumber('IMAGE_GEN_REMOTE_IMAGE_TIMEOUT_MS', DEFAULT_REMOTE_IMAGE_TIMEOUT_MS, 100, 300_000, env),
    maxBytes: boundedEnvNumber('IMAGE_GEN_REMOTE_IMAGE_MAX_BYTES', DEFAULT_REMOTE_IMAGE_MAX_BYTES, 1024, 100 * 1024 * 1024, env),
    maxRedirects: boundedEnvNumber('IMAGE_GEN_REMOTE_IMAGE_MAX_REDIRECTS', DEFAULT_REMOTE_IMAGE_MAX_REDIRECTS, 0, 10, env),
  };
}

function validateRemoteImageUrl(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('Image URL is invalid');
  }
  if (target.protocol !== 'https:') throw new Error('Image URL protocol is not allowed');
  if (isLocalOrPrivateHost(target.hostname)) throw new Error('Image URL host is not allowed');
  return target;
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const target = path.join(dir, name);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

async function readResponseBodyWithLimit(resp, maxBytes, controller) {
  const chunks = [];
  let total = 0;
  if (!resp.body?.getReader) {
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes) {
      controller?.abort?.();
      throw new Error('Image download is too large');
    }
    return buf;
  }
  const reader = resp.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        controller?.abort?.();
        throw new Error('Image download is too large');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

async function bufferFromUrl(url) {
  let target = validateRemoteImageUrl(url);
  const limits = getRemoteImageDownloadLimits();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    let resp;
    for (let redirectCount = 0; ; redirectCount += 1) {
      resp = await fetch(target.href, { signal: controller.signal, redirect: 'manual' });
      if (!REMOTE_IMAGE_REDIRECT_STATUSES.has(resp.status)) break;
      if (redirectCount >= limits.maxRedirects) throw new Error('Image redirect limit exceeded');
      const location = resp.headers.get('location');
      if (!location) throw new Error('Image redirect location is missing');
      let nextUrl;
      try {
        nextUrl = new URL(location, target.href);
      } catch {
        throw new Error('Image redirect location is invalid');
      }
      target = validateRemoteImageUrl(nextUrl.href);
    }
    if (!resp.ok) throw new Error(`Image download failed: HTTP ${resp.status}`);
    const mime = (resp.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!ALLOWED_REMOTE_IMAGE_MIME.has(mime)) throw new Error('Unsupported image content type');
    const contentLength = Number(resp.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > limits.maxBytes) throw new Error('Image download is too large');
    const buf = await readResponseBodyWithLimit(resp, limits.maxBytes, controller);
    return { buffer: buf, mime };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Image download timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function createImageStore({ dataDir = path.join(process.cwd(), 'data'), now = () => Date.now(), idFactory, bufferTransformer = applyWatermarkToBuffer } = {}) {
  const root = path.resolve(dataDir);
  const imagesDir = path.join(root, IMAGE_DIR_NAME);
  const indexFile = path.join(root, INDEX_FILE_NAME);
  const makeId = idFactory || (() => `img_${crypto.randomBytes(12).toString('hex')}`);
  let indexWriteQueue = Promise.resolve();

  function loadIndex() {
    const parsed = safeJsonRead(indexFile, { version: 1, images: [] });
    return { version: 1, images: Array.isArray(parsed.images) ? parsed.images : [] };
  }

  function saveIndex(index) {
    const limited = { version: 1, images: index.images.slice(0, MAX_HISTORY) };
    writeJsonAtomic(indexFile, limited);
  }

  async function mutateIndex(mutator) {
    const run = indexWriteQueue.then(() => {
      const index = loadIndex();
      const next = mutator(index) || index;
      saveIndex(next);
      return next;
    });
    indexWriteQueue = run.catch(() => {});
    return run;
  }

  function makeRelativePath(id, format, timestamp) {
    const date = new Date(timestamp);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const ext = format === 'jpeg' ? 'jpg' : format;
    return path.join(IMAGE_DIR_NAME, `${yyyy}-${mm}`, `${id}.${ext}`);
  }

  function resolveRecordPath(record) {
    const filePath = path.resolve(root, record?.relativePath || '');
    if (!filePath.startsWith(root + path.sep)) return null;
    return filePath;
  }

  function recordFileExists(record) {
    const filePath = resolveRecordPath(record);
    return !!filePath && fs.existsSync(filePath);
  }

  function listExistingRecords() {
    return loadIndex().images.filter(recordFileExists);
  }

  async function saveBuffer(buffer, meta = {}) {
    ensureDir(imagesDir);
    const timestamp = now();
    const id = makeId();
    const requestedFormat = safeFormat(meta.format);
    const watermark = normalizeWatermarkSettings(meta.watermarkSettings || {});
    const finalBuffer = await bufferTransformer(buffer, requestedFormat, watermark, new Date(timestamp));
    const relativePath = makeRelativePath(id, requestedFormat, timestamp);
    const filePath = path.join(root, relativePath);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid image path');
    ensureDir(path.dirname(resolved));
    fs.writeFileSync(resolved, finalBuffer, { mode: 0o644 });

    const record = {
      id,
      format: requestedFormat,
      mime: MIME_BY_FORMAT[requestedFormat] || 'image/png',
      bytes: finalBuffer.length,
      prompt: sanitizePrompt(meta.prompt),
      relativePath,
      url: `/api/images/${encodeURIComponent(id)}`,
      createdAt: timestamp,
      watermark: watermark.enabled ? {
        mode: watermark.mode,
        text: watermark.text,
        timeFormat: watermark.timeFormat,
        position: watermark.position,
      } : null,
      trace: sanitizeTrace(meta.trace),
      batchId: sanitizeBatchId(meta.batchId),
      batchIndex: sanitizePositiveInt(meta.batchIndex),
      batchCount: sanitizePositiveInt(meta.batchCount || meta.count),
      favorite: meta.favorite === true,
      tags: sanitizeTags(meta.tags),
      model: sanitizeMetaText(meta.model, 80),
      accountName: sanitizeMetaText(meta.accountName, 80),
      accountHost: sanitizeHost(meta.accountHost),
      generation: sanitizeGenerationSnapshot(meta.generation || {
        prompt: meta.prompt,
        size: meta.size,
        quality: meta.quality,
        format: requestedFormat,
        background: meta.background,
        mode: meta.mode,
        model: meta.model,
        hasRef: meta.hasRef === true,
      }),
    };
    await mutateIndex((index) => {
      index.images.unshift(record);
      return index;
    });
    return publicRecord(record);
  }

  async function persistGenerationResult(result = {}, meta = {}) {
    const data = Array.isArray(result.data) ? result.data : [];
    const defaultBatchId = sanitizeBatchId(meta.batchId || '');
    const defaultBatchCount = sanitizePositiveInt(meta.batchCount || meta.count || (data.length > 1 ? data.length : null));
    const persisted = [];
    for (const [index, item] of data.entries()) {
      const itemBatchId = sanitizeBatchId(item?.batchId || defaultBatchId);
      const itemBatchCount = sanitizePositiveInt(item?.batchCount || defaultBatchCount);
      const itemBatchIndex = sanitizePositiveInt(item?.batchIndex || (itemBatchCount ? index + 1 : null));
      const itemMeta = {
        ...meta,
        model: item?.model || meta.model,
        accountName: item?.accountName || meta.accountName,
        accountHost: item?.accountHost || meta.accountHost,
        tags: item?.tags || meta.tags,
        batchId: itemBatchId,
        batchIndex: itemBatchIndex,
        batchCount: itemBatchCount,
      };
      const batchFields = {
        ...(itemBatchId ? { batchId: itemBatchId } : {}),
        ...(itemBatchIndex ? { batchIndex: itemBatchIndex } : {}),
        ...(itemBatchCount ? { batchCount: itemBatchCount } : {}),
      };
      try {
        if (item?.b64_json) {
          const parsed = stripDataUrl(item.b64_json);
          const format = detectFormatFromMime(parsed.mime, safeFormat(itemMeta.format));
          const record = await saveBuffer(Buffer.from(parsed.base64, 'base64'), { ...itemMeta, format });
          persisted.push({ ...item, ...batchFields, b64_json: undefined, id: record.id, url: record.url, format: record.format, createdAt: record.createdAt, model: record.model, accountName: record.accountName, accountHost: record.accountHost, favorite: record.favorite, tags: record.tags, generation: record.generation, persisted: true });
        } else if (item?.url) {
          const downloaded = await bufferFromUrl(item.url);
          const format = detectFormatFromMime(downloaded.mime, safeFormat(itemMeta.format));
          const record = await saveBuffer(downloaded.buffer, { ...itemMeta, format });
          persisted.push({ ...item, ...batchFields, id: record.id, url: record.url, format: record.format, createdAt: record.createdAt, model: record.model, accountName: record.accountName, accountHost: record.accountHost, favorite: record.favorite, tags: record.tags, generation: record.generation, persisted: true });
        } else {
          persisted.push({ ...item, ...batchFields });
        }
      } catch (error) {
        persisted.push({ ...item, ...batchFields, persisted: false, storageError: sanitizeStorageError(error) });
      }
    }
    return { ...result, data: persisted };
  }

  function getRecord(id) {
    return loadIndex().images.find((item) => item.id === String(id || '')) || null;
  }

  function getImagePath(id) {
    const record = getRecord(id);
    if (!record) return null;
    const filePath = path.resolve(root, record.relativePath);
    if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) return null;
    return { filePath, record };
  }

  function getStats() {
    const images = listExistingRecords();
    const totalBytes = images.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    return {
      count: images.length,
      totalBytes,
      history: images.slice(0, 60).map(publicRecord),
    };
  }

  function listHistory({ query = '', favorite = null, limit = 60, cursor = 0, batchId = '' } = {}) {
    const normalizedLimit = normalizeHistoryLimit(limit);
    const start = normalizeCursor(cursor);
    const text = sanitizeMetaText(query, 120).toLowerCase();
    const favFilter = favorite === true || favorite === false ? favorite : null;
    const normalizedBatchId = sanitizeBatchId(batchId);
    const filtered = listExistingRecords().filter((record) => {
      if (favFilter !== null && (record.favorite === true) !== favFilter) return false;
      if (normalizedBatchId && sanitizeBatchId(record.batchId) !== normalizedBatchId) return false;
      if (!text) return true;
      const haystack = [
        record.prompt,
        record.model,
        record.accountName,
        record.accountHost,
        record.batchId,
        ...(Array.isArray(record.tags) ? record.tags : []),
      ].map((value) => String(value || '').toLowerCase()).join('\n');
      return haystack.includes(text);
    });
    const page = filtered.slice(start, start + normalizedLimit).map(publicRecord);
    const nextOffset = start + page.length;
    return {
      history: page,
      limit: normalizedLimit,
      cursor: start,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : '',
      count: page.length,
      total: filtered.length,
    };
  }

  async function updateMeta(id, meta = {}) {
    const targetId = String(id || '');
    let updated = null;
    await mutateIndex((index) => {
      const record = index.images.find((item) => item.id === targetId);
      if (!record || !recordFileExists(record)) return index;
      if (Object.prototype.hasOwnProperty.call(meta, 'favorite')) record.favorite = meta.favorite === true;
      if (Object.prototype.hasOwnProperty.call(meta, 'tags')) record.tags = sanitizeTags(meta.tags);
      updated = record;
      return index;
    });
    return updated ? publicRecord(updated) : null;
  }

  async function deleteImage(id) {
    const targetId = String(id || '');
    let result = null;
    await mutateIndex((index) => {
      const pos = index.images.findIndex((item) => item.id === targetId);
      if (pos === -1) return index;
      const [record] = index.images.splice(pos, 1);
      const filePath = resolveRecordPath(record);
      const existed = !!filePath && fs.existsSync(filePath);
      if (filePath) fs.rmSync(filePath, { force: true });
      result = {
        ok: true,
        id: targetId,
        deleted: true,
        missingFile: !existed,
        removedBytes: existed ? Number(record.bytes || 0) : 0,
        record: publicRecord(record),
      };
      return index;
    });
    return result;
  }

  function clear(scope = 'images') {
    const normalized = String(scope || 'images');
    if (normalized === 'conversations') {
      return {
        ok: true,
        scope: normalized,
        count: getStats().count,
        cleared: [],
        skipped: [{
          scope: 'conversations',
          reason: 'browser_only',
          message: '当前版本没有服务端对话数据；页面草稿和结果只在浏览器本地清理。',
        }],
      };
    }
    if (normalized !== 'images' && normalized !== 'all') throw new Error('Unsupported clear scope');
    const before = getStats();
    removeDirContents(imagesDir);
    saveIndex({ version: 1, images: [] });
    return {
      ok: true,
      scope: normalized,
      count: 0,
      cleared: ['images'],
      removedImages: before.count,
      removedBytes: before.totalBytes,
      skipped: normalized === 'all'
        ? [{
            scope: 'conversations',
            reason: 'browser_only',
            message: '当前版本没有服务端对话数据；页面草稿和结果由浏览器本地清理。',
          }]
        : [],
    };
  }

  return { persistGenerationResult, getImagePath, getStats, listHistory, updateMeta, deleteImage, clear };
}

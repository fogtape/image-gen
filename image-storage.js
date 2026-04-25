import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { applyWatermarkToBuffer, normalizeWatermarkSettings } from './image-watermark.js';

const IMAGE_DIR_NAME = 'images';
const INDEX_FILE_NAME = 'image-store.json';
const MAX_HISTORY = 500;

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
  };
}

function sanitizePrompt(prompt) {
  return String(prompt || '').trim().slice(0, 300);
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const target = path.join(dir, name);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

async function bufferFromUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image download failed: HTTP ${resp.status}`);
  const mime = (resp.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const buf = Buffer.from(await resp.arrayBuffer());
  return { buffer: buf, mime };
}

export function createImageStore({ dataDir = path.join(process.cwd(), 'data'), now = () => Date.now(), idFactory } = {}) {
  const root = path.resolve(dataDir);
  const imagesDir = path.join(root, IMAGE_DIR_NAME);
  const indexFile = path.join(root, INDEX_FILE_NAME);
  const makeId = idFactory || (() => `img_${crypto.randomBytes(12).toString('hex')}`);

  function loadIndex() {
    const parsed = safeJsonRead(indexFile, { version: 1, images: [] });
    return { version: 1, images: Array.isArray(parsed.images) ? parsed.images : [] };
  }

  function saveIndex(index) {
    ensureDir(root);
    const limited = { version: 1, images: index.images.slice(0, MAX_HISTORY) };
    fs.writeFileSync(indexFile, JSON.stringify(limited, null, 2));
  }

  function makeRelativePath(id, format, timestamp) {
    const date = new Date(timestamp);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const ext = format === 'jpeg' ? 'jpg' : format;
    return path.join(IMAGE_DIR_NAME, `${yyyy}-${mm}`, `${id}.${ext}`);
  }

  async function saveBuffer(buffer, meta = {}) {
    ensureDir(imagesDir);
    const timestamp = now();
    const id = makeId();
    const requestedFormat = safeFormat(meta.format);
    const watermark = normalizeWatermarkSettings(meta.watermarkSettings || {});
    const finalBuffer = await applyWatermarkToBuffer(buffer, requestedFormat, watermark, new Date(timestamp));
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
    };
    const index = loadIndex();
    index.images.unshift(record);
    saveIndex(index);
    return publicRecord(record);
  }

  async function persistGenerationResult(result = {}, meta = {}) {
    const data = Array.isArray(result.data) ? result.data : [];
    const persisted = [];
    for (const item of data) {
      try {
        if (item?.b64_json) {
          const parsed = stripDataUrl(item.b64_json);
          const format = detectFormatFromMime(parsed.mime, safeFormat(meta.format));
          const record = await saveBuffer(Buffer.from(parsed.base64, 'base64'), { ...meta, format });
          persisted.push({ ...item, b64_json: undefined, id: record.id, url: record.url, format: record.format });
        } else if (item?.url) {
          const downloaded = await bufferFromUrl(item.url);
          const format = detectFormatFromMime(downloaded.mime, safeFormat(meta.format));
          const record = await saveBuffer(downloaded.buffer, { ...meta, format });
          persisted.push({ ...item, id: record.id, url: record.url, format: record.format });
        } else {
          persisted.push(item);
        }
      } catch {
        persisted.push(item);
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
    const images = loadIndex().images.filter((record) => {
      const filePath = path.resolve(root, record.relativePath || '');
      return filePath.startsWith(root + path.sep) && fs.existsSync(filePath);
    });
    const totalBytes = images.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    return {
      count: images.length,
      totalBytes,
      history: images.slice(0, 60).map(publicRecord),
    };
  }

  function clear(scope = 'images') {
    const normalized = String(scope || 'images');
    if (normalized === 'conversations') return { ok: true, scope: normalized, count: getStats().count };
    if (normalized !== 'images' && normalized !== 'all') throw new Error('Unsupported clear scope');
    removeDirContents(imagesDir);
    saveIndex({ version: 1, images: [] });
    return { ok: true, scope: normalized, count: 0 };
  }

  return { persistGenerationResult, getImagePath, getStats, clear };
}

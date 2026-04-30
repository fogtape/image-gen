/**
 * Shared OAuth image request limits used by both Node server and Vercel/Netlify
 * serverless handlers to enforce consistent body size and input constraints.
 */

function boundedEnvBytes(name, fallback, min, max, env = process.env) {
  const raw = Number(env?.[name] || fallback);
  const value = Number.isFinite(raw) ? raw : fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Maximum allowed JSON request body bytes for OAuth image generation.
 */
export function getOAuthMaxBodyBytes(env = process.env) {
  return boundedEnvBytes('IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES', 30 * 1024 * 1024, 1024 * 1024, 80 * 1024 * 1024, env);
}

/**
 * Maximum number of reference images per request.
 */
export const MAX_REF_IMAGES = 3;

/**
 * Allowed MIME types for reference images.
 */
export const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Normalize MIME type aliases (e.g. image/jpg → image/jpeg).
 */
function normalizeMime(mime = '') {
  const value = String(mime || '').trim().toLowerCase();
  if (value === 'image/jpg') return 'image/jpeg';
  return value;
}

/**
 * Infer image MIME type from magic bytes. Returns '' if unrecognized.
 */
function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 4) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.length >= 12 && bytes.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return '';
}

/**
 * Parse a data URL or raw base64 string and extract MIME + decoded byte length.
 */
function parseRefImageInput(data) {
  const value = String(data || '').trim();
  const match = value.match(/^data:(image\/[^;]+);base64,(.*)$/is);
  if (match) return { mime: normalizeMime(match[1]), base64: match[2] };
  return { mime: '', base64: value };
}

function decodedBase64Bytes(base64 = '') {
  const clean = String(base64 || '').replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/**
 * Maximum bytes for a single reference image.
 */
export function getOAuthMaxRefImageBytes(env = process.env) {
  return boundedEnvBytes('IMAGE_GEN_REF_IMAGE_MAX_BYTES', 8 * 1024 * 1024, 1024, 30 * 1024 * 1024, env);
}

/**
 * Maximum total bytes for all reference images combined.
 */
export function getOAuthMaxRefImagesTotalBytes(env = process.env) {
  return boundedEnvBytes('IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES', 24 * 1024 * 1024, 1024, 80 * 1024 * 1024, env);
}

/**
 * Validate an OAuth image request body.
 * Throws 413/400 errors for limit violations.
 *
 * @param {object} parsed - Parsed JSON body
 * @param {object} [options]
 * @param {number} [options.maxBodyBytes] - Override max body bytes
 */
export function validateOAuthImageRequest(parsed, { maxBodyBytes } = {}) {
  // Validate reference images count
  const refImages = Array.isArray(parsed?.refImagesBase64)
    ? parsed.refImagesBase64
    : (parsed?.refImageBase64 ? [parsed.refImageBase64] : []);

  if (refImages.length > MAX_REF_IMAGES) {
    const err = new Error('最多只能上传 3 张参考图');
    err.status = 400;
    throw err;
  }

  // Validate MIME type, single image size, and total size
  const maxSingleBytes = getOAuthMaxRefImageBytes();
  const maxTotalBytes = getOAuthMaxRefImagesTotalBytes();
  let totalBytes = 0;

  for (const raw of refImages) {
    const { mime, base64 } = parseRefImageInput(raw);
    const bytes = decodedBase64Bytes(base64);

    // MIME type check: use declared MIME or sniff from magic bytes
    let effectiveMime = mime;

    // Always try to sniff magic bytes from the actual data
    let sniffedMime = '';
    if (bytes > 0) {
      try {
        const buf = Buffer.from(String(base64 || '').replace(/\s/g, ''), 'base64');
        sniffedMime = sniffImageMime(buf);
      } catch { /* ignore decode errors */ }
    }

    // 1) Reject empty image content
    if (bytes === 0) {
      const err = new Error('参考图内容为空');
      err.status = 400;
      throw err;
    }

    // 2) ALL non-empty images MUST have recognizable image magic bytes
    if (bytes > 0 && !sniffedMime) {
      const err = new Error('参考图无法识别为有效图片格式，请上传 PNG、JPEG 或 WebP');
      err.status = 400;
      throw err;
    }

    // Use sniffed MIME for effectiveMime when no declared MIME
    if (!effectiveMime) {
      effectiveMime = sniffedMime;
    }

    // 2) Cross-check declared MIME against actual magic bytes
    if (mime && sniffedMime) {
      const normalizedDeclared = normalizeMime(mime);
      const normalizedSniffed = normalizeMime(sniffedMime);
      if (normalizedDeclared !== normalizedSniffed) {
        const err = new Error('参考图声明格式与实际内容不一致');
        err.status = 400;
        throw err;
      }
    }

    if (effectiveMime && !ALLOWED_MIME.has(effectiveMime)) {
      const err = new Error('参考图格式不支持，请上传 PNG、JPEG 或 WebP 图片');
      err.status = 400;
      throw err;
    }

    // Single image size check
    if (bytes > maxSingleBytes) {
      const err = new Error('单张参考图过大，请换用更小图片');
      err.status = 413;
      throw err;
    }

    totalBytes += bytes;
  }

  // Total size check
  if (totalBytes > maxTotalBytes) {
    const err = new Error('参考图总大小过大，请减少数量或换用更小图片');
    err.status = 413;
    throw err;
  }
}

/**
 * Check if the raw request body text exceeds the size limit.
 * Throws 413 if too large.
 *
 * @param {string} bodyText - Raw body text
 * @param {object} [options]
 * @param {number} [options.maxBytes] - Override max bytes
 */
export function assertOAuthBodySize(bodyText, { maxBytes } = {}) {
  const limit = maxBytes || getOAuthMaxBodyBytes();
  if (Buffer.byteLength(String(bodyText || ''), 'utf8') > limit) {
    const err = new Error('请求体过大');
    err.status = 413;
    throw err;
  }
}

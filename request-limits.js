function boundedEnvBytes(name, fallback, min, max, env = process.env) {
  const raw = Number(env?.[name] || fallback);
  const value = Number.isFinite(raw) ? raw : fallback;
  return Math.min(max, Math.max(min, value));
}

export function getReferenceImageLimits(env = process.env) {
  return {
    maxImageBytes: boundedEnvBytes('IMAGE_GEN_REF_IMAGE_MAX_BYTES', 8 * 1024 * 1024, 1024, 30 * 1024 * 1024, env),
    maxTotalBytes: boundedEnvBytes('IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES', 24 * 1024 * 1024, 1024, 80 * 1024 * 1024, env),
  };
}

export function getImageJobBodyLimitBytes(env = process.env) {
  return boundedEnvBytes('IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES', 30 * 1024 * 1024, 1024 * 1024, 80 * 1024 * 1024, env);
}

export function payloadTooLargeError(message = '请求体过大') {
  const error = new Error(message);
  error.status = 413;
  return error;
}

export function assertTextBodyWithinLimit(text = '', {
  maxBytes = getImageJobBodyLimitBytes(),
  message = '请求体过大',
} = {}) {
  if (Buffer.byteLength(String(text || ''), 'utf8') > maxBytes) {
    throw payloadTooLargeError(message);
  }
}

export function decodedBase64Bytes(base64 = '') {
  const clean = String(base64 || '').replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function parseImageInputData(data, fallbackMime = 'image/png') {
  const value = String(data || '').trim();
  const match = value.match(/^data:(image\/[^;]+);base64,(.*)$/is);
  if (match) return { mime: match[1].toLowerCase(), base64: match[2] };
  return { mime: fallbackMime, base64: value };
}

export function imageDataByteLength(data, fallbackMime = 'image/png') {
  const parsed = parseImageInputData(data, fallbackMime);
  return decodedBase64Bytes(parsed.base64);
}

export function assertImageDataSize(data, {
  maxBytes = getReferenceImageLimits().maxImageBytes,
  message = '参考图过大，请压缩后重试',
} = {}) {
  const bytes = imageDataByteLength(data);
  if (bytes > maxBytes) throw payloadTooLargeError(message);
  return bytes;
}

export function assertImageListWithinLimits(images = [], {
  maxImageBytes,
  maxTotalBytes,
} = {}) {
  const limits = getReferenceImageLimits();
  let totalBytes = 0;
  for (const image of images) {
    totalBytes += assertImageDataSize(image, { maxBytes: maxImageBytes || limits.maxImageBytes });
    if (totalBytes > (maxTotalBytes || limits.maxTotalBytes)) {
      throw payloadTooLargeError('参考图总大小过大，请减少数量或压缩后重试');
    }
  }
}

export function collectDataImageStrings(value, out = [], depth = 0) {
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

export function assertEmbeddedDataImagesWithinLimits(value, options = {}) {
  assertImageListWithinLimits(collectDataImageStrings(value), options);
}

export function validateImagePayloadLimits(value, options = {}) {
  assertEmbeddedDataImagesWithinLimits(value, options);
  return true;
}

export function getMultipartImageSource(image) {
  return image?.data ?? image?.dataUrl ?? image;
}

export function assertMultipartImagesWithinLimits(multipartBody = {}, options = {}) {
  const images = Array.isArray(multipartBody.images) ? multipartBody.images : [];
  const maskImages = [];
  if (multipartBody.mask) maskImages.push(multipartBody.mask);
  if (multipartBody.maskImageBase64) maskImages.push(multipartBody.maskImageBase64);
  assertImageListWithinLimits([
    ...images.map(getMultipartImageSource),
    ...maskImages,
  ], options);
}

export function isPayloadTooLargeError(error) {
  return Number(error?.status || 0) === 413;
}

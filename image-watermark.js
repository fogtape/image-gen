import sharp from 'sharp';

export const CAMERA_TIME_FORMAT = 'camera';

const DEFAULTS = {
  enabled: false,
  mode: 'custom',
  text: 'AI Image Studio',
  timeFormat: CAMERA_TIME_FORMAT,
  position: 'bottom-right',
  opacity: 0.72,
  fontSize: 28,
  color: '#ffffff',
  shadow: true,
  background: true,
};

const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']);
const MODES = new Set(['custom', 'time', 'camera-time', 'custom-time']);
const TIME_FORMATS = new Set([CAMERA_TIME_FORMAT, 'slash', 'dash', 'iso']);

function boundedNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function cleanHexColor(value, fallback = DEFAULTS.color) {
  const text = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(text) || /^#[0-9a-fA-F]{6}$/.test(text)) return text;
  return fallback;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function normalizeWatermarkSettings(input = {}) {
  const mode = MODES.has(input.mode) ? input.mode : DEFAULTS.mode;
  const position = POSITIONS.has(input.position) ? input.position : DEFAULTS.position;
  const timeFormat = TIME_FORMATS.has(input.timeFormat) ? input.timeFormat : DEFAULTS.timeFormat;
  const text = String(input.text ?? DEFAULTS.text).trim().slice(0, 80) || DEFAULTS.text;
  return {
    enabled: input.enabled === true,
    mode,
    text,
    timeFormat,
    position,
    opacity: boundedNumber(input.opacity, 0.12, 1, DEFAULTS.opacity),
    fontSize: Math.round(boundedNumber(input.fontSize, 12, 96, DEFAULTS.fontSize)),
    color: cleanHexColor(input.color),
    shadow: input.shadow !== false,
    background: input.background !== false,
  };
}

export function formatWatermarkTime(date = new Date(), format = CAMERA_TIME_FORMAT) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  if (format === 'slash') return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
  if (format === 'dash') return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  if (format === 'iso') return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}

export function renderWatermarkLines(settings = {}, now = new Date()) {
  const normalized = normalizeWatermarkSettings(settings);
  if (!normalized.enabled) return [];
  const timeText = formatWatermarkTime(now, normalized.timeFormat);
  if (normalized.mode === 'time') return [timeText];
  if (normalized.mode === 'camera-time') return [normalized.text, timeText];
  if (normalized.mode === 'custom-time') return [normalized.text, timeText];
  return [normalized.text];
}

function positionAttrs(position, width, height, boxWidth, boxHeight, margin) {
  if (position === 'top-left') return { x: margin, y: margin, anchor: 'start' };
  if (position === 'top-right') return { x: width - margin, y: margin, anchor: 'end' };
  if (position === 'bottom-left') return { x: margin, y: height - margin - boxHeight, anchor: 'start' };
  if (position === 'center') return { x: width / 2, y: (height - boxHeight) / 2, anchor: 'middle' };
  return { x: width - margin, y: height - margin - boxHeight, anchor: 'end' };
}

function rectXFor(anchor, x, boxWidth, padding) {
  if (anchor === 'middle') return x - boxWidth / 2 - padding;
  if (anchor === 'end') return x - boxWidth - padding;
  return x - padding;
}

export function buildWatermarkSvg(width, height, settings = {}, now = new Date()) {
  const normalized = normalizeWatermarkSettings(settings);
  const lines = renderWatermarkLines(normalized, now);
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));
  if (!lines.length) return `<svg width="${safeWidth}" height="${safeHeight}" xmlns="http://www.w3.org/2000/svg"></svg>`;

  const fontSize = Math.max(10, Math.min(normalized.fontSize, Math.round(Math.max(safeWidth, safeHeight) / 8)));
  const lineHeight = Math.round(fontSize * 1.28);
  const padding = Math.round(fontSize * 0.55);
  const margin = Math.max(10, Math.round(Math.min(safeWidth, safeHeight) * 0.035));
  const longest = lines.reduce((max, line) => Math.max(max, [...line].length), 0);
  const boxWidth = Math.min(safeWidth - margin * 2, Math.max(fontSize * 5, Math.round(longest * fontSize * 0.64)));
  const boxHeight = lineHeight * lines.length;
  const pos = positionAttrs(normalized.position, safeWidth, safeHeight, boxWidth, boxHeight, margin);
  const rectX = rectXFor(pos.anchor, pos.x, boxWidth, padding);
  const rectY = pos.y - padding * 0.45;
  const rectWidth = boxWidth + padding * 2;
  const rectHeight = boxHeight + padding * 1.3;
  const shadow = normalized.shadow ? 'filter="url(#shadow)"' : '';

  const textLines = lines.map((line, index) => {
    const y = pos.y + fontSize + index * lineHeight;
    return `<text x="${pos.x}" y="${y}" text-anchor="${pos.anchor}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif" font-size="${fontSize}" font-weight="650" fill="${normalized.color}" opacity="${normalized.opacity}" ${shadow}>${xmlEscape(line)}</text>`;
  }).join('');

  const rect = normalized.background
    ? `<rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" rx="${Math.round(fontSize * 0.45)}" fill="#000000" opacity="${Math.min(0.42, normalized.opacity * 0.5)}"/>`
    : '';

  return `<svg width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.45"/></filter></defs>${rect}${textLines}</svg>`;
}

export async function applyWatermarkToBuffer(buffer, format = 'png', settings = {}, now = new Date()) {
  const normalized = normalizeWatermarkSettings(settings);
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!normalized.enabled) return input;

  const image = sharp(input, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const svg = Buffer.from(buildWatermarkSvg(width, height, normalized, now));
  let pipeline = image.composite([{ input: svg, top: 0, left: 0 }]);
  const output = String(format || metadata.format || 'png').toLowerCase();
  if (output === 'jpeg' || output === 'jpg') pipeline = pipeline.jpeg({ quality: 92 });
  else if (output === 'webp') pipeline = pipeline.webp({ quality: 92 });
  else pipeline = pipeline.png();
  return await pipeline.toBuffer();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const stateSource = fs.readFileSync(new URL('../frontend/state.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('参考图上传入口允许多选但限制最多三张', () => {
  assert.match(html, /<input[^>]+id="refImage"[^>]+multiple/);
  assert.match(app, /const MAX_REF_IMAGES = 3;/);
  assert.match(app, /const REF_IMAGE_MAX_BYTES = 8 \* 1024 \* 1024;/);
  assert.match(app, /const REF_IMAGES_TOTAL_MAX_BYTES = 24 \* 1024 \* 1024;/);
  assert.match(app, new RegExp("const ALLOWED_REF_IMAGE_MIME_TYPES = new Set\\(\\['image/png', 'image/jpeg', 'image/webp'\\]\\);"));
  assert.match(app, /const selectedFiles = Array\.from\(e\.target\.files \|\| \[\]\)/);
  assert.match(app, /const files = selectedFiles\.slice\(0, MAX_REF_IMAGES\)/);
  assert.match(app, /最多只能上传 3 张参考图/);
  assert.match(app, /validateRefImageFiles\(files\)/);
  assert.match(app, /ALLOWED_REF_IMAGE_MIME_TYPES\.has\(mime\)/);
  assert.match(app, /参考图格式不支持/);
  assert.match(app, /超过 \$\{formatFileSize\(REF_IMAGE_MAX_BYTES\)\}/);
});

test('前端用多参考图数组渲染预览并提交后台任务', () => {
  assert.match(stateSource, /refImagesBase64:\s*\[\]/);
  assert.match(app, /state\.refImagesBase64\.length/);
  assert.match(app, /refImagesBase64:\s*hasRef \? state\.refImagesBase64 : undefined/);
  assert.match(css, /\.ref-preview-list/);
  assert.match(css, /\.ref-preview-item/);
});

test('前端已移除 mask、自动压缩和居中裁剪参考图入口', () => {
  assert.doesNotMatch(html, /id="refAutoCompress"/);
  assert.doesNotMatch(html, /id="refCenterCrop"/);
  assert.doesNotMatch(html, /id="maskImage"/);
  assert.doesNotMatch(html, /id="maskPreview"/);
  assert.doesNotMatch(stateSource, /maskImageBase64|maskImagePreviewUrl/);
  assert.doesNotMatch(app, /function preprocessReferenceImageFile|preprocessReferenceImageFiles/);
  assert.doesNotMatch(app, /function handleMaskImageChange|maskImageBase64|body\.mask/);
  assert.doesNotMatch(css, /\.mask-preview|\.ref-edit-options|\.mask-icon/);
});

test('后端图片任务支持最多三张参考图，并让 Images edits 走官方风格 JSON images[].image_url', () => {
  assert.match(server, /const MAX_REF_IMAGES = 3;/);
  assert.match(server, new RegExp("const ALLOWED_REF_IMAGE_MIME_TYPES = new Set\\(\\['image/png', 'image/jpeg', 'image/webp'\\]\\);"));
  assert.match(server, /assertImageMimeAllowed\(parsed\.mime\)/);
  assert.match(server, /normalizeRefImages\(payload\)/);
  assert.match(server, /images:\s*refImages\.map\(\(data\) => \(\{ image_url: toImageDataUrl\(data\) \}\)\)/);
  assert.match(server, /refImages\.map\(\(data\) => \(\{ type: 'input_image'/);
  assert.doesNotMatch(server, /image:\s*refImages\.map\(\(data\) => \(\{ type: 'base64', data \}\)\)/);
  assert.doesNotMatch(server, /normalizeMaskImage|assertMaskUsageForMode|isMultipartMaskImage/);
});

test('前端直连 Images edits 也提供 images[].image_url，避免云平台回退时 image_url 缺失', () => {
  assert.match(app, /images:\s*state\.refImagesBase64\.map\(\(data\) => \(\{ image_url: toImageDataUrl\(data\) \}\)\)/);
});

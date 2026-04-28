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
  assert.match(app, /const selectedFiles = Array\.from\(e\.target\.files \|\| \[\]\)/);
  assert.match(app, /const files = selectedFiles\.slice\(0, MAX_REF_IMAGES\)/);
  assert.match(app, /最多只能上传 3 张参考图/);
  assert.match(app, /preprocessReferenceImageFiles\(files\)/);
  assert.match(app, /validateRefImageFiles\(processedFiles\)/);
  assert.match(app, /超过 \$\{formatFileSize\(REF_IMAGE_MAX_BYTES\)\}/);
});

test('前端用多参考图数组渲染预览并提交后台任务', () => {
  assert.match(stateSource, /refImagesBase64:\s*\[\]/);
  assert.match(app, /state\.refImagesBase64\.length/);
  assert.match(app, /refImagesBase64:\s*hasRef \? state\.refImagesBase64 : undefined/);
  assert.match(css, /\.ref-preview-list/);
  assert.match(css, /\.ref-preview-item/);
});

test('前端提供参考图预处理和 mask 上传预览，并只在 edits 链路透传 mask', () => {
  assert.match(html, /id="refAutoCompress"[^>]+checked/);
  assert.match(html, /id="refCenterCrop"/);
  assert.match(html, /id="maskImage"/);
  assert.match(html, /id="maskPreview"/);
  assert.match(stateSource, /maskImageBase64:\s*''/);
  assert.match(stateSource, /maskImagePreviewUrl:\s*''/);
  assert.match(app, /function preprocessReferenceImageFile\(file\)/);
  assert.match(app, /aspectFromSizeValue\(\$\(\'#sizeSelect\'\)\?\.dataset\.value/);
  assert.match(app, /function handleMaskImageChange\(e\)/);
  assert.match(app, /mask 需要搭配参考图使用/);
  assert.match(app, /局部编辑 mask 目前仅支持普通 Images edits 链路/);
  assert.match(app, /maskImageBase64:\s*hasRef && state\.maskImageBase64 \? state\.maskImageBase64 : undefined/);
  assert.match(app, /if \(body && maskImageBase64\) body\.mask = toImageDataUrl\(maskImageBase64\)/);
});

test('后端图片任务支持最多三张参考图，并让 Images edits 走官方风格 JSON images[].image_url', () => {
  assert.match(server, /const MAX_REF_IMAGES = 3;/);
  assert.match(server, /normalizeRefImages\(payload\)/);
  assert.match(server, /images:\s*refImages\.map\(\(data\) => \(\{ image_url: toImageDataUrl\(data\) \}\)\)/);
  assert.match(server, /refImages\.map\(\(data\) => \(\{ type: 'input_image'/);
  assert.doesNotMatch(server, /image:\s*refImages\.map\(\(data\) => \(\{ type: 'base64', data \}\)\)/);
});

test('前端直连 Images edits 也提供 images[].image_url，避免云平台回退时 image_url 缺失', () => {
  assert.match(app, /images:\s*state\.refImagesBase64\.map\(\(data\) => \(\{ image_url: toImageDataUrl\(data\) \}\)\)/);
});

test('后端限制 mask 只能随 Images edits 参考图使用，并支持 JSON 与 multipart 透传', () => {
  assert.match(server, /function normalizeMaskImage\(payload = \{\}\)/);
  assert.match(server, /mask 图片过大，请压缩后重试/);
  assert.match(server, /function assertMaskUsageForMode\(payload = \{\}, mode = payload\.mode\)/);
  assert.match(server, /mask 需要搭配参考图使用/);
  assert.match(server, /mask 目前仅支持 Images edits 链路/);
  assert.match(server, /\.\.\.\(mask \? \{ mask: toImageDataUrl\(mask\) \} : \{\}\)/);
  assert.match(server, /appendMultipartImage\(form, \{ data: mask, fieldName: 'mask'/);
  assert.match(server, /isMultipartMaskImage/);
});

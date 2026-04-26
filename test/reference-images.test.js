import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('参考图上传入口允许多选但限制最多三张', () => {
  assert.match(html, /<input[^>]+id="refImage"[^>]+multiple/);
  assert.match(app, /const MAX_REF_IMAGES = 3;/);
  assert.match(app, /Array\.from\(e\.target\.files \|\| \[\]\)\.slice\(0, MAX_REF_IMAGES\)/);
  assert.match(app, /最多只能上传 3 张参考图/);
});

test('前端用多参考图数组渲染预览并提交后台任务', () => {
  assert.match(app, /refImagesBase64:\s*\[\]/);
  assert.match(app, /state\.refImagesBase64\.length/);
  assert.match(app, /refImagesBase64:\s*hasRef \? state\.refImagesBase64 : undefined/);
  assert.match(css, /\.ref-preview-list/);
  assert.match(css, /\.ref-preview-item/);
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

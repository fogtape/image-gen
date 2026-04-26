import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('账号设置提供图生图兼容模式与流式失败回退开关', () => {
  assert.match(html, /图生图兼容模式（旧版 multipart）/);
  assert.match(html, /流式失败自动回退到非流式/);
  assert.match(html, /id="editImageEditsCompat"/);
  assert.match(html, /id="editResponsesAutoFallback"/);
});

test('前端图生图兼容模式支持 multipart 直连与代理透传', () => {
  assert.match(app, /async function genEdits\(cfg, prompt, quality, background, size, format\)/);
  assert.match(app, /const compatMode = shouldUseCompatImageEdits\(cfg\);/);
  assert.match(app, /buildCompatEditsRequest\(state\.refImagesBase64, \{ model: cfg\.model, prompt, quality, background, size, format \}\)/);
  assert.match(app, /multipartBody: compatMode \? compatRequest\.multipartBody : undefined/);
  assert.match(app, /form\.append\('image', new Blob/);
  assert.match(app, /multipartBody: opts\.multipartBody/);
});

test('前后端都支持关闭流式失败自动回退', () => {
  assert.match(app, /if \(!shouldAutoFallbackFromResponses\(cfg\)\) throw new Error\(withImageEditsCompatHint\(e\?\.message \|\| e, cfg\)\);/);
  assert.match(server, /if \(!shouldAutoFallbackFromResponses\(payload\.cfg\)\) throw new Error\(withImageEditsCompatHint\(e\?\.message \|\| e, payload\.cfg \|\| \{\}\)\);/);
});

test('服务端兼容模式会把 /v1\\/images\\/edits 改为 multipart，并对 parse multipart 错误给出开关提示', () => {
  assert.match(server, /function buildImagesEditsMultipartFormData\(payload = \{\}\)/);
  assert.match(server, /compatMode = mode === 'edits' && shouldUseCompatImageEdits\(cfg\)/);
  assert.match(server, /body: compatMode \? buildImagesEditsMultipartFormData\(payload\) : JSON\.stringify\(body\)/);
  assert.match(server, /function buildProxyMultipartFormData\(multipartBody = \{\}\)/);
  assert.match(server, /withImageEditsCompatHint/);
  assert.match(server, /图生图兼容模式（旧版 multipart）/);
});

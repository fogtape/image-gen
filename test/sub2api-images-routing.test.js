import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildImagesApiBody,
  buildOAuthCodexImagesRequest,
  buildOAuthCodexHeaders,
} from '../server.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('API Key Images generations 使用 sub2api 原生 Images 请求体，流式只设置 stream，不走 Responses', () => {
  const body = buildImagesApiBody({
    mode: 'images',
    prompt: '画一只猫',
    cfg: { model: 'gpt-image-2' },
    stream: true,
    quality: 'medium',
    size: '1024x1024',
    format: 'png',
  });

  assert.equal(body.model, 'gpt-image-2');
  assert.equal(body.prompt, '画一只猫');
  assert.equal(body.stream, true);
  assert.equal(body.response_format, 'b64_json');
  assert.equal(body.quality, 'medium');
  assert.equal(body.size, '1024x1024');
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
  assert.equal(body.input, undefined);
});

test('API Key Images edits JSON 请求体与 sub2api 一致：只提交 images[].image_url，不再混入旧 image 字段', () => {
  const body = buildImagesApiBody({
    mode: 'edits',
    prompt: '把图修清晰',
    cfg: { model: 'gpt-image-2' },
    refImagesBase64: ['abc123'],
    stream: false,
  });

  assert.deepEqual(body.images, [{ image_url: 'data:image/png;base64,abc123' }]);
  assert.equal(body.image, undefined);
});

test('OAuth 文生图/图生图统一构造 sub2api Codex Responses 图片工具请求', () => {
  const textToImage = buildOAuthCodexImagesRequest({
    mode: 'oauth',
    prompt: '画一只猫',
    cfg: { model: 'gpt-image-2' },
    size: '1024x1024',
    quality: 'low',
    format: 'png',
  });
  assert.equal(textToImage.model, 'gpt-5.4-mini');
  assert.equal(textToImage.stream, true);
  assert.equal(textToImage.store, false);
  assert.deepEqual(textToImage.tool_choice, { type: 'image_generation' });
  assert.equal(textToImage.tools[0].type, 'image_generation');
  assert.equal(textToImage.tools[0].action, 'generate');
  assert.equal(textToImage.tools[0].model, 'gpt-image-2');
  assert.equal(textToImage.input[0].content[0].type, 'input_text');

  const edit = buildOAuthCodexImagesRequest({
    mode: 'oauth',
    prompt: '换背景',
    cfg: { model: 'gpt-image-2' },
    refImagesBase64: ['abc123'],
  });
  assert.equal(edit.tools[0].action, 'edit');
  assert.deepEqual(edit.input[0].content.map((item) => item.type), ['input_text', 'input_image']);
  assert.equal(edit.input[0].content[1].image_url, 'data:image/png;base64,abc123');
});

test('OAuth Codex 图片请求头使用 sub2api/Codex 指纹，不再使用 ChatGPT backend 头', () => {
  const headers = buildOAuthCodexHeaders({ apiKey: 'token-for-test' });
  assert.equal(headers.Authorization, 'Bearer token-for-test');
  assert.equal(headers.Accept, 'text/event-stream');
  assert.equal(headers['OpenAI-Beta'], 'responses=experimental');
  assert.equal(headers.Originator, 'codex_cli_rs');
  assert.match(headers['User-Agent'], /^codex_cli_rs\//);
  assert.ok(headers.session_id);
  assert.equal(headers.Origin, undefined);
  assert.equal(headers.Referer, undefined);
  assert.equal(headers['chatgpt-account-id'], undefined);
});

test('后端不再保留 Responses 失败后 fallback 到 Images 的兜底逻辑', () => {
  assert.doesNotMatch(server, /fallback:images/);
  assert.doesNotMatch(server, /runResponsesJob\(/);
  assert.match(server, /buildOAuthCodexImagesRequest/);
});

test('前端 API Key 流式不再选择 responses 模式，直连 fallback 也不再调用 genResponsesWithFallback', () => {
  assert.match(app, /function backgroundModeFor\(cfg, hasRef\)/);
  assert.doesNotMatch(app, /return 'responses'/);
  assert.doesNotMatch(app, /genResponsesWithFallback/);
  assert.match(app, /stream: cfg\.streamMode === true/);
});

test('OAuth 编辑说明更新为 Codex Responses 图片工具流程', () => {
  assert.match(html, /Codex Responses 图片工具流程|\/v1\/responses/);
  assert.doesNotMatch(html, /chat-requirements[\s\S]*conversation\/prepare[\s\S]*conversation/);
});

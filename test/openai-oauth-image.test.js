import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatGPTBackendHeaders,
  buildConversationRequest,
  collectImagePointersFromText,
  normalizeBase64Image,
  isChatChallengeRequired,
} from '../openai-oauth-image.js';

test('OAuth 生图请求使用 ChatGPT backend 头，而不是 Codex/OpenAI Images scope 头', () => {
  const headers = buildChatGPTBackendHeaders({
    accessToken: 'access-token-for-test',
    accountId: 'acc_123',
    deviceId: 'device-123',
    sessionId: 'session-123',
  });

  assert.equal(headers.Authorization, 'Bearer access-token-for-test');
  assert.equal(headers.Origin, 'https://chatgpt.com');
  assert.equal(headers.Referer, 'https://chatgpt.com/');
  assert.equal(headers['chatgpt-account-id'], 'acc_123');
  assert.equal(headers['oai-device-id'], 'device-123');
  assert.equal(headers['oai-session-id'], 'session-123');
  assert.equal(headers.Cookie, 'oai-did=device-123');
  assert.ok(headers['User-Agent'].includes('Mozilla/5.0'));

  assert.equal(headers.Originator, undefined);
  assert.equal(headers['OpenAI-Beta'], undefined);
  assert.equal(headers['Session_id'], undefined);
});

test('OAuth 图片会话请求走 ChatGPT picture_v2，而不是 /v1/images/generations', () => {
  const req = buildConversationRequest({
    prompt: '画一只猫',
    parentMessageId: 'parent-1',
    messageId: 'message-1',
  });

  assert.equal(req.action, 'next');
  assert.equal(req.model, 'auto');
  assert.deepEqual(req.system_hints, ['picture_v2']);
  assert.deepEqual(req.messages[0].content.parts, ['画一只猫']);
  assert.deepEqual(req.messages[0].metadata.system_hints, ['picture_v2']);
});

test('能从 ChatGPT SSE/JSON 文本中提取图片指针和内联 base64 图片', () => {
  const b64 = Buffer.from('fake-image').toString('base64');
  const text = [
    'data: {"v":{"conversation_id":"conv_1"},"message":{"metadata":{"dalle":{"prompt":"修订后的提示词"}}},"asset_pointer":"file-service://file_abc"}',
    '',
    JSON.stringify({ image_asset_pointer: 'sediment://asset_xyz', image_base64: `data:image/png;base64,${b64}` }),
  ].join('\n');

  const result = collectImagePointersFromText(text);

  assert.equal(result.conversationId, 'conv_1');
  assert.ok(result.pointers.some((p) => p.pointer === 'file-service://file_abc'));
  assert.ok(result.pointers.some((p) => p.pointer === 'sediment://asset_xyz'));
  assert.ok(result.pointers.some((p) => p.b64JSON === b64));
  assert.ok(result.pointers.some((p) => p.prompt === '修订后的提示词'));
});

test('normalizeBase64Image 支持 data URL 并补齐 padding', () => {
  const raw = Buffer.from('png-data').toString('base64').replace(/=+$/, '');
  assert.equal(normalizeBase64Image(`data:image/png;base64,${raw}`), Buffer.from('png-data').toString('base64'));
});


test('ChatGPT challenge required parser does not treat string false as required', () => {
  assert.equal(isChatChallengeRequired({ required: false }), false);
  assert.equal(isChatChallengeRequired({ required: 'false' }), false);
  assert.equal(isChatChallengeRequired({ required: '0' }), false);
  assert.equal(isChatChallengeRequired({ required: null }), false);
  assert.equal(isChatChallengeRequired({ required: true }), true);
  assert.equal(isChatChallengeRequired({ required: 'true' }), true);
  assert.equal(isChatChallengeRequired({ required: 'required' }), true);
});

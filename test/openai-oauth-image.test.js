import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatGPTBackendHeaders,
  buildConversationRequest,
  collectImagePointersFromText,
  normalizeBase64Image,
  isChatChallengeRequired,
  getUnsupportedChatRequirementChallenge,
  reportOAuthProgress,
  buildOAuthCodexHeaders,
  buildOAuthCodexImagesRequest,
  handleOAuthImageRequestBody,
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

test('ChatGPT 图片代理只阻断 sub2api 同样不支持的 arkose，不把 turnstile 字段直接当失败', () => {
  assert.equal(getUnsupportedChatRequirementChallenge({ arkose: { required: true } }), 'arkose');
  assert.equal(getUnsupportedChatRequirementChallenge({ turnstile: { required: true } }), '');
  assert.equal(getUnsupportedChatRequirementChallenge({ turnstile: { required: 'required' }, proofofwork: { required: true } }), '');
});

test('reportOAuthProgress emits structured progress events and ignores missing callbacks', () => {
  const events = [];
  reportOAuthProgress((event) => events.push(event), 'oauth:requirements', '正在获取 ChatGPT 账号状态', { attempt: 1 });
  reportOAuthProgress(null, 'oauth:conversation', 'ignored');

  assert.deepEqual(events, [{
    type: 'progress',
    phase: 'oauth:requirements',
    message: '正在获取 ChatGPT 账号状态',
    attempt: 1,
  }]);
});

test('OAuth Codex 图片请求按 sub2api 最新链路构造文生图 payload', () => {
  const headers = buildOAuthCodexHeaders({ apiKey: 'oauth-token', accountId: 'acc_123' }, { 'Content-Type': 'application/json' });
  assert.equal(headers.Authorization, 'Bearer oauth-token');
  assert.equal(headers.Accept, 'text/event-stream');
  assert.equal(headers['OpenAI-Beta'], 'responses=experimental');
  assert.equal(headers.Originator, 'codex_cli_rs');
  assert.match(headers['User-Agent'], /^codex_cli_rs\//);
  assert.equal(headers['chatgpt-account-id'], 'acc_123');
  assert.ok(headers.session_id);

  const body = buildOAuthCodexImagesRequest({
    prompt: '画一只猫',
    model: 'gpt-image-2',
    size: '1024x1024',
    quality: 'high',
    format: 'webp',
  });

  assert.equal(body.model, 'gpt-5.4-mini');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.deepEqual(body.tool_choice, { type: 'image_generation' });
  assert.equal(body.tools[0].type, 'image_generation');
  assert.equal(body.tools[0].action, 'generate');
  assert.equal(body.tools[0].model, 'gpt-image-2');
  assert.equal(body.tools[0].size, '1024x1024');
  assert.equal(body.tools[0].quality, 'high');
  assert.equal(body.tools[0].output_format, 'webp');
  assert.deepEqual(body.input[0].content, [{ type: 'input_text', text: '画一只猫' }]);
});

test('OAuth Codex 图片请求支持图生图 input_image，并走 edit action', () => {
  const ref = Buffer.from('ref-image').toString('base64');
  const body = buildOAuthCodexImagesRequest({
    prompt: '把参考图改成赛博朋克风格',
    refImagesBase64: [ref],
    model: 'gpt-image-2',
    format: 'png',
  });

  assert.equal(body.tools[0].action, 'edit');
  assert.equal(body.tools[0].output_format, 'png');
  assert.deepEqual(body.input[0].content, [
    { type: 'input_text', text: '把参考图改成赛博朋克风格' },
    { type: 'input_image', image_url: `data:image/png;base64,${ref}` },
  ]);
});

test('handleOAuthImageRequestBody 使用 Codex responses 链路并解析 image_generation_call 图片', async (t) => {
  const originalFetch = global.fetch;
  const calls = [];
  const b64 = Buffer.from('generated-image').toString('base64');
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return new Response([
      `data: ${JSON.stringify({ type: 'response.output_item.done', item: { type: 'image_generation_call', result: b64, revised_prompt: 'done' } })}`,
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const data = await handleOAuthImageRequestBody({
    accessToken: 'oauth-token',
    accountId: 'acc_123',
    prompt: '生成图片',
    refImagesBase64: [Buffer.from('ref').toString('base64')],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer oauth-token');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.tools[0].type, 'image_generation');
  assert.equal(sent.tools[0].action, 'edit');
  assert.equal(sent.input[0].content[1].type, 'input_image');
  assert.equal(data.data[0].b64_json, b64);
});

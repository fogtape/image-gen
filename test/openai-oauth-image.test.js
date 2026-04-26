import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatGPTBackendHeaders,
  buildCodexResponsesHeaders,
  buildConversationRequest,
  buildFileUploadRequest,
  buildOAuthResponsesImageBody,
  buildProcessUploadRequest,
  collectImagePointersFromText,
  filterUploadedReferencePointers,
  getImageQuotaMessage,
  normalizeBase64Image,
  isChatChallengeRequired,
  getUnsupportedChatRequirementChallenge,
  reportOAuthProgress,
} from '../openai-oauth-image.js';

test('OAuth 最新链路构造 ChatGPT Codex Responses image_generation 请求，支持文生图和图生图', () => {
  const txt = buildOAuthResponsesImageBody({
    prompt: '画一只猫',
    model: 'gpt-image-2',
    format: 'png',
  });
  assert.equal(txt.model, 'gpt-5.4-mini');
  assert.equal(txt.stream, true);
  assert.equal(txt.store, false);
  assert.deepEqual(txt.tool_choice, { type: 'image_generation' });
  assert.equal(txt.tools[0].type, 'image_generation');
  assert.equal(txt.tools[0].action, 'generate');
  assert.equal(txt.tools[0].model, 'gpt-image-2');
  assert.equal(txt.input[0].content[0].type, 'input_text');

  const edit = buildOAuthResponsesImageBody({
    prompt: '把图改成水彩风',
    model: 'gpt-image-2',
    refImagesBase64: ['abc123'],
  });
  assert.equal(edit.tools[0].action, 'edit');
  assert.deepEqual(edit.input[0].content[1], { type: 'input_image', image_url: 'data:image/png;base64,abc123' });
});

test('OAuth Codex Responses 头与 sub2api 最新版一致', () => {
  const headers = buildCodexResponsesHeaders({
    accessToken: 'access-token-for-test',
    accountId: 'acc_123',
    sessionId: 'sess_123',
  });
  assert.equal(headers.Authorization, 'Bearer access-token-for-test');
  assert.equal(headers.Accept, 'text/event-stream');
  assert.equal(headers['OpenAI-Beta'], 'responses=experimental');
  assert.equal(headers.originator, 'codex_cli_rs');
  assert.equal(headers.version, '0.125.0');
  assert.equal(headers['User-Agent'], 'codex_cli_rs/0.125.0');
  assert.equal(headers['chatgpt-account-id'], 'acc_123');
  assert.equal(headers.conversation_id, 'sess_123');
  assert.equal(headers.session_id, 'sess_123');
});

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

test('OAuth 参考图上传使用 ChatGPT 网页端 multimodal 上传和处理结构', () => {
  const upload = buildFileUploadRequest({
    filename: 'reference-1.png',
    sizeBytes: 12345,
  });
  assert.equal(upload.file_name, 'reference-1.png');
  assert.equal(upload.file_size, 12345);
  assert.equal(upload.use_case, 'multimodal');
  assert.equal(upload.reset_rate_limits, false);
  assert.equal(typeof upload.timezone_offset_min, 'number');

  const process = buildProcessUploadRequest({
    fileId: 'file_abc',
    filename: 'reference-1.png',
  });
  assert.deepEqual(process, {
    file_id: 'file_abc',
    use_case: 'multimodal',
    index_for_retrieval: false,
    file_name: 'reference-1.png',
    entry_surface: 'chat_composer',
  });
});

test('旧版 OAuth 图片会话请求走 ChatGPT picture_v2，而不是 /v1/images/generations', () => {
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

test('图生图不会把用户上传的参考图误当成生成结果', () => {
  const pointers = [
    { pointer: 'sediment://file_ref' },
    { pointer: 'file-service://file_out' },
  ];
  const filtered = filterUploadedReferencePointers(pointers, [{ id: 'file_ref', pointer: 'sediment://file_ref' }]);
  assert.deepEqual(filtered, [{ pointer: 'file-service://file_out' }]);
});

test('能从 conversation/init 返回中识别图片额度耗尽', () => {
  const msg = getImageQuotaMessage({
    blocked_features: [{
      name: 'image_gen',
      resets_after_text: 'in 18 hours',
      description: 'Upgrade to ChatGPT Plus or try again tomorrow.',
    }],
  });
  assert.match(msg, /图片生成额度已用完/);
  assert.match(msg, /in 18 hours/);
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

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
  downloadBytes,
  filterUploadedReferencePointers,
  getImageQuotaMessage,
  normalizeBase64Image,
  isChatChallengeRequired,
  getUnsupportedChatRequirementChallenge,
  reportOAuthProgress,
  generateOAuthImage,
  testOAuthAccessToken,
} from '../openai-oauth-image.js';

const ONE_BY_ONE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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
  assert.equal(req.client_prepare_state, 'success');
  assert.deepEqual(req.system_hints, ['picture_v2']);
  assert.deepEqual(req.messages[0].content.parts, ['画一只猫']);
  assert.deepEqual(req.messages[0].metadata.system_hints, ['picture_v2']);

  const editReq = buildConversationRequest({
    prompt: '改成海报',
    parentMessageId: 'parent-2',
    messageId: 'message-2',
    refImages: [{
      id: 'file_ref',
      pointer: 'sediment://file_ref',
      mimeType: 'image/jpeg',
      sizeBytes: 123,
      width: 400,
      height: 800,
    }],
  });
  assert.equal(editReq.messages[0].content.content_type, 'multimodal_text');
  assert.deepEqual(editReq.messages[0].metadata.attachments[0], {
    name: 'file_ref',
    id: 'file_ref',
    size: 123,
    mime_type: 'image/jpeg',
    width: 400,
    height: 800,
    source: 'local',
    is_big_paste: false,
  });
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


test('明确的 download_url 字段支持无扩展名 HTTPS 签名图片地址', () => {
  const text = 'data: {"download_url":"https://chatgpt.com/backend-api/estuary/content?id=file_generated&ts=1"}';
  const result = collectImagePointersFromText(text);
  assert.ok(result.pointers.some((p) => p.downloadURL === 'https://chatgpt.com/backend-api/estuary/content?id=file_generated&ts=1'));
});

test('ChatGPT conversation SSE parser 支持 event/data 块和多行 data JSON', () => {
  const text = [
    'event: delta',
    'data: {"v":{"conversation_id":"conv_multiline",',
    'data: "message":{"content":{"parts":[{"content_type":"image_asset_pointer","asset_pointer":"sediment://file_generated"}]}}}}',
    '',
  ].join('\n');
  const result = collectImagePointersFromText(text);
  assert.equal(result.conversationId, 'conv_multiline');
  assert.ok(result.pointers.some((p) => p.pointer === 'sediment://file_generated'));
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

test('OAuth 图片下载逐跳校验重定向、协议、类型和大小', async () => {
  const originalFetch = globalThis.fetch;
  const headers = { 'User-Agent': 'test-agent', Authorization: 'Bearer test-token' };
  const pngBuffer = Buffer.from(ONE_BY_ONE_PNG, 'base64');
  try {
    const requests = [];
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), redirect: options.redirect, hasAuth: Boolean(options.headers?.Authorization) });
      if (String(url) === 'https://chatgpt.com/cdn/start.png') {
        return new Response('', { status: 302, headers: { Location: 'https://cdn.example/final.png' } });
      }
      return new Response(pngBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(pngBuffer.length) },
      });
    };
    const ok = await downloadBytes(headers, 'https://chatgpt.com/cdn/start.png');
    assert.equal(ok.equals(pngBuffer), true);
    assert.deepEqual(requests.map((item) => item.url), [
      'https://chatgpt.com/cdn/start.png',
      'https://cdn.example/final.png',
    ]);
    assert.deepEqual(requests.map((item) => item.redirect), ['manual', 'manual']);
    assert.deepEqual(requests.map((item) => item.hasAuth), [true, false]);

    globalThis.fetch = async () => new Response('', { status: 302, headers: { Location: 'https://127.0.0.1/private.png' } });
    await assert.rejects(
      downloadBytes(headers, 'https://cdn.example/redirect-private.png'),
      /host is not allowed/,
    );

    await assert.rejects(
      downloadBytes(headers, 'http://cdn.example/insecure.png'),
      /protocol is not allowed/,
    );

    globalThis.fetch = async () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(
      downloadBytes(headers, 'https://cdn.example/not-image.png'),
      /unsupported image download content type/,
    );

    globalThis.fetch = async () => new Response('x', { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(21 << 20) } });
    await assert.rejects(
      downloadBytes(headers, 'https://cdn.example/large.png'),
      /too large/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test('OAuth 图生图轮询会跳过上传参考图并使用官方 files/download 路径下载生成图', async () => {
  const originalFetch = globalThis.fetch;
  const pngBuffer = Buffer.from(ONE_BY_ONE_PNG, 'base64');
  const requests = [];
  let pollCount = 0;
  try {
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      requests.push({ url: target, method: options.method || 'GET' });

      if (target === 'https://chatgpt.com/') return new Response('', { status: 200 });
      if (target === 'https://chatgpt.com/backend-api/conversation/init') {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target === 'https://chatgpt.com/backend-api/files' && options.method === 'POST') {
        return new Response(JSON.stringify({ status: 'success', file_id: 'file_ref', upload_url: 'https://upload.example/ref' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target === 'https://upload.example/ref') return new Response('', { status: 201 });
      if (target === 'https://chatgpt.com/backend-api/files/process_upload_stream') {
        return new Response([
          'data: {"event":"file.processing.started"}',
          'data: {"event":"file.processing.file_ready"}',
          'data: {"event":"file.processing.completed"}',
          '',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (target === 'https://chatgpt.com/backend-api/files/download/file_ref') {
        return new Response(JSON.stringify({ status: 'success', download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_ref' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target === 'https://chatgpt.com/backend-api/sentinel/chat-requirements') {
        return new Response(JSON.stringify({ token: 'chat-token', proofofwork: { required: false } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target === 'https://chatgpt.com/backend-api/f/conversation/prepare') {
        return new Response(JSON.stringify({ status: 'ok', conduit_token: 'conduit-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target === 'https://chatgpt.com/backend-api/f/conversation') {
        return new Response([
          'data: {"type":"resume_conversation_token","conversation_id":"conv_1"}',
          'data: {"v":{"conversation_id":"conv_1","message":{"content":{"parts":[{"content_type":"image_asset_pointer","asset_pointer":"sediment://file_ref"}]}}}}',
          '',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (target === 'https://chatgpt.com/backend-api/conversation/conv_1') {
        pollCount += 1;
        const pointer = pollCount === 1 ? 'sediment://file_ref' : 'sediment://file_generated';
        return new Response(JSON.stringify({
          conversation_id: 'conv_1',
          message: {
            content: { parts: [{ content_type: 'image_asset_pointer', asset_pointer: pointer }] },
            metadata: { image_gen_title: '生成图' },
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target === 'https://chatgpt.com/backend-api/files/download/file_generated?conversation_id=conv_1&inline=false') {
        return new Response(JSON.stringify({ status: 'success', download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_generated' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target === 'https://chatgpt.com/backend-api/estuary/content?id=file_generated') {
        return new Response(pngBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(pngBuffer.length) },
        });
      }
      return new Response(`unexpected ${options.method || 'GET'} ${target}`, { status: 500 });
    };

    const result = await generateOAuthImage({
      accessToken: 'access-token-for-test',
      prompt: '参考图改成海报',
      refImagesBase64: [ONE_BY_ONE_PNG],
    });

    assert.equal(result.data[0].b64_json, pngBuffer.toString('base64'));
    assert.equal(pollCount, 2);
    assert.ok(requests.some((item) => item.url === 'https://chatgpt.com/backend-api/files/download/file_generated?conversation_id=conv_1&inline=false'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth 探活优先使用官方 chat-requirements prepare/finalize 并提交 PoW', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      requests.push({ url: target, method: options.method || 'GET', body: options.body ? String(options.body) : '' });
      if (target === 'https://chatgpt.com/') return new Response('', { status: 200 });
      if (target === 'https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare') {
        return new Response(JSON.stringify({
          prepare_token: 'prepare-token',
          proofofwork: { required: true, seed: 'seed-for-test', difficulty: 'fffff' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target === 'https://chatgpt.com/backend-api/sentinel/chat-requirements/finalize') {
        const body = JSON.parse(String(options.body || '{}'));
        assert.equal(body.prepare_token, 'prepare-token');
        assert.match(body.proofofwork, /^gAAAAAB/);
        return new Response(JSON.stringify({ token: 'final-chat-token', expire_after: 540 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(`unexpected ${target}`, { status: 500 });
    };

    const result = await testOAuthAccessToken({ accessToken: 'access-token-for-test' });
    assert.equal(result.ok, true);
    assert.equal(result.service, 'chatgpt-backend');
    assert.ok(requests.some((item) => item.url.endsWith('/chat-requirements/prepare')));
    assert.ok(requests.some((item) => item.url.endsWith('/chat-requirements/finalize')));
    assert.equal(requests.some((item) => item.url === 'https://chatgpt.com/backend-api/sentinel/chat-requirements'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth chat-requirements 对无法自动完成的 challenge 返回稳定错误分类', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target === 'https://chatgpt.com/') return new Response('', { status: 200 });
      if (target === 'https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare') {
        return new Response(JSON.stringify({
          prepare_token: 'prepare-token',
          turnstile: { required: true },
          so: { required: true },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(`unexpected ${target}`, { status: 500 });
    };
    await assert.rejects(
      testOAuthAccessToken({ accessToken: 'access-token-for-test' }),
      (err) => err.status === 403 && /turnstile/.test(err.message) && /官方 ChatGPT 网页端/.test(err.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('ChatGPT 图片代理会识别无法自动完成的 arkose、turnstile 和 so challenge', () => {
  assert.equal(getUnsupportedChatRequirementChallenge({ arkose: { required: true } }), 'arkose');
  assert.equal(getUnsupportedChatRequirementChallenge({ turnstile: { required: true } }), 'turnstile');
  assert.equal(getUnsupportedChatRequirementChallenge({ so: { required: 'required' }, proofofwork: { required: true } }), 'so');
  assert.equal(getUnsupportedChatRequirementChallenge({ token: 'ready', turnstile: { required: true } }, { allowSatisfiedToken: true }), '');
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

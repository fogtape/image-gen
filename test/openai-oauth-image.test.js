import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isChatChallengeRequired,
  getUnsupportedChatRequirementChallenge,
  reportOAuthProgress,
} from '../openai-oauth-image.js';
import {
  buildOAuthCodexHeaders,
  buildOAuthCodexImagesRequest,
  handleOAuthCodexImageRequestBody,
} from '../server.js';

test('OAuth 图片生成请求使用 sub2api/Codex Responses 指纹', () => {
  const headers = buildOAuthCodexHeaders({ apiKey: 'access-token-for-test', accountId: 'acc_123' });

  assert.equal(headers.Authorization, 'Bearer access-token-for-test');
  assert.equal(headers.Accept, 'text/event-stream');
  assert.equal(headers['OpenAI-Beta'], 'responses=experimental');
  assert.equal(headers.Originator, 'codex_cli_rs');
  assert.equal(headers.Version, '0.104.0');
  assert.equal(headers['User-Agent'], 'codex_cli_rs/0.104.0');
  assert.equal(headers['chatgpt-account-id'], 'acc_123');
  assert.ok(headers.session_id);

  assert.equal(headers.Origin, undefined);
  assert.equal(headers.Referer, undefined);
  assert.equal(headers['oai-device-id'], undefined);
});

test('OAuth 图片生成请求走 Codex /responses image_generation，支持文生图和图生图', () => {
  const req = buildOAuthCodexImagesRequest({
    prompt: '画一只猫',
    cfg: { model: 'gpt-image-2' },
    refImagesBase64: ['abc123'],
    quality: 'high',
    size: '1024x1024',
    format: 'png',
  });

  assert.equal(req.model, 'gpt-5.4-mini');
  assert.equal(req.stream, true);
  assert.equal(req.store, false);
  assert.deepEqual(req.tool_choice, { type: 'image_generation' });
  assert.deepEqual(req.include, ['reasoning.encrypted_content']);
  assert.equal(req.tools[0].type, 'image_generation');
  assert.equal(req.tools[0].action, 'edit');
  assert.equal(req.tools[0].model, 'gpt-image-2');
  assert.equal(req.tools[0].quality, 'high');
  assert.equal(req.input[0].content[0].type, 'input_text');
  assert.equal(req.input[0].content[1].type, 'input_image');
  assert.equal(req.input[0].content[1].image_url, 'data:image/png;base64,abc123');
});

test('OAuth Codex 在上游拒绝强制 image_generation tool_choice 时，同端点重试 auto', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        error: { message: "Tool choice 'image_generation' not found in 'tools' parameter." },
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"iVBORw0KGgo="}}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    const result = await handleOAuthCodexImageRequestBody({
      accessToken: 'access-token-for-test',
      prompt: '画一只猫',
      format: 'png',
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://chatgpt.com/backend-api/codex/responses');
    assert.deepEqual(calls[0].body.tool_choice, { type: 'image_generation' });
    assert.equal(calls[1].url, 'https://chatgpt.com/backend-api/codex/responses');
    assert.equal(calls[1].body.tool_choice, 'auto');
    assert.equal(calls[1].body.tools[0].type, 'image_generation');
    assert.equal(result.data[0].b64_json, 'iVBORw0KGgo=');
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

test('OAuth 连接探活只阻断 sub2api 同样不支持的 arkose，不把 turnstile 字段直接当失败', () => {
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

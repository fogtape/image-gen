import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPromptEnhancementRequest,
  extractEnhancedPrompt,
  normalizePromptEnhancementSettings,
  sanitizeEnhancedPrompt,
} from '../prompt-enhancement.js';

test('提示词增强默认关闭，模型为空时跟随账号模型', () => {
  const settings = normalizePromptEnhancementSettings();
  assert.equal(settings.enabled, false);
  assert.equal(settings.model, '');
  assert.equal(settings.mode, 'balanced');
  assert.equal(settings.language, 'auto');
});

test('API Key 账号构造 chat/completions 文本请求且不携带图片工具参数', () => {
  const req = buildPromptEnhancementRequest({
    cfg: { apiUrl: 'https://api.example.com/', apiKey: 'sk-test', model: 'gpt-image-1', promptModel: 'gpt-5.4-mini' },
    prompt: '一只猫',
    style: 'cinematic',
    type: 'poster',
    settings: { mode: 'professional', language: 'zh' },
  });

  assert.equal(req.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(req.body.model, 'gpt-5.4-mini');
  assert.equal(req.body.messages[0].role, 'system');
  assert.equal(req.body.messages.at(-1).role, 'user');
  const bodyText = JSON.stringify(req.body);
  assert.doesNotMatch(bodyText, /image_generation/);
  assert.doesNotMatch(bodyText, /tool_choice/);
  assert.doesNotMatch(bodyText, /output_format|size|quality|background/);
});

test('OAuth 账号构造 responses 文本请求且不携带 image_generation tool', () => {
  const req = buildPromptEnhancementRequest({
    cfg: { apiUrl: 'https://api.openai.com', apiKey: 'oauth-token', model: 'gpt-5.4', promptModel: 'gpt-5.4-mini', isOAuth: true, accountId: 'acct' },
    prompt: '赛博朋克城市',
    settings: { mode: 'balanced', language: 'auto' },
  });

  assert.equal(req.url, 'https://api.openai.com/v1/responses');
  assert.equal(req.body.model, 'gpt-5.4-mini');
  assert.ok(req.body.input.includes('赛博朋克城市'));
  const bodyText = JSON.stringify(req.body);
  assert.doesNotMatch(bodyText, /image_generation/);
  assert.doesNotMatch(bodyText, /tools/);
});

test('可从 chat/completions 和 responses 响应中提取干净提示词', () => {
  assert.equal(
    extractEnhancedPrompt({ choices: [{ message: { content: '```\n电影感猫咪海报\n```' } }] }),
    '电影感猫咪海报',
  );
  assert.equal(
    extractEnhancedPrompt({ output_text: '“城市夜景，霓虹灯，雨夜”' }),
    '城市夜景，霓虹灯，雨夜',
  );
});

test('清理增强结果时去掉解释性前缀并拒绝空内容', () => {
  assert.equal(sanitizeEnhancedPrompt('优化后的提示词：夕阳下的山谷'), '夕阳下的山谷');
  assert.throws(() => sanitizeEnhancedPrompt('   '), /未返回有效提示词/);
});

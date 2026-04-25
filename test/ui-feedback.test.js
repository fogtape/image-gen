import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLICY_VIOLATION_MESSAGE,
  normalizeGenerationError,
  getGeneratingHint,
  IDLE_GENERATION_HINT,
  getGenerationProgressMessage,
  getResponseStreamProgressMessage,
  getSseProgressMessage,
  getWaitingProgressMessage,
} from '../ui-feedback.js';

test('normalizeGenerationError turns content policy failures into user-friendly Chinese guidance', () => {
  const samples = [
    'Your request was rejected as a result of our safety system. This prompt may violate our content policy.',
    { error: { code: 'content_policy_violation', message: 'Image blocked by policy' } },
    '非常抱歉，生成的图片可能违反了我们的内容政策。',
  ];

  for (const sample of samples) {
    assert.equal(normalizeGenerationError(sample), POLICY_VIOLATION_MESSAGE);
  }
});

test('normalizeGenerationError preserves ordinary readable errors', () => {
  assert.equal(normalizeGenerationError(new Error('网络请求失败')), '网络请求失败');
  assert.equal(normalizeGenerationError({ message: 'Missing prompt' }), 'Missing prompt');
});

test('getGeneratingHint cycles through reassuring progress text and idle hint stays unchanged', () => {
  assert.equal(IDLE_GENERATION_HINT, 'Ctrl+Enter 发送');
  assert.equal(getGeneratingHint(0), '正在整理提示词');
  assert.equal(getGeneratingHint(1), '正在提交请求到后端');
  assert.equal(getGeneratingHint(2), '模型正在生成图片');
  assert.equal(getGeneratingHint(3), '正在接收图片数据');
});

test('getGenerationProgressMessage maps concrete generation phases to user-visible status', () => {
  assert.equal(getGenerationProgressMessage('prompt:prepare'), '正在整理提示词');
  assert.equal(getGenerationProgressMessage('request:send'), '正在提交请求到后端');
  assert.equal(getGenerationProgressMessage('oauth:requirements'), '正在获取 ChatGPT 账号状态');
  assert.equal(getGenerationProgressMessage('oauth:download'), '正在下载生成的图片');
  assert.equal(getGenerationProgressMessage('result:render'), '正在渲染生成结果');
  assert.equal(getGenerationProgressMessage('unknown:phase'), '正在生成图片');
});

test('getResponseStreamProgressMessage converts Responses SSE event types into progress text', () => {
  assert.equal(getResponseStreamProgressMessage({ type: 'response.created' }), '后端已接收请求');
  assert.equal(getResponseStreamProgressMessage({ type: 'response.output_item.added', item: { type: 'image_generation_call' } }), '模型已开始生成图片');
  assert.equal(getResponseStreamProgressMessage({ type: 'response.output_item.done', item: { type: 'image_generation_call' } }), '图片数据已返回');
  assert.equal(getResponseStreamProgressMessage({ type: 'response.completed' }), '生成完成，正在渲染结果');
  assert.equal(getResponseStreamProgressMessage({ type: 'unrelated' }), '');
});

test('getSseProgressMessage handles named SSE events as well as default message events', () => {
  assert.equal(getSseProgressMessage('response.created', { type: 'response.created' }), '后端已接收请求');
  assert.equal(getSseProgressMessage('response.output_item.added', { item: { type: 'image_generation_call' } }), '模型已开始生成图片');
  assert.equal(getSseProgressMessage('progress', { phase: 'oauth:download', message: '正在下载生成的图片' }), '正在下载生成的图片');
  assert.equal(getSseProgressMessage('message', { type: 'response.completed' }), '生成完成，正在渲染结果');
});

test('getWaitingProgressMessage stays stable instead of cycling through noisy copy', () => {
  assert.equal(getWaitingProgressMessage(), '仍在生成，请耐心等待');
  assert.equal(getWaitingProgressMessage(99), '仍在生成，请耐心等待');
});

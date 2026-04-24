import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLICY_VIOLATION_MESSAGE,
  normalizeGenerationError,
  getGeneratingHint,
  IDLE_GENERATION_HINT,
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
  assert.equal(getGeneratingHint(0), '正在生成中');
  assert.equal(getGeneratingHint(1), '仍在生成中');
  assert.equal(getGeneratingHint(2), '继续生成中');
  assert.equal(getGeneratingHint(3), '正在生成中');
});

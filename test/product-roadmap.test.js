import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('P4 产品增强路线有目标用户、优先级和验收标准', () => {
  const roadmap = read('docs/p4-product-roadmap.md');
  for (const section of [
    'P4.1 局部编辑与画布工作流',
    'P4.2 上传增强',
    'P4.3 队列面板',
    'P4.4 历史增强',
    'P4.5 诊断与可观测性增强',
    'P4.6 统计面板',
  ]) {
    assert.match(roadmap, new RegExp(`## ${section}`));
  }
  assert.match(roadmap, /目标用户/);
  assert.match(roadmap, /建议优先级/);
  assert.match(roadmap, /验收标准/);
  assert.match(roadmap, /不包含 API Key、OAuth token、管理口令/);
});

test('README 链接 P0-P3 追踪和 P4 产品路线', () => {
  const readme = read('README.md');
  assert.match(readme, /docs\/audit-p0-p3-tracking-2026-04-28\.md/);
  assert.match(readme, /docs\/admin-gate-account-settings-refactor-2026-04-29\.md/);
  assert.match(readme, /docs\/p4-product-roadmap\.md/);
});

test('README 说明前置管理员登录、账号存储优先级和 Upstash 配置', () => {
  const readme = read('README.md');
  for (const phrase of [
    '前置管理员登录',
    '独立账号管理',
    '服务端优先账号存储',
    '此账号的 API 地址',
    'data/accounts.enc.json',
    'config/.account-store-key',
    'IMAGE_GEN_ACCOUNT_STORE',
    'IMAGE_GEN_UPSTASH_REDIS_REST_URL',
    '测试账号存储',
    '浏览器副本会保留作为 fallback',
  ]) {
    assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

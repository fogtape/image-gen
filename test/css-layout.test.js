import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}

test('生成工具栏长状态文案不挤压生成按钮', () => {
  const toolbarRight = ruleBody('.toolbar-right');
  assert.match(toolbarRight, /min-width\s*:\s*0\s*;/);

  const hint = ruleBody('.hint');
  assert.match(hint, /overflow\s*:\s*hidden\s*;/);
  assert.match(hint, /text-overflow\s*:\s*ellipsis\s*;/);
  assert.match(hint, /white-space\s*:\s*nowrap\s*;/);

  const sendButton = ruleBody('.btn-send');
  assert.match(sendButton, /width\s*:\s*82px\s*;/);
  assert.match(sendButton, /min-width\s*:\s*82px\s*;/);
  assert.match(sendButton, /height\s*:\s*36px\s*;/);
  assert.match(sendButton, /padding\s*:\s*0\s+18px\s*;/);
  assert.match(sendButton, /flex-shrink\s*:\s*0\s*;/);
  assert.match(sendButton, /justify-content\s*:\s*center\s*;/);
});

test('生成按钮加载态隐藏文字和加载图标时布局稳定', () => {
  assert.match(css, /\.btn-text\.hidden\s*,\s*\n\.btn-loading\.hidden\s*\{\s*display\s*:\s*none\s*;\s*\}/m);
  const loading = ruleBody('.btn-loading');
  assert.match(loading, /display\s*:\s*inline-flex\s*;/);
  assert.match(loading, /align-items\s*:\s*center\s*;/);
  assert.match(loading, /min-width\s*:\s*28px\s*;/);
  assert.match(loading, /justify-content\s*:\s*center\s*;/);
});

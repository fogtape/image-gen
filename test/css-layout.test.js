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

test('移动端顶部栏和后台任务 banner 在 320-360px 有溢出兜底', () => {
  const topbarLeft = ruleBody('.topbar-left,\n.topbar-right');
  assert.match(topbarLeft, /min-width\s*:\s*0\s*;/);

  const logo = ruleBody('.logo');
  assert.match(logo, /min-width\s*:\s*0\s*;/);

  const logoSpan = ruleBody('.logo span');
  assert.match(logoSpan, /overflow\s*:\s*hidden\s*;/);
  assert.match(logoSpan, /text-overflow\s*:\s*ellipsis\s*;/);
  assert.match(logoSpan, /white-space\s*:\s*nowrap\s*;/);

  const switcher = ruleBody('.switcher-btn');
  assert.match(switcher, /min-width\s*:\s*0\s*;/);
  const switcherName = ruleBody('.switcher-name');
  assert.match(switcherName, /min-width\s*:\s*0\s*;/);

  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.active-job-banner\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.active-job-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.active-job-actions \.btn\s*\{[\s\S]*?min-height:\s*40px/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.logo span\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.active-job-actions\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.active-job-actions \.btn\s*\{[\s\S]*?width:\s*100%/);
});

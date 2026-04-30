import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}

function divAncestorsBefore(needle) {
  const targetIndex = html.indexOf(needle);
  assert.ok(targetIndex >= 0, `${needle} should exist`);
  const stack = [];
  const divTag = /<\/?div\b[^>]*>/gi;
  let match;
  while ((match = divTag.exec(html)) && match.index < targetIndex) {
    const tag = match[0];
    if (/^<\//.test(tag)) stack.pop();
    else stack.push(tag);
  }
  return stack.join('\n');
}

test('后台任务提示改为浮动胶囊，只保留查看和停止两个操作', () => {
  const bannerMatch = html.match(/<div id="activeJobBanner"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(bannerMatch, 'active job banner markup should exist');
  const banner = bannerMatch[0];

  assert.match(banner, /role="status"/);
  assert.match(banner, /aria-live="polite"/);
  assert.match(banner, /active-job-pill/);
  assert.match(banner, /id="retryActiveJobBtn"[\s\S]*>\s*查看\s*<\/button>/);
  assert.match(banner, /id="cancelActiveJobBtn"[\s\S]*>\s*停止\s*<\/button>/);
  assert.doesNotMatch(banner, /dismissActiveJobBtn|放弃任务|取消任务/);
});

test('后台任务浮动胶囊在移动端保持紧凑，不再竖排全宽按钮', () => {
  const banner = ruleBody('.active-job-banner');
  assert.match(banner, /position\s*:\s*fixed\s*;/);
  assert.match(banner, /left\s*:\s*50%\s*;/);
  assert.match(banner, /bottom\s*:\s*14px\s*;/);
  assert.match(banner, /border-radius\s*:\s*999px\s*;/);

  const actions = ruleBody('.active-job-actions');
  assert.match(actions, /gap\s*:\s*6px\s*;/);
  assert.match(actions, /flex-shrink\s*:\s*0\s*;/);

  const buttons = ruleBody('.active-job-actions .btn');
  assert.match(buttons, /height\s*:\s*30px\s*;/);
  assert.match(buttons, /min-width\s*:\s*52px\s*;/);

  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.active-job-banner\s*\{[\s\S]*?width:\s*calc\(100vw - 20px\)/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.active-job-title\s*\{[\s\S]*?max-width:\s*42vw/);
  const mobileActionMatch = css.match(/@media \(max-width: 600px\)[\s\S]*?\.active-job-actions \.btn\s*\{([^}]*)\}/);
  assert.ok(mobileActionMatch, 'mobile active job button rule should exist');
  assert.doesNotMatch(mobileActionMatch[1], /width\s*:\s*100%/);
  assert.doesNotMatch(mobileActionMatch[1], /flex-basis\s*:/);
});

test('后台任务浮动胶囊不放在毛玻璃输入卡片内，避免 fixed 被包含块劫持', () => {
  const inputCard = ruleBody('.input-card');
  assert.match(inputCard, /backdrop-filter\s*:\s*blur\(16px\)/);
  assert.doesNotMatch(
    divAncestorsBefore('<div id="activeJobBanner"'),
    /class="[^"]*\binput-card\b[^"]*"/,
  );
});

test('首页 hero 保留副标题和适度留白，但不恢复顶部渐变横条', () => {
  assert.doesNotMatch(html, /class="hero-accent"/);
  assert.doesNotMatch(css, /\.hero-accent\s*\{/);
  const hero = ruleBody('.hero-section');
  assert.match(hero, /padding\s*:\s*16px 0 12px\s*;/);
  const title = ruleBody('.hero-title');
  assert.match(title, /margin\s*:\s*0 0 4px\s*;/);
  assert.match(title, /font-size\s*:\s*1\.35rem\s*;/);
  const desc = ruleBody('.hero-desc');
  assert.match(desc, /margin\s*:\s*0\s*;/);
  assert.match(desc, /font-size\s*:\s*0\.84rem\s*;/);
  assert.doesNotMatch(desc, /display\s*:\s*none/);
});

test('后台任务停止操作使用停止文案，不再恢复取消任务文案', () => {
  assert.match(app, /button\.textContent\s*=\s*'停止中…'/);
  assert.match(app, /oldText \|\| '停止'/);
  assert.doesNotMatch(app, /oldText \|\| '取消任务'/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('状态提示超长时使用省略号且不挤压发送区布局', () => {
  assert.match(html, /id="generationHint" class="hint" title=/);
  assert.match(css, /\.toolbar-right \.hint \{[\s\S]*overflow: hidden;[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;/s);
  assert.match(css, /\.btn-send \{ flex-shrink: 0; \}/);
});

test('前端新增后台任务恢复条与显式重试\/放弃按钮', () => {
  assert.match(html, /id="activeJobBanner"/);
  assert.match(html, /id="retryActiveJobBtn"/);
  assert.match(html, /id="dismissActiveJobBtn"/);
  assert.match(app, /function showActiveJobBanner/);
});

test('首次轮询查询失败时保留 active job 而不是直接清除', () => {
  assert.match(app, /if \(isRetryableBackgroundJobError\(e\)\) \{[\s\S]*showActiveJobBanner\('后台任务仍在进行'[\s\S]*setGenerationStatus\('已保留后台任务，网络恢复后会自动继续获取结果'\);[\s\S]*return;/s);
});

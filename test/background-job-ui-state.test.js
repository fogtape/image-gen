import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const backgroundJobs = fs.readFileSync(new URL('../frontend/background-jobs.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('状态提示超长时使用省略号且不挤压发送区布局', () => {
  assert.match(html, /id="generationHint" class="hint" title=/);
  assert.match(css, /\.toolbar-right \.hint \{[\s\S]*overflow: hidden;[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;/s);
  assert.match(css, /\.btn-send\s*\{[\s\S]*flex-shrink\s*:\s*0\s*;[\s\S]*\}/s);
});

test('前端新增后台任务恢复条与显式重试\/放弃按钮', () => {
  assert.match(html, /id="activeJobBanner"/);
  assert.match(html, /id="retryActiveJobBtn"/);
  assert.match(html, /id="cancelActiveJobBtn"/);
  assert.match(html, /id="dismissActiveJobBtn"/);
  assert.match(backgroundJobs, /function showActiveJobBanner/);
});

test('前端取消后台任务会调用后端 cancel API 并停止本地轮询', () => {
  assert.match(app, /async function cancelBackgroundJob\(jobId\)/);
  assert.match(app, /\/api\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/cancel/);
  assert.match(app, /async function cancelActiveJob\(\)/);
  assert.match(app, /stopPollingJob\(state, active\.jobId\)/);
  assert.match(app, /if \(job\.status === 'cancelled'\) \{[\s\S]*stopPollingJob\(state, jobId\)[\s\S]*setGenerationStatus\('job:cancelled'\);[\s\S]*return;/s);
  assert.match(app, /id="cancelActiveJobBtn"|cancelActiveJobBtn/);
});

test('首次轮询查询失败时保留 active job 而不是直接清除', () => {
  assert.match(app, /if \(isRetryableBackgroundJobError\(e\)\) \{[\s\S]*showActiveJobBanner\('后台任务仍在进行'[\s\S]*setGenerationStatus\('已保留后台任务，网络恢复后会自动继续获取结果'\);[\s\S]*return;/s);
});

test('前端支持批量生成数量并把 count 和 batchId 交给后台任务', () => {
  assert.match(html, /id="countSelect"/);
  assert.match(html, /id="settingsDefaultCount"/);
  assert.match(app, /function getGenerationCount/);
  assert.match(app, /const count = getGenerationCount\(\)/);
  assert.match(app, /const batchId = `batch_\$\{genId\(\)\}`/);
  assert.match(app, /count: actualCount/);
  assert.match(app, /batchId/);
  assert.match(app, /batchIndex/);
  assert.match(app, /batchCount/);
  assert.match(app, /function addFailedResultCard/);
  assert.match(css, /\.card-meta/);
});

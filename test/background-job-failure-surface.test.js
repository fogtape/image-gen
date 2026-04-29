import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('前端创建成功后的后台任务如果轮询重试耗尽，会保留 active job 并转入可恢复态而不是伪装成已完成或直接丢任务', () => {
  assert.match(
    app,
    /try \{\s*await pollBackgroundJob\(jobId, format, cfg\.isOAuth(?:, resultMeta)?\);\s*\} catch \(e\) \{\s*if \(isRetryableBackgroundJobError\(e\)\) \{[\s\S]*showActiveJobBanner\('后台任务仍在进行'[\s\S]*setGenerationStatus\('已保留后台任务，网络恢复后会自动继续获取结果'\);[\s\S]*return;\s*\}\s*throw e;\s*\}/s,
  );
  assert.doesNotMatch(app, /后台任务已提交，当前连接不稳定，可稍后回来继续查看结果/);
});

test('图片持久化失败会进入后台任务进度并在前端显示可理解状态', () => {
  assert.match(server, /onProgress\('storage:partial'/);
  assert.match(server, /onProgress\('storage:error'/);
  assert.match(server, /storageErrors: failures\.slice\(0, 3\)\.map/);
  assert.match(app, /'storage:partial': '部分图片保存历史失败，生成结果仍可查看'/);
  assert.match(app, /'storage:error': '图片历史保存失败，生成结果仍可查看'/);
});

test('后台任务已明确 failed 时应终止轮询并展示上游真实错误，而不是当成连接波动继续保留任务', () => {
  assert.match(
    app,
    /if \(job\.status === 'failed'\) \{[\s\S]*clearActiveJob\(\);[\s\S]*const err = new Error\(normalizeGenerationError\(job\.errorInfo\?\.message \|\| job\.error \|\| '后台生成失败'\)\);[\s\S]*err\.isBackgroundJobTerminalFailure = true;[\s\S]*throw err;[\s\S]*\}/s,
  );
  assert.match(
    app,
    /function isRetryableBackgroundJobError\(error\) \{[\s\S]*if \(error\?\.isBackgroundJobTerminalFailure\) return false;[\s\S]*\}/s,
  );
});

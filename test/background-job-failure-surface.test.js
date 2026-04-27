import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('前端创建成功后的后台任务如果轮询重试耗尽，会保留 active job 并转入可恢复态而不是伪装成已完成或直接丢任务', () => {
  assert.match(
    app,
    /try \{\s*await pollBackgroundJob\(jobId, format, cfg\.isOAuth\);\s*\} catch \(e\) \{\s*if \(isRetryableBackgroundJobError\(e\)\) \{[\s\S]*showActiveJobBanner\('后台任务仍在进行'[\s\S]*setGenerationStatus\('已保留后台任务，网络恢复后会自动继续获取结果'\);[\s\S]*return;\s*\}\s*throw e;\s*\}/s,
  );
  assert.doesNotMatch(app, /后台任务已提交，当前连接不稳定，可稍后回来继续查看结果/);
});

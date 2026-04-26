import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('前端后台任务轮询增加超时、有限重试，并把直连回退限制在建任务阶段', () => {
  const app = read('app.js');
  assert.match(app, /const BACKGROUND_JOB_CREATE_TIMEOUT_MS = 20_000/);
  assert.match(app, /const BACKGROUND_JOB_POLL_RETRY_LIMIT = 4/);
  assert.match(app, /async function fetchWithTimeout\(url, options = \{\}, timeoutMs = 15_000\)/);
  assert.match(app, /async function pollBackgroundJob\(jobId, format, isOAuth\) \{[\s\S]*retryCount = 0[\s\S]*retryCount \+= 1[\s\S]*BACKGROUND_JOB_POLL_RETRY_LIMIT[\s\S]*backgroundJobBackoffMs/s);
  assert.match(app, /let job;[\s\S]*try \{\s*job = await createBackgroundJob\(payload\);[\s\S]*if \(isBackgroundJobsUnavailableError\(e\)\) \{[\s\S]*genDirectImagesAfterJobFallback/s);
});

test('前端恢复后台任务时只在明确 404 时清理 active job，并在网络恢复后自动续查', () => {
  const app = read('app.js');
  assert.match(app, /if \(isMissingBackgroundJobError\(e\)\) \{[\s\S]*clearActiveJob\(\)[\s\S]*return;[\s\S]*\}/s);
  assert.match(app, /if \(isRetryableBackgroundJobError\(e\)\) \{[\s\S]*已保留后台任务[\s\S]*return;[\s\S]*\}/s);
  assert.match(app, /window\.addEventListener\('online', \(\) => \{ void resumeActiveJobIfAny\(\); \}\)/);
  assert.match(app, /window\.addEventListener\('focus', \(\) => \{ void resumeActiveJobIfAny\(\); \}\)/);
  assert.match(app, /document\.addEventListener\('visibilitychange', \(\) => \{[\s\S]*document\.visibilityState === 'visible'[\s\S]*resumeActiveJobIfAny\(\)/s);
});

test('服务端图片上游请求带统一超时保护，超时按 504 处理', () => {
  const server = read('server.js');
  assert.match(server, /const IMAGES_API_TIMEOUT_MS = 300_000/);
  assert.match(server, /const RESPONSES_API_TIMEOUT_MS = 300_000/);
  assert.match(server, /async function runWithTimeout\(task, timeoutMs, timeoutMessage\)/);
  assert.match(server, /error\.status = 504/);
  assert.match(server, /runImagesApiJob[\s\S]*await runWithTimeout\(async \(signal\) => \{/s);
  assert.match(server, /runResponsesJob[\s\S]*await runWithTimeout\(async \(signal\) => \{/s);
});

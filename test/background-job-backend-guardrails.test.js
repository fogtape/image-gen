import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const jobs = fs.readFileSync(new URL('../background-jobs.js', import.meta.url), 'utf8');

test('服务端 responses fallback 改为按错误类型触发，而不是无脑回退', () => {
  assert.match(server, /function shouldFallbackResponsesError\(error\)/);
  assert.match(server, /if \(!shouldFallbackResponsesError\(e\)\) throw e;/);
});

test('后台任务存储支持并发上限与队列上限', () => {
  assert.match(server, /function boundedIntEnv\(name, fallback, min, max\)/);
  assert.match(server, /const IMAGE_JOB_MAX_CONCURRENCY = boundedIntEnv\('IMAGE_JOB_MAX_CONCURRENCY', 3, 1, 10\);/);
  assert.match(server, /const IMAGE_JOB_MAX_QUEUE = boundedIntEnv\('IMAGE_JOB_MAX_QUEUE', 12, 1, 100\);/);
  assert.match(server, /const IMAGE_JOB_PENDING_TIMEOUT_MS = boundedIntEnv\('IMAGE_JOB_PENDING_TIMEOUT_MS'/);
  assert.match(server, /const IMAGE_JOB_RUNNING_TIMEOUT_MS = boundedIntEnv\('IMAGE_JOB_RUNNING_TIMEOUT_MS'/);
  assert.match(jobs, /maxPendingMs = 15 \* 60 \* 1000/);
  assert.match(jobs, /maxRunningMs = 15 \* 60 \* 1000/);
  assert.match(jobs, /if \(runningCount \+ queue\.length >= maxQueue\)/);
  assert.match(jobs, /JOB_PENDING_TIMEOUT/);
  assert.match(jobs, /JOB_RUNNING_TIMEOUT/);
});

test('后台任务失败保留结构化错误信息，便于前端和诊断使用', () => {
  assert.match(jobs, /errorInfo: \{/);
  assert.match(jobs, /fallbackAttempted: e\?\.fallbackAttempted === true/);
});

test('主路由统一捕获异步 handler 异常并安全解码路径参数', () => {
  assert.match(server, /function dispatchRoute\(req, res, handler\)/);
  assert.match(server, /Promise\.resolve\(\)\s*\.then\(handler\)\s*\.catch/);
  assert.match(server, /function safeDecodePathComponent\(value, res\)/);
  assert.match(server, /safeDecodePathComponent\(match\[1\], res\)/);
});

test('后台图片任务限制批量生成数量并统一 batch 元数据', () => {
  assert.match(server, /const IMAGE_JOB_MAX_COUNT = 4/);
  assert.match(server, /function normalizeImageJobCount/);
  assert.match(server, /生成数量必须是 1-\$\{IMAGE_JOB_MAX_COUNT\}/);
  assert.match(server, /function normalizeImageJobPayload/);
  assert.match(server, /batch_\$\{crypto\.randomUUID\(\)\}/);
  assert.match(server, /batchIndex: index/);
  assert.match(server, /batchCount: count/);
});

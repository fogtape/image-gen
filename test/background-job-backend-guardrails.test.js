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
  assert.match(server, /const IMAGE_JOB_MAX_CONCURRENCY = Number\(process\.env\.IMAGE_JOB_MAX_CONCURRENCY \|\| 3\);/);
  assert.match(server, /const IMAGE_JOB_MAX_QUEUE = Number\(process\.env\.IMAGE_JOB_MAX_QUEUE \|\| 12\);/);
  assert.match(jobs, /maxConcurrency = Infinity, maxQueue = Infinity/);
  assert.match(jobs, /if \(runningCount \+ queue\.length >= maxQueue\)/);
});

test('后台任务失败保留结构化错误信息，便于前端和诊断使用', () => {
  assert.match(jobs, /errorInfo: \{/);
  assert.match(jobs, /fallbackAttempted: e\?\.fallbackAttempted === true/);
});

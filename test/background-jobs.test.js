import test from 'node:test';
import assert from 'node:assert/strict';

import { createJobStore } from '../background-jobs.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('background job returns immediately, records progress, and completes asynchronously', async () => {
  const events = [];
  const store = createJobStore({
    idFactory: () => 'job_1',
    ttlMs: 60_000,
    runner: async (payload, onProgress) => {
      events.push(['runner-start', payload.prompt]);
      onProgress('request:accepted', '后端已接收请求');
      await tick();
      return { data: [{ b64_json: Buffer.from('image').toString('base64') }] };
    },
  });

  const created = store.create({ prompt: '画一只猫', apiKey: 'secret' });

  assert.equal(created.id, 'job_1');
  assert.equal(created.status, 'pending');
  assert.equal(created.payload, undefined);
  assert.deepEqual(events, []);

  await tick();
  assert.equal(store.get('job_1').status, 'running');
  assert.equal(store.get('job_1').progress.at(-1).message, '后端已接收请求');

  await tick();
  const done = store.get('job_1');
  assert.equal(done.status, 'completed');
  assert.equal(done.result.data[0].b64_json, Buffer.from('image').toString('base64'));
  assert.equal(done.payload, undefined);
});

test('background job stores failures without leaking payload secrets', async () => {
  const store = createJobStore({
    idFactory: () => 'job_fail',
    runner: async () => { throw new Error('upstream failed'); },
  });

  store.create({ apiKey: 'secret-key' });
  await tick();

  const failed = store.get('job_fail');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'upstream failed');
  assert.equal(JSON.stringify(failed).includes('secret-key'), false);
});

test('background job cleanup removes expired finished jobs', async () => {
  let now = 1_000;
  const store = createJobStore({
    idFactory: () => 'job_old',
    now: () => now,
    ttlMs: 100,
    runner: async () => ({ ok: true }),
  });

  store.create({});
  await tick();
  assert.equal(store.get('job_old').status, 'completed');

  now += 101;
  store.cleanup();
  assert.equal(store.get('job_old'), null);
});

test('background job cleanup marks expired pending jobs failed without running them', async () => {
  let now = 1_000;
  const ids = ['job_running', 'job_pending'];
  const started = [];
  const store = createJobStore({
    idFactory: () => ids.shift(),
    now: () => now,
    maxConcurrency: 1,
    maxPendingMs: 100,
    runner: async (payload) => {
      started.push(payload.name);
      if (payload.name === 'first') await new Promise(() => {});
      return { ok: true };
    },
  });

  store.create({ name: 'first' });
  store.create({ name: 'second' });
  await tick();
  now += 101;

  const expired = store.get('job_pending');
  assert.equal(expired.status, 'failed');
  assert.equal(expired.errorInfo.code, 'JOB_PENDING_TIMEOUT');
  assert.equal(expired.payload, undefined);
  assert.deepEqual(started, ['first']);
});

test('background job cleanup expires stuck running jobs and releases concurrency slot', async () => {
  let now = 1_000;
  const ids = ['job_stuck', 'job_next'];
  const started = [];
  const store = createJobStore({
    idFactory: () => ids.shift(),
    now: () => now,
    maxConcurrency: 1,
    maxRunningMs: 100,
    runner: async (payload) => {
      started.push(payload.name);
      if (payload.name === 'stuck') await new Promise(() => {});
      return { ok: payload.name };
    },
  });

  store.create({ name: 'stuck' });
  store.create({ name: 'next' });
  await tick();
  assert.equal(store.get('job_stuck').status, 'running');
  assert.equal(store.get('job_next').status, 'pending');

  now += 101;
  const expired = store.get('job_stuck');
  assert.equal(expired.status, 'failed');
  assert.equal(expired.errorInfo.code, 'JOB_RUNNING_TIMEOUT');

  await tick();
  const next = store.get('job_next');
  assert.equal(next.status, 'completed');
  assert.deepEqual(next.result, { ok: 'next' });
  assert.deepEqual(started, ['stuck', 'next']);
});

test('background job cancellation removes pending queued jobs without running them', async () => {
  const ids = ['job_running', 'job_pending'];
  const started = [];
  let releaseRunning;
  const runningGate = new Promise((resolve) => { releaseRunning = resolve; });
  const store = createJobStore({
    idFactory: () => ids.shift(),
    maxConcurrency: 1,
    runner: async (payload) => {
      started.push(payload.name);
      if (payload.name === 'first') await runningGate;
      return { ok: true };
    },
  });

  store.create({ name: 'first' });
  store.create({ name: 'second' });
  await tick();
  assert.equal(store.get('job_running').status, 'running');
  assert.equal(store.get('job_pending').status, 'pending');

  const cancelled = store.cancel('job_pending');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelledAt > 0, true);
  assert.equal(cancelled.progress.at(-1).phase, 'job:cancelled');

  releaseRunning();
  await tick();
  assert.deepEqual(started, ['first']);
  assert.equal(store.get('job_pending').status, 'cancelled');
});

test('background job cancellation aborts running jobs and keeps cancelled status', async () => {
  let sawAbort = false;
  const store = createJobStore({
    idFactory: () => 'job_cancel_running',
    runner: async (_payload, _onProgress, signal) => {
      if (signal.aborted) throw signal.reason;
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          sawAbort = true;
          reject(signal.reason);
        }, { once: true });
      });
    },
  });

  store.create({ prompt: 'long task' });
  await tick();
  assert.equal(store.get('job_cancel_running').status, 'running');

  const cancelled = store.cancel('job_cancel_running');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.payload, undefined);
  await tick();

  const finalJob = store.get('job_cancel_running');
  assert.equal(sawAbort, true);
  assert.equal(finalJob.status, 'cancelled');
  assert.equal(finalJob.error, null);
});

test('background job cancellation is idempotent for completed jobs', async () => {
  const store = createJobStore({
    idFactory: () => 'job_done',
    runner: async () => ({ ok: true }),
  });

  store.create({});
  await tick();
  assert.equal(store.get('job_done').status, 'completed');

  const afterCancel = store.cancel('job_done');
  assert.equal(afterCancel.status, 'completed');
  assert.deepEqual(afterCancel.result, { ok: true });
});

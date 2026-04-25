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

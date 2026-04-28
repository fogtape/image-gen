import test from 'node:test';
import assert from 'node:assert/strict';

function installBrowserStubs() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  };
  globalThis.document = {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return {
        appendChild() {},
        classList: { add() {}, remove() {}, toggle() {} },
        dataset: {},
        setAttribute() {},
        style: {},
      };
    },
  };
  globalThis.window = { addEventListener() {} };
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => 'test-id' },
    });
  }
  globalThis.confirm = () => true;
  globalThis.alert = () => {};
}

async function loadAppForBehavior() {
  installBrowserStubs();
  const app = await import(`../app.js?compareBehavior=${Date.now()}`);
  const { state } = await import('../frontend/state.js');
  state.data = { activeId: 'active', accounts: [], useProxy: false };
  state.stoppedJobIds = new Set();
  localStorage.clear();
  return { app, state };
}

test('对比模式从初始禁用态开启时会应用默认账号选择，但保留用户已有选择', async () => {
  const { app } = await loadAppForBehavior();
  assert.equal(app.compareTargetCheckedState({ checked: false, disabled: true }, true, true, false), true);
  assert.equal(app.compareTargetCheckedState({ checked: false, disabled: true }, true, false, false), false);
  assert.equal(app.compareTargetCheckedState({ checked: true, disabled: true }, true, false, true), true);
  assert.equal(app.compareTargetCheckedState({ checked: false, disabled: false }, true, true, true), false);
});

test('OAuth 对比结果按目标账号更新，不再写入当前激活账号', async () => {
  const { app, state } = await loadAppForBehavior();
  const active = { id: 'active', type: 'oauth', name: 'Active' };
  const target = { id: 'target', type: 'oauth', name: 'Target' };
  state.data = { activeId: 'active', accounts: [active, target], useProxy: false };

  assert.equal(app.getOAuthResultAccount({ localAccountId: 'target' }), target);
  assert.equal(app.getOAuthResultAccount({}), active);
});

test('compare active jobs 会保存多个 jobId，并在完成后逐个清理', async () => {
  const { app, state } = await loadAppForBehavior();
  state.stoppedJobIds.add('job-a');
  state.stoppedJobIds.add('job-b');
  const common = { compareId: 'cmp-1', compareCount: 2, count: 1, format: 'png' };

  app.saveActiveCompareJob(common, { jobId: 'job-a', isOAuth: false, resultMeta: { compareIndex: 1 } });
  app.saveActiveCompareJob(common, { jobId: 'job-b', isOAuth: true, resultMeta: { compareIndex: 2 } });

  const active = JSON.parse(localStorage.getItem('img-gen-active-job'));
  assert.equal(active.type, 'compare');
  assert.equal(active.compareId, 'cmp-1');
  assert.deepEqual(active.jobs.map((job) => job.jobId).sort(), ['job-a', 'job-b']);
  assert.equal(state.stoppedJobIds.has('job-a'), false);
  assert.equal(state.stoppedJobIds.has('job-b'), false);

  app.clearFinishedCompareJob('job-a');
  assert.deepEqual(app.activeCompareJobs().map((job) => job.jobId), ['job-b']);

  app.clearFinishedCompareJob('job-b');
  assert.equal(localStorage.getItem('img-gen-active-job'), null);
});

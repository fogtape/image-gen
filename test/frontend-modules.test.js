import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

test('P3.1 前端入口改为无框架 ES module 拆分，低耦合能力不再堆在 app.js', () => {
  const app = read('app.js');
  const build = read('scripts/build-static.js');
  for (const modulePath of [
    'frontend/dom.js',
    'frontend/http.js',
    'frontend/state.js',
    'frontend/background-jobs.js',
    'frontend/error-dialog.js',
    'frontend/ui-actions.js',
  ]) {
    assert.ok(exists(modulePath), `${modulePath} should exist`);
  }
  assert.match(app, /from '\.\/frontend\/dom\.js'/);
  assert.match(app, /from '\.\/frontend\/http\.js'/);
  assert.match(app, /from '\.\/frontend\/state\.js'/);
  assert.match(app, /from '\.\/frontend\/background-jobs\.js'/);
  assert.match(app, /from '\.\/frontend\/error-dialog\.js'/);
  assert.match(app, /from '\.\/frontend\/ui-actions\.js'/);
  assert.doesNotMatch(app, /function fetchWithTimeout/);
  assert.doesNotMatch(app, /function showGenerationErrorDialog/);
  assert.doesNotMatch(app, /function createIconButton/);
  assert.doesNotMatch(app, /const state = \{/);
  assert.match(build, /directories = \['frontend'\]/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('设置面板提供最近成功链路诊断区', () => {
  assert.match(html, /id="storageDiagnostics"/);
  assert.match(app, /function renderStorageDiagnostics/);
  assert.match(app, /最近成功链路诊断/);
  const fn = app.match(/function renderStorageDiagnostics\(history = \[\]\) \{([\s\S]*?)\n\}\n\nasync function loadStorageStats/)?.[1] || '';
  assert.match(fn, /document\.createElement\('div'\)/);
  assert.match(fn, /labelEl\.textContent = label/);
  assert.match(fn, /valueEl\.textContent = String\(value\)/);
  assert.match(fn, /valueEl\.title = String\(value\)/);
  assert.match(fn, /panel\.replaceChildren\(title, list\)/);
  assert.doesNotMatch(fn, /innerHTML/);
  assert.doesNotMatch(fn, /\$\{rows\.map/);
  assert.match(css, /\.storage-diagnostics/);
  assert.match(css, /\.storage-diagnostics-item/);
});

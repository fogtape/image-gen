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
  assert.match(css, /\.storage-diagnostics/);
  assert.match(css, /\.storage-diagnostics-item/);
});

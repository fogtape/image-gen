import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const errorDialog = fs.readFileSync(new URL('../frontend/error-dialog.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('错误弹窗支持结构化分类、建议与调试详情', () => {
  assert.match(html, /id="generationErrorKind"/);
  assert.match(html, /id="generationErrorSuggestion"/);
  assert.match(html, /id="generationErrorDebug"/);
  assert.match(html, /id="generationErrorDebugText"/);
  assert.match(errorDialog, /function classifyGenerationError/);
  assert.match(errorDialog, /function normalizeErrorDialogPayload/);
  assert.match(errorDialog, /\$\('#generationErrorKind'\)\.textContent/);
  assert.match(errorDialog, /fallbackAttempted === true/);
  assert.match(errorDialog, /JOB_RUNNING_TIMEOUT/);
  assert.match(errorDialog, /后台任务超时/);
  assert.match(errorDialog, /showGenerationErrorDialog\(details\)/);
  assert.match(css, /\.error-dialog-kind/);
  assert.match(css, /\.error-dialog-debug-text/);
});

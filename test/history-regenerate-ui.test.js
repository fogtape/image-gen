import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('历史卡片支持复制提示词、重新生成和作为参考图继续', () => {
  const app = read('app.js');
  const css = read('style.css');

  assert.match(app, /function getHistoryGenerationSnapshot/);
  assert.match(app, /function restoreGenerationSnapshot/);
  assert.match(app, /async function regenerateFromHistory/);
  assert.match(app, /await generate\(\)/);
  assert.match(app, /async function addHistoryImageAsReference/);
  assert.match(app, /state\.refImagesBase64\.push\(base64\)/);
  assert.match(app, /renderRefPreviews\(\)/);
  assert.match(app, /async function copyPromptFromHistory/);
  assert.match(app, /copyTextToClipboard\(prompt\)/);
  assert.match(app, /history-regenerate-btn/);
  assert.match(app, /history-reference-btn/);
  assert.match(app, /history-copy-btn/);

  assert.match(css, /\.history-regenerate-btn/);
  assert.match(css, /\.history-reference-btn/);
  assert.match(css, /\.history-copy-btn/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Prompt 区域简化为提示词历史记录，并默认收进高级选项', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('style.css');

  for (const id of [
    'promptHistoryPanel',
    'promptHistorySelect',
    'savePromptHistory',
    'restorePromptBefore',
    'restorePromptAfter',
    'clearPromptHistory',
    'promptHistoryStatus',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  const advancedBlock = html.match(/<details class="advanced-panel">[\s\S]*?<\/details>/)?.[0] || '';
  assert.match(advancedBlock, /id="promptHistoryPanel"/);
  assert.doesNotMatch(advancedBlock, /id="comparePanel"|compareModeEnabled|compareTargetList/);
  assert.doesNotMatch(html, /promptTemplateName|promptTemplateTags|savePromptTemplate|exportPromptTemplates|importPromptTemplates/);
  assert.doesNotMatch(html, /Prompt 模板库|保存当前为模板|更新模板版本/);

  assert.match(app, /const PROMPT_HISTORY_KEY = 'img-gen-prompt-history'/);
  assert.match(app, /function sanitizePromptHistoryEntry/);
  assert.match(app, /function saveCurrentPromptToHistory/);
  assert.match(app, /function recordPromptHistory/);
  assert.match(app, /function applySelectedPromptHistory/);
  assert.match(app, /function restorePromptHistoryVersion/);
  assert.match(app, /function clearPromptHistory/);
  assert.match(app, /\$\('#promptHistorySelect'\)\?\.addEventListener\('change', \(\) => \{ try \{ applySelectedPromptHistory\(\);/);
  assert.match(app, /recordPromptHistory\(\{ source: prompt, final: enhanced/);
  assert.match(app, /recordPromptHistory\(\{ source: prompt, final: finalPrompt/);
  assert.doesNotMatch(app, /PROMPT_TEMPLATES_KEY|function sanitizePromptTemplate|saveCurrentPromptAsTemplate|exportPromptTemplates/);

  assert.match(css, /\.prompt-history-panel/);
  assert.match(css, /\.prompt-history-row/);
  assert.doesNotMatch(css, /\.prompt-template-panel|\.prompt-template-actions/);
});

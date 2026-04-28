import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Prompt 模板库支持保存、应用、版本历史和安全导入导出', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('style.css');

  for (const id of [
    'promptTemplatePanel',
    'promptTemplateName',
    'promptTemplateTags',
    'promptTemplateSelect',
    'savePromptTemplate',
    'applyPromptTemplate',
    'appendPromptTemplate',
    'updatePromptTemplate',
    'deletePromptTemplate',
    'exportPromptTemplates',
    'importPromptTemplates',
    'promptHistorySelect',
    'restorePromptBefore',
    'restorePromptAfter',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(app, /const PROMPT_TEMPLATES_KEY = 'img-gen-prompt-templates'/);
  assert.match(app, /const PROMPT_HISTORY_KEY = 'img-gen-prompt-history'/);
  assert.match(app, /function sanitizePromptTemplate/);
  assert.match(app, /function saveCurrentPromptAsTemplate/);
  assert.match(app, /function updateSelectedPromptTemplate/);
  assert.match(app, /function applyPromptTemplate/);
  assert.match(app, /function exportPromptTemplates/);
  assert.match(app, /async function importPromptTemplatesFromFile/);
  assert.match(app, /function recordPromptHistory/);
  assert.match(app, /function restorePromptHistoryVersion/);
  assert.match(app, /recordPromptHistory\(\{ source: prompt, final: enhanced/);
  assert.match(app, /recordPromptHistory\(\{ source: prompt, final: finalPrompt/);

  const exportFn = app.match(/function exportPromptTemplates\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(exportFn, /ACCOUNTS_KEY|apiKey|accessToken|refreshToken|openaiSessionId|CONFIG_ADMIN_TOKEN_KEY/);

  assert.match(css, /\.prompt-template-panel/);
  assert.match(css, /\.prompt-template-actions/);
  assert.match(css, /\.prompt-history-row/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../ui-feedback.js', import.meta.url), 'utf8');

test('长时间等待提示 30 秒后再出现且不轮换', () => {
  assert.match(app, /function startWaitingStatusSequence\(delayMs = 30000\)/);
  assert.match(app, /setTimeout\(\(\) => \{/);
  assert.doesNotMatch(app, /setInterval\(\(\) => \{\s*setGenerationStatus\(getWaitingProgressMessage/s);
  assert.match(ui, /LONG_WAIT_PROGRESS_MESSAGE = '仍在生成，请耐心等待'/);
});

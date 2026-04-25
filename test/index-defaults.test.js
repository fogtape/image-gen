import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('默认尺寸选择自动', () => {
  const selectMatch = html.match(/<div class="custom-select" id="sizeSelect" data-value="([^"]+)">\s*<button class="cs-trigger" type="button">([^<]+)<\/button>/);
  assert.ok(selectMatch, 'sizeSelect custom select should exist');
  assert.equal(selectMatch[1], 'auto');
  assert.equal(selectMatch[2], '自动');
});

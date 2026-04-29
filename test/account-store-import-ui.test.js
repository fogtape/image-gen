import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('设置中心提供浏览器账号迁移到服务端的清晰入口', () => {
  assert.match(html, /id="migrateBrowserAccountsBtn"/);
  assert.match(html, /迁移当前浏览器账号到服务端/);
  assert.match(html, /id="accountMigrationStatus"/);

  assert.match(app, /async function migrateBrowserAccountsToServer\(/);
  assert.match(app, /adminFetch\('\/api\/accounts\/import-local'/);
  assert.match(app, /state\.data\.accounts\.map\(compactServerAccountPayload\)/);
  assert.match(app, /migrateBrowserAccountsBtn/);
  assert.match(app, /accountMigrationStatus/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('账号管理前端在可用且已登录管理员时优先同步服务端账号 CRUD API', () => {
  assert.match(app, /function canUseServerAccountStore\(\)/);
  assert.match(app, /async function listServerAccounts\(/);
  assert.match(app, /function mergeServerAccountsIntoLocal\(/);
  assert.match(app, /async function loadServerAccountsIntoLocal\(/);
  assert.match(app, /async function createServerAccount\(/);
  assert.match(app, /async function patchServerAccount\(/);
  assert.match(app, /async function deleteServerAccountOnServer\(/);
  assert.match(app, /adminFetch\('\/api\/accounts', \{\s*method: 'GET'/s);
  assert.match(app, /adminFetch\('\/api\/accounts'/);
  assert.match(app, /adminFetch\(`\/api\/accounts\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(app, /method: 'POST'/);
  assert.match(app, /method: 'PATCH'/);
  assert.match(app, /method: 'DELETE'/);
  assert.match(app, /addAccount\(account, \{ syncServer: false \}\)/);
  assert.match(app, /updateAccount\(id, fields, \{ syncServer: false \}\)/);
  assert.match(app, /await loadServerAccountsIntoLocal\(/);
});

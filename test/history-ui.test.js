import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('前端提供历史搜索、收藏筛选、收藏切换和单图删除入口', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('style.css');

  assert.match(html, /id="historyToolbar"/);
  assert.match(html, /id="historySearch"/);
  assert.match(html, /id="historyFavoriteOnly"/);
  assert.match(html, /id="historyRefresh"/);
  assert.match(html, /id="historyStatus"/);

  assert.match(app, /function canUseStorageApi/);
  assert.match(app, /async function fetchImageHistory/);
  assert.match(app, /\/api\/storage\/history\?\$\{params\.toString\(\)\}/);
  assert.match(app, /async function patchStoredImageMeta/);
  assert.match(app, /\/api\/images\/\$\{encodeURIComponent\(id\)\}\/meta/);
  assert.match(app, /async function deleteStoredImage/);
  assert.match(app, /method: 'DELETE'/);
  assert.match(app, /function appendHistoryActions/);
  assert.match(app, /createButton\(\{\s*className: 'btn btn-ghost history-copy-btn'/);
  assert.match(app, /confirmAction\('确定删除这张历史图片/);
  assert.match(app, /favorite-btn/);
  assert.match(app, /card-delete-btn/);
  assert.match(app, /historySearchTimer/);

  assert.match(css, /\.history-toolbar/);
  assert.match(css, /\.history-search/);
  assert.match(css, /\.history-status/);
  assert.match(css, /\.favorite-btn\.active/);
  assert.match(css, /\.card-delete-btn/);
});

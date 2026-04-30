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

test('云平台或直连降级时生成结果会保存到浏览器本地历史，刷新后可恢复', () => {
  const app = read('app.js');

  assert.match(app, /LOCAL_IMAGE_HISTORY_DB/);
  assert.match(app, /async function saveLocalImageResult/);
  assert.match(app, /async function loadLocalImageHistory/);
  assert.match(app, /function shouldPersistClientImageResult/);
  assert.match(app, /state\.appSettings\.storage\.enabled !== false/);
  assert.match(app, /meta\.persisted === false/);
  assert.match(app, /!!meta\.storageError/);
  assert.match(app, /function persistClientResultIfNeeded\(src, format, meta = \{\}, card = null, actions = null\)/);
  assert.match(app, /persistClientHistory: true/);
  assert.match(app, /job\.serverless === true/);
  assert.match(app, /const baseResultMeta = \{/);
  assert.match(app, /generation:\s*\{[\s\S]*prompt,[\s\S]*size:[\s\S]*format:[\s\S]*mode,[\s\S]*model:[\s\S]*hasRef,/);
  assert.match(app, /if \(!canUseStorageApi\(\)\) \{[\s\S]*await loadLocalImageHistory\(\{ replace: false \}\);[\s\S]*return;/);
  assert.match(app, /if \(!canUseStorageApi\(\)\) \{[\s\S]*fetchLocalImageHistory\(filters\)[\s\S]*renderHistoryResults/s);
  assert.match(app, /isLocalImageHistoryItem\(meta\)/);
  assert.match(app, /deleteLocalImage\(meta\.id\)/);
});


test('纯静态部署没有 runtime/storage API 时刷新也会读取浏览器本地历史', () => {
  const app = read('app.js');

  assert.match(app, /function isRuntimeConfigPayload/);
  assert.match(app, /function markRuntimeApisUnavailable/);
  assert.match(app, /if \(!isRuntimeConfigPayload\(data\)\) throw new Error\('Runtime config API unavailable'\)/);
  assert.match(app, /state\.serverCapabilities = \{[\s\S]*canUseStorageApi: false[\s\S]*canPersistImages: false[\s\S]*canUseBackgroundJobs: false/s);
  assert.match(app, /catch \(e\) \{[\s\S]*markRuntimeApisUnavailable\(\)[\s\S]*Failed to load server runtime config/s);
  assert.match(app, /if \(!canUseStorageApi\(\)\) \{[\s\S]*await loadLocalImageHistory\(\{ replace: false \}\);[\s\S]*return;/);
});

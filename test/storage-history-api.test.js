import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-storage-history-api-'));
const adminToken = 'test-admin-token-storage-history-api';

process.env.VERCEL = '1';
process.env.IMAGE_GEN_DATA_DIR = dataDir;
process.env.IMAGE_GEN_ADMIN_TOKEN = adminToken;
delete process.env.IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN;

function seedHistory() {
  const imagesDir = path.join(dataDir, 'images', '2026-04');
  fs.mkdirSync(imagesDir, { recursive: true });
  const catPath = path.join('images', '2026-04', 'img_api_cat.png');
  const lakePath = path.join('images', '2026-04', 'img_api_lake.png');
  fs.writeFileSync(path.join(dataDir, catPath), ONE_BY_ONE_PNG);
  fs.writeFileSync(path.join(dataDir, lakePath), ONE_BY_ONE_PNG);
  const now = new Date('2026-04-28T03:30:00Z').getTime();
  fs.writeFileSync(path.join(dataDir, 'image-store.json'), JSON.stringify({
    version: 1,
    images: [
      {
        id: 'img_api_cat',
        url: '/api/images/img_api_cat',
        format: 'png',
        mime: 'image/png',
        bytes: ONE_BY_ONE_PNG.length,
        prompt: 'orange cat in neon city',
        relativePath: catPath,
        createdAt: now,
        favorite: true,
        tags: ['cat', 'neon'],
        model: 'gpt-image-2',
        accountHost: 'api.openai.com',
        batchId: 'batch_api',
        batchIndex: 1,
        batchCount: 2,
      },
      {
        id: 'img_api_lake',
        url: '/api/images/img_api_lake',
        format: 'png',
        mime: 'image/png',
        bytes: ONE_BY_ONE_PNG.length,
        prompt: 'quiet mountain lake',
        relativePath: lakePath,
        createdAt: now - 1000,
        favorite: false,
        tags: ['landscape'],
        model: 'gpt-image-2',
        accountHost: 'relay.example.test',
      },
    ],
  }, null, 2));
  return { catPath: path.join(dataDir, catPath), lakePath: path.join(dataDir, lakePath) };
}

const seeded = seedHistory();
const { server } = await import('../server.js');

async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { resp, text, data };
}

test('历史 API 支持搜索、收藏筛选、单图 meta 更新和单图删除', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const options = await fetch(`${base}/api/storage/history`, { method: 'OPTIONS' });
    assert.match(options.headers.get('access-control-allow-methods') || '', /PATCH/);
    assert.match(options.headers.get('access-control-allow-methods') || '', /DELETE/);

    const catSearch = await jsonFetch(`${base}/api/storage/history?query=cat&limit=10`);
    assert.equal(catSearch.resp.status, 200);
    assert.equal(catSearch.data.total, 1);
    assert.equal(catSearch.data.history[0].id, 'img_api_cat');
    assert.equal(catSearch.data.history[0].favorite, true);
    assert.deepEqual(catSearch.data.history[0].tags, ['cat', 'neon']);
    assert.equal(catSearch.data.history[0].batchId, 'batch_api');

    const favoriteSearch = await jsonFetch(`${base}/api/storage/history?favorite=true`);
    assert.equal(favoriteSearch.data.total, 1);
    assert.equal(favoriteSearch.data.history[0].id, 'img_api_cat');

    const noTokenPatch = await jsonFetch(`${base}/api/images/img_api_cat/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: false }),
    });
    assert.equal(noTokenPatch.resp.status, 401);
    assert.equal(fs.existsSync(seeded.catPath), true);
    assert.doesNotMatch(noTokenPatch.text, new RegExp(adminToken));

    const patch = await jsonFetch(`${base}/api/images/img_api_cat/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Image-Gen-Admin-Token': adminToken },
      body: JSON.stringify({ favorite: false, tags: ['portrait', 'portrait', 'cat'] }),
    });
    assert.equal(patch.resp.status, 200);
    assert.equal(patch.data.ok, true);
    assert.equal(patch.data.image.favorite, false);
    assert.deepEqual(patch.data.image.tags, ['portrait', 'cat']);
    assert.equal((await jsonFetch(`${base}/api/storage/history?favorite=true`)).data.total, 0);

    const noTokenDelete = await jsonFetch(`${base}/api/images/img_api_cat`, {
      method: 'DELETE',
    });
    assert.equal(noTokenDelete.resp.status, 401);
    assert.equal(fs.existsSync(seeded.catPath), true);
    assert.doesNotMatch(noTokenDelete.text, new RegExp(adminToken));

    const wrongHeaderDelete = await jsonFetch(`${base}/api/images/img_api_cat`, {
      method: 'DELETE',
      headers: { 'X-Image-Gen-Admin-Token': 'wrong-token' },
    });
    assert.equal(wrongHeaderDelete.resp.status, 401);
    assert.equal(fs.existsSync(seeded.catPath), true);
    assert.doesNotMatch(wrongHeaderDelete.text, new RegExp(adminToken));

    const deleted = await jsonFetch(`${base}/api/images/img_api_cat`, {
      method: 'DELETE',
      headers: { 'X-Image-Gen-Admin-Token': adminToken },
    });
    assert.equal(deleted.resp.status, 200);
    assert.equal(deleted.data.ok, true);
    assert.equal(deleted.data.deleted, true);
    assert.equal(fs.existsSync(seeded.catPath), false);
    assert.equal(fs.existsSync(seeded.lakePath), true);

    const imageAfterDelete = await jsonFetch(`${base}/api/images/img_api_cat`);
    assert.equal(imageAfterDelete.resp.status, 404);
    assert.equal((await jsonFetch(`${base}/api/storage/history?query=cat`)).data.total, 0);
    assert.equal((await jsonFetch(`${base}/api/storage/history?query=mountain`)).data.total, 1);

    const legacyBodyTokenDelete = await jsonFetch(`${base}/api/images/img_api_lake`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken }),
    });
    assert.equal(legacyBodyTokenDelete.resp.status, 200);
    assert.equal(legacyBodyTokenDelete.data.ok, true);
    assert.equal(legacyBodyTokenDelete.data.deleted, true);
    assert.equal(fs.existsSync(seeded.lakePath), false);
    assert.equal((await jsonFetch(`${base}/api/storage/history?query=mountain`)).data.total, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

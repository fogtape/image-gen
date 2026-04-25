import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createImageStore } from '../image-storage.js';

const ONE_BY_ONE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('图片存储把生成结果落盘为挂载目录文件并写入轻量元数据', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-'));
  const store = createImageStore({ dataDir: dir, now: () => new Date('2026-04-25T11:32:00Z').getTime() });

  const result = await store.persistGenerationResult({
    created: 123,
    data: [{ b64_json: ONE_BY_ONE_PNG }],
  }, {
    prompt: 'test prompt',
    format: 'png',
    watermarkSettings: { enabled: false },
  });

  assert.equal(result.data.length, 1);
  assert.ok(result.data[0].id);
  assert.match(result.data[0].url, /^\/api\/images\//);
  assert.equal(result.data[0].b64_json, undefined);

  const stats = store.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.history.length, 1);
  assert.equal(stats.history[0].prompt, 'test prompt');
  assert.ok(fs.existsSync(path.join(dir, 'image-store.json')));
  assert.ok(fs.existsSync(path.join(dir, stats.history[0].relativePath)));
});

test('图片存储清理图片和全部数据时只删除数据目录内文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-clear-'));
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
  fs.writeFileSync(outside, 'keep');
  const store = createImageStore({ dataDir: dir });

  await store.persistGenerationResult({ data: [{ b64_json: ONE_BY_ONE_PNG }] }, { format: 'png', watermarkSettings: { enabled: false } });
  assert.equal(store.getStats().count, 1);

  const imagesCleared = store.clear('images');
  assert.equal(imagesCleared.ok, true);
  assert.equal(store.getStats().count, 0);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');

  await store.persistGenerationResult({ data: [{ b64_json: ONE_BY_ONE_PNG }] }, { format: 'png', watermarkSettings: { enabled: false } });
  const allCleared = store.clear('all');
  assert.equal(allCleared.ok, true);
  assert.equal(store.getStats().count, 0);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');

  fs.unlinkSync(outside);
});

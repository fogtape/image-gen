import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createImageStore } from '../image-storage.js';

const ONE_BY_ONE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('图片存储把生成结果落盘为挂载目录文件并写入轻量元数据', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-'));
  const store = createImageStore({
    dataDir: dir,
    now: () => new Date('2026-04-25T11:32:00Z').getTime(),
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });

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
  assert.equal(result.data[0].persisted, true);

  const stats = store.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.history.length, 1);
  assert.equal(stats.history[0].prompt, 'test prompt');
  assert.ok(fs.existsSync(path.join(dir, 'image-store.json')));
  assert.ok(fs.existsSync(path.join(dir, stats.history[0].relativePath)));
});

test('图片索引并发保存不丢记录，索引文件始终是合法 JSON 且无临时文件残留', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-concurrent-'));
  let id = 0;
  const store = createImageStore({
    dataDir: dir,
    now: () => new Date('2026-04-25T11:32:00Z').getTime(),
    idFactory: () => `img_concurrent_${++id}`,
    bufferTransformer: async (buffer) => {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
      return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    },
  });

  await Promise.all(Array.from({ length: 20 }, (_, index) => store.persistGenerationResult({
    created: index,
    data: [{ b64_json: ONE_BY_ONE_PNG }],
  }, {
    prompt: `concurrent prompt ${index}`,
    format: 'png',
    watermarkSettings: { enabled: false },
  })));

  const indexFile = path.join(dir, 'image-store.json');
  const parsed = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  assert.equal(parsed.images.length, 20);
  assert.equal(store.getStats().count, 20);
  assert.deepEqual(
    new Set(parsed.images.map((item) => item.prompt)),
    new Set(Array.from({ length: 20 }, (_, index) => `concurrent prompt ${index}`)),
  );
  for (const record of parsed.images) {
    assert.ok(fs.existsSync(path.join(dir, record.relativePath)));
  }
  const tempFiles = fs.readdirSync(dir).filter((name) => name.includes('image-store.json') && name.endsWith('.tmp'));
  assert.deepEqual(tempFiles, []);
});

test('图片历史会保存并公开批量生成 batch 元数据', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-batch-'));
  let id = 0;
  const store = createImageStore({
    dataDir: dir,
    now: () => new Date('2026-04-25T11:32:00Z').getTime(),
    idFactory: () => `img_batch_${++id}`,
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });

  const result = await store.persistGenerationResult({
    data: [
      { b64_json: ONE_BY_ONE_PNG },
      { b64_json: ONE_BY_ONE_PNG },
      { b64_json: ONE_BY_ONE_PNG, batchIndex: 3 },
    ],
  }, {
    prompt: 'batch prompt',
    format: 'png',
    batchId: 'batch_20260428',
    batchCount: 3,
    watermarkSettings: { enabled: false },
  });

  assert.equal(result.data.length, 3);
  assert.deepEqual(result.data.map((item) => item.batchId), ['batch_20260428', 'batch_20260428', 'batch_20260428']);
  assert.deepEqual(result.data.map((item) => item.batchIndex), [1, 2, 3]);
  assert.deepEqual(result.data.map((item) => item.batchCount), [3, 3, 3]);

  const stats = store.getStats();
  assert.equal(stats.count, 3);
  assert.deepEqual(stats.history.map((item) => item.batchId), ['batch_20260428', 'batch_20260428', 'batch_20260428']);
  assert.deepEqual(new Set(stats.history.map((item) => item.batchCount)), new Set([3]));
  assert.deepEqual(new Set(stats.history.map((item) => item.batchIndex)), new Set([1, 2, 3]));
});

test('图片历史支持搜索、收藏元数据、标签净化和单图删除', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-history-'));
  let id = 0;
  const store = createImageStore({
    dataDir: dir,
    now: () => new Date('2026-04-25T11:32:00Z').getTime() + id,
    idFactory: () => `img_history_${++id}`,
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });

  await store.persistGenerationResult({ data: [{ b64_json: ONE_BY_ONE_PNG }] }, {
    prompt: 'orange cat in neon city',
    format: 'png',
    favorite: true,
    tags: ['cat', 'neon', 'cat', ''],
    model: 'gpt-image-2',
    accountName: '  Main   Account  ',
    accountHost: 'https://api.openai.com/v1?token=secret',
    size: '1024x1024',
    quality: 'medium',
    background: 'auto',
    mode: 'images',
    hasRef: false,
    batchId: 'batch_history_a',
    watermarkSettings: { enabled: false },
  });
  await store.persistGenerationResult({ data: [{ b64_json: ONE_BY_ONE_PNG }] }, {
    prompt: 'quiet mountain lake',
    format: 'png',
    favorite: false,
    tags: ['landscape'],
    model: 'gpt-image-2',
    accountHost: 'relay.example.test',
    watermarkSettings: { enabled: false },
  });

  const cat = store.listHistory({ query: 'cat' });
  assert.equal(cat.total, 1);
  assert.equal(cat.history[0].prompt, 'orange cat in neon city');
  assert.equal(cat.history[0].favorite, true);
  assert.deepEqual(cat.history[0].tags, ['cat', 'neon']);
  assert.equal(cat.history[0].accountName, 'Main Account');
  assert.equal(cat.history[0].accountHost, 'api.openai.com');
  assert.equal(cat.history[0].model, 'gpt-image-2');
  assert.deepEqual(cat.history[0].generation, {
    prompt: 'orange cat in neon city',
    size: '1024x1024',
    quality: 'medium',
    format: 'png',
    background: 'auto',
    mode: 'images',
    model: 'gpt-image-2',
    hasRef: false,
  });

  const favorite = store.listHistory({ favorite: true });
  assert.equal(favorite.total, 1);
  assert.equal(favorite.history[0].id, cat.history[0].id);

  const updated = await store.updateMeta(cat.history[0].id, { favorite: false, tags: 'hero, hero, portrait' });
  assert.equal(updated.favorite, false);
  assert.deepEqual(updated.tags, ['hero', 'portrait']);
  assert.equal(store.listHistory({ favorite: true }).total, 0);
  assert.equal(store.listHistory({ query: 'portrait' }).history[0].id, cat.history[0].id);

  const beforeDelete = store.getStats();
  const deletedPath = path.join(dir, beforeDelete.history.find((item) => item.id === cat.history[0].id).relativePath);
  const deleted = await store.deleteImage(cat.history[0].id);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.missingFile, false);
  assert.equal(fs.existsSync(deletedPath), false);
  assert.equal(store.getStats().count, 1);
  assert.equal(store.listHistory({ query: 'cat' }).total, 0);
  assert.equal(store.listHistory({ query: 'mountain' }).total, 1);
});

test('图片持久化失败会返回结构化脱敏错误而不是静默吞掉', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-failure-'));
  const store = createImageStore({
    dataDir: dir,
    bufferTransformer: async () => {
      throw new Error('disk denied token=secret-token-value Authorization Bearer abcdefghijklmnop sk-testsecret123456');
    },
  });

  const result = await store.persistGenerationResult({
    data: [{ b64_json: ONE_BY_ONE_PNG }],
  }, {
    prompt: 'failure prompt',
    format: 'png',
    watermarkSettings: { enabled: false },
  });

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].persisted, false);
  assert.equal(result.data[0].b64_json, ONE_BY_ONE_PNG);
  assert.match(result.data[0].storageError?.message || '', /disk denied/);
  assert.doesNotMatch(result.data[0].storageError?.message || '', /secret-token-value|abcdefghijklmnop|sk-testsecret123456/);
  assert.equal(store.getStats().count, 0);
});

test('远程图片 URL 下载成功时校验 content-type 并落盘', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-remote-ok-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from(ONE_BY_ONE_PNG, 'base64'), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(Buffer.from(ONE_BY_ONE_PNG, 'base64').length) },
  });
  const store = createImageStore({
    dataDir: dir,
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });
  try {
    const result = await store.persistGenerationResult({
      data: [{ url: 'https://images.example/generated.png' }],
    }, { format: 'png', watermarkSettings: { enabled: false } });
    assert.equal(result.data[0].persisted, true);
    assert.match(result.data[0].url, /^\/api\/images\//);
    assert.equal(store.getStats().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('远程图片 URL 下载会拒绝私网地址、非图片类型、超大内容和超时', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-remote-guard-'));
  const originalFetch = globalThis.fetch;
  const originalMax = process.env.IMAGE_GEN_REMOTE_IMAGE_MAX_BYTES;
  const originalTimeout = process.env.IMAGE_GEN_REMOTE_IMAGE_TIMEOUT_MS;
  const store = createImageStore({
    dataDir: dir,
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });

  try {
    let fetchHits = 0;
    globalThis.fetch = async () => {
      fetchHits += 1;
      return new Response('nope', { status: 200, headers: { 'Content-Type': 'image/png' } });
    };
    const privateResult = await store.persistGenerationResult({ data: [{ url: 'https://127.0.0.1/private.png' }] }, { format: 'png' });
    assert.equal(privateResult.data[0].persisted, false);
    assert.match(privateResult.data[0].storageError?.message || '', /host is not allowed/);
    assert.equal(fetchHits, 0);

    globalThis.fetch = async () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    const htmlResult = await store.persistGenerationResult({ data: [{ url: 'https://images.example/not-image' }] }, { format: 'png' });
    assert.equal(htmlResult.data[0].persisted, false);
    assert.match(htmlResult.data[0].storageError?.message || '', /Unsupported image content type/);

    process.env.IMAGE_GEN_REMOTE_IMAGE_MAX_BYTES = '1024';
    globalThis.fetch = async () => new Response('x', { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '2048' } });
    const largeResult = await store.persistGenerationResult({ data: [{ url: 'https://images.example/large.png' }] }, { format: 'png' });
    assert.equal(largeResult.data[0].persisted, false);
    assert.match(largeResult.data[0].storageError?.message || '', /too large/);

    process.env.IMAGE_GEN_REMOTE_IMAGE_TIMEOUT_MS = '100';
    globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
    const timeoutResult = await store.persistGenerationResult({ data: [{ url: 'https://images.example/slow.png' }] }, { format: 'png' });
    assert.equal(timeoutResult.data[0].persisted, false);
    assert.match(timeoutResult.data[0].storageError?.message || '', /timed out/);
  } finally {
    if (originalMax === undefined) delete process.env.IMAGE_GEN_REMOTE_IMAGE_MAX_BYTES;
    else process.env.IMAGE_GEN_REMOTE_IMAGE_MAX_BYTES = originalMax;
    if (originalTimeout === undefined) delete process.env.IMAGE_GEN_REMOTE_IMAGE_TIMEOUT_MS;
    else process.env.IMAGE_GEN_REMOTE_IMAGE_TIMEOUT_MS = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});

test('远程图片 URL 下载逐跳校验重定向', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-remote-redirect-'));
  const originalFetch = globalThis.fetch;
  const originalRedirects = process.env.IMAGE_GEN_REMOTE_IMAGE_MAX_REDIRECTS;
  const pngBuffer = Buffer.from(ONE_BY_ONE_PNG, 'base64');
  const store = createImageStore({
    dataDir: dir,
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });

  try {
    const requested = [];
    globalThis.fetch = async (url, options = {}) => {
      requested.push({ url: String(url), redirect: options.redirect });
      if (String(url) === 'https://images.example/start.png') {
        return new Response('', { status: 302, headers: { Location: '/final.png' } });
      }
      return new Response(pngBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(pngBuffer.length) },
      });
    };
    const ok = await store.persistGenerationResult({ data: [{ url: 'https://images.example/start.png' }] }, { format: 'png' });
    assert.equal(ok.data[0].persisted, true);
    assert.deepEqual(requested.map((item) => item.url), [
      'https://images.example/start.png',
      'https://images.example/final.png',
    ]);
    assert.deepEqual(requested.map((item) => item.redirect), ['manual', 'manual']);

    requested.length = 0;
    globalThis.fetch = async (url, options = {}) => {
      requested.push({ url: String(url), redirect: options.redirect });
      return new Response('', { status: 302, headers: { Location: 'https://127.0.0.1/private.png' } });
    };
    const privateRedirect = await store.persistGenerationResult({ data: [{ url: 'https://images.example/private-redirect.png' }] }, { format: 'png' });
    assert.equal(privateRedirect.data[0].persisted, false);
    assert.match(privateRedirect.data[0].storageError?.message || '', /host is not allowed/);
    assert.deepEqual(requested.map((item) => item.url), ['https://images.example/private-redirect.png']);

    globalThis.fetch = async () => new Response('', { status: 302, headers: { Location: 'http://images.example/insecure.png' } });
    const httpRedirect = await store.persistGenerationResult({ data: [{ url: 'https://images.example/http-redirect.png' }] }, { format: 'png' });
    assert.equal(httpRedirect.data[0].persisted, false);
    assert.match(httpRedirect.data[0].storageError?.message || '', /protocol is not allowed/);

    globalThis.fetch = async () => new Response('', { status: 302 });
    const missingLocation = await store.persistGenerationResult({ data: [{ url: 'https://images.example/missing-location.png' }] }, { format: 'png' });
    assert.equal(missingLocation.data[0].persisted, false);
    assert.match(missingLocation.data[0].storageError?.message || '', /redirect location is missing/);

    process.env.IMAGE_GEN_REMOTE_IMAGE_MAX_REDIRECTS = '1';
    globalThis.fetch = async (url) => {
      const next = String(url).endsWith('/a.png') ? '/b.png' : '/c.png';
      return new Response('', { status: 302, headers: { Location: next } });
    };
    const loop = await store.persistGenerationResult({ data: [{ url: 'https://images.example/a.png' }] }, { format: 'png' });
    assert.equal(loop.data[0].persisted, false);
    assert.match(loop.data[0].storageError?.message || '', /redirect limit exceeded/);
  } finally {
    if (originalRedirects === undefined) delete process.env.IMAGE_GEN_REMOTE_IMAGE_MAX_REDIRECTS;
    else process.env.IMAGE_GEN_REMOTE_IMAGE_MAX_REDIRECTS = originalRedirects;
    globalThis.fetch = originalFetch;
  }
});

test('图片存储清理图片和全部数据时只删除数据目录内文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-clear-'));
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
  fs.writeFileSync(outside, 'keep');
  const store = createImageStore({
    dataDir: dir,
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });

  await store.persistGenerationResult({ data: [{ b64_json: ONE_BY_ONE_PNG }] }, { format: 'png', watermarkSettings: { enabled: false } });
  assert.equal(store.getStats().count, 1);

  const conversationsCleared = store.clear('conversations');
  assert.equal(conversationsCleared.ok, true);
  assert.equal(conversationsCleared.count, 1);
  assert.deepEqual(conversationsCleared.cleared, []);
  assert.equal(conversationsCleared.skipped[0].reason, 'browser_only');
  assert.equal(store.getStats().count, 1);

  const imagesCleared = store.clear('images');
  assert.equal(imagesCleared.ok, true);
  assert.deepEqual(imagesCleared.cleared, ['images']);
  assert.equal(imagesCleared.removedImages, 1);
  assert.deepEqual(imagesCleared.skipped, []);
  assert.equal(store.getStats().count, 0);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');

  await store.persistGenerationResult({ data: [{ b64_json: ONE_BY_ONE_PNG }] }, { format: 'png', watermarkSettings: { enabled: false } });
  const allCleared = store.clear('all');
  assert.equal(allCleared.ok, true);
  assert.deepEqual(allCleared.cleared, ['images']);
  assert.equal(allCleared.skipped[0].scope, 'conversations');
  assert.equal(allCleared.skipped[0].reason, 'browser_only');
  assert.equal(store.getStats().count, 0);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');

  fs.unlinkSync(outside);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createImageStore } from '../image-storage.js';

const ONE_BY_ONE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('历史记录保留最近成功链路 trace 与 batch 元数据且 API 地址只暴露 host', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-trace-'));
  const store = createImageStore({
    dataDir: dir,
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });

  await store.persistGenerationResult({ data: [{ b64_json: ONE_BY_ONE_PNG }] }, {
    format: 'png',
    prompt: 'trace test',
    batchId: 'batch-trace-1',
    batchIndex: 1,
    batchCount: 2,
    model: 'gpt-image-2',
    accountName: 'Main account',
    accountHost: 'https://demo.example.com/v1?token=secret',
    size: '1024x1536',
    quality: 'high',
    background: 'transparent',
    mode: 'edits',
    hasRef: true,
    watermarkSettings: { enabled: false },
    trace: {
      mode: 'edits',
      protocol: 'images-multipart',
      flow: 'chatgpt-web',
      phase: 'oauth:download',
      phases: ['oauth:bootstrap', 'oauth:download', 'oauth:download'],
      endpoint: '/v1/images/edits',
      compatMode: true,
      fallbackAttempted: true,
      hasRef: true,
      apiUrl: 'https://demo.example.com/v1?token=secret',
    },
  });

  const stats = store.getStats();
  assert.equal(stats.history.length, 1);
  assert.equal(stats.history[0].batchId, 'batch-trace-1');
  assert.equal(stats.history[0].batchIndex, 1);
  assert.equal(stats.history[0].batchCount, 2);
  assert.equal(stats.history[0].model, 'gpt-image-2');
  assert.equal(stats.history[0].accountName, 'Main account');
  assert.equal(stats.history[0].accountHost, 'demo.example.com');
  assert.doesNotMatch(JSON.stringify(stats.history[0]), /token=secret/);
  assert.deepEqual(stats.history[0].generation, {
    prompt: 'trace test',
    size: '1024x1536',
    quality: 'high',
    format: 'png',
    background: 'transparent',
    mode: 'edits',
    model: 'gpt-image-2',
    hasRef: true,
  });
  assert.deepEqual(stats.history[0].trace, {
    mode: 'edits',
    protocol: 'images-multipart',
    flow: 'chatgpt-web',
    phase: 'oauth:download',
    phases: ['oauth:bootstrap', 'oauth:download'],
    endpoint: '/v1/images/edits',
    compatMode: true,
    fallbackAttempted: true,
    hasRef: true,
    apiHost: 'demo.example.com',
  });
});

test('服务端 OAuth 图生图 trace 会记录 ChatGPT Web flow 和阶段', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /trace\.flow = 'chatgpt-web'/);
  assert.match(server, /trace\.phase = phase/);
  assert.match(server, /trace\.phases\.push\(phase\)/);
});

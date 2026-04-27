import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createImageStore } from '../image-storage.js';

const ONE_BY_ONE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('历史记录保留最近成功链路 trace 元数据且 API 地址只暴露 host', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-trace-'));
  const store = createImageStore({
    dataDir: dir,
    bufferTransformer: async (buffer) => Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });

  await store.persistGenerationResult({ data: [{ b64_json: ONE_BY_ONE_PNG }] }, {
    format: 'png',
    prompt: 'trace test',
    watermarkSettings: { enabled: false },
    trace: {
      mode: 'edits',
      protocol: 'images-multipart',
      endpoint: '/v1/images/edits',
      compatMode: true,
      fallbackAttempted: true,
      hasRef: true,
      apiUrl: 'https://demo.example.com/v1?token=secret',
    },
  });

  const stats = store.getStats();
  assert.equal(stats.history.length, 1);
  assert.deepEqual(stats.history[0].trace, {
    mode: 'edits',
    protocol: 'images-multipart',
    endpoint: '/v1/images/edits',
    compatMode: true,
    fallbackAttempted: true,
    hasRef: true,
    apiHost: 'demo.example.com',
  });
});

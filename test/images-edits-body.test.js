import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImagesApiBody, toImageDataUrl } from '../server.js';

test('Images edits body 同时提供 images[].image_url，兼容要求 image_url 的 API 站点', () => {
  const body = buildImagesApiBody({
    mode: 'edits',
    prompt: '把这张图修清晰一点',
    cfg: { model: 'gpt-image-2' },
    refImagesBase64: ['abc123'],
    quality: 'medium',
    size: '1024x1024',
    format: 'png',
  });

  assert.equal(body.model, 'gpt-image-2');
  assert.equal(body.prompt, '把这张图修清晰一点');
  assert.deepEqual(body.images, [{ image_url: 'data:image/png;base64,abc123' }]);
  assert.deepEqual(body.image, [{ type: 'base64', data: 'abc123' }]);
});

test('toImageDataUrl 不重复包装已有 data URL', () => {
  assert.equal(toImageDataUrl('data:image/jpeg;base64,xxx'), 'data:image/jpeg;base64,xxx');
  assert.equal(toImageDataUrl('yyy'), 'data:image/png;base64,yyy');
});

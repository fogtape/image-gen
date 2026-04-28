import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImagesApiBody, buildImagesEditsMultipartFormData, toImageDataUrl } from '../server.js';

test('Images edits JSON body 使用官方风格 images[].image_url，不再混发 multipart 风格 image 字段', () => {
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
  assert.equal(body.image, undefined);
  assert.equal(body.mask, undefined);
});

test('toImageDataUrl 不重复包装已有 data URL', () => {
  assert.equal(toImageDataUrl('data:image/jpeg;base64,xxx'), 'data:image/jpeg;base64,xxx');
  assert.equal(toImageDataUrl('yyy'), 'data:image/png;base64,yyy');
});

test('Images edits JSON body 不再透传旧 mask 字段', () => {
  const body = buildImagesApiBody({
    mode: 'edits',
    prompt: '只修改透明区域',
    cfg: { model: 'gpt-image-2' },
    refImagesBase64: ['ref123'],
    maskImageBase64: 'mask123',
    format: 'png',
  });

  assert.deepEqual(body.images, [{ image_url: 'data:image/png;base64,ref123' }]);
  assert.equal(body.mask, undefined);
});

test('Images edits multipart 兼容模式只包含参考图文件字段', async () => {
  const form = buildImagesEditsMultipartFormData({
    mode: 'edits',
    prompt: '改成水彩风',
    cfg: { model: 'gpt-image-2' },
    refImagesBase64: ['ref123'],
    maskImageBase64: 'mask123',
    format: 'png',
  });
  const names = Array.from(form.entries()).map(([name]) => name);
  assert.ok(names.includes('image'));
  assert.equal(names.includes('mask'), false);
});

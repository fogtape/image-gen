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
});

test('toImageDataUrl 不重复包装已有 data URL', () => {
  assert.equal(toImageDataUrl('data:image/jpeg;base64,xxx'), 'data:image/jpeg;base64,xxx');
  assert.equal(toImageDataUrl('yyy'), 'data:image/png;base64,yyy');
});

test('Images edits JSON body 可随参考图透传 mask data URL', () => {
  const body = buildImagesApiBody({
    mode: 'edits',
    prompt: '只修改透明区域',
    cfg: { model: 'gpt-image-2' },
    refImagesBase64: ['ref123'],
    maskImageBase64: 'mask123',
    format: 'png',
  });

  assert.deepEqual(body.images, [{ image_url: 'data:image/png;base64,ref123' }]);
  assert.equal(body.mask, 'data:image/png;base64,mask123');
});

test('Images edits multipart 兼容模式会把 mask 作为单独文件字段', async () => {
  const form = buildImagesEditsMultipartFormData({
    mode: 'edits',
    prompt: '只修改透明区域',
    cfg: { model: 'gpt-image-2' },
    refImagesBase64: ['ref123'],
    maskImageBase64: 'mask123',
    format: 'png',
  });
  const entries = Array.from(form.entries());
  const names = entries.map(([name]) => name);
  assert.ok(names.includes('image'));
  assert.ok(names.includes('mask'));
  const maskEntry = entries.find(([name]) => name === 'mask');
  assert.equal(maskEntry[1].name, 'mask.png');
});

test('mask 缺少参考图时拒绝构造 Images edits body', () => {
  assert.throws(() => buildImagesApiBody({
    mode: 'edits',
    prompt: '局部修改',
    cfg: { model: 'gpt-image-2' },
    maskImageBase64: 'mask123',
  }), /mask 需要搭配参考图使用/);
});

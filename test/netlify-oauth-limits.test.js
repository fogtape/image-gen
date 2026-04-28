import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../netlify/functions/oauth-images.js';

function makeImageDataUrl(sizeBytes) {
  return `data:image/png;base64,${Buffer.alloc(sizeBytes, 1).toString('base64')}`;
}

test('Netlify OAuth images rejects oversized body and reference images before generation', async () => {
  const originalBodyLimit = process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES;
  const originalMax = process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES;
  const originalTotal = process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES;
  try {
    process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES = String(1024 * 1024);
    const oversizedBody = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ prompt: 'x'.repeat(1024 * 1024 + 1) }),
    });
    assert.equal(oversizedBody.statusCode, 413);
    assert.doesNotMatch(oversizedBody.body, /x{100}/);

    process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES = '1024';
    process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES = '2048';
    const largeImage = makeImageDataUrl(1500);
    const oversizedRef = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        accessToken: 'test-access-token',
        prompt: '画一只猫',
        refImagesBase64: [largeImage],
      }),
    });
    assert.equal(oversizedRef.statusCode, 413);
    assert.doesNotMatch(oversizedRef.body, new RegExp(largeImage.slice(40, 120)));

    const oversizedMask = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        accessToken: 'test-access-token',
        prompt: '画一只猫',
        maskImageBase64: largeImage,
      }),
    });
    assert.equal(oversizedMask.statusCode, 413);
    assert.doesNotMatch(oversizedMask.body, new RegExp(largeImage.slice(40, 120)));
  } finally {
    if (originalBodyLimit === undefined) delete process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES;
    else process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES = originalBodyLimit;
    if (originalMax === undefined) delete process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES;
    else process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES = originalMax;
    if (originalTotal === undefined) delete process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES;
    else process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES = originalTotal;
  }
});

test('Netlify OAuth images keeps invalid JSON as 400', async () => {
  const response = await handler({ httpMethod: 'POST', body: '{not-json' });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Invalid JSON/);
});

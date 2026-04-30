import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../netlify/functions/oauth-images.js';

function makeImageDataUrl(sizeBytes) {
  const buf = Buffer.alloc(sizeBytes, 0);
  // Include valid PNG magic bytes so sniffImageMime recognizes it
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47; // \x89PNG
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function authHeaders(token = 'test-admin-token') {
  return { authorization: `Bearer ${token}` };
}

test('Netlify OAuth images rejects oversized body and reference images before generation', async () => {
  const originalBodyLimit = process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES;
  const originalMax = process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES;
  const originalTotal = process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES;
  const originalAdminToken = process.env.IMAGE_GEN_ADMIN_TOKEN;
  try {
    process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token';
    process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES = String(1024 * 1024);
    const oversizedBody = await handler({
      httpMethod: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'x'.repeat(1024 * 1024 + 1) }),
    });
    assert.equal(oversizedBody.statusCode, 413);
    assert.doesNotMatch(oversizedBody.body, /x{100}/);

    process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES = '1024';
    process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES = '2048';
    const largeImage = makeImageDataUrl(1500);
    const oversizedRef = await handler({
      httpMethod: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        accessToken: 'test-access-token',
        prompt: '画一只猫',
        refImagesBase64: [largeImage],
      }),
    });
    assert.equal(oversizedRef.statusCode, 413);
    assert.doesNotMatch(oversizedRef.body, new RegExp(largeImage.slice(40, 120)));
  } finally {
    if (originalBodyLimit === undefined) delete process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES;
    else process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES = originalBodyLimit;
    if (originalMax === undefined) delete process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES;
    else process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES = originalMax;
    if (originalTotal === undefined) delete process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES;
    else process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES = originalTotal;
    if (originalAdminToken === undefined) delete process.env.IMAGE_GEN_ADMIN_TOKEN;
    else process.env.IMAGE_GEN_ADMIN_TOKEN = originalAdminToken;
  }
});

test('Netlify OAuth images keeps invalid JSON as 400', async () => {
  const originalAdminToken = process.env.IMAGE_GEN_ADMIN_TOKEN;
  try {
    process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token';
    const response = await handler({ httpMethod: 'POST', headers: authHeaders(), body: '{not-json' });
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /Invalid JSON/);
  } finally {
    if (originalAdminToken === undefined) delete process.env.IMAGE_GEN_ADMIN_TOKEN;
    else process.env.IMAGE_GEN_ADMIN_TOKEN = originalAdminToken;
  }
});

test('Netlify OAuth images rejects requests without admin token', async () => {
  const originalAdminToken = process.env.IMAGE_GEN_ADMIN_TOKEN;
  try {
    process.env.IMAGE_GEN_ADMIN_TOKEN = 'secret-token';
    const response = await handler({ httpMethod: 'POST', body: JSON.stringify({ prompt: 'test' }) });
    assert.equal(response.statusCode, 401);
    assert.match(response.body, /Admin authentication required/);
  } finally {
    if (originalAdminToken === undefined) delete process.env.IMAGE_GEN_ADMIN_TOKEN;
    else process.env.IMAGE_GEN_ADMIN_TOKEN = originalAdminToken;
  }
});

test('Netlify OAuth images rejects requests with wrong admin token', async () => {
  const originalAdminToken = process.env.IMAGE_GEN_ADMIN_TOKEN;
  try {
    process.env.IMAGE_GEN_ADMIN_TOKEN = 'secret-token';
    const response = await handler({
      httpMethod: 'POST',
      headers: authHeaders('wrong-token'),
      body: JSON.stringify({ prompt: 'test' }),
    });
    assert.equal(response.statusCode, 401);
    assert.match(response.body, /Admin authentication required/);
  } finally {
    if (originalAdminToken === undefined) delete process.env.IMAGE_GEN_ADMIN_TOKEN;
    else process.env.IMAGE_GEN_ADMIN_TOKEN = originalAdminToken;
  }
});

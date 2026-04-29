import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { assertImageListWithinLimits } from '../request-limits.js';

process.env.VERCEL = '1';
process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token-request-limits';
process.env.IMAGE_GEN_JSON_BODY_LIMIT_BYTES = '1024';
process.env.IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES = String(1024 * 1024);
process.env.IMAGE_GEN_REF_IMAGE_MAX_BYTES = '1024';
process.env.IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES = '2048';
process.env.IMAGE_GEN_PROXY_ALLOWED_HOSTS = '127.0.0.1';
process.env.IMAGE_GEN_PROXY_ALLOW_LOCAL_HTTP = 'true';

const { server } = await import('../server.js');

function makeImageDataUrl(sizeBytes) {
  return `data:image/png;base64,${Buffer.alloc(sizeBytes, 1).toString('base64')}`;
}

test('参考图 MIME 只允许 PNG、JPEG 和 WebP', () => {
  assert.doesNotThrow(() => assertImageListWithinLimits([`data:image/png;base64,${Buffer.from('ok').toString('base64')}`]));
  assert.doesNotThrow(() => assertImageListWithinLimits([`data:image/jpeg;base64,${Buffer.from('ok').toString('base64')}`]));
  assert.doesNotThrow(() => assertImageListWithinLimits([`data:image/webp;base64,${Buffer.from('ok').toString('base64')}`]));
  assert.throws(
    () => assertImageListWithinLimits([`data:image/gif;base64,${Buffer.from('gif').toString('base64')}`]),
    /参考图格式不支持/,
  );
});

async function postJson(baseUrl, path, body) {
  const resp = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { resp, text, data };
}

test('请求体和参考图超限返回 413，小请求仍可通过代理正常处理', async () => {
  let upstreamHits = 0;
  const upstream = http.createServer((req, res) => {
    upstreamHits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });

  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1/models`;
    const tooLargeImage = makeImageDataUrl(1500);

    const hugeJson = await postJson(baseUrl, '/api/prompt/enhance', { prompt: 'x'.repeat(2000) });
    assert.equal(hugeJson.resp.status, 413);
    assert.doesNotMatch(hugeJson.text, /x{100}/);

    const hugeRef = await postJson(baseUrl, '/api/jobs', {
      mode: 'responses',
      prompt: '画一只猫',
      cfg: { apiUrl: 'https://example.test', apiKey: 'test-key', model: 'gpt-image-2' },
      refImagesBase64: [tooLargeImage],
      storageSettings: { enabled: false },
    });
    assert.equal(hugeRef.resp.status, 413);
    assert.doesNotMatch(hugeRef.text, new RegExp(tooLargeImage.slice(40, 120)));

    const proxyJsonImage = await postJson(baseUrl, '/api/proxy', {
      url: 'https://api.openai.com/v1/responses',
      method: 'POST',
      headers: { Authorization: 'Bearer test-key' },
      body: { input: [{ content: [{ type: 'input_image', image_url: tooLargeImage }] }] },
    });
    assert.equal(proxyJsonImage.resp.status, 413);

    const proxyMultipartImage = await postJson(baseUrl, '/api/proxy', {
      url: 'https://api.openai.com/v1/images/edits',
      method: 'POST',
      headers: { Authorization: 'Bearer test-key' },
      multipartBody: {
        fields: { model: 'gpt-image-2', prompt: '改成水彩风' },
        images: [{ data: tooLargeImage, filename: 'reference.png' }],
      },
    });
    assert.equal(proxyMultipartImage.resp.status, 413);

    const ok = await postJson(baseUrl, '/api/proxy', {
      url: upstreamUrl,
      method: 'GET',
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(ok.resp.status, 200);
    assert.equal(ok.data.ok, true);
    assert.equal(upstreamHits, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-storage-security-'));
const adminToken = 'test-admin-token-storage-security';

process.env.VERCEL = '1';
process.env.IMAGE_GEN_DATA_DIR = dataDir;
process.env.IMAGE_GEN_ADMIN_TOKEN = adminToken;
delete process.env.IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN;

const { server } = await import('../server.js');

async function postJson(url, body, headers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { resp, text, data };
}

test('/api/storage/clear 必须通过管理鉴权，正确 token 才能清理数据', async () => {
  const imagesDir = path.join(dataDir, 'images');
  const marker = path.join(imagesDir, 'keep.txt');
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(marker, 'keep');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/storage/clear`;

    const noToken = await postJson(url, { scope: 'images' });
    assert.equal(noToken.resp.status, 401);
    assert.equal(fs.existsSync(marker), true);
    assert.doesNotMatch(noToken.text, new RegExp(adminToken));

    const wrongToken = await postJson(url, { scope: 'images' }, { 'X-Image-Gen-Admin-Token': 'wrong-token' });
    assert.equal(wrongToken.resp.status, 401);
    assert.equal(fs.existsSync(marker), true);

    const ok = await postJson(url, { scope: 'images' }, { 'X-Image-Gen-Admin-Token': adminToken });
    assert.equal(ok.resp.status, 200);
    assert.equal(ok.data.ok, true);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

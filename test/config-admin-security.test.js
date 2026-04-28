import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfigService } from '../config-service.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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

test('未配置 admin token 时默认拒绝管理鉴权，仅显式本机开发开关可放行本机请求', () => {
  process.env.IMAGE_GEN_ADMIN_TOKEN = '';
  delete process.env.IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN;

  const locked = createConfigService({ isServerless: false });
  assert.equal(locked.verifyAdminToken('', { isLocalRequest: true }), false);
  assert.equal(locked.verifyAdminToken('', { isLocalRequest: false }), false);

  process.env.IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN = 'true';
  const localOnly = createConfigService({ isServerless: false });
  assert.equal(localOnly.verifyAdminToken('', { isLocalRequest: true }), true);
  assert.equal(localOnly.verifyAdminToken('', { isLocalRequest: false }), false);

  const serverless = createConfigService({ isServerless: true });
  assert.equal(serverless.verifyAdminToken('', { isLocalRequest: true }), false);
});

test('配置管理接口无 token 和错 token 拒绝，正确 token 才允许保存', async () => {
  const adminToken = 'test-admin-token-p02-admin-security';
  process.env.VERCEL = '1';
  process.env.IMAGE_GEN_ADMIN_TOKEN = adminToken;
  delete process.env.IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN;

  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/api/config/save`;
    const body = { config: { providerDefaults: { imageModel: 'gpt-image-2' } } };

    const noToken = await postJson(url, body);
    assert.equal(noToken.resp.status, 401);
    assert.doesNotMatch(noToken.text, new RegExp(adminToken));

    const wrongToken = await postJson(url, body, { 'X-Image-Gen-Admin-Token': 'wrong-admin-token' });
    assert.equal(wrongToken.resp.status, 401);
    assert.doesNotMatch(wrongToken.text, new RegExp(adminToken));

    const ok = await postJson(url, body, { 'X-Image-Gen-Admin-Token': adminToken });
    assert.equal(ok.resp.status, 200);
    assert.equal(ok.data.ok, true);
    assert.doesNotMatch(ok.text, new RegExp(adminToken));
    assert.equal(ok.data.runtime?.security?.adminTokenConfigured, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serverless 配置初始化不创建本地 config/.env，且保存配置不写磁盘', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-serverless-config-'));
  const configDir = path.join(tempRoot, 'config');
  const script = `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    const { createConfigService } = await import(${JSON.stringify(pathToFileURL(path.resolve('config-service.js')).href)});
    const service = createConfigService({ isServerless: true });
    assert.equal(fs.existsSync(process.env.IMAGE_GEN_CONFIG_DIR), false);
    assert.equal(service.getRuntimeConfig().capabilities.canPersistLocalEnv, false);
    service.setRuntimeConfig({ providerDefaults: { imageModel: 'gpt-image-2' } });
    assert.equal(fs.existsSync(process.env.IMAGE_GEN_CONFIG_DIR), false);
    assert.equal(fs.existsSync(process.env.IMAGE_GEN_ENV_FILE), false);
  `;

  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      VERCEL: '1',
      IMAGE_GEN_CONFIG_DIR: configDir,
      IMAGE_GEN_ENV_FILE: path.join(configDir, '.env'),
      IMAGE_GEN_ADMIN_TOKEN: 'test-admin-token-serverless-config',
    },
    stdio: 'pipe',
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfigService } from '../config-service.js';
import { createPlatformHandler } from '../handlers/handler-factory.js';

const ADMIN_TOKEN = 'test-admin-token-p13-platform-config';
const DEPLOY_TOKEN = 'test-deploy-token-p13-platform-config';

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

test('平台 handler 通过 configService 默认读取 resolved deploy 配置，而不是公开脱敏 runtime', () => {
  process.env.IMAGE_GEN_DEPLOY_PLATFORM = 'vercel';
  process.env.IMAGE_GEN_DEPLOY_PROJECT_ID = 'p13-direct-project';
  process.env.IMAGE_GEN_DEPLOY_API_TOKEN = DEPLOY_TOKEN;

  const configService = createConfigService({ isServerless: true });
  const publicRuntime = configService.getRuntimeConfig();
  assert.equal(publicRuntime.config.deploy.projectId, '***已配置***');
  assert.equal(publicRuntime.config.deploy.apiTokenConfigured, true);

  const handler = createPlatformHandler('vercel', { configService });
  assert.equal(handler.getDeployConfig().projectId, 'p13-direct-project');
  assert.equal(handler.getDeployConfig().apiToken, DEPLOY_TOKEN);

  const wrappedHandler = createPlatformHandler('vercel', {
    runtimeResolver: () => ({
      config: {
        deploy: {
          platform: 'vercel',
          projectId: 'p13-wrapped-project',
          apiToken: 'p13-wrapped-token',
        },
      },
    }),
  });
  assert.equal(wrappedHandler.getDeployConfig().projectId, 'p13-wrapped-project');
  assert.equal(wrappedHandler.getDeployConfig().apiToken, 'p13-wrapped-token');
});

test('保存配置时 autoSync/autoRedeploy 使用 resolved deploy secret，并且响应不回显 token', async () => {
  process.env.VERCEL = '1';
  process.env.IMAGE_GEN_ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.IMAGE_GEN_DEPLOY_PLATFORM = 'node';
  process.env.IMAGE_GEN_DEPLOY_PROJECT_ID = '';
  process.env.IMAGE_GEN_DEPLOY_API_TOKEN = '';
  delete process.env.IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN;

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    const method = String(options.method || 'GET').toUpperCase();
    const authorization = options.headers?.Authorization || options.headers?.authorization || '';
    calls.push({ target, method, authorization, body: options.body || '' });

    if (target.includes('/v10/projects/') && target.endsWith('/env') && method === 'GET') {
      return jsonResponse({ envs: [] });
    }
    if (target.includes('/v10/projects/') && target.endsWith('/env') && method === 'POST') {
      return jsonResponse({ id: `env-${calls.length}` });
    }
    if (target.includes('/v6/deployments?') && method === 'GET') {
      return jsonResponse({ deployments: [{ uid: 'p13-previous-deployment' }] });
    }
    if (target.endsWith('/v13/deployments') && method === 'POST') {
      return jsonResponse({ id: 'p13-new-deployment' });
    }
    return jsonResponse({ ok: true });
  };

  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { 'X-Image-Gen-Admin-Token': ADMIN_TOKEN };

    const saved = await postJson(`${baseUrl}/api/config/save`, {
      config: {
        deploy: {
          platform: 'vercel',
          projectId: 'p13-auto-project',
          apiToken: DEPLOY_TOKEN,
          autoSync: true,
          autoRedeploy: true,
        },
      },
    }, headers);

    assert.equal(saved.resp.status, 200, saved.text);
    assert.equal(saved.data.ok, true);
    assert.equal(saved.data.runtime?.deploy?.apiTokenConfigured, true);
    assert.equal(saved.data.operations?.length, 2);
    assert.doesNotMatch(saved.text, new RegExp(DEPLOY_TOKEN));
    assert.ok(calls.some((call) => call.target.includes('/v10/projects/p13-auto-project/env') && call.method === 'POST'));
    assert.ok(calls.some((call) => call.target.endsWith('/v13/deployments') && call.method === 'POST'));
    assert.ok(calls.every((call) => !call.authorization || call.authorization === `Bearer ${DEPLOY_TOKEN}`));

    calls.length = 0;
    const checked = await postJson(`${baseUrl}/api/config/platform/check`, {
      platform: 'vercel',
    }, headers);
    assert.equal(checked.resp.status, 200, checked.text);
    assert.equal(checked.data.result?.details?.apiTokenConfigured, true);
    assert.equal('tokenPreview' in (checked.data.result?.details || {}), false);
    assert.doesNotMatch(checked.text, new RegExp(DEPLOY_TOKEN));
    assert.ok(calls.some((call) => call.target.includes('/v10/projects/p13-auto-project/env') && call.method === 'GET'));

    calls.length = 0;
    const synced = await postJson(`${baseUrl}/api/config/platform/sync`, {
      config: {
        deploy: {
          platform: 'vercel',
          projectId: 'p13-preserved-project',
        },
      },
    }, headers);

    assert.equal(synced.resp.status, 200, synced.text);
    assert.equal(synced.data.ok, true);
    assert.doesNotMatch(synced.text, new RegExp(DEPLOY_TOKEN));
    assert.ok(calls.some((call) => call.target.includes('/v10/projects/p13-preserved-project/env')));
    assert.ok(calls.every((call) => !call.authorization || call.authorization === `Bearer ${DEPLOY_TOKEN}`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
  }
});

test('EdgeOne check 不调用 ModifyPagesProjectEnvs，sync 才执行环境变量写入', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: String(options.body || '') });
    return jsonResponse({ Code: 0, data: { Code: 0 } });
  };

  try {
    const configService = createConfigService({ isServerless: true });
    configService.setRuntimeConfig({
      deploy: {
        platform: 'edgeone',
        projectId: 'p18-edge-project',
        apiToken: DEPLOY_TOKEN,
      },
    }, { preserveSecrets: true });
    const handler = createPlatformHandler('edgeone', { configService });

    const checked = await handler.check();
    assert.equal(checked.ok, true);
    assert.equal(checked.details.projectId, 'p18-edge-project');
    assert.equal(checked.details.apiTokenConfigured, true);
    assert.equal(checked.details.remoteWrite, false);
    assert.equal(calls.length, 0);

    const synced = await handler.sync();
    assert.equal(synced.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].body, /ModifyPagesProjectEnvs/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('EdgeOne 平台同步业务错误不会回显请求体中的账号存储 secret', async () => {
  const originalFetch = globalThis.fetch;
  const upstashToken = 'edgeone-handler-upstash-secret';
  const encryptionKey = 'edgeone-handler-encryption-secret';
  globalThis.fetch = async () => jsonResponse({
    Code: 1001,
    Message: `invalid env ${upstashToken} ${encryptionKey}`,
  });

  try {
    const configService = createConfigService({ isServerless: true });
    configService.setRuntimeConfig({
      accountStore: {
        type: 'upstash',
        upstashRestUrl: 'https://edgeone-handler-upstash.example.invalid',
        upstashRestToken: upstashToken,
        encryptionKey,
      },
      deploy: {
        platform: 'edgeone',
        projectId: 'p18-edge-project',
        apiToken: DEPLOY_TOKEN,
      },
    }, { preserveSecrets: true });
    const handler = createPlatformHandler('edgeone', { configService });

    await assert.rejects(
      () => handler.sync(),
      (error) => {
        assert.match(error.message, /invalid env/);
        assert.doesNotMatch(error.message, new RegExp(upstashToken));
        assert.doesNotMatch(error.message, new RegExp(encryptionKey));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

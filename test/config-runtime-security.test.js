import assert from 'node:assert/strict';
import test from 'node:test';

test('/api/config/runtime only exposes sanitized public runtime config', async () => {
  const fakeAdminToken = 'test-admin-token-runtime-redaction';
  const fakeDeployToken = 'test-deploy-token-runtime-redaction';
  const fakeAccountId = 'test-account-runtime-redaction';
  const fakeProjectId = 'test-project-runtime-redaction';
  const fakeUpstashUrl = 'https://runtime-redaction-upstash.example.invalid';
  const fakeUpstashToken = 'test-upstash-token-runtime-redaction';
  const fakeAccountStoreKey = 'test-account-store-key-runtime-redaction';

  process.env.VERCEL = '1';
  process.env.IMAGE_GEN_ADMIN_TOKEN = fakeAdminToken;
  process.env.IMAGE_GEN_DEPLOY_API_TOKEN = fakeDeployToken;
  process.env.IMAGE_GEN_DEPLOY_ACCOUNT_ID = fakeAccountId;
  process.env.IMAGE_GEN_DEPLOY_PROJECT_ID = fakeProjectId;
  process.env.IMAGE_GEN_ACCOUNT_STORE = 'upstash';
  process.env.IMAGE_GEN_UPSTASH_REDIS_REST_URL = fakeUpstashUrl;
  process.env.IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN = fakeUpstashToken;
  process.env.IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY = fakeAccountStoreKey;

  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const resp = await fetch(`http://127.0.0.1:${port}/api/config/runtime`);
    const text = await resp.text();
    const data = JSON.parse(text);

    assert.equal(resp.status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.runtime);
    assert.ok(data.meta?.capabilities);
    assert.equal(data.meta.capabilities.runtime, 'serverless');
    assert.equal(data.meta.capabilities.canUseProxy, true);
    assert.equal(data.meta.capabilities.canProxySse, true);
    assert.equal(data.meta.capabilities.canProxyMultipart, false);
    assert.equal(data.meta.capabilities.canUseBackgroundJobs, true);
    assert.equal(data.meta.capabilities.backgroundJobsInline, true);
    assert.equal(data.meta.capabilities.canPersistImages, false);
    assert.equal(data.meta.capabilities.canUseStorageApi, false);
    assert.equal(data.editable, undefined);
    assert.equal(data.runtime.security.adminTokenConfigured, true);
    assert.equal(data.runtime.deploy.apiTokenConfigured, true);
    assert.equal(data.runtime.deploy.accountIdConfigured, true);
    assert.equal(data.runtime.deploy.projectIdConfigured, true);
    assert.equal(data.runtime.deploy.accountId, '***已配置***');
    assert.equal(data.runtime.deploy.projectId, '***已配置***');
    assert.equal(Object.hasOwn(data.runtime.deploy, 'apiToken'), false);
    assert.equal(data.runtime.accountStore.type, 'upstash');
    assert.equal(data.runtime.accountStore.upstashRestUrlConfigured, true);
    assert.equal(data.runtime.accountStore.upstashRestTokenConfigured, true);
    assert.equal(data.runtime.accountStore.encryptionKeyConfigured, true);
    assert.equal(Object.hasOwn(data.runtime.accountStore, 'upstashRestUrl'), false);
    assert.equal(Object.hasOwn(data.runtime.accountStore, 'upstashRestToken'), false);
    assert.equal(Object.hasOwn(data.runtime.accountStore, 'encryptionKey'), false);
    assert.doesNotMatch(text, new RegExp(fakeAdminToken));
    assert.doesNotMatch(text, new RegExp(fakeDeployToken));
    assert.doesNotMatch(text, new RegExp(fakeAccountId));
    assert.doesNotMatch(text, new RegExp(fakeProjectId));
    assert.doesNotMatch(text, /runtime-redaction-upstash\.example\.invalid/);
    assert.doesNotMatch(text, new RegExp(fakeUpstashToken));
    assert.doesNotMatch(text, new RegExp(fakeAccountStoreKey));
    assert.doesNotMatch(text, /"adminToken"\s*:/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

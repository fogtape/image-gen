import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('服务端已接入统一配置中心与平台配置 API', () => {
  const server = read('server.js');
  assert.match(server, /createConfigService/);
  assert.match(server, /createPlatformHandler/);
  assert.match(server, /\/api\/config\/runtime/);
  assert.match(server, /\/api\/config\/save/);
  assert.match(server, /\/api\/config\/platform\/check/);
  assert.match(server, /\/api\/config\/platform\/sync/);
  assert.match(server, /\/api\/config\/platform\/deploy/);
  assert.match(server, /x-image-gen-admin-token/i);
});

test('前端设置页新增服务端默认配置与部署平台区块', () => {
  const html = read('index.html');
  assert.match(html, /服务端默认配置/);
  assert.match(html, /部署平台配置/);
  assert.match(html, /id="serverDefaultApiUrl"/);
  assert.match(html, /id="serverDefaultImageModel"/);
  assert.match(html, /id="serverDefaultResponsesModel"/);
  assert.match(html, /id="deployPlatform"/);
  assert.match(html, /id="deployAccountId"/);
  assert.match(html, /id="deployProjectId"/);
  assert.match(html, /id="deployApiToken"/);
  assert.match(html, /id="configAdminToken"/);
});

test('前端已支持读取/保存服务端 runtime config 并驱动默认账号值', () => {
  const app = read('app.js');
  assert.match(app, /CONFIG_ADMIN_TOKEN_KEY/);
  assert.match(app, /async function fetchServerRuntimeConfig/);
  assert.match(app, /async function saveServerRuntimeConfig/);
  assert.match(app, /function getProviderDefaults/);
  assert.match(app, /providerDefaults\.imageModel/);
  assert.match(app, /providerDefaults\.responsesModel/);
  assert.match(app, /providerDefaults\.imageEditsCompatMode/);
  assert.match(app, /providerDefaults\.forceProxy/);
});

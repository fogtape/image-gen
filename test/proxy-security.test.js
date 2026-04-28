import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {
  getProxyAllowedHosts,
  sanitizeProxyHeaders,
  validateApiBaseUrl,
  validateProxyTarget,
} from '../proxy-policy.js';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('代理策略只允许白名单 host/path/protocol，并清理危险 header', () => {
  const allowedHosts = new Set(['api.openai.com']);
  assert.equal(validateProxyTarget('https://api.openai.com/v1/models', { method: 'GET', allowedHosts }).target.hostname, 'api.openai.com');

  assert.throws(() => validateProxyTarget('file:///etc/passwd', { method: 'GET', allowedHosts }), /not allowed|invalid/);
  assert.throws(() => validateProxyTarget('http://127.0.0.1:3000/v1/models', { method: 'GET', allowedHosts: new Set(['127.0.0.1']) }), /not allowed/);
  assert.throws(() => validateProxyTarget('http://169.254.169.254/latest/meta-data', { method: 'GET', allowedHosts: new Set(['169.254.169.254']) }), /not allowed/);
  assert.throws(() => validateProxyTarget('https://evil.example/v1/models', { method: 'GET', allowedHosts }), /allowlisted/);
  assert.throws(() => validateProxyTarget('https://api.openai.com/v1/files', { method: 'GET', allowedHosts }), /path/);
  assert.throws(() => validateProxyTarget('https://api.openai.com/v1/models', { method: 'DELETE', allowedHosts }), /method/);

  const headers = sanitizeProxyHeaders({
    Authorization: 'Bearer ok',
    Cookie: 'secret',
    Host: 'evil.example',
    Connection: 'keep-alive',
    'X-Forwarded-For': '127.0.0.1',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(headers, { Authorization: 'Bearer ok', 'Content-Type': 'application/json' });

  const envHosts = getProxyAllowedHosts({ env: { IMAGE_GEN_PROXY_ALLOWED_HOSTS: 'https://relay.example, api.example.com:8443' } });
  assert.equal(envHosts.has('api.openai.com'), true);
  assert.equal(envHosts.has('relay.example'), true);
  assert.equal(envHosts.has('api.example.com'), true);

  const defaultApiHosts = getProxyAllowedHosts({ env: { IMAGE_GEN_DEFAULT_API_URL: 'https://relay-default.example/openai' } });
  assert.equal(defaultApiHosts.has('api.openai.com'), true);
  assert.equal(defaultApiHosts.has('relay-default.example'), true);
});

test('服务端上游 API 地址复用 allowlist 并默认拒绝本机和私网', () => {
  const allowedHosts = new Set(['api.openai.com', 'relay.example']);
  assert.equal(validateApiBaseUrl('https://api.openai.com/', { allowedHosts }).baseUrl, 'https://api.openai.com');
  assert.equal(validateApiBaseUrl('https://relay.example/openai/', { allowedHosts }).baseUrl, 'https://relay.example/openai');

  assert.throws(() => validateApiBaseUrl('http://api.openai.com', { allowedHosts }), /protocol/);
  assert.throws(() => validateApiBaseUrl('http://127.0.0.1:3000', { allowedHosts: new Set(['127.0.0.1']) }), /not allowed/);
  assert.throws(() => validateApiBaseUrl('https://169.254.169.254', { allowedHosts: new Set(['169.254.169.254']) }), /not allowed/);
  assert.throws(() => validateApiBaseUrl('https://evil.example', { allowedHosts }), /allowlisted/);
  assert.throws(() => validateApiBaseUrl('https://api.openai.com?token=x', { allowedHosts }), /query or hash/);
  assert.throws(() => validateApiBaseUrl('https://user:pass@api.openai.com', { allowedHosts }), /credentials/);
});

test('Node /api/proxy 默认拒绝本机目标，显式本机开发开关下也会过滤危险 header', async () => {
  let upstreamHits = 0;
  let upstreamHeaders = null;
  const upstream = http.createServer((req, res) => {
    upstreamHits += 1;
    upstreamHeaders = req.headers;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, headers: req.headers }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  process.env.VERCEL = '1';
  process.env.IMAGE_GEN_ADMIN_TOKEN = 'test-admin-token-proxy-security';
  process.env.IMAGE_GEN_PROXY_ALLOWED_HOSTS = '127.0.0.1';
  delete process.env.IMAGE_GEN_PROXY_ALLOW_LOCAL_HTTP;

  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const upstreamPort = upstream.address().port;
    const proxyPort = server.address().port;
    const targetUrl = `http://127.0.0.1:${upstreamPort}/v1/models`;
    const proxyUrl = `http://127.0.0.1:${proxyPort}/api/proxy`;

    const blocked = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, method: 'GET', headers: { Authorization: 'Bearer ok' } }),
    });
    assert.equal(blocked.status, 403);
    assert.equal(upstreamHits, 0);

    process.env.IMAGE_GEN_PROXY_ALLOW_LOCAL_HTTP = 'true';
    const allowed = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: targetUrl,
        method: 'GET',
        headers: {
          Authorization: 'Bearer ok',
          Cookie: 'secret-cookie',
          Host: 'evil.example',
          'X-Forwarded-For': '10.0.0.1',
        },
      }),
    });
    const data = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(data.ok, true);
    assert.equal(upstreamHits, 1);
    assert.equal(upstreamHeaders.authorization, 'Bearer ok');
    assert.equal(upstreamHeaders.cookie, undefined);
    assert.notEqual(upstreamHeaders.host, 'evil.example');
    assert.equal(upstreamHeaders['x-forwarded-for'], undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('Vercel 和 Netlify 代理复用同一策略，并明确 multipart 降级', () => {
  const vercelProxy = read('api/proxy.js');
  const netlifyProxy = read('netlify/functions/proxy.js');
  const proxyExecutor = read('proxy-executor.js');
  const readme = read('README.md');

  for (const source of [vercelProxy, netlifyProxy]) {
    assert.match(source, /proxy-policy\.js/);
    assert.match(source, /proxy-executor\.js/);
    assert.match(source, /prepareProxyRequest/);
    assert.match(source, /runProxyUpstream/);
    assert.match(source, /allowMultipart:\s*false/);
    assert.doesNotMatch(source, /await\s+resp\.text\(\)/);
  }

  assert.match(proxyExecutor, /request-limits\.js/);
  assert.match(proxyExecutor, /sanitizeProxyHeaders/);
  assert.match(proxyExecutor, /validateProxyTarget/);
  assert.match(proxyExecutor, /assertEmbeddedDataImagesWithinLimits/);
  assert.match(proxyExecutor, /assertMultipartImagesWithinLimits/);
  assert.match(proxyExecutor, /IMAGE_GEN_PROXY_TIMEOUT_MS/);
  assert.match(proxyExecutor, /IMAGE_GEN_PROXY_MAX_RESPONSE_BYTES/);
  assert.match(proxyExecutor, /Multipart proxy is not supported on this platform/);
  assert.match(vercelProxy, /onStreamStart:\s*\(\{\s*status,\s*contentType\s*\}\)/);
  assert.match(vercelProxy, /res\.status\(status\)/);
  assert.match(vercelProxy, /contentType\s*\|\|\s*'text\/event-stream'/);

  assert.match(readme, /Node \/ Docker.*multipart 图生图代理/);
  assert.match(readme, /Vercel.*不支持 multipart 图生图代理/);
  assert.match(readme, /Netlify.*multipart 图生图代理不支持/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createConfigService } from '../config-service.js';
import { resolveRuntimeMode } from '../server.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

test('Docker/Node 显式 runtime 覆盖云平台环境变量，保持服务端图片持久化能力', () => {
  const server = read('server.js');
  const dockerfile = read('Dockerfile');
  const compose = read('docker-compose.yml');

  assert.match(server, /IMAGE_GEN_RUNTIME/);
  assert.match(server, /return false/);
  assert.match(dockerfile, /ENV IMAGE_GEN_RUNTIME=node/);
  assert.match(dockerfile, /ENV IMAGE_GEN_DATA_DIR=\/app\/data/);
  assert.match(compose, /IMAGE_GEN_RUNTIME: node/);
  assert.match(compose, /IMAGE_GEN_DATA_DIR: \/app\/data/);
  assert.equal(resolveRuntimeMode({ IMAGE_GEN_RUNTIME: 'node', VERCEL: '1', NETLIFY: '1' }), 'node');
  assert.equal(resolveRuntimeMode({ IMAGE_GEN_RUNTIME: 'docker', AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x' }), 'node');
  assert.equal(resolveRuntimeMode({ IMAGE_GEN_RUNTIME: 'vercel' }), 'serverless');

  const configService = createConfigService({ isServerless: false });
  const runtime = configService.getRuntimeConfig();
  assert.equal(runtime.capabilities.runtime, 'node');
  assert.equal(runtime.capabilities.backgroundJobsInline, false);
  assert.equal(runtime.capabilities.canPersistImages, true);
  assert.equal(runtime.capabilities.canUseStorageApi, true);
  assert.equal(runtime.capabilities.canUseBackgroundJobs, true);
  configService.stopWatcher?.();
});

test('Docker runtime 即使宿主环境残留 VERCEL 变量，/api/config/runtime 仍返回 node 存储能力', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-docker-runtime-'));
  const script = `
    const { server } = await import('./server.js');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const resp = await fetch('http://127.0.0.1:' + port + '/api/config/runtime');
      const data = await resp.json();
      if (data.meta.capabilities.runtime !== 'node') throw new Error('runtime=' + data.meta.capabilities.runtime);
      if (data.meta.capabilities.canPersistImages !== true) throw new Error('canPersistImages=false');
      if (data.meta.capabilities.canUseStorageApi !== true) throw new Error('canUseStorageApi=false');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      VERCEL: '1',
      IMAGE_GEN_RUNTIME: 'node',
      IMAGE_GEN_DATA_DIR: path.join(tempRoot, 'data'),
      IMAGE_GEN_CONFIG_DIR: path.join(tempRoot, 'config'),
      IMAGE_GEN_ENV_FILE: path.join(tempRoot, 'config', '.env'),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('Docker/Node 后台生图默认写入 /app/data 风格的数据目录，刷新后可由 storage API 找回', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-docker-storage-'));
  const script = `
    const oneByOnePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (!String(url).endsWith('/v1/responses')) return realFetch(url, options);
      return new Response('event: response.output_item.done\\ndata: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"' + oneByOnePng + '"}}\\n\\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const { server, imageJobStore } = await import('./server.js');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const created = imageJobStore.create({
        mode: 'responses',
        prompt: 'docker persistence check',
        cfg: { apiUrl: 'https://api.openai.com', apiKey: 'test-key', model: 'gpt-image-2', responsesModel: 'gpt-5.4' },
        quality: 'low',
        size: 'auto',
        background: 'auto',
        format: 'png',
        storageSettings: { enabled: true },
      });
      let job = null;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        job = imageJobStore.get(created.id);
        if (job && (job.status === 'completed' || job.status === 'failed')) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (job?.status !== 'completed') throw new Error('job did not complete: ' + JSON.stringify(job));
      const item = job.result.data[0];
      if (item.persisted !== true) throw new Error('not persisted: ' + JSON.stringify(item.storageError || item));
      if (!String(item.url || '').startsWith('/api/images/')) throw new Error('bad image url: ' + item.url);
      if (item.b64_json !== undefined) throw new Error('b64_json should be removed after server persistence');
      const base = 'http://127.0.0.1:' + server.address().port;
      const stats = await (await fetch(base + '/api/storage')).json();
      if (stats.count !== 1) throw new Error('storage count=' + stats.count);
      if (stats.history[0].prompt !== 'docker persistence check') throw new Error('history prompt missing');
      const imageResp = await fetch(base + item.url);
      if (imageResp.status !== 200) throw new Error('stored image HTTP ' + imageResp.status);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      VERCEL: '1',
      IMAGE_GEN_RUNTIME: 'node',
      IMAGE_GEN_DATA_DIR: path.join(tempRoot, 'data'),
      IMAGE_GEN_CONFIG_DIR: path.join(tempRoot, 'config'),
      IMAGE_GEN_ENV_FILE: path.join(tempRoot, 'config', '.env'),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('Vercel 使用静态构建产物部署，避免把浏览器 app.js 当服务端函数执行', () => {
  const pkg = JSON.parse(read('package.json'));
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(pkg.scripts.build, 'node scripts/build-static.js');
  assert.equal(vercel.buildCommand, 'npm run build');
  assert.equal(vercel.outputDirectory, 'dist');
  assert.equal(vercel.framework, null);
  assert.ok(exists('api/[...path].js'), 'Vercel catch-all API adapter should exist');

  const adapter = read('api/[...path].js');
  assert.match(adapter, /server\.emit\('request', req, res\)/);
  assert.doesNotMatch(adapter, /app\.js/);
});

test('Vercel 为嵌套 API 路径提供显式入口，避免返回 The page could not be found 文本', () => {
  for (const routeFile of [
    'api/oauth/start.js',
    'api/oauth/exchange.js',
    'api/oauth/refresh.js',
    'api/oauth/test.js',
    'api/oauth/status/[state].js',
    'api/oauth/images/stream.js',
    'api/admin/[...path].js',
    'api/config/[...path].js',
    'api/accounts/[...path].js',
  ]) {
    assert.ok(exists(routeFile), `${routeFile} should exist for Vercel nested API routing`);
    const source = read(routeFile);
    assert.match(source, /dispatchToNodeServer/);
    assert.doesNotMatch(source, /The page could not be found|app\.js/);
  }
});

test('Vercel Serverless Functions 数量不超过 Hobby 计划 12 个限制', () => {
  const functionFiles = [
    'api/[...path].js',
    'api/accounts/[...path].js',
    'api/admin/[...path].js',
    'api/config/[...path].js',
    'api/oauth/exchange.js',
    'api/oauth/images.js',
    'api/oauth/images/stream.js',
    'api/oauth/refresh.js',
    'api/oauth/start.js',
    'api/oauth/status/[state].js',
    'api/oauth/test.js',
    'api/proxy.js',
  ];
  for (const routeFile of functionFiles) assert.ok(exists(routeFile), `${routeFile} should exist`);
  assert.equal(functionFiles.length, 12);
});

test('OAuth start 在 Vercel serverless 环境不启动本地 loopback 监听', () => {
  const server = read('server.js');
  assert.match(server, /function shouldStartOAuthLoopbackServer/);
  assert.match(server, /return !isServerlessRuntime\(\)/);
  assert.match(server, /if \(shouldStartOAuthLoopbackServer\(\)\) await ensureLoopbackServer\(\)/);
});

test('Cloudflare Pages 和 EdgeOne Pages 可直接导入 Fork 仓库使用默认构建配置', () => {
  assert.ok(exists('wrangler.toml'), 'Cloudflare Pages wrangler.toml should exist');
  assert.ok(exists('edgeone.json'), 'EdgeOne Pages config should exist');
  const wrangler = read('wrangler.toml');
  const edgeone = JSON.parse(read('edgeone.json'));
  assert.match(wrangler, /pages_build_output_dir\s*=\s*"dist"/);
  assert.equal(edgeone.buildCommand, 'npm run build');
  assert.equal(edgeone.outputDirectory, 'dist');
  assert.equal(edgeone.installCommand, 'npm install');
});

test('静态构建只输出浏览器资源，不把服务端代码暴露为前端入口', () => {
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const file of ['index.html', 'app.js', 'style.css', 'ui-feedback.js']) {
    assert.ok(exists(`dist/${file}`), `dist/${file} should exist`);
  }
  assert.ok(!exists('dist/server.js'), 'server.js should not be copied into static output');
  assert.ok(!exists('dist/api'), 'api functions should not be copied into static output');
});
test('云平台静态部署没有后台任务 API 时会回退到浏览器直连生成', () => {
  const app = read('app.js');
  assert.match(app, /function isBackgroundJobsUnavailableError/);
  assert.match(app, /HTTP\\s\+\(404\|405\|408\|429\|5\\d\\d\)/);
  assert.match(app, /function canUseBackgroundJobs/);
  assert.match(app, /async function genDirectImagesAfterJobFallback/);
  assert.match(app, /if \(!canUseBackgroundJobs\(\)\) \{[\s\S]*await genDirectImagesAfterJobFallback\(cfg, prompt, quality, background, size, format, hasRef, actualCount, baseResultMeta\);[\s\S]*return;[\s\S]*\}/s);
  assert.match(app, /function isValidBackgroundJobResponse/);
  assert.match(app, /if \(!isValidBackgroundJobResponse\(data\)\) \{[\s\S]*后台任务 API 不可用或返回格式无效[\s\S]*throw err;[\s\S]*\}/s);
  assert.match(app, /job = await createBackgroundJob\(payload\);[\s\S]*if \(isBackgroundJobsUnavailableError\(e\)\)/s);
  assert.match(app, /await genDirectImagesAfterJobFallback\(cfg, prompt, quality, background, size, format, hasRef, actualCount, baseResultMeta\)/);
});

test('Vercel serverless 后台任务同步完成并直接返回结果，避免跨实例轮询丢失', () => {
  const server = read('server.js');
  assert.match(server, /function isServerlessRuntime\(\)/);
  assert.match(server, /process\.env\.VERCEL/);
  assert.match(server, /if \(isServerlessRuntime\(\)\) \{/);
  assert.match(server, /await runImageJob\(serverlessPayload, onProgress\)/);
  assert.match(server, /status: 'completed'/);
  assert.match(server, /serverless: true/);
  assert.match(server, /storageSettings:\s*\{[\s\S]*enabled: false[\s\S]*\}/);
});

test('前端能处理 serverless 直接完成结果，刷新遇到过期后台任务不弹错误', () => {
  const app = read('app.js');
  assert.match(app, /if \(job\.status === 'completed'\) \{/);
  assert.match(app, /handleOAuthImageResult\(job\.result, format, completedMeta\)/);
  assert.match(app, /handleImagesResult\(job\.result, format, completedMeta\)/);
  assert.match(app, /function isMissingBackgroundJobError\(error\)/);
  assert.match(app, /if \(isMissingBackgroundJobError\(e\)\) \{[\s\S]*clearActiveJob\(\)[\s\S]*return;[\s\S]*\}/);
});

test('README 覆盖 Vercel、Cloudflare Pages、EdgeOne Pages 的零配置 Fork 导入流程', () => {
  const readme = read('README.md');
  for (const phrase of ['Vercel', 'Cloudflare Pages', 'EdgeOne Pages', 'Fork', '无需配置环境变量']) {
    assert.match(readme, new RegExp(phrase));
  }
});

test('README 平台能力矩阵明确各部署形态的后端能力和降级边界', () => {
  const readme = read('README.md');
  for (const phrase of [
    '## 平台能力矩阵',
    '服务端代理 `/api/proxy`',
    'OAuth 后端',
    '后台任务',
    '图片持久化',
    '服务端配置保存',
    '平台同步/重部署',
    'Node / VPS',
    'Docker / Compose',
    'Vercel',
    'Netlify',
    'Cloudflare Pages',
    'EdgeOne Pages',
  ]) {
    assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(readme, /\| Netlify \|[\s\S]*缺 `start\/exchange\/status\/stream`[\s\S]*配置中心和后台任务需 Node\/Vercel 形态/);
  assert.match(readme, /\| Cloudflare Pages \|[\s\S]*纯静态 Pages 构建[\s\S]*管理外部 Worker\/Script env/);
  assert.match(readme, /\| EdgeOne Pages \|[\s\S]*纯静态 Pages 构建[\s\S]*调用 Pages API/);
  assert.match(readme, /保存服务端配置时会自动执行平台变量同步和重新部署/);
  assert.match(readme, /接口响应的 `operations`/);
});

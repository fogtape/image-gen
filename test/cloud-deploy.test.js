import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

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
  assert.match(app, /async function genDirectImagesAfterJobFallback/);
  assert.match(app, /catch \(e\) \{\s*if \(isBackgroundJobsUnavailableError\(e\)\)/s);
  assert.match(app, /await genDirectImagesAfterJobFallback\(cfg, prompt, quality, background, size, format, hasRef\)/);
});

test('README 覆盖 Vercel、Cloudflare Pages、EdgeOne Pages 的零配置 Fork 导入流程', () => {
  const readme = read('README.md');
  for (const phrase of ['Vercel', 'Cloudflare Pages', 'EdgeOne Pages', 'Fork', '无需配置环境变量']) {
    assert.match(readme, new RegExp(phrase));
  }
});

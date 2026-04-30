import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const dockerignore = fs.readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dockerPublishWorkflow = fs.readFileSync(new URL('../.github/workflows/docker-publish.yml', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);

test('Docker 镜像安装 sharp 依赖并复制水印、存储和提示词增强运行文件', () => {
  assert.match(dockerfile, /COPY package\*\.json/);
  assert.match(dockerfile, /apk add --no-cache su-exec/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, /COPY frontend \.\/frontend/);
  assert.match(dockerfile, /COPY scripts\/docker-entrypoint\.sh \.\/scripts\/docker-entrypoint\.sh/);
  assert.match(dockerfile, /image-storage\.js/);
  assert.match(dockerfile, /image-watermark\.js/);
  assert.match(dockerfile, /prompt-enhancement\.js/);
  assert.match(dockerfile, /proxy-policy\.js/);
  assert.match(dockerfile, /proxy-executor\.js/);
  assert.match(dockerfile, /request-limits\.js/);
  assert.match(dockerfile, /account-store\.js/);
  assert.match(dockerfile, /account-store-file\.js/);
  assert.match(dockerfile, /account-store-upstash\.js/);
  assert.match(dockerfile, /account-store-capabilities\.js/);
  assert.match(dockerfile, /pow-config\.js/);
});

test('Docker 启动时会修正 bind mount 数据目录权限后再降权运行 Node', () => {
  const entrypoint = fs.readFileSync(new URL('../scripts/docker-entrypoint.sh', import.meta.url), 'utf8');

  assert.match(dockerfile, /ENV IMAGE_GEN_RUNTIME=node/);
  assert.match(dockerfile, /ENV IMAGE_GEN_DATA_DIR=\/app\/data/);
  assert.match(dockerfile, /chmod \+x \.\/scripts\/docker-entrypoint\.sh/);
  assert.match(dockerfile, /ENTRYPOINT \["\.\/scripts\/docker-entrypoint\.sh"\]/);
  assert.doesNotMatch(dockerfile, /^USER node$/m);
  assert.match(entrypoint, /mkdir -p "\$\{IMAGE_GEN_DATA_DIR:-\/app\/data\}" \/app\/config/);
  assert.match(entrypoint, /chown -R node:node "\$\{IMAGE_GEN_DATA_DIR:-\/app\/data\}" \/app\/config/);
  assert.match(entrypoint, /exec su-exec node "\$@"/);
});

test('Docker 构建只复制配置模板，不把本地运行态配置和数据打进镜像', () => {
  assert.match(dockerfile, /COPY config\/\.env\.example \.\/config\/\.env\.example/);
  assert.doesNotMatch(dockerfile, /COPY\s+config\s+\.\/config/);

  for (const pattern of [
    'config/.env',
    'config/.account-store-key',
    'config/*.local',
    'config/*.secret',
    '!config/.env.example',
    'data',
    '.oauth-sessions.json',
    '.tmp*',
    '*.log',
    '*.pid',
    'dist',
  ]) {
    assert.match(dockerignore, new RegExp(`(^|\\n)${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`));
  }

  assert.match(readme, /Docker 镜像构建时只复制 `config\/\.env\.example`/);
  assert.match(readme, /不会把本地 `config\/\.env`、`data\/`、`\.oauth-sessions\.json` 或 `\.tmp_\*` 临时文件打进镜像/);
  assert.match(readme, /清理页面对话/);
  assert.match(readme, /清理服务端图片/);
  assert.match(readme, /不会删除账号配置、`config\/\.env`、OAuth 会话文件或项目外文件/);
});

test('账号存储本地加密 key 不会被提交或打进 Docker 构建上下文', () => {
  for (const ignoreText of [gitignore, dockerignore]) {
    assert.match(ignoreText, /(^|\n)config\/\.account-store-key(\n|$)/);
  }
});

function copyPathFromRoot(source, destination, tempDir) {
  const from = new URL(source.replace(/^\.\//, ''), root);
  const to = path.join(tempDir, destination.replace(/^\.\//, ''));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.cpSync(from, to, { recursive: true });
  } else {
    fs.copyFileSync(from, to);
  }
}

function replayDockerCopiesBeforeStaticBuild(tempDir) {
  for (const rawLine of dockerfile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === 'RUN npm run build') break;
    if (!line.startsWith('COPY ')) continue;
    const parts = line.split(/\s+/);
    const destination = parts.at(-1);
    const sources = parts.slice(1, -1);
    if (sources.includes('package*.json')) continue;
    for (const source of sources) {
      const target = destination.endsWith('/')
        ? path.posix.join(destination, path.posix.basename(source))
        : destination;
      copyPathFromRoot(source, target, tempDir);
    }
  }
}

test('Docker 静态构建阶段会带上 frontend ES modules 产物', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-docker-build-'));
  try {
    replayDockerCopiesBeforeStaticBuild(tempDir);
    execFileSync(process.execPath, ['scripts/build-static.js'], {
      cwd: tempDir,
      stdio: 'pipe',
    });
    for (const modulePath of [
      'dist/frontend/dom.js',
      'dist/frontend/http.js',
      'dist/frontend/state.js',
      'dist/frontend/background-jobs.js',
      'dist/frontend/error-dialog.js',
      'dist/frontend/dialog-a11y.js',
    ]) {
      assert.ok(fs.existsSync(path.join(tempDir, modulePath)), `${modulePath} should exist in Docker build output`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Docker 发布前有质量门禁和可跳过烟测入口', () => {
  assert.equal(packageJson.scripts['test:docker:packaging'], 'node --test test/docker-packaging.test.js');
  assert.equal(packageJson.scripts['smoke:docker'], 'node scripts/docker-smoke-test.mjs');
  assert.match(packageJson.scripts.test, /--test-concurrency=1/);
  assert.match(packageJson.scripts['ci:release-gate'], /npm test/);
  assert.match(packageJson.scripts['ci:release-gate'], /npm run build/);
  assert.match(packageJson.scripts['ci:release-gate'], /npm run smoke:docker/);

  const smokeScript = fs.readFileSync(new URL('../scripts/docker-smoke-test.mjs', import.meta.url), 'utf8');
  assert.match(smokeScript, /REQUIRE_DOCKER_SMOKE/);
  assert.match(smokeScript, /process\.env\.CI === 'true'/);
  assert.match(smokeScript, /docker command not found/);
  assert.match(smokeScript, /docker daemon is not available/);
  assert.match(smokeScript, /runDocker\(\['build'/);
  assert.match(smokeScript, /function cleanupSmokeImage\(\)/);
  assert.match(smokeScript, /'image', 'rm', '-f', imageTag/);
  assert.match(smokeScript, /failed to remove smoke image/);
  assert.match(smokeScript, /127\.0\.0\.1:\$\{port\}:3000/);
  assert.match(smokeScript, /\/frontend\/state\.js/);
  assert.match(smokeScript, /\/api\/config\/runtime/);
});

test('Docker 发布 workflow 先测试和烟测，再登录并推送镜像', () => {
  for (const expected of [
    'actions/setup-node@v4',
    'npm ci',
    'npm run ci:release-gate',
    "REQUIRE_DOCKER_SMOKE: '1'",
    'docker/setup-buildx-action@v3',
    'docker/login-action@v3',
    'docker/build-push-action@v6',
    'push: true',
  ]) {
    assert.match(dockerPublishWorkflow, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const gateIndex = dockerPublishWorkflow.indexOf('npm run ci:release-gate');
  const buildxIndex = dockerPublishWorkflow.indexOf('docker/setup-buildx-action@v3');
  const loginIndex = dockerPublishWorkflow.indexOf('docker/login-action@v3');
  const pushIndex = dockerPublishWorkflow.indexOf('docker/build-push-action@v6');

  assert.ok(gateIndex > 0, 'release gate should exist');
  assert.ok(buildxIndex > gateIndex, 'Buildx should run after the release gate');
  assert.ok(loginIndex > buildxIndex, 'Docker Hub login should run after local validation');
  assert.ok(pushIndex > loginIndex, 'image push should run after Docker Hub login');
});

test('README 说明发布门禁和 Node 版本要求', () => {
  assert.equal(packageJson.engines.node, '>=22');
  assert.match(readme, /Node\.js 22 或更高版本/);
  assert.match(readme, /推荐使用 `npm ci`/);
  assert.match(readme, /npm run ci:release-gate/);
  assert.match(readme, /REQUIRE_DOCKER_SMOKE=1/);
  assert.match(readme, /通过单元测试、静态构建和 Docker smoke 后才登录 Docker Hub/);
});

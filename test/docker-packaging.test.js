import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('Docker 镜像安装 sharp 依赖并复制水印和存储运行文件', () => {
  assert.match(dockerfile, /COPY package\*\.json/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /image-storage\.js/);
  assert.match(dockerfile, /image-watermark\.js/);
});

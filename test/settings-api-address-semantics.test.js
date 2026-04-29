import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('设置中心不再提供服务端默认 API 地址主入口，API 地址回到账号编辑', () => {
  assert.doesNotMatch(html, /id="serverDefaultApiUrl"/);
  assert.doesNotMatch(html, /<label for="serverDefaultApiUrl">默认 API 地址<\/label>/);
  assert.match(html, /<label for="editUrl">此账号的 API 地址<\/label>/);
  assert.match(html, /当前账号实际请求会优先使用这里的地址/);
});

test('保存服务端默认配置时会保留已有 providerDefaults.apiUrl，避免无字段时清空旧配置', () => {
  assert.doesNotMatch(app, /\$\('#serverDefaultApiUrl'\)/);
  assert.match(app, /apiUrl:\s*current\.providerDefaults\?\.apiUrl \|\| getProviderDefaults\(\)\.apiUrl/);
});

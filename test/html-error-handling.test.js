import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('前端直连 Images API 遇到 HTML 错误页时不直接抛 Unexpected token', () => {
  assert.match(app, /async function readJsonResponse\(resp/);
  assert.match(app, /await resp\.text\(\)/);
  assert.match(app, /上游返回了 HTML 错误页面/);
  assert.doesNotMatch(app, /const data = await resp\.json\(\);\n\s*if \(!resp\.ok\) throw new Error\(normalizeGenerationError\(data\.error\?\.message \|\| data\.message \|\| `HTTP \$\{resp\.status\}`\)\)/);
  assert.match(app, /const data = await readJsonResponse\(resp, 'Images API'\)/);
});

test('后端 Images API 任务遇到 HTML 错误页时返回可读上游错误', () => {
  assert.match(server, /async function readUpstreamJson\(resp/);
  assert.match(server, /await resp\.text\(\)/);
  assert.match(server, /上游返回了 HTML 错误页面/);
  assert.match(server, /const data = await readUpstreamJson\(resp, 'Images API'\)/);
});

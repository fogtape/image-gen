import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeHtml, renderOAuthLoopbackPage } from '../server.js';

test('OAuth loopback HTML 会转义动态错误文本，避免把上游错误当 HTML 注入', () => {
  const malicious = '<script>alert(1)</script>&"\'';
  const html = renderOAuthLoopbackPage('登录失败', malicious);

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;&quot;&#39;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.equal(escapeHtml(malicious), '&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;');
});

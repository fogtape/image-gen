import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('README 明确项目定位为 OpenAI 系中转或 ChatGPT OAuth', () => {
  assert.match(readme, /目前只支持 OpenAI 系/);
  assert.match(readme, /OpenAI 兼容/);
  assert.match(readme, /ChatGPT OAuth/);
  assert.match(readme, /不支持 Midjourney|不支持 Stable Diffusion|不支持 ComfyUI/);
});

test('README 说明 OAuth 登录流程和 localhost 回跳不可访问的处理方式', () => {
  assert.match(readme, /## ChatGPT OAuth 登录流程/);
  assert.match(readme, /授权链接/);
  assert.match(readme, /localhost/);
  assert.match(readme, /无法访问|打不开|不可访问/);
  assert.match(readme, /复制.*回调链接|粘贴.*回调链接|授权码/);
});

test('README 提醒云平台后台生图能力有限，推荐 Node 或 Docker', () => {
  assert.match(readme, /云平台/);
  assert.match(readme, /后台生图不太好用|后台任务不适合长期/);
  assert.match(readme, /Node \/ Docker|Docker \/ Compose|Node \/ VPS/);
  assert.match(readme, /浏览器直连/);
});

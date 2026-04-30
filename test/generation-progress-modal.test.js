import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  getGenerationProgressView,
  normalizeGenerationPercent,
} from '../ui-feedback.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}

test('生成中弹窗提供图片轮廓、进度条和可读状态', () => {
  assert.match(html, /id="generationProgressOverlay"[^>]*class="overlay hidden"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="generationProgressTitle"[^>]*aria-describedby="generationProgressMeta"/);
  assert.match(html, /class="modal generation-progress-dialog"/);
  assert.match(html, /class="generation-image-skeleton"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /id="generationProgressPreview"/);
  assert.match(html, /id="generationProgressPercent"[^>]*>0%<\/span>/);
  assert.match(html, /id="generationProgressBar"[^>]*role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="0"/);
  assert.match(html, /id="generationProgressFill"/);
  assert.match(html, /id="generationProgressMeta"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="generationProgressMinimize"[^>]*>最小化<\/button>/);
  assert.match(html, /id="generationProgressCancel"[^>]*>停止任务<\/button>/);
});

test('生成中弹窗居中且移动端不溢出，动画支持 reduced motion', () => {
  const dialog = ruleBody('.generation-progress-dialog');
  assert.match(dialog, /max-width\s*:\s*420px\s*;/);
  assert.match(dialog, /overflow\s*:\s*hidden\s*;/);

  const body = ruleBody('.generation-progress-body');
  assert.match(body, /padding\s*:\s*22px\s*;/);

  const skeleton = ruleBody('.generation-image-skeleton');
  assert.doesNotMatch(skeleton, /height\s*:\s*138px\s*;/);
  assert.match(skeleton, /aspect-ratio\s*:\s*4\s*\/\s*3\s*;/);
  assert.match(skeleton, /overflow\s*:\s*hidden\s*;/);
  assert.doesNotMatch(css, /generation-progress-preview/);
  assert.doesNotMatch(css, /has-preview/);

  const percent = ruleBody('.generation-progress-percent');
  assert.match(percent, /font-variant-numeric\s*:\s*tabular-nums\s*;/);
  assert.match(percent, /min-width\s*:\s*4ch\s*;/);

  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.generation-progress-dialog\s*\{[\s\S]*?max-width:\s*calc\(100vw - 16px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.generation-image-skeleton::before\s*\{[\s\S]*?animation:\s*none/);
});

test('阶段进度映射区分真实和预计百分比', () => {
  assert.equal(normalizeGenerationPercent(-1), null);
  assert.equal(normalizeGenerationPercent(38.6), 39);
  assert.equal(normalizeGenerationPercent(160), 100);

  assert.deepEqual(getGenerationProgressView({ phase: 'prompt:prepare' }), {
    percent: 6,
    kind: 'estimated',
    label: '预计进度',
  });
  assert.deepEqual(getGenerationProgressView({ phase: 'response:image_done' }), {
    percent: 88,
    kind: 'estimated',
    label: '预计进度',
  });
  assert.deepEqual(getGenerationProgressView({ phase: 'batch:item:start', percent: 50, progressKind: 'real', current: 2, total: 4 }), {
    percent: 50,
    kind: 'real',
    label: '真实进度',
    detail: '已完成 2/4 张',
  });
});

test('生成状态只写入弹窗进度，生成按钮左侧不再重复显示进度', () => {
  assert.match(app, /function updateGenerationProgressDialog/);
  assert.match(app, /function setToolbarGenerationHint/);
  assert.match(app, /state\.generating[\s\S]*?setToolbarGenerationHint\(''\)/);
  assert.doesNotMatch(app, /hintEl\.textContent\s*=\s*text/);
  assert.match(app, /updateGenerationProgressDialog\(\{\s*phase,\s*message,\s*text,\s*meta/);
});


test('前端会把 SSE progress 事件的 percent 透传到进度弹窗', () => {
  assert.match(app, /function generationProgressPhaseFromSse/);
  assert.match(app, /type === 'response\.output_item\.added'[\s\S]*?'response:image_started'/);
  assert.match(app, /function generationProgressOptionsFromSse/);
  assert.match(app, /progressKind/);
  assert.doesNotMatch(app, /setGenerationProgressPreview/);
  assert.doesNotMatch(app, /previewImage/);
  assert.match(app, /setGenerationStatus\(message,\s*undefined,\s*generationProgressOptionsFromSse\(data, event\)\)/);
  assert.match(app, /setGenerationStatus\(message,\s*undefined,\s*generationProgressOptionsFromSse\(ev\)\)/);
});

test('Responses 流式生图请求启用 partial_images 并把 partial_image 事件映射为进度', () => {
  assert.match(app, /partial_images\s*:\s*3/);
  assert.match(server, /partial_images\s*:\s*3/);
  assert.match(app, /response\.image_generation_call\.partial_image[\s\S]*?'response:image_partial'/);
});

test('底部后台任务胶囊查看按钮可重新打开已最小化的生成详情弹窗', () => {
  assert.match(app, /function openGenerationProgressFromBanner/);
  assert.match(app, /if \(state\.generating\) \{[\s\S]*showGenerationProgressDialog\(\);[\s\S]*return;/);
  assert.match(app, /\$\('#retryActiveJobBtn'\)\?\.addEventListener\('click', \(\) => \{ openGenerationProgressFromBanner\(\); \}\)/);
  assert.doesNotMatch(app, /\$\('#retryActiveJobBtn'\)\?\.addEventListener\('click', \(\) => \{ void resumeActiveJobIfAny\(\); \}\)/);
});

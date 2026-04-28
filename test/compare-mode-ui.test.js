import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('首页在高级选项里提供多账号多模型对比模式入口和目标列表', () => {
  const advancedBlock = html.match(/<details class="advanced-panel">[\s\S]*?<\/details>/)?.[0] || '';
  assert.match(advancedBlock, /id="comparePanel"/);
  assert.match(html, /id="compareModeEnabled"/);
  assert.match(html, /id="compareTargetList"/);
  assert.match(html, /id="compareStatus"/);
  assert.match(css, /\.compare-panel/);
  assert.match(css, /\.compare-target-list/);
  assert.match(css, /\.compare-target-model/);
});

test('前端对比模式从账号列表读取目标并允许临时覆盖模型', () => {
  assert.match(app, /function renderCompareTargets\(\)/);
  assert.match(app, /function readCompareTargets\(\)/);
  assert.match(app, /getEffectiveForAccount\(acc, \{ model: modelOverride \}\)/);
  assert.match(app, /compare-target-check/);
  assert.match(app, /compare-target-model/);
  assert.match(app, /对比模式至少需要选择 2 个账号\/模型组合/);
});

test('对比生成复用后台任务并用 compare 元数据标记结果卡片', () => {
  assert.match(app, /async function genCompareImages\(targets, prompt, quality, background, size, format, hasRef, count = 1\)/);
  assert.match(app, /const compareId = `compare_\$\{genId\(\)\}`/);
  assert.match(app, /Promise\.all\(targets\.map/);
  assert.match(app, /compareIndex: target\.compareIndex/);
  assert.match(app, /compareCount: common\.compareCount/);
  assert.match(app, /compareLabel: target\.label/);
  assert.match(app, /batchId: `\$\{common\.compareId\}_\$\{target\.compareIndex\}`/);
  assert.match(app, /cfg: publicJobCfg\(cfg\)/);
  assert.match(app, /handleImagesResult\(job\.result, common\.format, resultMeta\)/);
  assert.match(app, /对比 \$\{meta\.compareIndex \|\| '\?'\} \/ \$\{meta\.compareCount\}/);
});

test('对比后台轮询具备有限重试，已创建任务不会因轮询波动改走直连重复生成', () => {
  const waitBody = app.match(/async function waitCompareBackgroundJob[\s\S]*?\n}\n\nasync function runCompareTarget/)?.[0] || '';
  assert.match(waitBody, /retryCount/);
  assert.match(waitBody, /isRetryableBackgroundJobError\(e\)/);
  assert.match(waitBody, /BACKGROUND_JOB_POLL_RETRY_LIMIT/);
  assert.match(waitBody, /backgroundJobBackoffMs/);

  const runBody = app.match(/async function runCompareTarget[\s\S]*?\n}\n\nasync function genCompareImages/)?.[0] || '';
  const createFailureBlock = runBody.match(/job = await createBackgroundJob\(payload\);[\s\S]*?return \{ ok: false, error: e \};/)?.[0] || '';
  assert.match(createFailureBlock, /isBackgroundJobsUnavailableError\(e\)/);
  assert.match(createFailureBlock, /genDirectImagesAfterJobFallback/);

  const pollingBlock = runBody.match(/return await waitCompareBackgroundJob[\s\S]*?return \{ ok: false, error: e \};/)?.[0] || '';
  assert.match(pollingBlock, /addFailedResultCard/);
  assert.doesNotMatch(pollingBlock, /genDirectImagesAfterJobFallback/);
});

test('对比模式不再包含 mask 特殊分支', () => {
  assert.doesNotMatch(app, /maskImageBase64|局部编辑 mask|MASK_UNSUPPORTED_MODE/);
});

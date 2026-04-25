import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('顶部提供独立设置入口并包含生成、水印、存储分组', () => {
  assert.match(html, /id="openSettings"/);
  assert.match(html, /id="settingsOverlay"/);
  assert.match(html, />生成设置</);
  assert.match(html, />水印设置</);
  assert.match(html, />存储管理</);
});

test('设置面板支持默认尺寸质量格式和成熟水印配置', () => {
  for (const id of [
    'settingsDefaultSize',
    'settingsDefaultQuality',
    'settingsDefaultFormat',
    'watermarkEnabled',
    'watermarkTemporaryMode',
    'watermarkMode',
    'watermarkText',
    'watermarkTimeFormat',
    'watermarkPosition',
    'watermarkOpacity',
    'watermarkFontSize',
    'watermarkBackground',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
  assert.match(html, /相机时间/);
  assert.match(html, /仅本次/);
});

test('设置默认尺寸选项与首页尺寸选项保持一致，避免保存设置后丢失 4:7 等尺寸', () => {
  const settingsMatch = html.match(/<select id="settingsDefaultSize">([\s\S]*?)<\/select>/);
  const homepageMatch = html.match(/<div class="custom-select" id="sizeSelect"[\s\S]*?<div class="cs-dropdown hidden">([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(settingsMatch, 'settings default size select should exist');
  assert.ok(homepageMatch, 'homepage size select should exist');

  const settingsSizes = [...settingsMatch[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  const homepageSizes = [...homepageMatch[1].matchAll(/class="cs-item" data-value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(settingsSizes, homepageSizes);
});

test('设置会参与后台生成任务且不依赖刷新内存结果', () => {
  assert.match(app, /APP_SETTINGS_KEY/);
  assert.match(app, /getEffectiveWatermarkSettings/);
  assert.match(app, /watermarkSettings:/);
  assert.match(app, /storageSettings:/);
  assert.match(app, /loadImageHistory/);
  assert.match(app, /clearStorageData/);
});

test('提示词增强默认关闭，开启后可选择自动或手动修饰', () => {
  assert.match(html, />提示词增强</);
  assert.match(html, /开启 AI 提示词修饰/);
  assert.match(html, /id="promptEnhancementEnabled"/);
  assert.match(html, /id="promptEnhancementOptions"[^>]*class="[^"]*hidden/);
  assert.doesNotMatch(html, /id="promptEnhancementEnabled"[^>]*checked/);
  assert.match(html, /id="promptEnhancementRunMode"/);
  assert.match(html, /value="manual"[^>]*>手动/);
  assert.match(html, /value="auto"[^>]*>自动/);
  assert.match(html, /id="promptEnhancementModel"/);
  assert.match(html, /id="promptEnhancementMode"/);
  assert.match(html, /id="promptEnhancementLanguage"/);
  assert.doesNotMatch(html, /id="promptEnhancementOutput"/);
  assert.match(app, /promptEnhancement:\s*\{[^}]*enabled:\s*false[^}]*runMode:\s*'manual'/s);
  assert.match(app, /syncPromptEnhancementUi/);
});

test('手动模式显示修饰按钮且生成按钮不调用修饰接口，自动模式相反', () => {
  assert.match(html, /id="enhancePromptBtn"[^>]*class="[^"]*hidden/);
  assert.doesNotMatch(html, /id="editPromptModel"/);
  assert.match(html, /aria-label="润色提示词"/);
  assert.match(css, /\.prompt-tools/);
  assert.match(css, /\.enhance-prompt-btn/);
  assert.match(css, /\.enhance-prompt-btn\.hidden\s*\{\s*display\s*:\s*none/);
  assert.match(css, /flex-wrap\s*:\s*wrap/);
  assert.match(app, /isPromptEnhancementAutoMode/);
  assert.match(app, /isPromptEnhancementManualMode/);
  assert.match(app, /requestPromptEnhancement\(cfg, prompt, style, type, promptEnhancementSettingsForRequest\(true\)\)/);
  assert.match(app, /if \(shouldAutoEnhance\)/);
  assert.match(app, /const shouldAutoEnhance = isPromptEnhancementAutoMode\(\)/);
  assert.match(app, /classList\.toggle\('hidden', !isPromptEnhancementManualMode\(source\)\)/);
});

test('生成失败会用居中弹窗提示完整错误，方便后台回来查看', () => {
  assert.match(html, /id="generationErrorOverlay"/);
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /id="generationErrorMessage"/);
  assert.match(html, /id="generationErrorClose"/);
  assert.match(html, /id="generationErrorConfirm"/);
  assert.match(css, /\.error-dialog/);
  assert.match(css, /\.error-dialog-message/);
  assert.match(app, /function showGenerationErrorDialog/);
  assert.match(app, /showGenerationErrorDialog\(normalized\)/);
  assert.match(app, /\$\('#generationErrorClose'\)\?\.addEventListener\('click', hideGenerationErrorDialog\)/);
  assert.match(app, /\$\('#generationErrorConfirm'\)\?\.addEventListener\('click', hideGenerationErrorDialog\)/);
});

test('设置界面样式保持简洁并适配移动端', () => {
  assert.match(css, /\.settings-grid/);
  assert.match(css, /\.watermark-preview/);
  assert.match(css, /\.danger-zone/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

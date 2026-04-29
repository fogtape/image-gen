import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const html = read('index.html');
const app = read('app.js');
const css = read('style.css');
const dialogA11y = read('frontend/dialog-a11y.js');
const errorDialog = read('frontend/error-dialog.js');

test('P3.9 弹窗统一支持焦点陷阱、Escape 关闭和恢复焦点', () => {
  assert.match(app, /from '\.\/frontend\/dialog-a11y\.js'/);
  assert.match(dialogA11y, /export function getFocusableElements/);
  assert.match(dialogA11y, /export function openDialog/);
  assert.match(dialogA11y, /export function closeDialog/);
  assert.match(dialogA11y, /export function handleDialogKeydown/);
  assert.match(dialogA11y, /event\.key !== 'Tab'/);
  assert.match(dialogA11y, /event\.key === 'Escape'/);
  assert.match(dialogA11y, /restoreFocus/);
  assert.match(app, /openDialog\(\$\('#settingsOverlay'\)/);
  assert.match(app, /closeDialog\(\$\('#settingsOverlay'\)/);
  assert.match(app, /openSettingsCenter\('accounts'/);
  assert.doesNotMatch(app, /openDialog\(\$\('#accountOverlay'\)/);
  assert.match(app, /openDialog\(\$\('#editOverlay'\)/);
  assert.match(app, /openDialog\(\$\('#lightbox'\)/);
  assert.match(errorDialog, /openDialog\(overlay,\s*\{\s*focusSelector:\s*'#generationErrorConfirm'/);
  assert.match(errorDialog, /closeDialog\(\$\('#generationErrorOverlay'\)\)/);
});

test('P3.9 状态和错误区域对读屏可感知', () => {
  assert.match(html, /id="generationHint"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="generateBtn"[^>]*aria-busy="false"/);
  assert.match(html, /id="errorMsg"[^>]*role="alert"[^>]*aria-live="assertive"/);
  assert.match(errorDialog, /function setPersistentErrorSummary/);
  assert.match(errorDialog, /setPersistentErrorSummary\(text\)/);
  assert.match(app, /generateBtn\.setAttribute\('aria-busy', on \? 'true' : 'false'\)/);
  assert.match(app, /generateBtn\.setAttribute\('aria-disabled', on \? 'true' : 'false'\)/);
  assert.doesNotMatch(app, /alert\(/);
});

test('P3.9 自定义尺寸选择器支持 ARIA 状态和键盘选择', () => {
  assert.match(html, /class="cs-trigger"[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"/);
  assert.match(html, /class="cs-dropdown hidden"[^>]*role="listbox"[^>]*aria-label="选择图片尺寸"/);
  assert.match(html, /class="[^"]*\bcs-item\b[^"]*"[^>]*role="option"[^>]*aria-selected="true"/);
  assert.match(app, /function setSizeSelectOpen/);
  assert.match(app, /setAttribute\('aria-expanded', open \? 'true' : 'false'\)/);
  assert.match(app, /setAttribute\('aria-selected', active \? 'true' : 'false'\)/);
  assert.match(app, /function handleSizeTriggerKeydown/);
  assert.match(app, /function handleSizeItemKeydown/);
  assert.match(app, /'ArrowDown'/);
  assert.match(app, /'Home'/);
  assert.match(app, /'End'/);
});

test('P3.9 账号切换和账号管理可键盘操作', () => {
  assert.match(html, /id="switcherBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="switcherDropdown"/);
  assert.match(html, /id="switcherDropdown"[^>]*role="menu"[^>]*aria-label="账号切换"/);
  assert.match(app, /setAttribute\('role', 'menuitemradio'\)/);
  assert.match(app, /setAttribute\('aria-checked', acc\.id === state\.data\.activeId \? 'true' : 'false'\)/);
  assert.match(app, /function handleSwitcherKeydown/);
  assert.match(app, /function handleDropdownKeydown/);
  assert.match(app, /list\.setAttribute\('role', 'radiogroup'\)/);
  assert.match(app, /card\.setAttribute\('role', 'radio'\)/);
  assert.match(app, /event\.key !== 'Enter' && event\.key !== ' '/);
});

test('P3.9 移动端布局有 360px 和安全区兜底', () => {
  assert.match(css, /padding:\s*max\(12px,\s*env\(safe-area-inset-top\)\)/);
  assert.match(css, /max-height:\s*min\(85vh,\s*calc\(100dvh - 24px\)\)/);
  assert.match(css, /padding:\s*14px 20px calc\(14px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.input-toolbar\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.backup-actions \.btn\s*\{[\s\S]*?width:\s*100%/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?max-height:\s*calc\(100dvh - 16px\)/);
});

test('P3.6 reduced motion 下关闭长动画和 transition', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration:\s*0\.001ms !important/);
  assert.match(css, /transition-duration:\s*0\.001ms !important/);
  assert.match(css, /scroll-behavior:\s*auto !important/);
});

test('P2 开关、上传入口、分段控件、图标按钮和表单 label 可访问', () => {
  assert.doesNotMatch(css, /\.switch-label input\s*\{\s*display:\s*none/);
  assert.match(css, /\.switch-label input:focus-visible \+ \.switch/);
  assert.match(css, /\.sr-only/);
  assert.match(html, /<label class="sr-only" for="prompt">图片提示词<\/label>/);

  assert.match(html, /<button class="tool-btn" id="uploadLabel" type="button"[^>]*aria-label="上传参考图，最多 3 张"/);
  assert.match(html, /<input type="file" id="refImage"[^>]*multiple hidden>/);
  assert.doesNotMatch(html, /id="maskUploadLabel"|id="maskImage"/);
  assert.match(app, /\$\('#uploadLabel'\)\?\.addEventListener\('click', \(\) => \$\('#refImage'\)\?\.click\(\)\)/);
  assert.doesNotMatch(app, /maskUploadLabel|maskImage/);

  assert.match(html, /class="seg" data-field="quality" role="group" aria-labelledby="qualitySegLabel"/);
  assert.match(html, /data-value="medium" class="active" aria-pressed="true"/);
  assert.match(app, /function setSegmentValue\(group, value\)/);
  assert.match(app, /btn\.setAttribute\('aria-pressed', active \? 'true' : 'false'\)/);
  assert.match(app, /function handleSegmentKeydown\(event, group, btn\)/);
  assert.match(app, /'ArrowLeft'/);
  assert.match(app, /'Home'/);

  assert.match(html, /id="openSettings"[^>]*aria-label="打开设置"/);
  assert.match(html, /id="toggleEditKey"[^>]*aria-label="显示 API Key"[^>]*aria-pressed="false"/);
  assert.match(app, /btn\.setAttribute\('aria-label', show \? '隐藏 API Key' : '显示 API Key'\)/);
  assert.match(html, /<label for="formatSelect">格式<\/label>/);
  assert.match(html, /<label for="styleSelect">风格<\/label>/);
  assert.match(html, /<label for="typeSelect">类型<\/label>/);
  assert.match(css, /\.btn:focus-visible/);
  assert.match(css, /\.tool-btn:focus-visible/);
  assert.match(css, /\.seg button:focus-visible/);
});

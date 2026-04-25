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

test('设置会参与后台生成任务且不依赖刷新内存结果', () => {
  assert.match(app, /APP_SETTINGS_KEY/);
  assert.match(app, /getEffectiveWatermarkSettings/);
  assert.match(app, /watermarkSettings:/);
  assert.match(app, /storageSettings:/);
  assert.match(app, /loadImageHistory/);
  assert.match(app, /clearStorageData/);
});

test('设置界面样式保持简洁并适配移动端', () => {
  assert.match(css, /\.settings-grid/);
  assert.match(css, /\.watermark-preview/);
  assert.match(css, /\.danger-zone/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAMERA_TIME_FORMAT,
  buildWatermarkSvg,
  normalizeWatermarkSettings,
  renderWatermarkLines,
} from '../image-watermark.js';

const fixedNow = new Date('2026-04-25T11:32:45+08:00');

test('normalizeWatermarkSettings 提供安全默认值并限制异常输入', () => {
  const settings = normalizeWatermarkSettings({
    enabled: true,
    mode: 'camera-time',
    text: '  My Brand  ',
    position: 'bad-position',
    opacity: 9,
    fontSize: 500,
    color: 'javascript:red',
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.mode, 'camera-time');
  assert.equal(settings.text, 'My Brand');
  assert.equal(settings.position, 'bottom-right');
  assert.equal(settings.opacity, 0.72);
  assert.equal(settings.fontSize, 28);
  assert.equal(settings.color, '#ffffff');
});

test('相机时间水印按固定时间生成双行相机风格文本', () => {
  const lines = renderWatermarkLines({ enabled: true, mode: 'camera-time', text: 'AI Image Studio', timeFormat: CAMERA_TIME_FORMAT }, fixedNow);
  assert.deepEqual(lines, ['AI Image Studio', '2026.04.25 11:32']);
});

test('自定义文字和当前时间可以组合为成熟水印', () => {
  const lines = renderWatermarkLines({ enabled: true, mode: 'custom-time', text: '私有作品', timeFormat: 'slash' }, fixedNow);
  assert.deepEqual(lines, ['私有作品', '2026/04/25 11:32']);
});

test('buildWatermarkSvg 根据图片尺寸、位置和样式生成可叠加 SVG', () => {
  const svg = buildWatermarkSvg(1200, 800, {
    enabled: true,
    mode: 'camera-time',
    text: 'AI Image Studio',
    position: 'bottom-left',
    opacity: 0.66,
    fontSize: 26,
    color: '#fff7cc',
    shadow: true,
    background: true,
    timeFormat: CAMERA_TIME_FORMAT,
  }, fixedNow);

  assert.match(svg, /<svg/);
  assert.match(svg, /AI Image Studio/);
  assert.match(svg, /2026\.04\.25 11:32/);
  assert.match(svg, /fill="#fff7cc"/);
  assert.match(svg, /opacity="0.66"/);
  assert.match(svg, /text-anchor="start"/);
});

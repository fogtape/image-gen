import {
  POLICY_VIOLATION_MESSAGE,
  isPolicyViolationText,
  normalizeGenerationError,
} from '../ui-feedback.js';
import { closeDialog, openDialog } from './dialog-a11y.js';
import { $ } from './dom.js';

export function hideGenerationErrorDialog() {
  closeDialog($('#generationErrorOverlay'));
}

export function setPersistentErrorSummary(message = '') {
  const el = $('#errorMsg');
  if (!el) return;
  const text = String(message || '').trim();
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

export function classifyGenerationError(error = {}) {
  const message = normalizeGenerationError(error.message || error.error || error);
  const code = String(error.code || error.type || '').toUpperCase();
  const status = Number(error.status || error.httpStatus || 0);
  if (code.startsWith('CONFIG_') || error.context === 'settings') {
    return {
      kind: '设置保存失败',
      suggestion: '本地偏好可以继续保存；如果要修改服务端默认配置，请确认当前部署提供配置 API，并检查配置管理口令。',
      debug: error.debug || code,
    };
  }
  if (isPolicyViolationText(message) || code.includes('POLICY')) {
    return {
      kind: '内容策略限制',
      suggestion: POLICY_VIOLATION_MESSAGE,
      debug: error.debug || '',
    };
  }
  if (code === 'JOB_PENDING_TIMEOUT' || code === 'JOB_RUNNING_TIMEOUT') {
    return {
      kind: '后台任务超时',
      suggestion: '任务可能卡住或队列拥堵，请稍后重试；如果持续出现，请降低并发或检查上游服务。',
      debug: error.debug || code,
    };
  }
  if (code === 'TIMEOUT' || error.isTimeout || status === 504) {
    return {
      kind: '请求超时',
      suggestion: '请检查网络和上游服务状态；后台生成可能仍在继续，可稍后重试或恢复任务。',
      debug: error.debug || code,
    };
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key|无权限|鉴权/i.test(message)) {
    return {
      kind: '鉴权失败',
      suggestion: '请检查账号 API Key、OAuth 登录状态或管理 token 是否正确。',
      debug: error.debug || code,
    };
  }
  if (error.fallbackAttempted === true) {
    return {
      kind: '兼容回退失败',
      suggestion: '已尝试兼容回退但仍失败，请检查模型、图生图兼容模式或上游返回内容。',
      debug: error.debug || '',
    };
  }
  return {
    kind: '生成失败',
    suggestion: '请根据错误信息调整提示词、模型或账号配置后重试。',
    debug: error.debug || code,
  };
}

export function normalizeErrorDialogPayload(input) {
  if (input && typeof input === 'object') {
    const message = normalizeGenerationError(input.message || input.error || input);
    return {
      ...input,
      message,
      status: input.status || input.httpStatus,
      code: input.code || input.type,
    };
  }
  return { message: normalizeGenerationError(input) };
}

export function showGenerationErrorDialog(input) {
  const overlay = $('#generationErrorOverlay');
  if (!overlay) return;
  const details = normalizeErrorDialogPayload(input);
  const classification = classifyGenerationError(details);
  $('#generationErrorKind').textContent = classification.kind;
  $('#generationErrorMessage').textContent = details.message || '生成失败';
  $('#generationErrorSuggestion').textContent = classification.suggestion;
  const debugBox = $('#generationErrorDebug');
  const debugText = $('#generationErrorDebugText');
  const debug = details.debug || classification.debug || details.code || '';
  if (debugBox && debugText) {
    debugText.textContent = String(debug || '');
    debugBox.classList.toggle('hidden', !debug);
  }
  openDialog(overlay, { focusSelector: '#generationErrorConfirm' });
}

export function showError(msg) {
  console.error(msg);
  const details = normalizeErrorDialogPayload(msg);
  const text = details.message || String(msg || '操作失败');
  $('#generationHint').textContent = text;
  $('#generationHint').title = text;
  setPersistentErrorSummary(text);
  showGenerationErrorDialog(details);
}

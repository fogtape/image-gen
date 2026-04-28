import {
  POLICY_VIOLATION_MESSAGE,
  isPolicyViolationText,
  normalizeGenerationError,
} from '../ui-feedback.js';
import { closeDialog, openDialog } from './dialog-a11y.js';
import { $ } from './dom.js';

const BASE_ERROR_DIALOG = {
  title: '操作失败',
  summary: '操作没有完成，请查看下面的错误信息。',
  kind: '操作错误',
  suggestion: '请根据错误信息调整后重试；如果持续失败，可以刷新页面后再试。',
};

const CONTEXT_ERROR_DIALOGS = {
  generation: {
    title: '图片生成失败',
    summary: '图片没有生成成功，请查看具体原因。',
    kind: '生成链路失败',
    suggestion: '请根据错误信息调整提示词、模型或账号配置后重试。',
  },
  'prompt-enhancement': {
    title: '提示词润色失败',
    summary: '提示词没有完成润色，原始输入还在输入框中。',
    kind: '提示词增强失败',
    suggestion: '请检查账号配置、优化模型或稍后重试；也可以直接用原提示词生成。',
  },
  'prompt-history': {
    title: '提示词历史操作失败',
    summary: '提示词历史没有按预期完成操作。',
    kind: '提示词历史错误',
    suggestion: '请确认已选择有效历史记录，或重新保存当前提示词。',
  },
  validation: {
    title: '信息还没填完整',
    summary: '当前操作缺少必要输入。',
    kind: '输入缺失',
    suggestion: '请补全提示词、账号或必要参数后再继续。',
  },
  account: {
    title: '账号配置有问题',
    summary: '当前账号缺少必要配置或鉴权不可用。',
    kind: '账号配置错误',
    suggestion: '请检查 API 地址、Key、OAuth 登录状态和模型配置。',
  },
  oauth: {
    title: 'OAuth 登录失败',
    summary: 'OAuth 登录或授权交换没有完成。',
    kind: 'OAuth 错误',
    suggestion: '请重新发起登录，确认回调链接或授权码完整后再提交。',
  },
  reference: {
    title: '参考图处理失败',
    summary: '参考图没有成功加入本次生成。',
    kind: '参考图错误',
    suggestion: '请确认图片格式、数量和大小符合限制后再试。',
  },
  history: {
    title: '历史记录操作失败',
    summary: '图片历史记录没有完成当前操作。',
    kind: '历史记录错误',
    suggestion: '请刷新历史记录后重试；如果是删除或收藏，请确认管理口令可用。',
  },
  storage: {
    title: '存储操作失败',
    summary: '本地或服务端存储没有完成当前操作。',
    kind: '存储错误',
    suggestion: '请确认存储服务可用、管理口令正确，并稍后重试。',
  },
  'backup-export': {
    title: '备份导出失败',
    summary: '备份文件没有成功导出。',
    kind: '备份导出错误',
    suggestion: '请确认浏览器支持所需能力；完整备份需要输入加密密码。',
  },
  'backup-import': {
    title: '备份导入失败',
    summary: '备份文件没有成功读取或应用。',
    kind: '备份导入错误',
    suggestion: '请确认文件格式正确；加密备份需要输入正确密码。',
  },
  settings: {
    title: '设置保存失败',
    summary: '设置没有完全保存成功。',
    kind: '设置保存失败',
    suggestion: '本地偏好可以继续保存；如果要修改服务端默认配置，请确认当前部署提供配置 API，并检查配置管理口令。',
  },
  platform: {
    title: '平台操作失败',
    summary: '部署平台校验、同步或重部署没有完成。',
    kind: '平台配置错误',
    suggestion: '请检查平台账号、项目 ID、环境变量权限和部署配置。',
  },
  background: {
    title: '后台任务操作失败',
    summary: '后台任务没有完成当前操作。',
    kind: '后台任务错误',
    suggestion: '请稍后重试；如果网络刚恢复，可以保留任务并继续等待。',
  },
};

function redactSensitiveText(value = '') {
  return String(value || '')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_KEY]')
    .replace(/\b(ghp_[A-Za-z0-9_]{8,})\b/g, '[REDACTED_TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|cookie)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function normalizeDialogContext(value = '') {
  const text = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!text) return '';
  if (text.startsWith('backup.import')) return 'backup-import';
  if (text.startsWith('backup.export')) return 'backup-export';
  if (text.startsWith('prompt.history') || text.startsWith('prompt-history')) return 'prompt-history';
  if (text.startsWith('prompt.enhancement') || text.startsWith('prompt-enhancement')) return 'prompt-enhancement';
  if (text.startsWith('platform.')) return 'platform';
  if (text.startsWith('background.')) return 'background';
  return text;
}

function inferErrorContext(error = {}, message = '') {
  const explicit = normalizeDialogContext(error.context || error.scope || error.feature || error.operation);
  if (explicit) return explicit;
  const code = String(error.code || error.type || '').toUpperCase();
  const text = String(message || '').toLowerCase();
  if (code.startsWith('CONFIG_') || /服务端默认配置|配置管理|设置保存|runtime config/.test(text)) return 'settings';
  if (/备份|导入密码|加密密码|web crypto|backup/.test(text)) return /导入|解密|import/.test(text) ? 'backup-import' : 'backup-export';
  if (/参考图|上传.*图片|最多只能上传|图片.*超过|ref image|reference image/.test(text)) return 'reference';
  if (/提示词历史|历史提示词|原始提示词|最终提示词/.test(text)) return 'prompt-history';
  if (/历史记录|历史图片|收藏|删除这张|读取历史/.test(text)) return 'history';
  if (/提示词增强|提示词润色|润色|优化提示词|enhance/.test(text)) return 'prompt-enhancement';
  if (/oauth|授权|登录/.test(text)) return 'oauth';
  if (/api 地址|api key|账号|key/.test(text)) return 'account';
  if (/清理|存储|storage/.test(text)) return 'storage';
  if (/后台任务|job_?|任务已取消|任务取消/.test(text) || code.startsWith('JOB_')) return 'background';
  if (/请输入|请先|缺少|不能为空|未选择/.test(text)) return 'validation';
  return '';
}

function dialogPresetFor(context) {
  const normalized = normalizeDialogContext(context);
  return CONTEXT_ERROR_DIALOGS[normalized] || null;
}

function mergeDialog(base, override = {}) {
  return { ...base, ...Object.fromEntries(Object.entries(override || {}).filter(([, value]) => value != null && value !== '')) };
}

function buildMetaText(details = {}) {
  const parts = [];
  if (details.status) parts.push(`HTTP ${details.status}`);
  if (details.code) parts.push(String(details.code));
  return parts.slice(0, 2).join(' · ');
}

export function hideGenerationErrorDialog() {
  closeDialog($('#generationErrorOverlay'));
}

export function setPersistentErrorSummary(message = '') {
  const el = $('#errorMsg');
  if (!el) return;
  const text = redactSensitiveText(String(message || '').trim());
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

export function classifyGenerationError(error = {}) {
  const message = redactSensitiveText(normalizeGenerationError(error.message || error.error || error, '操作失败，请稍后重试'));
  const code = String(error.code || error.type || '').toUpperCase();
  const status = Number(error.status || error.httpStatus || 0);
  const inferredContext = inferErrorContext(error, message);
  const contextPreset = dialogPresetFor(inferredContext) || BASE_ERROR_DIALOG;

  if (code.startsWith('CONFIG_') || error.context === 'settings') {
    return mergeDialog(CONTEXT_ERROR_DIALOGS.settings, {
      debug: error.debug || code,
    });
  }
  if (isPolicyViolationText(message) || code.includes('POLICY')) {
    return mergeDialog(CONTEXT_ERROR_DIALOGS.generation, {
      title: '内容无法生成',
      summary: '这次请求被内容策略拦截，图片没有生成。',
      kind: '内容策略限制',
      suggestion: POLICY_VIOLATION_MESSAGE,
      debug: error.debug || '',
    });
  }
  if (code === 'JOB_PENDING_TIMEOUT' || code === 'JOB_RUNNING_TIMEOUT') {
    return mergeDialog(CONTEXT_ERROR_DIALOGS.background, {
      title: '后台任务超时',
      summary: '后台生成任务等待时间过长，暂时没有拿到结果。',
      kind: '后台任务超时',
      suggestion: '任务可能卡住或队列拥堵，请稍后重试；如果持续出现，请降低并发或检查上游服务。',
      debug: error.debug || code,
    });
  }
  if (code === 'TIMEOUT' || error.isTimeout || status === 504) {
    return mergeDialog(contextPreset, {
      title: inferredContext === 'generation' ? '图片生成超时' : '请求超时',
      summary: '请求等待时间过长，当前操作没有确认完成。',
      kind: '请求超时',
      suggestion: '请检查网络和上游服务状态；如果是后台生成，任务可能仍在继续，可稍后恢复或重试。',
      debug: error.debug || code,
    });
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key|无权限|鉴权/i.test(message)) {
    return mergeDialog(CONTEXT_ERROR_DIALOGS.account, {
      title: '账号鉴权失败',
      summary: '当前账号没有通过上游或管理接口鉴权。',
      kind: '鉴权失败',
      suggestion: '请检查账号 API Key、OAuth 登录状态或管理 token 是否正确。',
      debug: error.debug || code,
    });
  }
  if (error.fallbackAttempted === true) {
    return mergeDialog(CONTEXT_ERROR_DIALOGS.generation, {
      title: '兼容回退失败',
      summary: '已尝试切换兼容链路，但图片仍未生成成功。',
      kind: '兼容回退失败',
      suggestion: '请检查模型、图生图兼容模式或上游返回内容。',
      debug: error.debug || '',
    });
  }
  return mergeDialog(contextPreset, {
    debug: error.debug || code,
  });
}

export function normalizeErrorDialogPayload(input, options = {}) {
  const mergedOptions = options && typeof options === 'object' ? options : {};
  if (input && typeof input === 'object') {
    const message = redactSensitiveText(normalizeGenerationError(input.message || input.error || input, '操作失败，请稍后重试'));
    return {
      ...input,
      ...mergedOptions,
      message,
      status: input.status || input.httpStatus || mergedOptions.status,
      code: input.code || input.type || mergedOptions.code,
      context: mergedOptions.context || input.context,
      title: mergedOptions.title || input.title,
      summary: mergedOptions.summary || input.summary,
      suggestion: mergedOptions.suggestion || input.suggestion,
    };
  }
  return {
    ...mergedOptions,
    message: redactSensitiveText(normalizeGenerationError(input, '操作失败，请稍后重试')),
  };
}

export function showGenerationErrorDialog(input) {
  const overlay = $('#generationErrorOverlay');
  if (!overlay) return;
  const details = normalizeErrorDialogPayload(input);
  const classification = classifyGenerationError(details);
  const view = mergeDialog(classification, {
    title: details.title,
    summary: details.summary,
    kind: details.kind,
    suggestion: details.suggestion,
  });
  $('#generationErrorTitle').textContent = view.title || BASE_ERROR_DIALOG.title;
  $('.error-dialog-summary').textContent = view.summary || BASE_ERROR_DIALOG.summary;
  $('#generationErrorKind').textContent = view.kind || BASE_ERROR_DIALOG.kind;
  $('#generationErrorKind').dataset.tone = details.tone || view.tone || 'danger';
  $('#generationErrorMessage').textContent = details.message || '操作失败';
  $('#generationErrorSuggestion').textContent = view.suggestion || BASE_ERROR_DIALOG.suggestion;

  const metaEl = $('#generationErrorMeta');
  const meta = details.meta || buildMetaText(details);
  if (metaEl) {
    metaEl.textContent = String(meta || '');
    metaEl.classList.toggle('hidden', !meta);
  }

  const debugBox = $('#generationErrorDebug');
  const debugText = $('#generationErrorDebugText');
  const debug = details.debug || view.debug || details.code || '';
  if (debugBox && debugText) {
    debugText.textContent = redactSensitiveText(String(debug || ''));
    debugBox.classList.toggle('hidden', !debug);
  }
  openDialog(overlay, { focusSelector: '#generationErrorConfirm' });
}

export function showError(msg, options = {}) {
  console.error(msg);
  const details = normalizeErrorDialogPayload(msg, options);
  const text = details.message || String(msg || '操作失败');
  const hint = $('#generationHint');
  if (hint) {
    hint.textContent = text;
    hint.title = text;
  }
  setPersistentErrorSummary(text);
  showGenerationErrorDialog(details);
}

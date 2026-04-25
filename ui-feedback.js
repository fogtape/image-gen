export const POLICY_VIOLATION_MESSAGE = '非常抱歉，生成的图片可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。';
export const IDLE_GENERATION_HINT = 'Ctrl+Enter 发送';

export const GENERATION_PROGRESS_MESSAGES = {
  'prompt:prepare': '正在整理提示词',
  'request:send': '正在提交请求到后端',
  'request:accepted': '后端已接收请求',
  'response:created': '后端已接收请求',
  'response:image_started': '模型已开始生成图片',
  'response:image_done': '图片数据已返回',
  'response:completed': '生成完成，正在渲染结果',
  'oauth:prepare': '正在准备 OAuth 生图请求',
  'oauth:bootstrap': '正在初始化 ChatGPT 会话',
  'oauth:requirements': '正在获取 ChatGPT 账号状态',
  'oauth:prepare_conversation': '正在准备 ChatGPT 图片会话',
  'oauth:conversation': '正在提交提示词到 ChatGPT',
  'oauth:generating': 'ChatGPT 正在生成图片',
  'oauth:poll': '正在轮询图片结果',
  'oauth:download_url': '正在获取图片下载地址',
  'oauth:download': '正在下载生成的图片',
  'oauth:done': '图片已生成，正在返回页面',
  'fallback:images': 'Responses 不可用，正在切换到 Images API',
  'result:parse': '正在解析生成结果',
  'result:render': '正在渲染生成结果',
};

export const GENERATING_HINTS = [
  GENERATION_PROGRESS_MESSAGES['prompt:prepare'],
  GENERATION_PROGRESS_MESSAGES['request:send'],
  '模型正在生成图片',
  '正在接收图片数据',
];

export const LONG_WAIT_PROGRESS_MESSAGE = '仍在生成，请耐心等待';

function toReadableText(value) {
  if (value == null) return '';
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const direct = [
      value.error_description,
      value.detail,
      value.message,
      value.code,
      value.type,
      value.error?.message,
      value.error?.code,
      value.error?.type,
      value.error,
    ];
    for (const item of direct) {
      if (typeof item === 'string' && item.trim()) return item.trim();
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

export function isPolicyViolationText(value) {
  const text = toReadableText(value).toLowerCase();
  if (!text) return false;
  return /content[_\s-]*policy|policy[_\s-]*violation|safety[_\s-]*(system|policy)|violat(e|es|ed|ing|ion)|not allowed|disallowed|blocked by policy|inappropriate|unsafe|非常抱歉|内容政策|违反/.test(text);
}

export function normalizeGenerationError(value, fallback = '生成失败，请稍后重试') {
  if (isPolicyViolationText(value)) return POLICY_VIOLATION_MESSAGE;
  const text = toReadableText(value).trim();
  return text || fallback;
}

export function getGenerationProgressMessage(phase, fallback = '正在生成图片') {
  const key = String(phase || '').trim();
  return GENERATION_PROGRESS_MESSAGES[key] || fallback;
}

export function getResponseStreamProgressMessage(ev = {}) {
  if (!ev || typeof ev !== 'object') return '';
  if (ev.type === 'response.created') return getGenerationProgressMessage('response:created');
  if (ev.type === 'response.output_item.added' && ev.item?.type === 'image_generation_call') {
    return getGenerationProgressMessage('response:image_started');
  }
  if (ev.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call') {
    return getGenerationProgressMessage('response:image_done');
  }
  if (ev.type === 'response.completed') return getGenerationProgressMessage('response:completed');
  if (ev.type === 'response.failed' || ev.type === 'error') return '生成失败，正在整理错误信息';
  return '';
}

export function getSseProgressMessage(event = 'message', data = {}) {
  if (event === 'progress' && data && typeof data === 'object') {
    return data.message || getGenerationProgressMessage(data.phase, '');
  }
  if (data && typeof data === 'object') {
    const normalized = data.type ? data : { ...data, type: event };
    return getResponseStreamProgressMessage(normalized);
  }
  return '';
}

export function getWaitingProgressMessage() {
  return LONG_WAIT_PROGRESS_MESSAGE;
}

export function getGeneratingHint(step = 0) {
  const idx = Math.abs(Number.parseInt(step, 10) || 0) % GENERATING_HINTS.length;
  return GENERATING_HINTS[idx];
}

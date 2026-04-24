export const POLICY_VIOLATION_MESSAGE = '非常抱歉，生成的图片可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。';
export const IDLE_GENERATION_HINT = 'Ctrl+Enter 发送';
export const GENERATING_HINTS = ['正在生成中', '仍在生成中', '继续生成中'];

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

export function getGeneratingHint(step = 0) {
  const idx = Math.abs(Number.parseInt(step, 10) || 0) % GENERATING_HINTS.length;
  return GENERATING_HINTS[idx];
}

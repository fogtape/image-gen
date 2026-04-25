import crypto from 'crypto';

export const DEFAULT_PROMPT_ENHANCEMENT_SETTINGS = Object.freeze({
  enabled: false,
  model: '',
  mode: 'balanced',
  language: 'auto',
});

const MODE_LABELS = {
  balanced: '在保留原意的基础上补足画面主体、环境、构图、光线、材质和细节。',
  professional: '按专业摄影、海报和商业视觉提示词标准强化镜头、构图、光影、质感和氛围。',
  faithful: '只做轻量修饰，尽量保持用户原话、主体和约束不变。',
};

const LANGUAGE_LABELS = {
  auto: '跟随用户输入语言；如果用户中英混合，可输出更适合图像模型理解的自然语言。',
  zh: '输出中文提示词。',
  en: '输出英文提示词。',
};

function pickAllowed(value, allowed, fallback) {
  const text = String(value || '').trim();
  return allowed.includes(text) ? text : fallback;
}

export function normalizePromptEnhancementSettings(input = {}) {
  return {
    enabled: input.enabled === true,
    model: String(input.model || '').trim(),
    mode: pickAllowed(input.mode, ['balanced', 'professional', 'faithful'], DEFAULT_PROMPT_ENHANCEMENT_SETTINGS.mode),
    language: pickAllowed(input.language, ['auto', 'zh', 'en'], DEFAULT_PROMPT_ENHANCEMENT_SETTINGS.language),
  };
}

export function resolvePromptModel(cfg = {}, settings = {}) {
  return String(settings.model || cfg.promptModel || cfg.model || 'gpt-5.4-mini').trim();
}

function baseApiUrl(apiUrl) {
  const text = String(apiUrl || '').trim().replace(/\/+$/, '');
  if (!text) throw new Error('Missing API address');
  return text;
}

function buildSystemPrompt(settings) {
  return [
    '你是专业的图像生成提示词优化器。',
    '任务：把用户输入改写成更适合图像生成模型的提示词。',
    '要求：只输出最终提示词，不要解释，不要编号，不要 Markdown，不要加引号。',
    '必须保留用户原始主体、动作、限制和明确风格；不要擅自加入违背原意的元素。',
    MODE_LABELS[settings.mode] || MODE_LABELS.balanced,
    LANGUAGE_LABELS[settings.language] || LANGUAGE_LABELS.auto,
  ].join('\n');
}

function buildUserPrompt({ prompt, style = '', type = '' }) {
  const lines = [`原始提示词：${String(prompt || '').trim()}`];
  if (style) lines.push(`当前选择的风格：${style}`);
  if (type) lines.push(`当前选择的类型：${type}`);
  lines.push('请输出可直接用于图片生成的一段提示词。');
  return lines.join('\n');
}

export function buildPromptEnhancementRequest({ cfg = {}, prompt = '', style = '', type = '', settings: rawSettings = {} } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Missing prompt');
  const settings = normalizePromptEnhancementSettings(rawSettings);
  const model = resolvePromptModel(cfg, settings);
  const endpoint = cfg.isOAuth ? 'responses' : 'chat';
  const system = buildSystemPrompt(settings);
  const user = buildUserPrompt({ prompt: text, style, type });

  if (endpoint === 'responses') {
    return {
      endpoint,
      url: `${baseApiUrl(cfg.apiUrl)}/v1/responses`,
      body: {
        model,
        input: `${system}\n\n${user}`,
        max_output_tokens: 900,
        temperature: settings.mode === 'faithful' ? 0.35 : 0.7,
      },
    };
  }

  return {
    endpoint,
    url: `${baseApiUrl(cfg.apiUrl)}/v1/chat/completions`,
    body: {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: settings.mode === 'faithful' ? 0.35 : 0.7,
      max_tokens: 900,
    },
  };
}

export function buildPromptEnhancementHeaders(cfg = {}, extra = {}) {
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) throw new Error('Missing API key');
  const headers = { Authorization: `Bearer ${apiKey}`, ...extra };
  if (cfg.isOAuth) {
    headers.Originator = 'codex_cli_rs';
    if (cfg.accountId) headers['Chatgpt-Account-Id'] = cfg.accountId;
    headers.Version = '0.101.0';
    headers['OpenAI-Beta'] = 'responses=experimental';
    headers.Session_id = crypto.randomUUID();
    headers['User-Agent'] = 'codex_cli_rs/0.101.0';
  }
  return headers;
}

export function sanitizeEnhancedPrompt(value) {
  let text = String(value || '').trim();
  text = text.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/i, '').trim();
  text = text.replace(/^(优化后的?提示词|提示词|enhanced prompt|prompt)\s*[:：]\s*/i, '').trim();
  text = text.replace(/^[-*]\s+/, '').trim();
  text = text.replace(/^[“”"'`]+|[“”"'`]+$/g, '').trim();
  if (!text) throw new Error('模型未返回有效提示词');
  return text.slice(0, 4000);
}

function extractFromOutputItems(output) {
  if (!Array.isArray(output)) return '';
  for (const item of output) {
    if (typeof item?.content === 'string') return item.content;
    if (!Array.isArray(item?.content)) continue;
    const parts = [];
    for (const content of item.content) {
      if (typeof content?.text === 'string') parts.push(content.text);
      else if (typeof content?.content === 'string') parts.push(content.content);
    }
    if (parts.length) return parts.join('\n');
  }
  return '';
}

export function extractEnhancedPrompt(data) {
  if (typeof data === 'string') {
    try { return extractEnhancedPrompt(JSON.parse(data)); } catch { return sanitizeEnhancedPrompt(data); }
  }
  const direct = data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.output_text
    || extractFromOutputItems(data?.output);
  return sanitizeEnhancedPrompt(direct);
}

function safeErrorMessage(value) {
  const text = String(value?.message || value || '提示词增强失败').trim();
  return text.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, 'Bearer ***');
}

export async function enhancePrompt({ cfg = {}, prompt = '', style = '', type = '', settings = {}, fetchImpl = fetch } = {}) {
  const request = buildPromptEnhancementRequest({ cfg, prompt, style, type, settings });
  const resp = await fetchImpl(request.url, {
    method: 'POST',
    headers: buildPromptEnhancementHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(request.body),
  });
  const contentType = resp.headers?.get?.('content-type') || '';
  const raw = contentType.includes('application/json')
    ? await resp.json().catch(() => ({}))
    : await resp.text();
  if (!resp.ok) {
    const message = raw?.error?.message || raw?.message || raw?.error || `HTTP ${resp.status}`;
    throw new Error(safeErrorMessage(message));
  }
  return {
    prompt: extractEnhancedPrompt(raw),
    model: request.body.model,
    endpoint: request.endpoint,
  };
}

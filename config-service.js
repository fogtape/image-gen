import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_DIR = path.join(__dirname, 'config');
export const ENV_FILE = path.join(CONFIG_DIR, '.env');
export const ENV_EXAMPLE_FILE = path.join(CONFIG_DIR, '.env.example');

const DEFAULT_RUNTIME_CONFIG = {
  adminToken: '',
  providerDefaults: {
    apiUrl: 'https://api.openai.com',
    imageModel: 'gpt-image-2',
    responsesModel: 'gpt-5.4',
    streamMode: false,
    responsesAutoFallback: true,
    imageEditsCompatMode: false,
    forceProxy: false,
  },
  generation: { size: 'auto', quality: 'medium', format: 'png', background: 'auto' },
  watermark: {
    enabled: false,
    temporaryMode: 'default',
    mode: 'camera-time',
    text: 'AI Image Studio',
    timeFormat: 'camera',
    position: 'bottom-right',
    opacity: 0.72,
    fontSize: 28,
    color: '#ffffff',
    shadow: true,
    background: true,
  },
  storage: { enabled: true },
  promptEnhancement: {
    enabled: false,
    runMode: 'manual',
    model: '',
    mode: 'balanced',
    language: 'auto',
  },
  deploy: {
    platform: 'node',
    accountId: '',
    projectId: '',
    apiToken: '',
    autoSync: false,
    autoRedeploy: false,
  },
};

const CONFIG_SCHEMA = {
  adminToken: { env: 'IMAGE_GEN_ADMIN_TOKEN', type: 'string', secret: true },
  providerDefaults: {
    apiUrl: { env: 'IMAGE_GEN_DEFAULT_API_URL', type: 'string' },
    imageModel: { env: 'IMAGE_GEN_DEFAULT_IMAGE_MODEL', type: 'string' },
    responsesModel: { env: 'IMAGE_GEN_DEFAULT_RESPONSES_MODEL', type: 'string' },
    streamMode: { env: 'IMAGE_GEN_DEFAULT_STREAM_MODE', type: 'boolean' },
    responsesAutoFallback: { env: 'IMAGE_GEN_DEFAULT_RESPONSES_AUTO_FALLBACK', type: 'boolean' },
    imageEditsCompatMode: { env: 'IMAGE_GEN_DEFAULT_IMAGE_EDITS_COMPAT_MODE', type: 'boolean' },
    forceProxy: { env: 'IMAGE_GEN_FORCE_PROXY', type: 'boolean' },
  },
  generation: {
    size: { env: 'IMAGE_GEN_DEFAULT_SIZE', type: 'string' },
    quality: { env: 'IMAGE_GEN_DEFAULT_QUALITY', type: 'string' },
    format: { env: 'IMAGE_GEN_DEFAULT_FORMAT', type: 'string' },
    background: { env: 'IMAGE_GEN_DEFAULT_BACKGROUND', type: 'string' },
  },
  watermark: {
    enabled: { env: 'IMAGE_GEN_WATERMARK_ENABLED', type: 'boolean' },
    temporaryMode: { env: 'IMAGE_GEN_WATERMARK_TEMPORARY_MODE', type: 'string' },
    mode: { env: 'IMAGE_GEN_WATERMARK_MODE', type: 'string' },
    text: { env: 'IMAGE_GEN_WATERMARK_TEXT', type: 'string' },
    timeFormat: { env: 'IMAGE_GEN_WATERMARK_TIME_FORMAT', type: 'string' },
    position: { env: 'IMAGE_GEN_WATERMARK_POSITION', type: 'string' },
    opacity: { env: 'IMAGE_GEN_WATERMARK_OPACITY', type: 'number' },
    fontSize: { env: 'IMAGE_GEN_WATERMARK_FONT_SIZE', type: 'number' },
    color: { env: 'IMAGE_GEN_WATERMARK_COLOR', type: 'string' },
    shadow: { env: 'IMAGE_GEN_WATERMARK_SHADOW', type: 'boolean' },
    background: { env: 'IMAGE_GEN_WATERMARK_BACKGROUND', type: 'boolean' },
  },
  storage: {
    enabled: { env: 'IMAGE_GEN_STORAGE_ENABLED', type: 'boolean' },
  },
  promptEnhancement: {
    enabled: { env: 'IMAGE_GEN_PROMPT_ENHANCEMENT_ENABLED', type: 'boolean' },
    runMode: { env: 'IMAGE_GEN_PROMPT_ENHANCEMENT_RUN_MODE', type: 'string' },
    model: { env: 'IMAGE_GEN_PROMPT_ENHANCEMENT_MODEL', type: 'string' },
    mode: { env: 'IMAGE_GEN_PROMPT_ENHANCEMENT_MODE', type: 'string' },
    language: { env: 'IMAGE_GEN_PROMPT_ENHANCEMENT_LANGUAGE', type: 'string' },
  },
  deploy: {
    platform: { env: 'IMAGE_GEN_DEPLOY_PLATFORM', type: 'string' },
    accountId: { env: 'IMAGE_GEN_DEPLOY_ACCOUNT_ID', type: 'string', secret: true },
    projectId: { env: 'IMAGE_GEN_DEPLOY_PROJECT_ID', type: 'string', secret: true },
    apiToken: { env: 'IMAGE_GEN_DEPLOY_API_TOKEN', type: 'string', secret: true },
    autoSync: { env: 'IMAGE_GEN_DEPLOY_AUTO_SYNC', type: 'boolean' },
    autoRedeploy: { env: 'IMAGE_GEN_DEPLOY_AUTO_REDEPLOY', type: 'boolean' },
  },
};

function deepClone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function parseNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeEnvValue(value, type, fallback) {
  if (type === 'boolean') return parseBoolean(value, fallback);
  if (type === 'number') return parseNumber(value, fallback);
  return value === undefined || value === null ? fallback : String(value);
}

function serializeEnvValue(value, type) {
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') return Number.isFinite(Number(value)) ? String(value) : '0';
  return String(value ?? '');
}

function parseEnvFile(content = '') {
  const out = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = rawLine.indexOf('=');
    if (idx <= 0) continue;
    const key = rawLine.slice(0, idx).trim();
    let value = rawLine.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      try {
        value = JSON.parse(value.startsWith('"') ? value : JSON.stringify(value.slice(1, -1)));
      } catch {
        value = value.slice(1, -1);
      }
    }
    out[key] = value;
  }
  return out;
}

function envLine(key, value, type) {
  const serialized = serializeEnvValue(value, type);
  if (type === 'string') return `${key}=${JSON.stringify(serialized)}`;
  return `${key}=${serialized}`;
}

function ensureConfigFiles() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(ENV_EXAMPLE_FILE)) {
    const lines = [
      '# AI Image Studio runtime configuration',
      '# Copy this file to .env for local/Docker deployments.',
      '',
      ...buildEnvExampleLines(),
      '',
    ];
    fs.writeFileSync(ENV_EXAMPLE_FILE, lines.join('\n'), 'utf8');
  }
  if (!fs.existsSync(ENV_FILE)) {
    fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
  }
}

function buildEnvExampleLines() {
  const lines = [];
  visitLeafSchema((pathParts, leaf) => {
    const key = leaf.env;
    const defaultValue = getValueByPath(DEFAULT_RUNTIME_CONFIG, pathParts);
    lines.push(`${key}=${leaf.type === 'string' ? JSON.stringify(String(defaultValue ?? '')) : serializeEnvValue(defaultValue, leaf.type)}`);
  });
  return lines;
}

function visitLeafSchema(visitor, schema = CONFIG_SCHEMA, prefix = []) {
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && 'env' in value) {
      visitor([...prefix, key], value);
      continue;
    }
    visitLeafSchema(visitor, value, [...prefix, key]);
  }
}

function getValueByPath(obj, pathParts = []) {
  return pathParts.reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setValueByPath(obj, pathParts = [], value) {
  let cursor = obj;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const key = pathParts[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[pathParts[pathParts.length - 1]] = value;
}

function mergeConfigWithEnv(baseConfig, envMap) {
  const merged = deepClone(baseConfig);
  visitLeafSchema((pathParts, leaf) => {
    const fallback = getValueByPath(baseConfig, pathParts);
    const nextValue = normalizeEnvValue(envMap[leaf.env], leaf.type, fallback);
    setValueByPath(merged, pathParts, nextValue);
  });
  return validateRuntimeConfig(merged);
}

function validateRuntimeConfig(input = {}) {
  const cfg = deepClone(DEFAULT_RUNTIME_CONFIG);
  const source = deepClone(input || {});

  cfg.adminToken = String(source.adminToken || '').trim();

  const provider = source.providerDefaults || {};
  cfg.providerDefaults.apiUrl = String(provider.apiUrl || DEFAULT_RUNTIME_CONFIG.providerDefaults.apiUrl).trim().replace(/\/+$/, '') || DEFAULT_RUNTIME_CONFIG.providerDefaults.apiUrl;
  cfg.providerDefaults.imageModel = String(provider.imageModel || DEFAULT_RUNTIME_CONFIG.providerDefaults.imageModel).trim() || DEFAULT_RUNTIME_CONFIG.providerDefaults.imageModel;
  cfg.providerDefaults.responsesModel = String(provider.responsesModel || DEFAULT_RUNTIME_CONFIG.providerDefaults.responsesModel).trim() || DEFAULT_RUNTIME_CONFIG.providerDefaults.responsesModel;
  cfg.providerDefaults.streamMode = provider.streamMode === true;
  cfg.providerDefaults.responsesAutoFallback = provider.responsesAutoFallback !== false;
  cfg.providerDefaults.imageEditsCompatMode = provider.imageEditsCompatMode === true;
  cfg.providerDefaults.forceProxy = provider.forceProxy === true;

  const generation = source.generation || {};
  cfg.generation.size = ['auto', '1024x1024', '1056x1408', '864x1536', '1408x1056', '1536x864'].includes(generation.size) ? generation.size : DEFAULT_RUNTIME_CONFIG.generation.size;
  cfg.generation.quality = ['low', 'medium', 'high'].includes(generation.quality) ? generation.quality : DEFAULT_RUNTIME_CONFIG.generation.quality;
  cfg.generation.format = ['png', 'webp', 'jpeg'].includes(generation.format) ? generation.format : DEFAULT_RUNTIME_CONFIG.generation.format;
  cfg.generation.background = ['auto', 'opaque', 'transparent'].includes(generation.background) ? generation.background : DEFAULT_RUNTIME_CONFIG.generation.background;

  const watermark = source.watermark || {};
  cfg.watermark.enabled = watermark.enabled === true;
  cfg.watermark.temporaryMode = ['default', 'on', 'off'].includes(watermark.temporaryMode) ? watermark.temporaryMode : DEFAULT_RUNTIME_CONFIG.watermark.temporaryMode;
  cfg.watermark.mode = ['custom', 'time', 'camera-time', 'custom-time'].includes(watermark.mode) ? watermark.mode : DEFAULT_RUNTIME_CONFIG.watermark.mode;
  cfg.watermark.text = String(watermark.text || DEFAULT_RUNTIME_CONFIG.watermark.text).slice(0, 80) || DEFAULT_RUNTIME_CONFIG.watermark.text;
  cfg.watermark.timeFormat = ['camera', 'slash', 'dash', 'iso'].includes(watermark.timeFormat) ? watermark.timeFormat : DEFAULT_RUNTIME_CONFIG.watermark.timeFormat;
  cfg.watermark.position = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'].includes(watermark.position) ? watermark.position : DEFAULT_RUNTIME_CONFIG.watermark.position;
  cfg.watermark.opacity = Math.min(1, Math.max(0.12, Number(watermark.opacity || DEFAULT_RUNTIME_CONFIG.watermark.opacity)));
  cfg.watermark.fontSize = Math.min(96, Math.max(12, Math.round(Number(watermark.fontSize || DEFAULT_RUNTIME_CONFIG.watermark.fontSize))));
  cfg.watermark.color = /^#[0-9a-f]{6}$/i.test(String(watermark.color || '')) ? String(watermark.color) : DEFAULT_RUNTIME_CONFIG.watermark.color;
  cfg.watermark.shadow = watermark.shadow !== false;
  cfg.watermark.background = watermark.background !== false;

  const storage = source.storage || {};
  cfg.storage.enabled = storage.enabled !== false;

  const prompt = source.promptEnhancement || {};
  cfg.promptEnhancement.enabled = prompt.enabled === true;
  cfg.promptEnhancement.runMode = prompt.runMode === 'auto' ? 'auto' : 'manual';
  cfg.promptEnhancement.model = String(prompt.model || '').trim();
  cfg.promptEnhancement.mode = ['balanced', 'professional', 'faithful'].includes(prompt.mode) ? prompt.mode : DEFAULT_RUNTIME_CONFIG.promptEnhancement.mode;
  cfg.promptEnhancement.language = ['auto', 'zh', 'en'].includes(prompt.language) ? prompt.language : DEFAULT_RUNTIME_CONFIG.promptEnhancement.language;

  const deploy = source.deploy || {};
  cfg.deploy.platform = String(deploy.platform || DEFAULT_RUNTIME_CONFIG.deploy.platform).trim().toLowerCase() || 'node';
  if (!['node', 'vercel', 'netlify', 'cloudflare', 'edgeone'].includes(cfg.deploy.platform)) cfg.deploy.platform = 'node';
  cfg.deploy.accountId = String(deploy.accountId || '').trim();
  cfg.deploy.projectId = String(deploy.projectId || '').trim();
  cfg.deploy.apiToken = String(deploy.apiToken || '').trim();
  cfg.deploy.autoSync = deploy.autoSync === true;
  cfg.deploy.autoRedeploy = deploy.autoRedeploy === true;

  return cfg;
}

function toPublicConfig(config) {
  const cfg = validateRuntimeConfig(config);
  return {
    providerDefaults: deepClone(cfg.providerDefaults),
    generation: deepClone(cfg.generation),
    watermark: deepClone(cfg.watermark),
    storage: deepClone(cfg.storage),
    promptEnhancement: deepClone(cfg.promptEnhancement),
    deploy: {
      platform: cfg.deploy.platform,
      accountId: cfg.deploy.accountId ? '***已配置***' : '',
      projectId: cfg.deploy.projectId ? '***已配置***' : '',
      apiTokenConfigured: !!cfg.deploy.apiToken,
      autoSync: cfg.deploy.autoSync,
      autoRedeploy: cfg.deploy.autoRedeploy,
    },
    security: {
      adminTokenConfigured: !!cfg.adminToken,
    },
  };
}

function toEditableConfig(config) {
  const cfg = validateRuntimeConfig(config);
  return {
    providerDefaults: deepClone(cfg.providerDefaults),
    generation: deepClone(cfg.generation),
    watermark: deepClone(cfg.watermark),
    storage: deepClone(cfg.storage),
    promptEnhancement: deepClone(cfg.promptEnhancement),
    deploy: {
      platform: cfg.deploy.platform,
      accountId: cfg.deploy.accountId,
      projectId: cfg.deploy.projectId,
      apiTokenConfigured: !!cfg.deploy.apiToken,
      autoSync: cfg.deploy.autoSync,
      autoRedeploy: cfg.deploy.autoRedeploy,
    },
    security: {
      adminTokenConfigured: !!cfg.adminToken,
    },
  };
}

function buildEnvMapFromConfig(config, previousEnv = {}) {
  const envMap = { ...previousEnv };
  const normalized = validateRuntimeConfig(config);
  visitLeafSchema((pathParts, leaf) => {
    const value = getValueByPath(normalized, pathParts);
    envMap[leaf.env] = value;
  });
  return envMap;
}

function writeEnvFile(envMap) {
  const lines = [];
  const header = '# AI Image Studio runtime configuration';
  lines.push(header, `# updated_at=${new Date().toISOString()}`, '');
  visitLeafSchema((pathParts, leaf) => {
    const value = envMap[leaf.env] ?? serializeEnvValue(getValueByPath(DEFAULT_RUNTIME_CONFIG, pathParts), leaf.type);
    lines.push(envLine(leaf.env, value, leaf.type));
  });
  lines.push('');
  fs.writeFileSync(ENV_FILE, lines.join('\n'), 'utf8');
}

export function createConfigService({ isServerless = false, onReload } = {}) {
  ensureConfigFiles();
  let currentEnv = fs.existsSync(ENV_FILE) ? parseEnvFile(fs.readFileSync(ENV_FILE, 'utf8')) : {};
  let currentConfig = mergeConfigWithEnv(DEFAULT_RUNTIME_CONFIG, { ...currentEnv, ...process.env });
  let configVersion = crypto.createHash('sha1').update(JSON.stringify(currentConfig)).digest('hex').slice(0, 12);
  let watcher = null;
  let reloadTimer = null;

  function refreshFromDisk() {
    currentEnv = fs.existsSync(ENV_FILE) ? parseEnvFile(fs.readFileSync(ENV_FILE, 'utf8')) : {};
    currentConfig = mergeConfigWithEnv(DEFAULT_RUNTIME_CONFIG, { ...currentEnv, ...process.env });
    configVersion = crypto.createHash('sha1').update(JSON.stringify(currentConfig)).digest('hex').slice(0, 12);
    onReload?.(getRuntimeConfig());
    return currentConfig;
  }

  function getRuntimeConfig() {
    return {
      schemaVersion: 1,
      configVersion,
      config: toPublicConfig(currentConfig),
      capabilities: {
        runtime: isServerless ? 'serverless' : 'node',
        canPersistLocalEnv: !isServerless,
        canManageConfig: true,
        supportedDeployPlatforms: ['node', 'vercel', 'netlify', 'cloudflare', 'edgeone'],
      },
    };
  }

  function getEditableRuntimeConfig() {
    return {
      schemaVersion: 1,
      configVersion,
      config: toEditableConfig(currentConfig),
      capabilities: getRuntimeConfig().capabilities,
    };
  }

  function getResolvedConfig() {
    return validateRuntimeConfig(currentConfig);
  }


function getEnvMapForPlatformSync(config = currentConfig) {
  const envMap = buildEnvMapFromConfig(validateRuntimeConfig(config), {});
  delete envMap.IMAGE_GEN_ADMIN_TOKEN;
  delete envMap.IMAGE_GEN_DEPLOY_API_TOKEN;
  return envMap;
}
  function getSchema() {
    return {
      schemaVersion: 1,
      fields: {
        providerDefaults: {
          apiUrl: { type: 'url', label: '默认 API 地址' },
          imageModel: { type: 'text', label: '默认图片模型' },
          responsesModel: { type: 'text', label: '默认流式主模型' },
          streamMode: { type: 'boolean', label: '默认启用流式 Responses' },
          responsesAutoFallback: { type: 'boolean', label: '流式失败自动回退非流式' },
          imageEditsCompatMode: { type: 'boolean', label: '默认图生图兼容模式' },
          forceProxy: { type: 'boolean', label: '默认强制代理' },
        },
        generation: {
          size: { type: 'select', options: ['auto', '1024x1024', '1056x1408', '864x1536', '1408x1056', '1536x864'] },
          quality: { type: 'select', options: ['low', 'medium', 'high'] },
          format: { type: 'select', options: ['png', 'webp', 'jpeg'] },
          background: { type: 'select', options: ['auto', 'opaque', 'transparent'] },
        },
      },
    };
  }

  function setRuntimeConfig(nextConfig, { preserveSecrets = true } = {}) {
    const merged = validateRuntimeConfig({
      ...currentConfig,
      ...nextConfig,
      providerDefaults: { ...currentConfig.providerDefaults, ...(nextConfig.providerDefaults || {}) },
      generation: { ...currentConfig.generation, ...(nextConfig.generation || {}) },
      watermark: { ...currentConfig.watermark, ...(nextConfig.watermark || {}) },
      storage: { ...currentConfig.storage, ...(nextConfig.storage || {}) },
      promptEnhancement: { ...currentConfig.promptEnhancement, ...(nextConfig.promptEnhancement || {}) },
      deploy: {
        ...currentConfig.deploy,
        ...(nextConfig.deploy || {}),
        apiToken: preserveSecrets && nextConfig?.deploy && !('apiToken' in nextConfig.deploy)
          ? currentConfig.deploy.apiToken
          : String(nextConfig?.deploy?.apiToken || currentConfig.deploy.apiToken || ''),
      },
      adminToken: preserveSecrets && !('adminToken' in (nextConfig || {}))
        ? currentConfig.adminToken
        : String(nextConfig?.adminToken || currentConfig.adminToken || ''),
    });
    currentConfig = merged;
    currentEnv = buildEnvMapFromConfig(merged, currentEnv);
    if (!isServerless) writeEnvFile(currentEnv);
    configVersion = crypto.createHash('sha1').update(JSON.stringify(currentConfig)).digest('hex').slice(0, 12);
    onReload?.(getRuntimeConfig());
    return getRuntimeConfig();
  }

  function verifyAdminToken(candidate = '') {
    const expected = String(currentConfig.adminToken || '').trim();
    if (!expected) return !isServerless;
    return String(candidate || '').trim() === expected;
  }

  function startWatcher() {
    if (isServerless || watcher) return;
    watcher = fs.watch(CONFIG_DIR, { persistent: false }, (eventType, filename) => {
      if (!filename || filename !== '.env') return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        try { refreshFromDisk(); } catch (error) { console.warn('Failed to reload config/.env:', error.message); }
      }, 200);
    });
  }

  function stopWatcher() {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    watcher?.close?.();
    watcher = null;
  }

  return {
    getRuntimeConfig,
    getEditableRuntimeConfig,
    getResolvedConfig,
    getSchema,
    getEnvMapForPlatformSync,
    setRuntimeConfig,
    refreshFromDisk,
    verifyAdminToken,
    startWatcher,
    stopWatcher,
    envFile: ENV_FILE,
    configDir: CONFIG_DIR,
  };
}

export function getDefaultRuntimeConfig() {
  return deepClone(DEFAULT_RUNTIME_CONFIG);
}

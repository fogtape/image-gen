import {
  IDLE_GENERATION_HINT,
  POLICY_VIOLATION_MESSAGE,
  getGeneratingHint,
  getGenerationProgressMessage,
  getResponseStreamProgressMessage,
  getSseProgressMessage,
  getWaitingProgressMessage,
  isPolicyViolationText,
  normalizeGenerationError,
} from './ui-feedback.js';
import { $ } from './frontend/dom.js';
import { backgroundJobBackoffMs, fetchWithTimeout, sleep } from './frontend/http.js';
import {
  ACTIVE_JOB_STALE_MS,
  BACKGROUND_JOB_CREATE_TIMEOUT_MS,
  BACKGROUND_JOB_POLL_INTERVAL_MS,
  BACKGROUND_JOB_POLL_RETRY_BASE_MS,
  BACKGROUND_JOB_POLL_RETRY_LIMIT,
  BACKGROUND_JOB_POLL_TIMEOUT_MS,
  clearActiveJob,
  formatRelativeTime,
  hideActiveJobBanner,
  isPollingStopped,
  loadActiveJob,
  saveActiveJob,
  showActiveJobBanner,
  stopPollingJob,
} from './frontend/background-jobs.js';
import {
  hideGenerationErrorDialog,
  showError,
} from './frontend/error-dialog.js';
import { closeDialog, openDialog } from './frontend/dialog-a11y.js';
import { confirmAction, createButton, createIconButton, notifyAction } from './frontend/ui-actions.js';
import { state, cloneDefaultSettings, mergeAppSettings } from './frontend/state.js';
import { adminFetch } from './frontend/admin-api.js';
import {
  clearAdminSession,
  hasValidAdminSession,
  persistAdminSession,
} from './frontend/admin-session.js';

const ACCOUNTS_KEY = 'img-gen-accounts';
const APP_SETTINGS_KEY = 'img-gen-app-settings';
const PROMPT_HISTORY_KEY = 'img-gen-prompt-history';
const OLD_KEY = 'img-gen-settings';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_RESPONSES_MODEL = 'gpt-5.4';
const MAX_REF_IMAGES = 3;
const REF_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const REF_IMAGES_TOTAL_MAX_BYTES = 24 * 1024 * 1024;
const ALLOWED_REF_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
let historySearchTimer = null;
let promptHistory = [];
let pendingBackupImport = null;
// --- Data Layer ---

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNTS_KEY));
    if (saved) { state.data = saved; return; }
  } catch {}
  migrateOldSettings();
}

function saveData() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(state.data));
}

function sanitizeTemplateText(value = '', max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function sanitizePromptHistoryEntry(input = {}) {
  const source = sanitizeTemplateText(input.source || input.prompt || input.content || '', 4000);
  const final = sanitizeTemplateText(input.final || input.content || input.prompt || input.source || '', 4000);
  if (!source && !final) return null;
  const now = Date.now();
  return {
    id: sanitizeTemplateText(input.id, 80) || genId(),
    source,
    final: final || source,
    style: sanitizeTemplateText(input.style, 40),
    type: sanitizeTemplateText(input.type, 40),
    mode: sanitizeTemplateText(input.mode, 40) || 'history',
    createdAt: Number(input.createdAt || input.updatedAt || now),
  };
}

function loadPromptHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROMPT_HISTORY_KEY) || '[]');
    promptHistory = (Array.isArray(parsed) ? parsed : []).map(sanitizePromptHistoryEntry).filter(Boolean).slice(0, 30);
  } catch {
    promptHistory = [];
  }
}

function savePromptHistory() {
  localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(promptHistory.map(sanitizePromptHistoryEntry).filter(Boolean).slice(0, 30)));
}

function setPromptHistoryStatus(text = '', isError = false) {
  const el = $('#promptHistoryStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function renderPromptHistory() {
  const select = $('#promptHistorySelect');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">选择历史提示词...</option>';
  for (const item of promptHistory) {
    const option = document.createElement('option');
    option.value = item.id;
    const label = new Date(item.createdAt).toLocaleString();
    const text = (item.final || item.source || '').replace(/\s+/g, ' ').slice(0, 42);
    option.textContent = `${label} · ${text}`;
    select.appendChild(option);
  }
  if (promptHistory.some((item) => item.id === current)) select.value = current;
}

function recordPromptHistory({ source = '', final = '', style = '', type = '', mode = 'generate' } = {}) {
  const entry = sanitizePromptHistoryEntry({ source, final: final || source, style, type, mode, createdAt: Date.now() });
  if (!entry) return;
  const sameIndex = promptHistory.findIndex((item) => (item.final || item.source) === (entry.final || entry.source));
  if (sameIndex >= 0) promptHistory.splice(sameIndex, 1);
  promptHistory.unshift(entry);
  promptHistory = promptHistory.slice(0, 30);
  savePromptHistory();
  renderPromptHistory();
}

function saveCurrentPromptToHistory() {
  const prompt = sanitizeTemplateText($('#prompt')?.value || '', 4000);
  if (!prompt) { showError('请输入提示词后再保存历史', { context: 'prompt-history' }); return; }
  recordPromptHistory({
    source: prompt,
    final: prompt,
    style: $('#styleSelect')?.value || '',
    type: $('#typeSelect')?.value || '',
    mode: 'manual-save',
  });
  const select = $('#promptHistorySelect');
  if (select && promptHistory[0]) select.value = promptHistory[0].id;
  setPromptHistoryStatus('已保存到提示词历史');
}

function getSelectedPromptHistory() {
  const id = $('#promptHistorySelect')?.value || '';
  return promptHistory.find((entry) => entry.id === id) || null;
}

function applySelectedPromptHistory() {
  const item = getSelectedPromptHistory();
  if (!item) {
    setPromptHistoryStatus('');
    return;
  }
  const text = item.final || item.source;
  if (!text) {
    setPromptHistoryStatus('这条历史没有可恢复的提示词', true);
    return;
  }
  $('#prompt').value = text;
  if (item.style) setSelectValue('styleSelect', item.style);
  if (item.type) setSelectValue('typeSelect', item.type);
  setPromptHistoryStatus('已写入输入框');
}

function restorePromptHistoryVersion(kind = 'final') {
  const item = getSelectedPromptHistory();
  if (!item) { showError('请先选择历史提示词', { context: 'prompt-history' }); return; }
  const text = kind === 'source' ? item.source : item.final;
  if (!text) { showError(kind === 'source' ? '这条记录没有原始提示词' : '这条记录没有最终提示词', { context: 'prompt-history' }); return; }
  $('#prompt').value = text;
  if (item.style) setSelectValue('styleSelect', item.style);
  if (item.type) setSelectValue('typeSelect', item.type);
  setPromptHistoryStatus(kind === 'source' ? '已恢复原始提示词' : '已恢复最终提示词');
}

function clearPromptHistory() {
  if (!promptHistory.length) { setPromptHistoryStatus('暂无提示词历史'); return; }
  if (!confirmAction('确定清空提示词历史？')) return;
  promptHistory = [];
  savePromptHistory();
  renderPromptHistory();
  setPromptHistoryStatus('提示词历史已清空');
}

function toBase64Bytes(bytes) {
  const binary = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => String.fromCharCode(b)).join('');
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

function fromBase64Bytes(value = '') {
  const binary = typeof atob === 'function'
    ? atob(value)
    : Buffer.from(String(value || ''), 'base64').toString('binary');
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeAccountForExport(acc = {}, includeSecrets = false) {
  const allowed = {
    id: sanitizeTemplateText(acc.id, 80) || genId(),
    type: acc.type === 'oauth' ? 'oauth' : 'manual',
    name: sanitizeTemplateText(acc.name, 120),
    apiUrl: sanitizeTemplateText(acc.apiUrl, 500),
    model: sanitizeTemplateText(acc.model || DEFAULT_IMAGE_MODEL, 120),
    responsesModel: sanitizeTemplateText(acc.responsesModel || DEFAULT_RESPONSES_MODEL, 120),
    streamMode: acc.streamMode === true,
    imageEditsCompatMode: acc.imageEditsCompatMode === true,
    responsesAutoFallback: acc.responsesAutoFallback !== false,
    createdAt: Number(acc.createdAt || Date.now()),
  };
  if (!includeSecrets) return allowed;
  for (const key of ['apiKey', 'refreshToken', 'email', 'accountId', 'planType', 'openaiDeviceId', 'openaiSessionId']) {
    if (acc[key]) allowed[key] = String(acc[key]);
  }
  if (acc.tokenExpiresAt) allowed.tokenExpiresAt = Number(acc.tokenExpiresAt);
  return allowed;
}

function normalizeImportedAccount(acc = {}) {
  const normalized = sanitizeAccountForExport(acc, true);
  if (!normalized.id) normalized.id = genId();
  return normalized;
}

function buildBackupPayload({ includeSecrets = false } = {}) {
  return {
    version: 1,
    app: 'image-gen',
    exportedAt: Date.now(),
    containsSecrets: includeSecrets === true,
    accounts: (state.data.accounts || []).map((acc) => sanitizeAccountForExport(acc, includeSecrets)),
    settings: mergeAppSettings(state.appSettings),
    promptHistory: promptHistory.map(sanitizePromptHistoryEntry).filter(Boolean).slice(0, 30),
  };
}

async function deriveBackupKey(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持 Web Crypto，无法加密或解密完整备份');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptBackupPayload(payload, password) {
  if (!String(password || '').trim()) throw new Error('完整导出需要输入加密密码');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    version: 1,
    app: 'image-gen',
    encrypted: true,
    exportedAt: Date.now(),
    crypto: {
      name: 'AES-GCM',
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 210_000,
      salt: toBase64Bytes(salt),
      iv: toBase64Bytes(iv),
    },
    ciphertext: toBase64Bytes(ciphertext),
  };
}

async function decryptBackupEnvelope(envelope, password) {
  if (!String(password || '').trim()) throw new Error('此备份已加密，请输入导入密码');
  const salt = fromBase64Bytes(envelope?.crypto?.salt || '');
  const iv = fromBase64Bytes(envelope?.crypto?.iv || '');
  const ciphertext = fromBase64Bytes(envelope?.ciphertext || '');
  const key = await deriveBackupKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function promptHistoryFromBackupPayload(payload = {}) {
  if (Array.isArray(payload.promptHistory)) {
    return payload.promptHistory.map(sanitizePromptHistoryEntry).filter(Boolean).slice(0, 30);
  }
  return [];
}

function normalizeBackupPayload(payload = {}) {
  if (payload.app !== 'image-gen' || !Array.isArray(payload.accounts)) {
    throw new Error('备份文件格式不正确');
  }
  return {
    version: Number(payload.version || 1),
    app: 'image-gen',
    exportedAt: Number(payload.exportedAt || Date.now()),
    containsSecrets: payload.containsSecrets === true,
    accounts: payload.accounts.map(normalizeImportedAccount).slice(0, 50),
    settings: mergeAppSettings(payload.settings || {}),
    promptHistory: promptHistoryFromBackupPayload(payload),
  };
}

async function readBackupFile(file, password = '') {
  if (!file) return null;
  const raw = JSON.parse(await file.text());
  const payload = raw?.encrypted ? await decryptBackupEnvelope(raw, password) : raw;
  return normalizeBackupPayload(payload);
}

function summarizeBackupPayload(payload = {}) {
  const secretless = !payload.containsSecrets;
  return [
    `<strong>${payload.containsSecrets ? '完整备份' : '安全备份'}</strong>`,
    `账号：${payload.accounts?.length || 0} 个${secretless ? '（不含 key/token/session）' : '（含敏感字段，已通过密码解密）'}`,
    `设置：${payload.settings ? '1 组' : '0 组'}`,
    `提示词历史：${payload.promptHistory?.length || 0} 条`,
    `导出时间：${payload.exportedAt ? new Date(payload.exportedAt).toLocaleString() : '未知'}`,
  ].join('<br>');
}

function setBackupPreview(html = '', isError = false) {
  const preview = $('#importBackupPreview');
  if (!preview) return;
  preview.innerHTML = html;
  preview.classList.toggle('hidden', !html);
  preview.classList.toggle('error', !!isError);
}

function readBackupImportScopes() {
  return {
    accounts: $('#importBackupAccounts')?.checked !== false,
    settings: $('#importBackupSettings')?.checked !== false,
    promptHistory: $('#importBackupPromptHistory')?.checked !== false,
  };
}

function applyImportedBackup(payload, scopes = readBackupImportScopes()) {
  if (!payload) throw new Error('请先选择并预览备份文件');
  if (scopes.accounts) {
    const byId = new Map((state.data.accounts || []).map((acc) => [acc.id, acc]));
    for (const acc of payload.accounts || []) byId.set(acc.id || genId(), normalizeImportedAccount(acc));
    state.data.accounts = Array.from(byId.values()).slice(0, 50);
    if (!state.data.activeId && state.data.accounts.length) state.data.activeId = state.data.accounts[0].id;
    saveData();
    renderSwitcher();
  }
  if (scopes.settings) {
    state.appSettings = mergeAppSettings(payload.settings || {});
    saveAppSettings();
    fillSettingsForm();
    applyGenerationDefaultsToControls();
    syncPromptEnhancementUi();
  }
  if (scopes.promptHistory) {
    const byId = new Map(promptHistory.map((item) => [item.id, item]));
    for (const item of payload.promptHistory || []) {
      const sanitized = sanitizePromptHistoryEntry(item);
      if (sanitized) byId.set(sanitized.id, sanitized);
    }
    promptHistory = Array.from(byId.values())
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 30);
    savePromptHistory();
    renderPromptHistory();
  }
  return {
    accounts: scopes.accounts ? (payload.accounts?.length || 0) : 0,
    settings: scopes.settings ? 1 : 0,
    promptHistory: scopes.promptHistory ? (payload.promptHistory?.length || 0) : 0,
  };
}

function exportSafeBackup() {
  downloadJsonFile(`image-gen-safe-backup-${Date.now()}.json`, buildBackupPayload({ includeSecrets: false }));
  setBackupPreview('安全备份已导出：不包含 API key、OAuth token、session 或平台口令。');
}

async function exportEncryptedBackup() {
  const password = $('#backupPassword')?.value || '';
  const envelope = await encryptBackupPayload(buildBackupPayload({ includeSecrets: true }), password);
  downloadJsonFile(`image-gen-encrypted-backup-${Date.now()}.json`, envelope);
  setBackupPreview('完整备份已加密导出；导入时需要同一个密码。');
}

async function previewBackupImportFromFile(file) {
  const password = $('#backupPassword')?.value || '';
  pendingBackupImport = await readBackupFile(file, password);
  setBackupPreview(`${summarizeBackupPayload(pendingBackupImport)}<br><strong>请确认导入范围后再点击确认。</strong>`);
  const confirmBtn = $('#confirmImportBackup');
  if (confirmBtn) confirmBtn.disabled = false;
}

function confirmImportBackup() {
  const result = applyImportedBackup(pendingBackupImport, readBackupImportScopes());
  setBackupPreview(`导入完成：账号 ${result.accounts} 个，设置 ${result.settings} 组，提示词历史 ${result.promptHistory} 条。`);
  const confirmBtn = $('#confirmImportBackup');
  if (confirmBtn) confirmBtn.disabled = true;
  pendingBackupImport = null;
}

function setAdminSessionStatus(text = '', isError = false) {
  const el = $('#adminSessionStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function syncAdminSessionUi() {
  const unlocked = hasValidAdminSession();
  setAdminSessionStatus(
    unlocked
      ? '已解锁：你拥有全部管理权限。'
      : '未解锁：只能保存浏览器本地偏好，不能修改服务端配置。',
    false,
  );
  const logoutBtn = $('#adminLogoutBtn');
  if (logoutBtn) logoutBtn.disabled = !unlocked;
}

async function verifyAdminTokenInput(token) {
  const resp = await fetch('/api/admin/session', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const error = new Error(data.error || '管理员口令不正确或当前部署未启用管理接口。');
    error.status = resp.status;
    error.code = 'ADMIN_AUTH_FAILED';
    error.context = 'admin';
    throw error;
  }
  return data;
}

async function loginAdminFromForm() {
  const token = ($('#adminTokenInput')?.value || '').trim();
  if (!token) {
    setAdminSessionStatus('请输入管理员口令。', true);
    return;
  }
  try {
    await verifyAdminTokenInput(token);
    persistAdminSession(token);
    setInputValue('adminTokenInput', '');
    syncAdminSessionUi();
    try {
      await fetchEditableRuntimeConfig();
      fillServerConfigForm();
    } catch (error) {
      console.warn('Failed to refresh editable runtime config:', error?.message || error);
    }
    await fetchAccountStoreCapabilities();
    await loadServerAccountsIntoLocal({ silent: true });
    renderAccountList();
    syncSettingsCenterSummary();
    syncAccountMigrationUi();
    notifyAction('管理员已解锁');
  } catch (error) {
    clearAdminSession();
    syncAdminSessionUi();
    setAdminSessionStatus('管理员口令不正确或当前部署未启用管理接口。', true);
    showError(error, { context: 'admin' });
  }
}

function logoutAdminSession() {
  clearAdminSession();
  setInputValue('adminTokenInput', '');
  syncAdminSessionUi();
  syncAccountMigrationUi();
  notifyAction('已退出管理员模式');
}

async function fetchServerRuntimeConfig() {
  const resp = await fetch('/api/config/runtime');
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  state.serverConfig = data.runtime || null;
  state.serverCapabilities = data.meta?.capabilities || data.capabilities || null;
  state.configSchema = data.schema || null;
  return data;
}

async function fetchEditableRuntimeConfig() {
  const resp = await adminFetch('/api/config/editable', { method: 'GET' });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  state.serverConfig = data.runtime || state.serverConfig;
  state.serverCapabilities = data.meta?.capabilities || data.capabilities || state.serverCapabilities;
  state.configSchema = data.schema || state.configSchema;
  return data;
}

function getProviderDefaults() {
  return state.serverConfig?.providerDefaults || {
    apiUrl: 'https://api.openai.com',
    imageModel: DEFAULT_IMAGE_MODEL,
    responsesModel: DEFAULT_RESPONSES_MODEL,
    streamMode: false,
    responsesAutoFallback: true,
    imageEditsCompatMode: false,
    forceProxy: false,
  };
}

function getServerCapabilities() {
  return state.serverCapabilities || {};
}

function canUseProxyMultipart() {
  return getServerCapabilities().canProxyMultipart !== false;
}

function canPersistImagesOnServer() {
  return getServerCapabilities().canPersistImages !== false;
}

function canUseStorageApi() {
  return getServerCapabilities().canUseStorageApi !== false;
}

function canUseConfigSaveApi() {
  return getServerCapabilities().canUseConfigSaveApi !== false;
}

function normalizeAccountStoreCapabilities(input = {}) {
  const source = input.store || input.accountStore || input;
  const type = ['file', 'upstash', 'browser'].includes(source?.type) ? source.type : 'browser';
  return {
    ok: input.ok !== false,
    schemaVersion: Number(input.schemaVersion || 1),
    store: {
      requested: source?.requested || 'auto',
      type,
      available: source?.available !== false,
      encrypted: source?.encrypted === true,
      fallback: source?.fallback || 'browser',
      fallbackActive: source?.fallbackActive === true || type === 'browser' || source?.available === false,
      scope: source?.scope || (type === 'upstash' ? 'remote' : type === 'file' ? 'server' : 'browser'),
      reason: source?.reason || '',
    },
  };
}

function fallbackAccountStoreCapabilities(reason = 'api-unavailable') {
  return normalizeAccountStoreCapabilities({
    ok: true,
    store: {
      requested: 'auto',
      type: 'browser',
      available: true,
      encrypted: false,
      fallback: 'browser',
      fallbackActive: true,
      scope: 'browser',
      reason,
    },
  });
}

async function fetchAccountStoreCapabilities() {
  try {
    const resp = await fetch('/api/accounts/capabilities');
    if (resp.status === 404) {
      state.accountStoreCapabilities = fallbackAccountStoreCapabilities('api-not-found');
      syncAccountStoreUi();
      return state.accountStoreCapabilities;
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    state.accountStoreCapabilities = normalizeAccountStoreCapabilities(data);
  } catch (error) {
    console.warn('Failed to load account store capabilities:', error?.message || error);
    state.accountStoreCapabilities = fallbackAccountStoreCapabilities('api-error');
  }
  syncAccountStoreUi();
  return state.accountStoreCapabilities;
}

function describeAccountStore(store = {}) {
  const type = store.type || 'browser';
  if (type === 'file' && store.available) {
    return {
      pill: '账号当前保存位置：服务端文件',
      type: '服务端文件存储',
      detail: '当前 Node / Docker 部署具备服务端账号存储能力；管理员解锁后，账号会优先同步到服务端文件，并保留浏览器缓存作为兼容副本。',
      encrypted: store.encrypted ? '敏感字段：已启用账号存储加密' : '敏感字段：尚未检测到账号加密 key，后续写入前会继续要求加密或本地密钥。',
    };
  }
  if (type === 'upstash' && store.available) {
    return {
      pill: '账号当前保存位置：Upstash',
      type: 'Upstash 远程存储',
      detail: '已检测到 Upstash 账号存储配置，适合云平台多浏览器共享账号；页面不会展示 Upstash URL、Token 或账号密钥。',
      encrypted: store.encrypted ? '敏感字段：已启用加密配置' : '敏感字段：缺少加密配置，暂不应写入远程存储。',
    };
  }
  if (type !== 'browser' && store.available === false) {
    return {
      pill: '账号当前保存位置：浏览器缓存',
      type: type === 'upstash' ? 'Upstash 未就绪' : '服务端账号存储未就绪',
      detail: '已检测到服务端账号存储配置不完整。为避免影响使用，API Key 与 OAuth 账号会继续保存在当前浏览器。',
      encrypted: '敏感字段：未写入服务端或远程存储。',
    };
  }
  return {
    pill: '账号当前保存位置：浏览器缓存',
    type: '当前浏览器缓存',
    detail: '当前部署未检测到可用的服务端账号存储或 Upstash，API Key 与 OAuth 账号会按旧逻辑保存在此浏览器。',
    encrypted: '敏感字段：仅保存在当前浏览器；换设备、无痕模式或清理浏览器数据后需要重新配置。',
  };
}

function syncAccountStoreUi() {
  const capabilities = state.accountStoreCapabilities || fallbackAccountStoreCapabilities('not-loaded');
  const store = capabilities.store || {};
  const copy = describeAccountStore(store);
  const quickStatus = $('#settingsAccountStorageStatus');
  if (quickStatus) quickStatus.textContent = copy.pill;
  const storageStatus = $('#storageAccountStoreStatus');
  if (storageStatus) storageStatus.textContent = copy.pill.replace('账号当前保存位置：', '');
  const typeEl = $('#accountStoreType');
  if (typeEl) typeEl.textContent = copy.type;
  const detailEl = $('#accountStoreDetail');
  if (detailEl) detailEl.textContent = copy.detail;
  const encryptedEl = $('#accountStoreEncrypted');
  if (encryptedEl) encryptedEl.textContent = copy.encrypted;
  syncAccountMigrationUi();
}

function canUseServerAccountStore() {
  const store = state.accountStoreCapabilities?.store || {};
  return hasValidAdminSession()
    && store.available === true
    && store.type !== 'browser';
}

function accountStoreSyncWarning(action, error) {
  const message = error?.message || error;
  console.warn(`Failed to ${action} server account store:`, message);
}

function compactServerAccountPayload(account = {}) {
  const payload = sanitizeAccountForExport(account, true);
  for (const key of ['apiKey', 'refreshToken', 'email', 'accountId', 'planType', 'openaiDeviceId', 'openaiSessionId']) {
    if (!String(payload[key] || '').trim()) delete payload[key];
  }
  if (!Number.isFinite(Number(payload.tokenExpiresAt || 0))) delete payload.tokenExpiresAt;
  return payload;
}

function compactServerAccountPatch(fields = {}) {
  const source = fields && typeof fields === 'object' ? fields : {};
  const patch = {};
  const textKeys = ['type', 'name', 'apiUrl', 'model', 'responsesModel', 'email', 'accountId', 'planType'];
  const secretKeys = ['apiKey', 'refreshToken', 'openaiDeviceId', 'openaiSessionId'];
  for (const key of textKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = String(source[key] || '').trim();
    if (value) patch[key] = value;
  }
  for (const key of secretKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = String(source[key] || '').trim();
    if (value) patch[key] = value;
  }
  for (const key of ['streamMode', 'responsesAutoFallback', 'imageEditsCompatMode']) {
    if (Object.prototype.hasOwnProperty.call(source, key)) patch[key] = source[key] === true;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'tokenExpiresAt')) {
    const expires = Number(source.tokenExpiresAt);
    if (Number.isFinite(expires) && expires > 0) patch.tokenExpiresAt = expires;
  }
  return patch;
}

async function readAccountStoreResponse(resp, label) {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const error = new Error(data.error || `${label} failed: HTTP ${resp.status}`);
    error.status = resp.status;
    error.code = data.code || 'ACCOUNT_STORE_SYNC_FAILED';
    error.context = 'account-store';
    throw error;
  }
  return data;
}

async function listServerAccounts() {
  if (!canUseServerAccountStore()) return null;
  const resp = await adminFetch('/api/accounts', {
    method: 'GET',
  });
  return readAccountStoreResponse(resp, 'List accounts');
}

function mergeServerAccountsIntoLocal(data = {}) {
  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  let changed = false;
  for (const serverAccount of accounts) {
    const id = String(serverAccount?.id || '').trim();
    if (!id) continue;
    const existing = state.data.accounts.find((item) => item.id === id);
    const merged = {
      ...(existing || {}),
      ...serverAccount,
      id,
      serverStored: true,
      apiKey: existing?.apiKey || '',
      refreshToken: existing?.refreshToken || '',
      openaiDeviceId: existing?.openaiDeviceId || serverAccount.openaiDeviceId || '',
      openaiSessionId: existing?.openaiSessionId || serverAccount.openaiSessionId || '',
    };
    if (existing) Object.assign(existing, merged);
    else state.data.accounts.push(merged);
    changed = true;
  }
  const activeId = String(data?.activeId || '').trim();
  if (activeId && state.data.accounts.some((item) => item.id === activeId)) {
    state.data.activeId = activeId;
    changed = true;
  } else if (!state.data.activeId && state.data.accounts.length) {
    state.data.activeId = state.data.accounts[0].id;
    changed = true;
  }
  if (changed) saveData();
  return changed;
}

async function loadServerAccountsIntoLocal({ silent = false } = {}) {
  if (!canUseServerAccountStore()) return null;
  try {
    const data = await listServerAccounts();
    const changed = mergeServerAccountsIntoLocal(data);
    if (changed) {
      renderSwitcher();
      renderDropdown();
      renderAccountList();
      syncSettingsCenterSummary();
    }
    if (!silent) {
      const count = Array.isArray(data?.accounts) ? data.accounts.length : 0;
      setAccountMigrationStatus(count ? `已从服务端加载 ${count} 个账号；敏感字段仍不会回显。` : '服务端账号存储当前没有账号。');
    }
    return data;
  } catch (error) {
    accountStoreSyncWarning('list', error);
    if (!silent) setAccountMigrationStatus('服务端账号读取失败，已继续使用浏览器缓存。', true);
    return null;
  }
}

async function createServerAccount(account, { activeId = state.data.activeId } = {}) {
  if (!canUseServerAccountStore()) return null;
  const resp = await adminFetch('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      activeId: activeId || account?.id || state.data.activeId,
      account: compactServerAccountPayload(account),
    }),
  });
  return readAccountStoreResponse(resp, 'Create account');
}

async function patchServerAccount(id, fields) {
  if (!canUseServerAccountStore() || !id) return null;
  const resp = await adminFetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      activeId: state.data.activeId,
      account: compactServerAccountPatch(fields),
    }),
  });
  return readAccountStoreResponse(resp, 'Update account');
}

async function deleteServerAccountOnServer(id) {
  if (!canUseServerAccountStore() || !id) return null;
  const resp = await adminFetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return readAccountStoreResponse(resp, 'Delete account');
}

function setAccountMigrationStatus(text = '', isError = false) {
  const el = $('#accountMigrationStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function syncAccountMigrationUi() {
  const btn = $('#migrateBrowserAccountsBtn');
  const localCount = state.data.accounts.length;
  const canMigrate = canUseServerAccountStore() && localCount > 0;
  if (btn) btn.disabled = !canMigrate;
  if (!$('#accountMigrationStatus')) return;
  if (!localCount) {
    setAccountMigrationStatus('当前浏览器没有可迁移账号。');
  } else if (!hasValidAdminSession()) {
    setAccountMigrationStatus('先在“管理员”分区解锁管理员，再迁移当前浏览器账号。');
  } else if (!canUseServerAccountStore()) {
    setAccountMigrationStatus('当前部署未启用可写的服务端账号存储，账号会继续保存在浏览器缓存。');
  } else {
    setAccountMigrationStatus(`可迁移 ${localCount} 个浏览器账号到服务端；迁移后仍保留浏览器副本作为 fallback。`);
  }
}

async function importLocalAccountsToServer(accounts, { activeId = state.data.activeId } = {}) {
  if (!canUseServerAccountStore()) return null;
  const resp = await adminFetch('/api/accounts/import-local', {
    method: 'POST',
    body: JSON.stringify({
      activeId,
      accounts,
    }),
  });
  return readAccountStoreResponse(resp, 'Import browser accounts');
}

async function migrateBrowserAccountsToServer() {
  const accounts = state.data.accounts.map(compactServerAccountPayload);
  if (!accounts.length) {
    setAccountMigrationStatus('当前浏览器没有可迁移账号。', true);
    syncAccountMigrationUi();
    return null;
  }
  if (!canUseServerAccountStore()) {
    setAccountMigrationStatus('请先解锁管理员，并确认当前部署已启用服务端账号存储。', true);
    syncAccountMigrationUi();
    return null;
  }

  const btn = $('#migrateBrowserAccountsBtn');
  if (btn) btn.disabled = true;
  setAccountMigrationStatus('正在迁移当前浏览器账号到服务端...');
  try {
    const data = await importLocalAccountsToServer(accounts, { activeId: state.data.activeId });
    if (data?.activeId && state.data.accounts.some((item) => item.id === data.activeId)) {
      state.data.activeId = data.activeId;
      saveData();
      renderSwitcher();
      renderDropdown();
    }
    setAccountMigrationStatus(`已迁移 ${data?.imported ?? accounts.length} 个账号到服务端；浏览器副本已保留。`);
    notifyAction('浏览器账号已迁移到服务端');
    return data;
  } catch (error) {
    setAccountMigrationStatus('迁移失败：请检查管理员登录态和服务端账号存储配置。', true);
    showError(error, { context: 'account-store.import' });
    return null;
  } finally {
    if (btn) btn.disabled = !canUseServerAccountStore() || !state.data.accounts.length;
  }
}

function applyServerAccountMetadata(account = {}) {
  const id = String(account.id || '').trim();
  if (!id) return;
  const fields = compactServerAccountPatch(account);
  const existing = state.data.accounts.find((item) => item.id === id);
  if (existing) {
    updateAccount(id, fields, { syncServer: false });
  } else {
    addAccount(account, { syncServer: false });
  }
}

function markConfigApiUnavailable(status = 0) {
  state.serverCapabilities = {
    ...(state.serverCapabilities || {}),
    canUseConfigSaveApi: false,
  };
  const error = new Error('当前部署未提供服务端配置保存接口，本次仅保存本地页面设置');
  error.status = status;
  error.code = 'CONFIG_SAVE_UNAVAILABLE';
  error.context = 'settings';
  return error;
}

function isConfigSaveUnavailableError(error) {
  return error?.code === 'CONFIG_SAVE_UNAVAILABLE'
    || error?.status === 404
    || /HTTP 404|not found|configuration save api/i.test(String(error?.message || error || ''));
}

async function saveServerRuntimeConfig(config) {
  if (!canUseConfigSaveApi()) {
    throw markConfigApiUnavailable();
  }
  const resp = await adminFetch('/api/config/save', {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 404) throw markConfigApiUnavailable(resp.status);
  if (!resp.ok) {
    const error = new Error(data.error || `HTTP ${resp.status}`);
    error.status = resp.status;
    error.code = 'CONFIG_SAVE_FAILED';
    error.context = 'settings';
    throw error;
  }
  state.serverConfig = data.runtime || state.serverConfig;
  state.serverCapabilities = data.meta?.capabilities || data.capabilities || state.serverCapabilities;
  return data;
}

async function runPlatformAction(action, config) {
  const resp = await adminFetch(`/api/config/platform/${action}`, {
    method: 'POST',
    body: JSON.stringify({ config, platform: config?.deploy?.platform }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data.result || data;
}

async function testAccountStoreConfigFromForm() {
  setAccountStoreConfigStatus('正在测试账号存储连接...');
  try {
    const resp = await adminFetch('/api/accounts/store/test', {
      method: 'POST',
      body: JSON.stringify({ config: readServerConfigForm() }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const error = new Error(data.error || `HTTP ${resp.status}`);
      error.status = resp.status;
      throw error;
    }
    setAccountStoreConfigStatus(data.message || (data.ok ? '账号存储连接正常。' : '当前账号存储不可用，将继续使用浏览器缓存。'), data.ok !== true);
    await fetchAccountStoreCapabilities();
    if (data.ok) notifyAction(data.message || '账号存储连接正常');
    return data;
  } catch (error) {
    setAccountStoreConfigStatus('账号存储测试失败：请检查管理员登录态、Upstash URL、Token 和加密 Key。', true);
    showError(error, { context: 'account-store.test' });
    return null;
  }
}

function loadAppSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}');
    const defaults = state.serverConfig ? {
      generation: state.serverConfig.generation || {},
      watermark: state.serverConfig.watermark || {},
      storage: state.serverConfig.storage || {},
      promptEnhancement: state.serverConfig.promptEnhancement || {},
    } : {};
    state.appSettings = mergeAppSettings({ ...defaults, ...saved });
  } catch {
    state.appSettings = cloneDefaultSettings();
  }
}

function saveAppSettings() {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(state.appSettings));
}

function setSelectValue(id, value) {
  const el = $(`#${id}`);
  if (el) el.value = value;
}

function setChecked(id, checked) {
  const el = $(`#${id}`);
  if (el) el.checked = !!checked;
}

function setInputValue(id, value) {
  const el = $(`#${id}`);
  if (el) el.value = value;
}

function setSegmentValue(group, value) {
  if (!group) return;
  group.querySelectorAll('button').forEach((btn) => {
    const active = btn.dataset.value === value;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setExistingSecretHint(id, hasExisting, placeholderWhenExisting) {
  const el = $(`#${id}`);
  if (!el) return;
  if (hasExisting) {
    el.dataset.hasExisting = 'true';
    el.placeholder = placeholderWhenExisting;
  } else {
    delete el.dataset.hasExisting;
  }
}

function setSensitiveConfigHint(id, hasExisting, placeholderWhenExisting, placeholderWhenEmpty = '') {
  const el = $(`#${id}`);
  if (!el) return;
  el.value = '';
  if (hasExisting) {
    el.dataset.hasExisting = 'true';
    el.placeholder = placeholderWhenExisting;
  } else {
    delete el.dataset.hasExisting;
    if (placeholderWhenEmpty) el.placeholder = placeholderWhenEmpty;
  }
}

function applySegmentDefault(field, value) {
  const group = $(`.seg[data-field="${field}"]`);
  if (!group) return;
  setSegmentValue(group, value);
}

function handleSegmentKeydown(event, group, btn) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const buttons = [...group.querySelectorAll('button')];
  const currentIndex = buttons.indexOf(btn);
  if (currentIndex < 0) return;
  event.preventDefault();
  let nextIndex = currentIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = buttons.length - 1;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
  const next = buttons[nextIndex];
  setSegmentValue(group, next.dataset.value);
  next.focus();
}

function getSizeItems(csEl) {
  return [...(csEl?.querySelectorAll('.cs-item') || [])];
}

function getActiveSizeIndex(csEl) {
  const items = getSizeItems(csEl);
  const activeIndex = items.findIndex((item) => item.classList.contains('active'));
  return activeIndex >= 0 ? activeIndex : 0;
}

function focusSizeItem(csEl, index) {
  const items = getSizeItems(csEl);
  if (!items.length) return;
  const normalized = ((index % items.length) + items.length) % items.length;
  items[normalized].focus();
}

function setSizeSelectOpen(csEl, open, options = {}) {
  if (!csEl) return;
  const trigger = csEl.querySelector('.cs-trigger');
  const dropdown = csEl.querySelector('.cs-dropdown');
  dropdown?.classList.toggle('hidden', !open);
  trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && options.focusActive !== false) focusSizeItem(csEl, getActiveSizeIndex(csEl));
}

function selectSizeItem(csEl, item, options = {}) {
  if (!csEl || !item) return;
  csEl.dataset.value = item.dataset.value;
  const trigger = csEl.querySelector('.cs-trigger');
  if (trigger) trigger.textContent = item.dataset.label;
  getSizeItems(csEl).forEach((candidate) => {
    const active = candidate === item;
    candidate.classList.toggle('active', active);
    candidate.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (options.close !== false) setSizeSelectOpen(csEl, false, { focusActive: false });
  if (options.focusTrigger !== false) trigger?.focus();
}

function handleSizeTriggerKeydown(event, csEl) {
  if (!['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
  if (event.key === 'Escape') {
    setSizeSelectOpen(csEl, false, { focusActive: false });
    return;
  }
  event.preventDefault();
  setSizeSelectOpen(csEl, true, { focusActive: false });
  if (event.key === 'ArrowUp' || event.key === 'End') focusSizeItem(csEl, getSizeItems(csEl).length - 1);
  else if (event.key === 'Home') focusSizeItem(csEl, 0);
  else focusSizeItem(csEl, getActiveSizeIndex(csEl));
}

function handleSizeItemKeydown(event, csEl, item) {
  const items = getSizeItems(csEl);
  const currentIndex = items.indexOf(item);
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    setSizeSelectOpen(csEl, false, { focusActive: false });
    csEl.querySelector('.cs-trigger')?.focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowDown') focusSizeItem(csEl, currentIndex + 1);
  else if (event.key === 'ArrowUp') focusSizeItem(csEl, currentIndex - 1);
  else if (event.key === 'Home') focusSizeItem(csEl, 0);
  else if (event.key === 'End') focusSizeItem(csEl, items.length - 1);
  else selectSizeItem(csEl, item);
}

function applySizeDefault(value) {
  const csEl = $('#sizeSelect');
  if (!csEl) return;
  const item = csEl.querySelector(`.cs-item[data-value="${value}"]`) || csEl.querySelector('.cs-item[data-value="auto"]');
  if (!item) return;
  selectSizeItem(csEl, item, { close: false, focusTrigger: false });
}

function applyGenerationDefaultsToControls() {
  const g = state.appSettings.generation;
  applySegmentDefault('quality', g.quality);
  applySegmentDefault('background', g.background);
  applySizeDefault(g.size);
  setSelectValue('formatSelect', g.format);
  setSelectValue('countSelect', String(g.count || 1));
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatPreviewTime(date = new Date(), format = 'camera') {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  if (format === 'slash') return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
  if (format === 'dash') return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  if (format === 'iso') return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}

function renderWatermarkPreview() {
  const preview = $('#watermarkPreview');
  if (!preview) return;
  const wm = readWatermarkForm();
  const lines = [];
  const time = formatPreviewTime(new Date(), wm.timeFormat);
  if (wm.mode === 'time') lines.push(time);
  else if (wm.mode === 'camera-time' || wm.mode === 'custom-time') lines.push(wm.text || 'AI Image Studio', time);
  else lines.push(wm.text || 'AI Image Studio');
  preview.style.alignItems = wm.position.includes('left') ? 'flex-start' : wm.position.includes('right') ? 'flex-end' : 'center';
  preview.style.justifyContent = wm.position.startsWith('top') ? 'flex-start' : wm.position === 'center' ? 'center' : 'flex-end';
  preview.innerHTML = lines.map((line, i) => `<span class="wm-line${i ? ' small' : ''}${wm.background ? ' with-bg' : ''}${wm.shadow ? ' with-shadow' : ''}" style="color:${wm.color};opacity:${wm.opacity};font-size:${i ? Math.max(11, wm.fontSize * 0.75) : wm.fontSize}px;">${line.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>`).join('');
}

function getPromptEnhancementRuntime(source = 'state') {
  if (source === 'form') {
    const enabled = !!$('#promptEnhancementEnabled')?.checked;
    const runMode = $('#promptEnhancementRunMode')?.value === 'auto' ? 'auto' : 'manual';
    return { enabled, runMode };
  }
  const settings = state.appSettings.promptEnhancement || {};
  return {
    enabled: settings.enabled === true,
    runMode: settings.runMode === 'auto' ? 'auto' : 'manual',
  };
}

function isPromptEnhancementAutoMode(source = 'state') {
  const pe = getPromptEnhancementRuntime(source);
  return pe.enabled && pe.runMode === 'auto';
}

function isPromptEnhancementManualMode(source = 'state') {
  const pe = getPromptEnhancementRuntime(source);
  return pe.enabled && pe.runMode === 'manual';
}

function syncPromptEnhancementUi(source = 'state') {
  const formEnabled = !!$('#promptEnhancementEnabled')?.checked;
  $('#promptEnhancementOptions')?.classList.toggle('hidden', !formEnabled);
  $('#enhancePromptBtn')?.classList.toggle('hidden', !isPromptEnhancementManualMode(source));
}

function readPromptEnhancementForm() {
  return {
    enabled: !!$('#promptEnhancementEnabled')?.checked,
    runMode: $('#promptEnhancementRunMode')?.value === 'auto' ? 'auto' : 'manual',
    model: ($('#promptEnhancementModel')?.value || '').trim(),
    mode: $('#promptEnhancementMode')?.value || 'balanced',
    language: $('#promptEnhancementLanguage')?.value || 'auto',
  };
}

function readWatermarkForm() {
  return {
    enabled: !!$('#watermarkEnabled')?.checked,
    temporaryMode: $('#watermarkTemporaryMode')?.value || 'default',
    mode: $('#watermarkMode')?.value || 'camera-time',
    text: ($('#watermarkText')?.value || 'AI Image Studio').trim() || 'AI Image Studio',
    timeFormat: $('#watermarkTimeFormat')?.value || 'camera',
    position: $('#watermarkPosition')?.value || 'bottom-right',
    opacity: Number($('#watermarkOpacity')?.value || 0.72),
    fontSize: Number($('#watermarkFontSize')?.value || 28),
    color: $('#watermarkColor')?.value || '#ffffff',
    shadow: !!$('#watermarkShadow')?.checked,
    background: !!$('#watermarkBackground')?.checked,
  };
}

function setAccountStoreConfigStatus(text = '', isError = false) {
  const el = $('#accountStoreConfigStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function fillAccountStoreConfigForm(cfg = state.serverConfig || {}) {
  const accountStore = cfg.accountStore || {};
  setSelectValue('accountStoreTypeSelect', accountStore.type || 'auto');
  setInputValue('accountStoreNamespace', accountStore.namespace || 'image-gen');
  setInputValue('accountStoreDeploymentId', accountStore.deploymentId || 'default');
  setSensitiveConfigHint(
    'accountStoreUpstashRestUrl',
    accountStore.upstashRestUrlConfigured === true,
    '已配置，留空保存会保留，输入新值可覆盖',
    'https://...upstash.io',
  );
  setSensitiveConfigHint(
    'accountStoreUpstashRestToken',
    accountStore.upstashRestTokenConfigured === true,
    '已配置，留空保存会保留，输入新值可覆盖',
    '保存后不回显，留空保留已有值',
  );
  setSensitiveConfigHint(
    'accountStoreEncryptionKey',
    accountStore.encryptionKeyConfigured === true,
    '已配置，留空保存会保留，输入新值可覆盖',
    '建议使用长随机字符串，保存后不回显',
  );
  setAccountStoreConfigStatus('保存服务端配置后，账号会优先写入可用的服务端或 Upstash 存储。');
}


function fillServerConfigForm() {
  const cfg = state.serverConfig;
  if (!cfg) return;
  setInputValue('serverDefaultImageModel', cfg.providerDefaults?.imageModel || DEFAULT_IMAGE_MODEL);
  setInputValue('serverDefaultResponsesModel', cfg.providerDefaults?.responsesModel || DEFAULT_RESPONSES_MODEL);
  setChecked('serverDefaultStreamMode', cfg.providerDefaults?.streamMode === true);
  setChecked('serverDefaultResponsesAutoFallback', cfg.providerDefaults?.responsesAutoFallback !== false);
  setChecked('serverDefaultImageEditsCompatMode', cfg.providerDefaults?.imageEditsCompatMode === true);
  setChecked('serverDefaultForceProxy', cfg.providerDefaults?.forceProxy === true);
  setSelectValue('deployPlatform', cfg.deploy?.platform || 'node');
  const maskedAccountId = cfg.deploy?.accountId === '***已配置***';
  const maskedProjectId = cfg.deploy?.projectId === '***已配置***';
  setInputValue('deployAccountId', maskedAccountId ? '' : (cfg.deploy?.accountId || ''));
  setInputValue('deployProjectId', maskedProjectId ? '' : (cfg.deploy?.projectId || ''));
  setExistingSecretHint('deployAccountId', maskedAccountId, '已配置，留空保存会保留，输入新值可覆盖');
  setExistingSecretHint('deployProjectId', maskedProjectId, '已配置，留空保存会保留，输入新值可覆盖');
  setInputValue('deployApiToken', cfg.deploy?.apiToken || '');
  setExistingSecretHint('deployApiToken', cfg.deploy?.apiTokenConfigured === true, '已配置，留空保存会保留，输入新值可覆盖');
  setChecked('deployAutoSync', cfg.deploy?.autoSync === true);
  setChecked('deployAutoRedeploy', cfg.deploy?.autoRedeploy === true);
  fillAccountStoreConfigForm(cfg);
  syncAdminSessionUi();
}

function assignDeployFieldFromInput(deploy, id, fieldName) {
  const el = $(`#${id}`);
  const value = (el?.value || '').trim();
  if (value && value !== '***已配置***') {
    deploy[fieldName] = value;
    return;
  }
  if (el?.dataset?.hasExisting === 'true') return;
  delete deploy[fieldName];
}

function assignSensitiveConfigFieldFromInput(target, id, fieldName) {
  const el = $(`#${id}`);
  const value = (el?.value || '').trim();
  if (value && value !== '***已配置***') {
    target[fieldName] = value;
    return;
  }
  if (el?.dataset?.hasExisting === 'true') return;
  delete target[fieldName];
}

function readAccountStoreConfigForm() {
  const current = state.serverConfig?.accountStore || {};
  const accountStore = {
    ...(current || {}),
    type: $('#accountStoreTypeSelect')?.value || 'auto',
    namespace: ($('#accountStoreNamespace')?.value || 'image-gen').trim() || 'image-gen',
    deploymentId: ($('#accountStoreDeploymentId')?.value || 'default').trim() || 'default',
  };
  assignSensitiveConfigFieldFromInput(accountStore, 'accountStoreUpstashRestUrl', 'upstashRestUrl');
  assignSensitiveConfigFieldFromInput(accountStore, 'accountStoreUpstashRestToken', 'upstashRestToken');
  assignSensitiveConfigFieldFromInput(accountStore, 'accountStoreEncryptionKey', 'encryptionKey');
  return accountStore;
}

function readServerConfigForm() {
  const current = state.serverConfig || {};
  const deploy = {
    ...(current.deploy || {}),
    platform: $('#deployPlatform')?.value || 'node',
    autoSync: !!$('#deployAutoSync')?.checked,
    autoRedeploy: !!$('#deployAutoRedeploy')?.checked,
  };
  assignDeployFieldFromInput(deploy, 'deployAccountId', 'accountId');
  assignDeployFieldFromInput(deploy, 'deployProjectId', 'projectId');
  assignDeployFieldFromInput(deploy, 'deployApiToken', 'apiToken');

  return {
    ...current,
    providerDefaults: {
      ...(current.providerDefaults || {}),
      apiUrl: current.providerDefaults?.apiUrl || getProviderDefaults().apiUrl,
      imageModel: ($('#serverDefaultImageModel')?.value || '').trim() || DEFAULT_IMAGE_MODEL,
      responsesModel: ($('#serverDefaultResponsesModel')?.value || '').trim() || DEFAULT_RESPONSES_MODEL,
      streamMode: !!$('#serverDefaultStreamMode')?.checked,
      responsesAutoFallback: !!$('#serverDefaultResponsesAutoFallback')?.checked,
      imageEditsCompatMode: !!$('#serverDefaultImageEditsCompatMode')?.checked,
      forceProxy: !!$('#serverDefaultForceProxy')?.checked,
    },
    generation: {
      ...(current.generation || {}),
      size: $('#settingsDefaultSize')?.value || 'auto',
      quality: $('#settingsDefaultQuality')?.value || 'medium',
      format: $('#settingsDefaultFormat')?.value || 'png',
      background: $('#settingsDefaultBackground')?.value || 'auto',
      count: getGenerationCount($('#settingsDefaultCount')?.value || 1),
    },
    promptEnhancement: readPromptEnhancementForm(),
    watermark: readWatermarkForm(),
    storage: { enabled: !!$('#storageEnabled')?.checked },
    accountStore: readAccountStoreConfigForm(),
    deploy,
  };
}

function fillSettingsForm() {
  fillServerConfigForm();
  const settings = mergeAppSettings(state.appSettings);
  setSelectValue('settingsDefaultSize', settings.generation.size);
  setSelectValue('settingsDefaultQuality', settings.generation.quality);
  setSelectValue('settingsDefaultFormat', settings.generation.format);
  setSelectValue('settingsDefaultBackground', settings.generation.background);
  setSelectValue('settingsDefaultCount', String(settings.generation.count || 1));
  const wm = settings.watermark;
  setChecked('watermarkEnabled', wm.enabled);
  setSelectValue('watermarkTemporaryMode', wm.temporaryMode);
  setSelectValue('watermarkMode', wm.mode);
  setInputValue('watermarkText', wm.text);
  setSelectValue('watermarkTimeFormat', wm.timeFormat);
  setSelectValue('watermarkPosition', wm.position);
  setInputValue('watermarkOpacity', wm.opacity);
  setInputValue('watermarkFontSize', wm.fontSize);
  setInputValue('watermarkColor', wm.color);
  setChecked('watermarkShadow', wm.shadow);
  setChecked('watermarkBackground', wm.background);
  const pe = settings.promptEnhancement;
  setChecked('promptEnhancementEnabled', pe.enabled);
  setSelectValue('promptEnhancementRunMode', pe.runMode || 'manual');
  setInputValue('promptEnhancementModel', pe.model || '');
  setSelectValue('promptEnhancementMode', pe.mode);
  setSelectValue('promptEnhancementLanguage', pe.language);
  syncPromptEnhancementUi();
  setChecked('storageEnabled', settings.storage.enabled);
  renderWatermarkPreview();
}

function readSettingsForm() {
  return mergeAppSettings({
    generation: {
      size: $('#settingsDefaultSize')?.value || 'auto',
      quality: $('#settingsDefaultQuality')?.value || 'medium',
      format: $('#settingsDefaultFormat')?.value || 'png',
      background: $('#settingsDefaultBackground')?.value || 'auto',
      count: getGenerationCount($('#settingsDefaultCount')?.value || 1),
    },
    promptEnhancement: readPromptEnhancementForm(),
    watermark: readWatermarkForm(),
    storage: { enabled: !!$('#storageEnabled')?.checked },
  });
}

async function saveSettingsFromForm() {
  const nextAppSettings = readSettingsForm();
  const nextServerConfig = readServerConfigForm();
  try {
    let saved = null;
    const serverSaveSkippedBecauseAdminLocked = !hasValidAdminSession();
    if (!serverSaveSkippedBecauseAdminLocked) {
      try {
        saved = await saveServerRuntimeConfig(nextServerConfig);
      } catch (e) {
        if (!isConfigSaveUnavailableError(e)) throw e;
        console.warn(e?.message || e);
      }
    } else {
      console.warn('管理员未解锁，本次仅保存浏览器本地设置。');
    }
    state.appSettings = nextAppSettings;
    saveAppSettings();
    if (saved?.runtime) {
      state.serverConfig = saved.runtime;
      loadAppSettings();
      await fetchAccountStoreCapabilities();
      await loadServerAccountsIntoLocal({ silent: true });
    }
    applyGenerationDefaultsToControls();
    syncPromptEnhancementUi();
    closeDialog($('#settingsOverlay'));
    notifyAction(saved?.runtime
      ? '设置已保存'
      : serverSaveSkippedBecauseAdminLocked
        ? '本地设置已保存；如需写入服务端配置，请先解锁管理员'
        : '本地设置已保存；当前部署不支持服务端配置保存');
  } catch (e) {
    showError({ ...(typeof e === 'object' && e ? e : {}), message: e?.message || e, context: 'settings' });
  }
}

function getEffectiveWatermarkSettings() {
  const wm = { ...state.appSettings.watermark };
  if (wm.temporaryMode === 'on') wm.enabled = true;
  if (wm.temporaryMode === 'off') wm.enabled = false;
  return wm;
}

function renderStorageDiagnostics(history = []) {
  const panel = $('#storageDiagnostics');
  if (!panel) return;
  const latest = Array.isArray(history) ? history.find((item) => item?.trace) : null;
  if (!latest?.trace) {
    panel.classList.add('hidden');
    panel.replaceChildren();
    return;
  }
  const trace = latest.trace || {};
  const rows = [
    ['最近链路', trace.protocol || trace.mode || '未知'],
    ['接口', trace.endpoint || '未知'],
    ['图生图兼容模式', trace.compatMode ? '已开启' : '未开启'],
    ['自动回退', trace.fallbackAttempted ? '发生过' : '未发生'],
    ['参考图', trace.hasRef ? '有' : '无'],
    ['站点 Host', trace.apiHost || '未知'],
  ].filter(([, value]) => value);
  const title = document.createElement('div');
  title.className = 'storage-diagnostics-title';
  title.textContent = '最近成功链路诊断';

  const list = document.createElement('div');
  list.className = 'storage-diagnostics-list';
  rows.forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'storage-diagnostics-item';
    const labelEl = document.createElement('span');
    labelEl.className = 'storage-diagnostics-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'storage-diagnostics-value';
    valueEl.textContent = String(value);
    valueEl.title = String(value);
    item.append(labelEl, valueEl);
    list.appendChild(item);
  });

  panel.replaceChildren(title, list);
  panel.classList.remove('hidden');
}

async function loadStorageStats() {
  const el = $('#storageStats');
  if (!el) return;
  if (!canUseStorageApi()) {
    el.textContent = '当前部署不支持服务端历史管理';
    setHistoryStatus('当前部署不支持历史搜索、收藏和删除');
    setHistoryControlsEnabled(false);
    return;
  }
  setHistoryControlsEnabled(true);
  try {
    const resp = await fetch('/api/storage');
    const data = await resp.json();
    el.textContent = `已保存 ${data.count || 0} 张图片，占用 ${formatBytes(data.totalBytes || 0)}`;
    loadImageHistory(data.history || [], { replace: false });
    renderStorageDiagnostics(data.history || []);
  } catch {
    el.textContent = '存储状态读取失败';
  }
}

function setHistoryStatus(text = '', isError = false) {
  const el = $('#historyStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function setHistoryControlsEnabled(enabled) {
  ['historySearch', 'historyFavoriteOnly', 'historyRefresh'].forEach((id) => {
    const el = $(`#${id}`);
    if (el) el.disabled = !enabled;
  });
}

function getHistoryFilters() {
  return {
    query: ($('#historySearch')?.value || '').trim(),
    favorite: $('#historyFavoriteOnly')?.getAttribute('aria-pressed') === 'true',
    limit: 60,
  };
}

async function fetchImageHistory(filters = {}) {
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.favorite) params.set('favorite', 'true');
  if (filters.batchId) params.set('batchId', filters.batchId);
  params.set('limit', String(filters.limit || 60));
  if (filters.cursor) params.set('cursor', String(filters.cursor));
  const resp = await fetch(`/api/storage/history?${params.toString()}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

function renderHistoryResults(history, { replace = true } = {}) {
  const results = $('#results');
  if (!results) return;
  if (replace) results.innerHTML = '';
  if (!Array.isArray(history) || !history.length) return;
  for (const item of history.slice().reverse()) {
    if (item.url) addResultCardFromUrl(item.url, item.format || 'png', item);
  }
}

function loadImageHistory(history, { replace = false } = {}) {
  if (!replace && $('#results')?.children.length) return;
  renderHistoryResults(history, { replace });
}

async function loadHistoryWithFilters() {
  if (!canUseStorageApi()) {
    setHistoryStatus('当前部署不支持历史管理', true);
    return;
  }
  const filters = getHistoryFilters();
  setHistoryStatus('正在读取历史...');
  const data = await fetchImageHistory(filters);
  renderHistoryResults(data.history || [], { replace: true });
  renderStorageDiagnostics(data.history || []);
  const total = Number(data.total || 0);
  if (total) setHistoryStatus(`显示 ${data.count || 0}/${total} 条历史`);
  else setHistoryStatus(filters.query || filters.favorite ? '没有匹配的历史记录' : '暂无历史记录');
}

async function clearStorageData(scope) {
  if (scope === 'conversations') {
    clearActiveJob();
    $('#prompt').value = '';
    $('#results').innerHTML = '';
    await loadStorageStats();
    return { ok: true, scope, localOnly: true };
  }
  const resp = await adminFetch('/api/storage/clear', {
    method: 'POST',
    body: JSON.stringify({ scope }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  if (scope === 'all') {
    clearActiveJob();
    $('#prompt').value = '';
  }
  if (scope === 'images' || scope === 'all') $('#results').innerHTML = '';
  await loadStorageStats();
  return data;
}

function migrateOldSettings() {
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (old && old.apiUrl) {
      const acc = {
        id: genId(),
        name: '默认账号',
        type: 'manual',
        apiUrl: old.apiUrl || '',
        apiKey: old.apiKey || '',
        model: old.model || DEFAULT_IMAGE_MODEL,
        responsesModel: old.responsesModel || old.promptModel || DEFAULT_RESPONSES_MODEL,
        streamMode: old.streamMode === true,
        imageEditsCompatMode: old.imageEditsCompatMode === true,
        responsesAutoFallback: old.responsesAutoFallback !== false,
        createdAt: Date.now(),
      };
      state.data.accounts.push(acc);
      state.data.activeId = acc.id;
      state.data.useProxy = !!old.useProxy;
      saveData();
    }
  } catch {}
}

function getActiveAccount() {
  return state.data.accounts.find((a) => a.id === state.data.activeId) || null;
}

function setActiveAccount(id) {
  state.data.activeId = id;
  saveData();
  renderSwitcher();
}

function addAccount(acc, options = {}) {
  const account = acc || {};
  state.data.accounts.push(account);
  if (!state.data.activeId) state.data.activeId = account.id;
  saveData();
  if (options.syncServer === false) return;
  void createServerAccount(account, { activeId: state.data.activeId })
    .catch((error) => accountStoreSyncWarning('create', error));
}

function updateAccount(id, fields, options = {}) {
  const acc = state.data.accounts.find((a) => a.id === id);
  if (acc) Object.assign(acc, fields);
  saveData();
  if (!acc || options.syncServer === false) return;
  void patchServerAccount(id, fields)
    .catch((error) => accountStoreSyncWarning('update', error));
}

function deleteAccount(id, options = {}) {
  state.data.accounts = state.data.accounts.filter((a) => a.id !== id);
  if (state.data.activeId === id) {
    state.data.activeId = state.data.accounts.length ? state.data.accounts[0].id : null;
  }
  saveData();
  if (options.syncServer === false) return;
  void deleteServerAccountOnServer(id)
    .catch((error) => accountStoreSyncWarning('delete', error));
}

// --- Effective Config ---

function accountHistoryName(acc) {
  if (!acc) return '默认账号';
  const label = String(acc.name || '').trim();
  if (!label || label.includes('@')) return acc.type === 'oauth' ? 'OpenAI OAuth' : '手动账号';
  return label;
}

function getEffective() {
  const acc = getActiveAccount();
  const providerDefaults = getProviderDefaults();
  return {
    apiUrl: acc ? acc.apiUrl : (providerDefaults.apiUrl || ''),
    apiKey: acc ? acc.apiKey : '',
    model: acc ? acc.model : (providerDefaults.imageModel || DEFAULT_IMAGE_MODEL),
    responsesModel: acc ? (acc.responsesModel || providerDefaults.responsesModel || DEFAULT_RESPONSES_MODEL) : (providerDefaults.responsesModel || DEFAULT_RESPONSES_MODEL),
    streamMode: acc ? acc.streamMode === true : providerDefaults.streamMode === true,
    // legacy-default-check: streamMode: acc ? acc.streamMode === true : false
    imageEditsCompatMode: acc ? acc.imageEditsCompatMode === true : providerDefaults.imageEditsCompatMode === true,
    // legacy-default-check: imageEditsCompatMode: acc ? acc.imageEditsCompatMode === true : false
    responsesAutoFallback: acc ? acc.responsesAutoFallback !== false : providerDefaults.responsesAutoFallback !== false,
    // legacy-default-check: responsesAutoFallback: acc ? acc.responsesAutoFallback !== false : true
    useProxy: state.data.useProxy || providerDefaults.forceProxy === true,
    isOAuth: acc ? acc.type === 'oauth' : false,
    accountId: acc ? (acc.accountId || '') : '',
    openaiDeviceId: acc ? (acc.openaiDeviceId || '') : '',
    openaiSessionId: acc ? (acc.openaiSessionId || '') : '',
    accountName: accountHistoryName(acc),
    accountHost: acc ? (acc.apiUrl || '') : (providerDefaults.apiUrl || ''),
  };
}

function getEffectiveForAccount(acc, overrides = {}) {
  const providerDefaults = getProviderDefaults();
  const modelOverride = String(overrides.model || '').trim();
  return {
    apiUrl: acc ? acc.apiUrl : (providerDefaults.apiUrl || ''),
    apiKey: acc ? acc.apiKey : '',
    model: modelOverride || (acc ? acc.model : (providerDefaults.imageModel || DEFAULT_IMAGE_MODEL)),
    responsesModel: acc ? (acc.responsesModel || providerDefaults.responsesModel || DEFAULT_RESPONSES_MODEL) : (providerDefaults.responsesModel || DEFAULT_RESPONSES_MODEL),
    streamMode: acc ? acc.streamMode === true : providerDefaults.streamMode === true,
    imageEditsCompatMode: acc ? acc.imageEditsCompatMode === true : providerDefaults.imageEditsCompatMode === true,
    responsesAutoFallback: acc ? acc.responsesAutoFallback !== false : providerDefaults.responsesAutoFallback !== false,
    useProxy: state.data.useProxy || providerDefaults.forceProxy === true,
    isOAuth: acc ? acc.type === 'oauth' : false,
    accountId: acc ? (acc.accountId || '') : '',
    openaiDeviceId: acc ? (acc.openaiDeviceId || '') : '',
    openaiSessionId: acc ? (acc.openaiSessionId || '') : '',
    accountName: accountHistoryName(acc),
    accountHost: acc ? (acc.apiUrl || '') : (providerDefaults.apiUrl || ''),
  };
}

function getActiveValue(field) {
  const btn = $(`.seg[data-field="${field}"] button.active`);
  return btn ? btn.dataset.value : null;
}

function getGenerationCount(value = $('#countSelect')?.value) {
  const count = Number(value || 1);
  if (!Number.isInteger(count) || count < 1) return 1;
  return Math.min(4, count);
}

// --- Network ---

async function proxyFetch(url, opts = {}) {
  if (opts.multipartBody && !canUseProxyMultipart()) {
    throw new Error('当前部署的代理不支持 multipart 图生图；请关闭“使用代理”或关闭“图生图兼容模式”。');
  }
  return fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      method: opts.method || 'POST',
      headers: opts.headers || {},
      body: opts.jsonBody,
      multipartBody: opts.multipartBody,
    }),
  });
}

function buildHeaders(cfg, extra) {
  const headers = { Authorization: `Bearer ${cfg.apiKey}`, ...extra };
  if (cfg.isOAuth) {
    headers['Originator'] = 'codex_cli_rs';
    if (cfg.accountId) headers['Chatgpt-Account-Id'] = cfg.accountId;
    headers['Version'] = '0.101.0';
    headers['OpenAI-Beta'] = 'responses=experimental';
    headers['Session_id'] = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
    headers['User-Agent'] = 'codex_cli_rs/0.101.0';
    headers['Accept'] = 'text/event-stream';
    headers['Connection'] = 'Keep-Alive';
  }
  return headers;
}

async function smartFetch(url, opts) {
  if (state.data.useProxy || opts._forceProxy) return proxyFetch(url, opts);
  try {
    const fetchOpts = { method: opts.method || 'POST', headers: opts.headers || {} };
    if (opts.body) fetchOpts.body = opts.body;
    return await fetch(url, fetchOpts);
  } catch (e) {
    if (e.name === 'TypeError' || (e.message && e.message.includes('fetch'))) {
      try {
        return await proxyFetch(url, opts);
      } catch {
        throw new Error('直连被 CORS 拦截，代理也不可用。请用 node server.js 启动本地服务器');
      }
    }
    throw e;
  }
}

function parseSseBlock(block) {
  const eventLines = String(block || '').split('\n');
  let event = 'message';
  const dataLines = [];
  for (const line of eventLines) {
    if (line.startsWith('event:')) event = line.slice(6).trim() || 'message';
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  const dataText = dataLines.join('\n').trim();
  return { event, dataText };
}

async function readSseText(resp, onEvent) {
  if (!resp.body || !resp.body.getReader) return await resp.text();
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';

  const consumeBlock = (block) => {
    if (!block.trim()) return;
    rawText += `${block}\n\n`;
    const { event, dataText } = parseSseBlock(block);
    if (!dataText || dataText === '[DONE]') return;
    let data = dataText;
    try { data = JSON.parse(dataText); } catch {}
    onEvent?.(event, data, dataText);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || '';
    for (const part of parts) consumeBlock(part);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeBlock(buffer);
  return rawText;
}

// --- Token Refresh ---

async function refreshOAuthToken(acc) {
  if (!acc.refreshToken) return false;
  try {
    const resp = await fetch('/api/oauth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: acc.refreshToken }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.accessToken) return false;
    updateAccount(acc.id, {
      apiKey: data.accessToken,
      refreshToken: data.refreshToken || acc.refreshToken,
      tokenExpiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
      email: data.email || acc.email,
      name: data.name || acc.name,
      accountId: data.accountId || acc.accountId,
      planType: data.planType || acc.planType,
    });
    return true;
  } catch { return false; }
}

async function ensureValidTokenForAccount(cfg, acc) {
  if (!acc || acc.type !== 'oauth') return cfg;
  if (acc.tokenExpiresAt && Date.now() > acc.tokenExpiresAt - 60000) {
    const ok = await refreshOAuthToken(acc);
    if (ok) return { ...cfg, apiKey: acc.apiKey };
  }
  return cfg;
}

async function ensureValidToken(cfg) {
  return ensureValidTokenForAccount(cfg, getActiveAccount());
}

// --- UI Helpers ---

function getCurrentGenerationMeta() {
  return state.currentGenerationMeta || {};
}

function describeGenerationMode(meta = getCurrentGenerationMeta()) {
  if (meta.isOAuth) return 'OAuth';
  if (meta.streamMode) return meta.hasRef ? '流式图生图' : '流式文生图';
  return meta.hasRef ? '图生图' : '文生图';
}

function getAccurateStatusText(phaseOrMessage, message, meta = getCurrentGenerationMeta()) {
  if (message && !String(message).startsWith('仍在生成')) return message;
  const phase = String(phaseOrMessage || '').trim();
  const modeText = describeGenerationMode(meta);
  const hasRef = !!meta.hasRef;
  const streamMode = !!meta.streamMode;
  const mapping = {
    'prompt:prepare': '正在整理提示词',
    'prompt:enhance:send': '正在优化提示词',
    'prompt:enhance:done': '提示词已优化，准备开始生成',
    'request:send': streamMode
      ? `正在向 Responses API 提交${hasRef ? '图生图' : '文生图'}请求`
      : `正在向 Images API 提交${hasRef ? '图生图' : '文生图'}请求`,
    'request:accepted': streamMode
      ? `Responses API 已接收${hasRef ? '图生图' : '文生图'}请求`
      : `Images API 已接收${hasRef ? '图生图' : '文生图'}请求`,
    'response:created': 'Responses 已创建任务，等待模型开始生成',
    'response:image_started': hasRef ? '模型已开始根据参考图生成新图片' : '模型已开始生成图片',
    'response:image_done': '图片数据已返回，正在整理结果',
    'response:completed': '生成完成，正在渲染结果',
    'fallback:images': hasRef ? '流式图生图不可用，正在回退到 Images 图生图' : '流式文生图不可用，正在回退到 Images 文生图',
    'result:parse': streamMode ? '正在解析 Responses 返回的图片结果' : '正在解析 Images API 返回的图片结果',
    'result:render': '正在渲染生成结果',
    'storage:save': '正在保存图片到历史记录',
    'storage:done': '图片已保存到历史记录',
    'storage:partial': '部分图片保存历史失败，生成结果仍可查看',
    'storage:error': '图片历史保存失败，生成结果仍可查看',
    'job:cancelled': '任务已取消',
  };
  if (phase === '__long_wait__') {
    const last = state.lastStatusText && state.lastStatusText !== IDLE_GENERATION_HINT ? `（最近进度：${state.lastStatusText}）` : '';
    return `${modeText}仍在进行，请耐心等待${last}`;
  }
  return mapping[phase] || message || getGenerationProgressMessage(phase, String(phaseOrMessage || '正在生成图片'));
}

function setGenerationStatus(phaseOrMessage, message, options = {}) {
  const hintEl = $('#generationHint') || $('.toolbar-right .hint');
  if (!hintEl) return;
  const phase = String(phaseOrMessage || '').trim();
  const meta = options.meta || getCurrentGenerationMeta();
  const text = getAccurateStatusText(phaseOrMessage, message, meta);
  state.lastStatusPhase = phase;
  state.lastStatusText = text;
  hintEl.textContent = text;
  hintEl.title = text;
}

function stopWaitingStatusSequence() {
  if (state.waitingStatusTimer) {
    clearTimeout(state.waitingStatusTimer);
    state.waitingStatusTimer = null;
  }
}

function startWaitingStatusSequence(delayMs = 30000) {
  stopWaitingStatusSequence();
  state.waitingStatusTimer = setTimeout(() => {
    state.waitingStatusTimer = null;
    if (!state.generating) return;
    setGenerationStatus('__long_wait__', getWaitingProgressMessage(), { preserveLast: true });
  }, delayMs);
}

function setLoading(on) {
  state.generating = on;
  if (on) {
    state.lastProgressKey = '';
    state.lastStatusPhase = '';
    state.lastStatusText = '';
  } else {
    state.currentGenerationMeta = null;
  }
  const generateBtn = $('#generateBtn');
  $('#generateBtn .btn-text').classList.toggle('hidden', on);
  $('#generateBtn .btn-loading').classList.toggle('hidden', !on);
  generateBtn.disabled = on;
  generateBtn.setAttribute('aria-busy', on ? 'true' : 'false');
  generateBtn.setAttribute('aria-disabled', on ? 'true' : 'false');
  const enhanceBtn = $('#enhancePromptBtn');
  if (enhanceBtn) enhanceBtn.disabled = on || state.enhancingPrompt;
  if (state.generationHintTimer) {
    clearInterval(state.generationHintTimer);
    state.generationHintTimer = null;
  }
  stopWaitingStatusSequence();
  if (on) {
    state.generationHintStep = 0;
    setGenerationStatus('prompt:prepare');
  } else {
    setGenerationStatus(IDLE_GENERATION_HINT);
  }
}

function openImageLightbox(src, restoreFocus) {
  $('#lightboxImg').src = src;
  openDialog($('#lightbox'), { focusSelector: '#lightboxClose', restoreFocus });
}

function makePreviewImageAccessible(img, src, label = '打开图片预览') {
  img.tabIndex = 0;
  img.setAttribute('role', 'button');
  img.setAttribute('aria-label', label);
  img.onclick = () => openImageLightbox(src, img);
  img.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openImageLightbox(src, img);
  };
}

function formatResultMeta(meta = {}) {
  const parts = [];
  if (meta.batchCount && meta.batchCount > 1) parts.push(`第 ${meta.batchIndex || '?'} / ${meta.batchCount} 张`);
  if (meta.accountName) parts.push(meta.accountName);
  if (meta.model) parts.push(meta.model);
  if (meta.trace?.protocol || meta.protocol) parts.push(meta.trace?.protocol || meta.protocol);
  if (meta.accountHost) parts.push(meta.accountHost);
  if (meta.createdAt) parts.push(new Date(meta.createdAt).toLocaleString());
  return parts.filter(Boolean).join(' · ');
}

function appendResultMeta(bar, meta = {}) {
  const text = formatResultMeta(meta);
  if (!text) return;
  const el = document.createElement('span');
  el.className = 'card-meta';
  el.textContent = text;
  bar.appendChild(el);
}

function appendResultDetails(card, meta = {}) {
  if (meta.prompt) {
    const prompt = document.createElement('div');
    prompt.className = 'card-prompt';
    prompt.textContent = meta.prompt;
    prompt.title = meta.prompt;
    card.appendChild(prompt);
  }
  if (Array.isArray(meta.tags) && meta.tags.length) {
    const tags = document.createElement('div');
    tags.className = 'card-tags';
    tags.textContent = meta.tags.map((tag) => `#${tag}`).join(' ');
    card.appendChild(tags);
  }
}

function getHistoryGenerationSnapshot(meta = {}) {
  const generation = meta.generation && typeof meta.generation === 'object' ? meta.generation : {};
  return {
    prompt: generation.prompt || meta.prompt || '',
    size: generation.size || meta.size || '',
    quality: generation.quality || meta.quality || '',
    format: generation.format || meta.format || '',
    background: generation.background || meta.background || '',
    mode: generation.mode || meta.mode || meta.trace?.mode || '',
    model: generation.model || meta.model || '',
    hasRef: generation.hasRef === true || meta.trace?.hasRef === true,
  };
}

function restoreGenerationSnapshot(meta = {}) {
  const generation = getHistoryGenerationSnapshot(meta);
  if (generation.prompt) $('#prompt').value = generation.prompt;
  if (generation.size) applySizeDefault(generation.size);
  if (generation.quality) applySegmentDefault('quality', generation.quality);
  if (generation.background) applySegmentDefault('background', generation.background);
  if (generation.format) setSelectValue('formatSelect', generation.format);
  setSelectValue('countSelect', '1');
  $('#prompt')?.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return generation;
}

async function regenerateFromHistory(meta = {}) {
  const generation = restoreGenerationSnapshot(meta);
  if (!generation.prompt) {
    showError('这条历史没有保存提示词，无法重新生成', { context: 'history' });
    return;
  }
  setHistoryStatus('已恢复历史参数，正在重新生成...');
  await generate();
}

async function addHistoryImageAsReference(meta = {}) {
  if (!meta.url) {
    showError('这条历史没有可用图片 URL，无法作为参考图', { context: 'reference' });
    return;
  }
  if (state.refImagesBase64.length >= MAX_REF_IMAGES) {
    showError(`最多只能使用 ${MAX_REF_IMAGES} 张参考图，请先移除一张`, { context: 'reference' });
    return;
  }
  restoreGenerationSnapshot(meta);
  setHistoryStatus('正在把历史图片加入参考图...');
  const resp = await fetch(meta.url);
  if (!resp.ok) throw new Error(`读取历史图片失败：HTTP ${resp.status}`);
  const blob = await resp.blob();
  if (!validateRefImageFiles([blob])) return;
  const base64 = await fileToBase64(blob);
  state.refImagesBase64.push(base64);
  state.refImagePreviewUrls.push(URL.createObjectURL(blob));
  renderRefPreviews();
  setHistoryStatus('已加入参考图，可以继续图生图');
}

async function copyPromptFromHistory(meta = {}) {
  const prompt = getHistoryGenerationSnapshot(meta).prompt;
  if (!prompt) {
    showError('这条历史没有保存提示词，无法复制', { context: 'history' });
    return;
  }
  const ok = await copyTextToClipboard(prompt);
  setHistoryStatus(ok ? '提示词已复制' : '复制失败，请手动选择提示词');
}

function setFavoriteButtonState(button, favorite) {
  if (!button) return;
  button.classList.toggle('active', favorite === true);
  button.textContent = favorite === true ? '★' : '☆';
  button.title = favorite === true ? '取消收藏' : '收藏';
  button.setAttribute('aria-label', button.title);
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
}

function updateStoredImageCards(image = {}) {
  if (!image.id) return;
  document.querySelectorAll(`.gallery-card[data-image-id="${cssEscape(image.id)}"]`).forEach((card) => {
    card.dataset.favorite = image.favorite ? 'true' : 'false';
    setFavoriteButtonState(card.querySelector('.favorite-btn'), image.favorite === true);
    const tags = card.querySelector('.card-tags');
    if (tags) tags.textContent = Array.isArray(image.tags) ? image.tags.map((tag) => `#${tag}`).join(' ') : '';
  });
}

async function patchStoredImageMeta(id, meta) {
  const resp = await adminFetch(`/api/images/${encodeURIComponent(id)}/meta`, {
    method: 'PATCH',
    body: JSON.stringify(meta),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data.image;
}

async function deleteStoredImage(id) {
  const resp = await adminFetch(`/api/images/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

function appendHistoryActions(actions, meta = {}, card) {
  if (!meta.id) return;
  card.dataset.imageId = meta.id;
  card.dataset.favorite = meta.favorite ? 'true' : 'false';
  if (getHistoryGenerationSnapshot(meta).prompt) {
    const copy = createButton({
      className: 'btn btn-ghost history-copy-btn',
      text: '复制词',
      onClick: async () => {
        try { await copyPromptFromHistory(meta); } catch (e) { showError(e, { context: 'history' }); }
      },
    });
    actions.appendChild(copy);

    const regen = createButton({
      className: 'btn btn-ghost history-regenerate-btn',
      text: '重新生成',
      onClick: async () => {
        try { await regenerateFromHistory(meta); } catch (e) { showError(e, { context: 'history' }); }
      },
    });
    actions.appendChild(regen);
  }

  if (meta.url) {
    const ref = createButton({
      className: 'btn btn-ghost history-reference-btn',
      text: '作参考',
      onClick: async () => {
        try { await addHistoryImageAsReference(meta); } catch (e) { showError(e, { context: 'reference' }); }
      },
    });
    actions.appendChild(ref);
  }

  const fav = createButton({ className: 'btn btn-ghost favorite-btn' });
  setFavoriteButtonState(fav, meta.favorite === true);
  fav.onclick = async () => {
    const nextFavorite = card.dataset.favorite !== 'true';
    fav.disabled = true;
    try {
      const image = await patchStoredImageMeta(meta.id, { favorite: nextFavorite });
      updateStoredImageCards(image);
      await loadStorageStats();
    } catch (e) {
      showError(e, { context: 'history' });
    } finally {
      fav.disabled = false;
    }
  };
  actions.appendChild(fav);

  const del = createButton({
    className: 'btn btn-ghost card-delete-btn',
    text: '删除',
    danger: true,
    onClick: async () => {
      if (!confirmAction('确定删除这张历史图片？此操作不会影响同批次其他图片。')) return;
      del.disabled = true;
      try {
        await deleteStoredImage(meta.id);
        document.querySelectorAll(`.gallery-card[data-image-id="${cssEscape(meta.id)}"]`).forEach((node) => node.remove());
        await loadStorageStats();
        setHistoryStatus('已删除 1 张历史图片');
      } catch (e) {
        showError(e, { context: 'history' });
      } finally {
        del.disabled = false;
      }
    },
  });
  actions.appendChild(del);
}

function addResultCard(b64, format, meta = {}) {
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const src = `data:${mime};base64,${b64}`;
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const wrap = document.createElement('div');
  wrap.className = 'img-wrap';
  if (format === 'png') wrap.classList.add('checkerboard');
  const img = document.createElement('img');
  img.src = src;
  img.alt = '生成的图片';
  makePreviewImageAccessible(img, src);
  wrap.appendChild(img);
  const bar = document.createElement('div');
  bar.className = 'card-bar';
  appendResultMeta(bar, meta);
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const dl = document.createElement('button');
  dl.className = 'btn btn-ghost';
  dl.textContent = '下载';
  dl.onclick = () => { const a = document.createElement('a'); a.href = src; a.download = `image-${Date.now()}.${format}`; a.click(); };
  actions.appendChild(dl);
  bar.appendChild(actions);
  card.appendChild(wrap);
  appendResultDetails(card, meta);
  card.appendChild(bar);
  $('#results').prepend(card);
}

function addResultCardFromUrl(imageUrl, format, meta = {}) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const wrap = document.createElement('div');
  wrap.className = 'img-wrap';
  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = '生成的图片';
  makePreviewImageAccessible(img, imageUrl);
  wrap.appendChild(img);
  const bar = document.createElement('div');
  bar.className = 'card-bar';
  appendResultMeta(bar, meta);
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  appendHistoryActions(actions, meta, card);
  const dl = document.createElement('button');
  dl.className = 'btn btn-ghost';
  dl.textContent = '下载';
  dl.onclick = () => { const a = document.createElement('a'); a.href = imageUrl; a.download = `image-${Date.now()}.${format}`; a.target = '_blank'; a.click(); };
  actions.appendChild(dl);
  bar.appendChild(actions);
  card.appendChild(wrap);
  appendResultDetails(card, meta);
  card.appendChild(bar);
  $('#results').prepend(card);
}

function addFailedResultCard(item = {}) {
  const card = document.createElement('div');
  card.className = 'gallery-card gallery-card-error';
  const body = document.createElement('div');
  body.className = 'result-error-body';
  body.textContent = item.error || item.message || '此张图片生成失败';
  const bar = document.createElement('div');
  bar.className = 'card-bar';
  appendResultMeta(bar, item);
  card.appendChild(body);
  card.appendChild(bar);
  $('#results').prepend(card);
}

// --- UI Rendering ---

function syncAccountModeUi() {
  const cfg = getEffective();
  const acc = getActiveAccount();
  const info = $('#routeModeInfo');
  if (!info) return;
  if (!acc) {
    info.textContent = '当前模式：请选择账号';
    info.className = 'route-mode-info muted';
    return;
  }
  if (cfg.isOAuth) {
    info.textContent = '当前模式：OAuth · ChatGPT 后端图片流程（chat-requirements → conversation/prepare → conversation → 下载图片），不受流式开关影响。';
    info.className = 'route-mode-info oauth';
    return;
  }
  if (cfg.streamMode) {
    const fallbackText = cfg.responsesAutoFallback === false ? '流式失败后不自动回退。' : '流式失败后会自动回退到非流式。';
    info.textContent = `当前模式：API Key · 流式 Responses API（主模型 ${cfg.responsesModel || DEFAULT_RESPONSES_MODEL} + image_generation，图片模型 ${cfg.model || DEFAULT_IMAGE_MODEL}；${fallbackText}）`;
    info.className = 'route-mode-info responses';
    return;
  }
  const compatText = cfg.imageEditsCompatMode ? '；图生图已启用旧版 multipart 兼容模式' : '';
  info.textContent = `当前模式：API Key · 非流式 Images API（图片模型 ${cfg.model || DEFAULT_IMAGE_MODEL}；文生图走 /v1/images/generations，有参考图走 /v1/images/edits${compatText}）。`;
  info.className = 'route-mode-info images';
}

function renderSwitcher() {
  const acc = getActiveAccount();
  const dot = $('#switcherDot');
  const name = $('#switcherName');
  if (!acc) {
    name.textContent = '未配置账号';
    dot.className = 'switcher-dot inactive';
    syncAccountModeUi();
    return;
  }
  name.textContent = acc.name || acc.email || acc.apiUrl || '未命名';
  if (acc.type === 'oauth' && acc.tokenExpiresAt && Date.now() > acc.tokenExpiresAt) {
    dot.className = 'switcher-dot expired';
  } else {
    dot.className = 'switcher-dot';
  }
  syncAccountModeUi();
}

function renderDropdown() {
  const list = $('#dropdownList');
  list.innerHTML = '';
  for (const acc of state.data.accounts) {
    const btn = document.createElement('button');
    btn.className = 'dropdown-item' + (acc.id === state.data.activeId ? ' active' : '');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitemradio');
    btn.setAttribute('aria-checked', acc.id === state.data.activeId ? 'true' : 'false');
    btn.tabIndex = -1;
    btn.dataset.accountId = acc.id;
    const dotEl = document.createElement('span');
    dotEl.className = 'item-dot';
    const info = document.createElement('span');
    info.className = 'item-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'item-name';
    nameEl.textContent = acc.name || acc.email || '未命名';
    const sub = document.createElement('span');
    sub.className = 'item-sub';
    sub.textContent = acc.type === 'oauth' ? (acc.email || 'OAuth') : (acc.apiUrl || '');
    info.appendChild(nameEl);
    info.appendChild(sub);
    const badge = document.createElement('span');
    badge.className = 'item-badge' + (acc.type === 'oauth' ? ' oauth' : '');
    badge.textContent = acc.type === 'oauth' ? 'OAuth' : '手动';
    btn.appendChild(dotEl);
    btn.appendChild(info);
    btn.appendChild(badge);
    btn.onclick = () => { setActiveAccount(acc.id); renderDropdown(); toggleDropdown(false); $('#switcherBtn')?.focus(); };
    list.appendChild(btn);
  }
  if (!state.data.accounts.length) {
    const empty = document.createElement('div');
    empty.className = 'dropdown-item';
    empty.setAttribute('role', 'none');
    empty.setAttribute('aria-disabled', 'true');
    empty.style.color = 'var(--text-3)';
    empty.textContent = '暂无账号';
    list.appendChild(empty);
  }
}

function getDropdownItems() {
  return [...document.querySelectorAll('#switcherDropdown button.dropdown-item')];
}

function focusDropdownItem(index = 0) {
  const items = getDropdownItems();
  if (!items.length) return;
  const normalized = ((index % items.length) + items.length) % items.length;
  items[normalized].focus();
}

function focusActiveDropdownItem() {
  const items = getDropdownItems();
  const activeIndex = Math.max(0, items.findIndex((item) => item.classList.contains('active')));
  focusDropdownItem(activeIndex);
}

function toggleDropdown(force, options = {}) {
  state.dropdownOpen = force !== undefined ? force : !state.dropdownOpen;
  $('#switcherDropdown').classList.toggle('hidden', !state.dropdownOpen);
  $('#switcherBtn')?.setAttribute('aria-expanded', state.dropdownOpen ? 'true' : 'false');
  if (state.dropdownOpen && options.focus !== false) focusActiveDropdownItem();
}

function handleSwitcherKeydown(event) {
  if (!['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
  if (event.key === 'Escape') {
    toggleDropdown(false);
    return;
  }
  event.preventDefault();
  if (!state.dropdownOpen) {
    renderDropdown();
    toggleDropdown(true, { focus: true });
    if (event.key === 'ArrowUp') focusDropdownItem(getDropdownItems().length - 1);
    return;
  }
  if (event.key === 'ArrowUp') focusDropdownItem(getDropdownItems().length - 1);
  else focusActiveDropdownItem();
}

function handleDropdownKeydown(event) {
  const items = getDropdownItems();
  const currentIndex = items.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    toggleDropdown(false);
    $('#switcherBtn')?.focus();
    return;
  }
  if (event.key === 'Tab') {
    toggleDropdown(false);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowDown') focusDropdownItem(currentIndex + 1);
  else if (event.key === 'ArrowUp') focusDropdownItem(currentIndex - 1);
  else if (event.key === 'Home') focusDropdownItem(0);
  else if (event.key === 'End') focusDropdownItem(items.length - 1);
  else if (currentIndex >= 0) items[currentIndex].click();
}

function setAccountTab(tab) {
  const selected = ['api', 'oauth', 'advanced'].includes(tab) ? tab : 'api';
  const map = {
    api: ['accountTabApi', 'accountPanelApi'],
    oauth: ['accountTabOauth', 'accountPanelOauth'],
    advanced: ['accountTabAdvanced', 'accountPanelAdvanced'],
  };
  for (const [key, [tabId, panelId]] of Object.entries(map)) {
    const isActive = key === selected;
    const tabEl = $(`#${tabId}`);
    const panelEl = $(`#${panelId}`);
    tabEl?.classList.toggle('active', isActive);
    tabEl?.setAttribute('aria-selected', isActive ? 'true' : 'false');
    panelEl?.classList.toggle('active', isActive);
    panelEl?.classList.toggle('hidden', !isActive);
  }
}

function setSettingsPanel(panel) {
  const selected = ['quick', 'admin', 'accounts', 'generation', 'connection', 'storage', 'deploy', 'appearance', 'backup'].includes(panel)
    ? panel
    : 'quick';
  const map = {
    quick: ['settingsNavQuick', 'settingsPanelQuick'],
    admin: ['settingsNavAdmin', 'settingsPanelAdmin'],
    accounts: ['settingsNavAccounts', 'settingsPanelAccounts'],
    generation: ['settingsNavGeneration', 'settingsPanelGeneration'],
    connection: ['settingsNavConnection', 'settingsPanelConnection'],
    storage: ['settingsNavStorage', 'settingsPanelStorage'],
    deploy: ['settingsNavDeploy', 'settingsPanelDeploy'],
    appearance: ['settingsNavAppearance', 'settingsPanelAppearance'],
    backup: ['settingsNavBackup', 'settingsPanelBackup'],
  };
  for (const [key, [tabId, panelId]] of Object.entries(map)) {
    const isActive = key === selected;
    const tabEl = $(`#${tabId}`);
    const panelEl = $(`#${panelId}`);
    tabEl?.classList.toggle('active', isActive);
    tabEl?.setAttribute('aria-selected', isActive ? 'true' : 'false');
    panelEl?.classList.toggle('active', isActive);
    panelEl?.classList.toggle('hidden', !isActive);
  }
}

function syncSettingsCenterSummary() {
  const hasAccounts = state.data.accounts.length > 0;
  const active = getActiveAccount();
  const quickTitle = $('#settingsPanelQuick .settings-hero h3');
  const quickCopy = $('#settingsPanelQuick .settings-hero p');
  if (quickTitle) quickTitle.textContent = hasAccounts ? '已配置账号' : '未配置账号';
  if (quickCopy) {
    quickCopy.textContent = hasAccounts
      ? `当前账号：${active?.name || active?.email || active?.apiUrl || '未命名'}。你可以继续测试连接，或按需解锁管理员保存服务端配置。`
      : '添加 API Key 或登录 ChatGPT 后才能生成图片。需要写入服务端配置时，先解锁管理员。';
  }
  document.querySelectorAll('.settings-status-pill').forEach((el) => {
    if (el.textContent?.startsWith('当前账号：')) {
      el.textContent = `当前账号：${active ? (active.name || active.email || active.apiUrl || '未命名') : '未配置账号'}`;
    }
  });
}

async function openSettingsCenter(initialPanel = 'quick', options = {}) {
  try { await fetchServerRuntimeConfig(); } catch (e) { console.warn('Failed to refresh runtime config:', e?.message || e); }
  await fetchAccountStoreCapabilities();
  if (hasValidAdminSession()) {
    try { await fetchEditableRuntimeConfig(); } catch (e) { console.warn('Failed to load editable runtime config:', e?.message || e); }
    await loadServerAccountsIntoLocal({ silent: true });
  }
  loadAppSettings();
  fillSettingsForm();
  renderAccountList();
  const proxy = $('#useProxy');
  if (proxy) proxy.checked = state.data.useProxy;
  syncSettingsCenterSummary();
  loadStorageStats();
  setSettingsPanel(initialPanel);
  if (initialPanel === 'accounts') setAccountTab(options.accountTab || 'api');
  openDialog($('#settingsOverlay'), {
    focusSelector: options.focusSelector || `#settingsNav${initialPanel[0].toUpperCase()}${initialPanel.slice(1)}`,
    restoreFocus: options.restoreFocus || '#openSettings',
  });
}

function renderAccountCards(list, accounts, emptyText) {
  if (!list) return;
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', '账号列表');
  list.innerHTML = '';
  if (!accounts.length) {
    list.innerHTML = `<div class="account-empty">${emptyText}</div>`;
    return;
  }
  for (const acc of accounts) {
    const card = document.createElement('div');
    card.className = 'account-card' + (acc.id === state.data.activeId ? ' active' : '');
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', acc.id === state.data.activeId ? 'true' : 'false');
    card.tabIndex = 0;
    card.onclick = () => { setActiveAccount(acc.id); renderAccountList(); };
    card.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      setActiveAccount(acc.id);
      renderAccountList();
    };

    const radio = document.createElement('div');
    radio.className = 'account-radio';
    radio.setAttribute('aria-hidden', 'true');

    const info = document.createElement('div');
    info.className = 'account-info';
    const nameRow = document.createElement('div');
    nameRow.className = 'account-name';
    nameRow.textContent = acc.name || acc.email || '未命名';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (acc.type === 'oauth' ? 'badge-oauth' : 'badge-manual');
    badge.textContent = acc.type === 'oauth' ? 'ChatGPT' : 'API Key';
    if (acc.type === 'oauth' && acc.tokenExpiresAt && Date.now() > acc.tokenExpiresAt) {
      badge.className = 'badge badge-expired';
      badge.textContent = '已过期';
    }
    nameRow.appendChild(badge);
    const detail = document.createElement('div');
    detail.className = 'account-detail';
    detail.textContent = acc.type === 'oauth' ? (acc.email || acc.accountId || 'ChatGPT OAuth') : (acc.apiUrl || '');
    info.appendChild(nameRow);
    info.appendChild(detail);

    const actions = document.createElement('div');
    actions.className = 'account-actions-bar';
    const editBtn = createIconButton({
      title: '编辑',
      iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      onClick: (e) => { e.stopPropagation(); openEditModal(acc); },
    });
    const delBtn = createIconButton({
      className: 'btn-delete',
      title: '删除',
      iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      onClick: (e) => { e.stopPropagation(); if (confirmAction('确定删除此账号？')) { deleteAccount(acc.id); renderAccountList(); renderSwitcher(); renderDropdown(); } },
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(radio);
    card.appendChild(info);
    card.appendChild(actions);
    list.appendChild(card);
  }
}

function renderAccountList() {
  const manualAccounts = state.data.accounts.filter((acc) => acc.type !== 'oauth');
  const oauthAccounts = state.data.accounts.filter((acc) => acc.type === 'oauth');
  renderAccountCards($('#accountList'), manualAccounts, '还没有 API Key 账号，点击上方按钮添加');
  renderAccountCards($('#oauthAccountList'), oauthAccounts, '还没有 ChatGPT 登录账号，点击“登录 ChatGPT”开始添加');
  syncAccountMigrationUi();
  syncSettingsCenterSummary();
}

// --- Edit Modal ---

function openEditModal(acc) {
  const providerDefaults = getProviderDefaults();
  $('#editId').value = acc ? acc.id : '';
  $('#editTitle').textContent = acc ? '编辑账号' : '添加账号';
  $('#editName').value = acc ? (acc.name || '') : '';
  $('#editUrl').value = acc ? (acc.apiUrl || '') : (providerDefaults.apiUrl || '');
  $('#editKey').value = acc ? (acc.apiKey || '') : '';
  $('#editModel').value = acc ? (acc.model || providerDefaults.imageModel || DEFAULT_IMAGE_MODEL) : (providerDefaults.imageModel || DEFAULT_IMAGE_MODEL);
  $('#editResponsesModel').value = acc ? (acc.responsesModel || providerDefaults.responsesModel || DEFAULT_RESPONSES_MODEL) : (providerDefaults.responsesModel || DEFAULT_RESPONSES_MODEL);
  const isOAuth = acc?.type === 'oauth';
  $('#editStream').checked = acc ? acc.streamMode === true : providerDefaults.streamMode === true;

  // legacy-default-check: $('#editStream').checked = acc ? acc.streamMode === true : false
  // legacy-default-check: $('#editResponsesAutoFallback').checked = acc ? acc.responsesAutoFallback !== false : true
  // legacy-default-check: $('#editImageEditsCompat').checked = acc ? acc.imageEditsCompatMode === true : false
  $('#editResponsesAutoFallback').checked = acc ? acc.responsesAutoFallback !== false : providerDefaults.responsesAutoFallback !== false;
  $('#editImageEditsCompat').checked = acc ? acc.imageEditsCompatMode === true : providerDefaults.imageEditsCompatMode === true;
  $('#editStreamSection')?.classList.toggle('hidden', isOAuth);
  $('#editFallbackSection')?.classList.toggle('hidden', isOAuth);
  $('#editCompatSection')?.classList.toggle('hidden', isOAuth);
  $('#editOAuthFlowInfo')?.classList.toggle('hidden', !isOAuth);
  openDialog($('#editOverlay'), { focusSelector: '#editName' });
}

function closeEditModal() {
  closeDialog($('#editOverlay'));
}

function saveEditModal() {
  const id = $('#editId').value;
  const fields = {
    name: $('#editName').value.trim() || '未命名',
    apiUrl: $('#editUrl').value.trim().replace(/\/+$/, ''),
    apiKey: $('#editKey').value.trim(),
    model: $('#editModel').value.trim() || DEFAULT_IMAGE_MODEL,
    responsesModel: $('#editResponsesModel').value.trim() || DEFAULT_RESPONSES_MODEL,
    streamMode: $('#editStream').checked,
    responsesAutoFallback: $('#editResponsesAutoFallback').checked,
    imageEditsCompatMode: $('#editImageEditsCompat').checked,
  };
  if (id) {
    updateAccount(id, fields);
  } else {
    addAccount({ id: genId(), type: 'manual', createdAt: Date.now(), ...fields });
  }
  closeEditModal();
  renderAccountList();
  renderSwitcher();
  renderDropdown();
}

// --- OAuth Flow ---

function addOAuthAccountFromResult(r) {
  const dedupeKey = String(r?.accountId || r?.email || r?.openaiSessionId || r?.accessToken || '').trim();
  if (dedupeKey) {
    if (!state.oauthCompletedKeys) state.oauthCompletedKeys = new Set();
    if (state.oauthCompletedKeys.has(dedupeKey)) return false;
    state.oauthCompletedKeys.add(dedupeKey);
  }
  addAccount({
    id: genId(),
    name: r.name || r.email || 'OpenAI',
    type: 'oauth',
    apiUrl: 'https://api.openai.com',
    apiKey: r.accessToken,
    model: DEFAULT_IMAGE_MODEL,
    responsesModel: DEFAULT_RESPONSES_MODEL,
    streamMode: false,
    responsesAutoFallback: true,
    imageEditsCompatMode: false,
    email: r.email || '',
    accountId: r.accountId || '',
    planType: r.planType || '',
    openaiDeviceId: r.openaiDeviceId || genId(),
    openaiSessionId: r.openaiSessionId || genId(),
    refreshToken: r.refreshToken || null,
    tokenExpiresAt: Date.now() + (r.expiresIn || 3600) * 1000,
    createdAt: Date.now(),
  });
  renderAccountList();
  renderSwitcher();
  renderDropdown();
  return true;
}

function setOAuthLoginState(text, stateClass = '') {
  const stateEl = $('#oauthLoginStateText');
  const cardEl = stateEl?.closest('.oauth-login-state');
  if (stateEl) stateEl.textContent = text || '未登录';
  if (cardEl) cardEl.className = `oauth-login-state${stateClass ? ` ${stateClass}` : ''}`;
}

function setOAuthLoginBusy(isBusy) {
  state.oauthLoginInProgress = !!isBusy;
  const btn = $('#oauthLoginBtn');
  setOAuthLoginState(isBusy ? '登录中' : '未登录', isBusy ? 'busy' : '');
  if (!btn) return;
  btn.disabled = !!isBusy;
  btn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function clearOAuthPolling() {
  if (state.oauthPollTimer) clearTimeout(state.oauthPollTimer);
  state.oauthPollTimer = null;
  state.oauthPollSessionId = null;
}

function beginOAuthPolling(sessionId) {
  clearOAuthPolling();
  state.oauthPollSessionId = sessionId;
  state.oauthPollGeneration = (state.oauthPollGeneration || 0) + 1;
  return state.oauthPollGeneration;
}

function isCurrentOAuthPoll(sessionId, generation) {
  return !!sessionId
    && state.oauthPollSessionId === sessionId
    && state.oauthPollGeneration === generation
    && state.oauthPendingSessionId === sessionId;
}

function scheduleOAuthPoll(callback, delayMs) {
  if (state.oauthPollTimer) clearTimeout(state.oauthPollTimer);
  state.oauthPollTimer = setTimeout(callback, delayMs);
}

function resetOAuthManual({ keepPolling = false } = {}) {
  if (!keepPolling) clearOAuthPolling();
  setOAuthLoginBusy(false);
  state.oauthPendingSessionId = null;
  state.oauthPendingState = null;
  state.oauthAuthUrl = '';
  const manualEl = $('#oauthManual');
  const inputEl = $('#oauthCallbackInput');
  const authUrlEl = $('#oauthAuthUrl');
  if (manualEl) manualEl.classList.add('hidden');
  if (inputEl) inputEl.value = '';
  if (authUrlEl) authUrlEl.value = '';
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
  return ok;
}

function openOAuthAuthUrl() {
  if (!state.oauthAuthUrl) return;
  window.open(state.oauthAuthUrl, '_blank', 'noopener,noreferrer');
}

async function copyOAuthAuthUrl() {
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  statusEl.classList.remove('hidden');
  const ok = await copyTextToClipboard(state.oauthAuthUrl || $('#oauthAuthUrl').value);
  textEl.textContent = ok ? '授权链接已复制，请到浏览器打开登录。' : '复制失败，请手动长按/全选复制授权链接。';
}

async function startOAuth() {
  if (state.oauthLoginInProgress) return;
  clearOAuthPolling();
  setOAuthLoginBusy(true);
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  statusEl.classList.remove('hidden');
  textEl.textContent = '正在发起登录...';

  try {
    const resp = await fetch('/api/oauth/start', { method: 'POST' });
    const data = await resp.json();
    if (!data.authorizationUrl) throw new Error('未获取到授权地址');

    state.oauthPendingSessionId = data.sessionId || data.state;
    state.oauthPendingState = data.state;
    state.oauthAuthUrl = data.authorizationUrl;
    $('#oauthAuthUrl').value = data.authorizationUrl;
    $('#oauthCallbackInput').value = '';
    $('#oauthManual').classList.remove('hidden');
    textEl.textContent = '授权链接已生成。请点击“打开授权页面”或复制链接到浏览器登录，完成后把授权码/回调链接粘贴回来。';
    pollOAuthStatus(state.oauthPendingSessionId);
  } catch (e) {
    textEl.textContent = '发起失败: ' + e.message;
    setOAuthLoginBusy(false);
    setTimeout(() => statusEl.classList.add('hidden'), 5000);
  }
}

async function pollOAuthStatus(oauthState, generation = beginOAuthPolling(oauthState)) {
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  let attempts = 0;
  const maxAttempts = 120;

  const poll = async () => {
    if (!isCurrentOAuthPoll(oauthState, generation)) return;
    if (attempts++ > maxAttempts) {
      textEl.textContent = '登录超时，请重试';
      clearOAuthPolling();
      setOAuthLoginBusy(false);
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
      return;
    }
    try {
      const resp = await fetch(`/api/oauth/status/${oauthState}`);
      const data = await resp.json();
      if (!isCurrentOAuthPoll(oauthState, generation)) return;
      if (data.status === 'success') {
        const r = data.result;
        addOAuthAccountFromResult(r);
        resetOAuthManual();
        setOAuthLoginState('已登录', 'success');
        textEl.textContent = '登录成功: ' + (r.email || r.name || '');
        setTimeout(() => statusEl.classList.add('hidden'), 2000);
        return;
      }
      if (data.status === 'error') {
        textEl.textContent = '登录失败: ' + (data.error || '');
        clearOAuthPolling();
        setOAuthLoginBusy(false);
        setTimeout(() => statusEl.classList.add('hidden'), 5000);
        return;
      }
      scheduleOAuthPoll(poll, 2000);
    } catch {
      if (!isCurrentOAuthPoll(oauthState, generation)) return;
      scheduleOAuthPoll(poll, 3000);
    }
  };
  poll();
}

async function finishOAuthWithCode() {
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  const inputEl = $('#oauthCallbackInput');
  const value = inputEl.value.trim();
  if ((!state.oauthPendingSessionId && !state.oauthPendingState) || !value) {
    textEl.textContent = '请先发起登录，并粘贴回调链接或 code';
    statusEl.classList.remove('hidden');
    return;
  }

  statusEl.classList.remove('hidden');
  textEl.textContent = '正在完成登录...';
  clearOAuthPolling();
  $('#oauthExchangeBtn').disabled = true;
  try {
    const resp = await fetch('/api/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.oauthPendingSessionId, state: state.oauthPendingState, callbackUrl: value }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.status !== 'success') {
      throw new Error(data.error || data.message || `HTTP ${resp.status}`);
    }
    const r = data.result;
    addOAuthAccountFromResult(r);
    resetOAuthManual();
    setOAuthLoginState('已登录', 'success');
    textEl.textContent = '登录成功: ' + (r.email || r.name || '');
    setTimeout(() => statusEl.classList.add('hidden'), 2000);
  } catch (e) {
    textEl.textContent = '登录失败: ' + e.message;
  } finally {
    $('#oauthExchangeBtn').disabled = false;
  }
}

// --- Test Connection ---

function getConnectionTestResultElements() {
  return ['testResult', 'accountTestResult']
    .map((id) => $(`#${id}`))
    .filter(Boolean);
}

function setConnectionTestResult(className = 'toast', text = '', hidden = false) {
  for (const el of getConnectionTestResultElements()) {
    el.className = className;
    el.textContent = text;
    el.classList.toggle('hidden', hidden);
  }
}

async function testConnection() {
  setConnectionTestResult('toast', '测试中...', false);

  let cfg = getEffective();
  if (!cfg.apiUrl || !cfg.apiKey) {
    setConnectionTestResult('toast error', '请先添加账号并配置 API 地址和 Key', false);
    return;
  }

  cfg = await ensureValidToken(cfg);

  try {
    if (cfg.isOAuth) {
      const resp = await fetch('/api/oauth/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: cfg.apiKey,
          accountId: cfg.accountId,
          openaiDeviceId: cfg.openaiDeviceId,
          openaiSessionId: cfg.openaiSessionId,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok || data.ok) {
        setConnectionTestResult('toast success', '连接成功 — OAuth ChatGPT 后端可用', false);
      } else {
        setConnectionTestResult('toast error', `失败 (${resp.status}): ${data.error || data.message || ''}`, false);
      }
    } else {
      const resp = await smartFetch(`${cfg.apiUrl}/v1/models`, {
        method: 'GET',
        headers: buildHeaders(cfg),
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = data.data ? data.data.map((m) => m.id).slice(0, 6).join(', ') : '(无列表)';
        setConnectionTestResult('toast success', `连接成功 — ${models} ...`, false);
      } else {
        const data = await resp.json().catch(() => ({}));
        setConnectionTestResult('toast error', `失败 (${resp.status}): ${data.error?.message || data.message || ''}`, false);
      }
    }
  } catch (e) {
    setConnectionTestResult('toast error', e.message, false);
  }
}

// --- Generate ---

function buildFinalPrompt(prompt, style, type) {
  if (state.lastEnhancedPrompt && prompt === state.lastEnhancedPrompt) return prompt;
  const tags = [style, type].filter(Boolean);
  return tags.length ? `${tags.join(', ')} style. ${prompt}` : prompt;
}

function promptEnhancementSettingsForRequest(forceEnabled = true) {
  const settings = { ...state.appSettings.promptEnhancement };
  if (forceEnabled) settings.enabled = true;
  return settings;
}

function publicPromptCfg(cfg) {
  return {
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    responsesModel: cfg.responsesModel,
    isOAuth: cfg.isOAuth,
    accountId: cfg.accountId,
  };
}

async function requestPromptEnhancement(cfg, prompt, style, type, settings) {
  const payload = {
    cfg: publicPromptCfg(cfg),
    prompt,
    style,
    type,
    settings,
  };
  const resp = await fetch('/api/prompt/enhance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || data.message || `HTTP ${resp.status}`);
  if (!data.prompt) throw new Error('提示词增强接口未返回提示词');
  return String(data.prompt).trim();
}

function setEnhancePromptLoading(on) {
  state.enhancingPrompt = on;
  const btn = $('#enhancePromptBtn');
  if (!btn) return;
  btn.disabled = on || state.generating;
  btn.querySelector('.enhance-icon')?.classList.toggle('hidden', on);
  btn.querySelector('.enhance-label')?.classList.toggle('hidden', on);
  btn.querySelector('.enhance-loading')?.classList.toggle('hidden', !on);
}

async function enhancePromptManually() {
  if (state.generating || state.enhancingPrompt) return;
  const prompt = $('#prompt').value.trim();
  if (!prompt) { showError('请输入提示词', { context: 'validation' }); return; }
  let cfg = getEffective();
  if (!cfg.apiUrl || !cfg.apiKey) { showError('请先添加账号并配置 API 地址和 Key', { context: 'account' }); return; }
  cfg = await ensureValidToken(cfg);
  const style = $('#styleSelect').value;
  const type = $('#typeSelect').value;
  setEnhancePromptLoading(true);
  setGenerationStatus('prompt:enhance:send');
  $('#errorMsg').classList.add('hidden');
  try {
    const enhanced = await requestPromptEnhancement(cfg, prompt, style, type, promptEnhancementSettingsForRequest(true));
    $('#prompt').value = enhanced;
    state.lastEnhancedSource = prompt;
    state.lastEnhancedPrompt = enhanced;
    recordPromptHistory({ source: prompt, final: enhanced, style, type, mode: 'manual-enhance' });
    setGenerationStatus('提示词已生成，可继续修改');
  } catch (e) {
    showError(e, { context: 'prompt-enhancement' });
    setGenerationStatus(IDLE_GENERATION_HINT);
  } finally {
    setEnhancePromptLoading(false);
  }
}

async function generate() {
  if (state.generating) return;

  const prompt = $('#prompt').value.trim();
  if (!prompt) { showError('请输入提示词', { context: 'validation' }); return; }

  const quality = getActiveValue('quality');
  const background = getActiveValue('background');
  const size = $('#sizeSelect').dataset.value;
  const format = $('#formatSelect').value;
  const count = getGenerationCount();
  const style = $('#styleSelect').value;
  const type = $('#typeSelect').value;
  const hasRef = state.refImagesBase64.length > 0;
  let cfg = getEffective();
  if (!cfg.apiUrl || !cfg.apiKey) { showError('请先添加账号并配置 API 地址和 Key', { context: 'account' }); return; }
  cfg = await ensureValidToken(cfg);


  const shouldAutoEnhance = isPromptEnhancementAutoMode();
  let finalPrompt = shouldAutoEnhance ? prompt : buildFinalPrompt(prompt, style, type);

  state.currentGenerationMeta = {
    isOAuth: !!cfg.isOAuth,
    streamMode: !!cfg.streamMode,
    hasRef,
    count,
  };
  setLoading(true);
  setEnhancePromptLoading(false);
  setGenerationStatus(shouldAutoEnhance ? 'prompt:enhance:send' : 'prompt:prepare');
  $('#errorMsg').classList.add('hidden');
  hideGenerationErrorDialog();

  try {
    if (shouldAutoEnhance) {
      finalPrompt = await requestPromptEnhancement(cfg, prompt, style, type, promptEnhancementSettingsForRequest(true));
      $('#prompt').value = finalPrompt;
      state.lastEnhancedSource = prompt;
      state.lastEnhancedPrompt = finalPrompt;
      setGenerationStatus('prompt:enhance:done');
    }
    recordPromptHistory({ source: prompt, final: finalPrompt, style, type, mode: shouldAutoEnhance ? 'auto-enhance' : 'generate' });
    await genBackgroundImages(cfg, finalPrompt, quality, background, size, format, hasRef, count);
  } catch (e) {
    showError(e, { context: 'generation' });
  } finally {
    setLoading(false);
  }
}

// --- Background Jobs ---

function backgroundModeFor(cfg, hasRef) {
  if (cfg.isOAuth) return 'oauth';
  if (cfg.streamMode) return 'responses';
  return hasRef ? 'edits' : 'images';
}

function publicJobCfg(cfg) {
  return {
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    responsesModel: cfg.responsesModel,
    isOAuth: cfg.isOAuth,
    imageEditsCompatMode: cfg.imageEditsCompatMode === true,
    responsesAutoFallback: cfg.responsesAutoFallback !== false,
    accountId: cfg.accountId,
    openaiDeviceId: cfg.openaiDeviceId,
    openaiSessionId: cfg.openaiSessionId,
    accountName: cfg.accountName,
    accountHost: cfg.accountHost,
  };
}

async function createBackgroundJob(payload) {
  const resp = await fetchWithTimeout('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, BACKGROUND_JOB_CREATE_TIMEOUT_MS);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(normalizeGenerationError(data.error || data.message || `HTTP ${resp.status}`));
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchBackgroundJob(jobId) {
  const resp = await fetchWithTimeout(`/api/jobs/${encodeURIComponent(jobId)}`, {}, BACKGROUND_JOB_POLL_TIMEOUT_MS);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(normalizeGenerationError(data.error || data.message || `HTTP ${resp.status}`));
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function cancelBackgroundJob(jobId) {
  const resp = await fetchWithTimeout(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, BACKGROUND_JOB_CREATE_TIMEOUT_MS);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(normalizeGenerationError(data.error || data.message || `HTTP ${resp.status}`));
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data.job || data;
}

function applyJobProgress(job) {
  const last = Array.isArray(job.progress) ? job.progress.at(-1) : null;
  if (!last?.phase && !last?.message) return;

  const progressKey = `${last.phase || ''}:${last.message || ''}`;
  if (progressKey === state.lastProgressKey) return;
  state.lastProgressKey = progressKey;
  stopWaitingStatusSequence();
  setGenerationStatus(last.phase || last.message, last.message);
  startWaitingStatusSequence();
}

async function pollBackgroundJob(jobId, format, isOAuth, resultMeta = {}) {
  startWaitingStatusSequence();
  let retryCount = 0;
  while (true) {
    if (isPollingStopped(state, jobId)) return;
    try {
      const job = await fetchBackgroundJob(jobId);
      if (isPollingStopped(state, jobId)) return;
      retryCount = 0;
      applyJobProgress(job);
      if (job.status === 'completed') {
        clearActiveJob();
        stopWaitingStatusSequence();
        hideActiveJobBanner();
        setGenerationStatus('result:render');
        if (isOAuth) handleOAuthImageResult(job.result, format, resultMeta);
        else handleImagesResult(job.result, format, resultMeta);
        await loadStorageStats();
        return;
      }
      if (job.status === 'failed') {
        clearActiveJob();
        stopWaitingStatusSequence();
        hideActiveJobBanner();
        const err = new Error(normalizeGenerationError(job.errorInfo?.message || job.error || '后台生成失败'));
        err.isBackgroundJobTerminalFailure = true;
        if (job.errorInfo) Object.assign(err, job.errorInfo, { errorInfo: job.errorInfo });
        throw err;
      }
      if (job.status === 'cancelled') {
        stopPollingJob(state, jobId);
        clearActiveJob();
        stopWaitingStatusSequence();
        hideActiveJobBanner();
        setGenerationStatus('job:cancelled');
        return;
      }
      await sleep(BACKGROUND_JOB_POLL_INTERVAL_MS);
    } catch (e) {
      if (isPollingStopped(state, jobId)) return;
      if (!isRetryableBackgroundJobError(e) || isMissingBackgroundJobError(e)) throw e;
      retryCount += 1;
      if (retryCount > BACKGROUND_JOB_POLL_RETRY_LIMIT) throw e;
      stopWaitingStatusSequence();
      const delay = backgroundJobBackoffMs(retryCount, BACKGROUND_JOB_POLL_RETRY_BASE_MS);
      const retryText = `后台任务连接波动，第 ${retryCount}/${BACKGROUND_JOB_POLL_RETRY_LIMIT} 次重试，${Math.ceil(delay / 1000)} 秒后自动重试`;
      setGenerationStatus(retryText);
      showActiveJobBanner('后台任务连接波动', retryText);
      await sleep(delay);
      startWaitingStatusSequence();
    }
  }
}

function isBackgroundJobsUnavailableError(error) {
  const message = normalizeGenerationError(error?.message || error || '');
  return /HTTP\s+(404|405|408|429|5\d\d)|Failed to fetch|NetworkError|Method not allowed|timeout|timed out|超时/i.test(message);
}

function isRetryableBackgroundJobError(error) {
  if (error?.isBackgroundJobTerminalFailure) return false;
  const message = normalizeGenerationError(error?.message || error || '');
  return !!error?.isTimeout
    || error?.status === 429
    || Number(error?.status) >= 500
    || /HTTP\s+(408|429|5\d\d)|Failed to fetch|NetworkError|timeout|timed out|超时/i.test(message);
}

function isMissingBackgroundJobError(error) {
  const message = normalizeGenerationError(error?.message || error || '');
  return error?.status === 404 || /Job not found|not found or expired|HTTP\s+404/i.test(message);
}

async function cancelActiveJob() {
  const active = loadActiveJob();
  if (!active?.jobId) {
    clearActiveJob();
    setGenerationStatus(IDLE_GENERATION_HINT);
    return;
  }
  const button = $('#cancelActiveJobBtn');
  const oldText = button?.textContent || '';
  if (button) {
    button.disabled = true;
    button.textContent = '停止中…';
  }
  setGenerationStatus('正在停止后台任务');
  showActiveJobBanner('正在停止后台任务', '正在通知后端停止任务…');
  try {
    const job = await cancelBackgroundJob(active.jobId);
    stopPollingJob(state, active.jobId);
    clearActiveJob();
    stopWaitingStatusSequence();
    setLoading(false);
    setGenerationStatus('job:cancelled');
    showActiveJobBanner('后台任务已取消', job?.cancelledAt ? '已停止轮询，不会删除已保存的历史记录' : '已停止轮询');
    setTimeout(() => hideActiveJobBanner(), 5000);
  } catch (e) {
    showActiveJobBanner('取消失败', '后台任务仍保留，网络恢复后可继续获取结果');
    setGenerationStatus('取消失败，后台任务仍在进行');
    showError(e, { context: 'background' });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText || '停止';
    }
  }
}

function dismissActiveJob() {
  const active = loadActiveJob();
  if (active?.jobId) stopPollingJob(state, active.jobId);
  clearActiveJob();
  stopWaitingStatusSequence();
  setLoading(false);
  setGenerationStatus(IDLE_GENERATION_HINT);
}

async function genDirectImagesAfterJobFallback(cfg, prompt, quality, background, size, format, hasRef, count = 1, resultMeta = {}) {
  setGenerationStatus('当前部署未启用后台任务，已改用浏览器直连生成');
  const actualCount = getGenerationCount(count);
  const errors = [];
  for (let index = 1; index <= actualCount; index += 1) {
    try {
      setGenerationStatus(`正在直连生成第 ${index}/${actualCount} 张`);
      const itemMeta = { ...resultMeta, batchIndex: index, batchCount: actualCount };
      if (cfg.isOAuth) await genOAuthImages(cfg, prompt, quality, background, size, format, itemMeta);
      else if (cfg.streamMode) await genResponsesWithFallback(cfg, prompt, quality, background, size, format, hasRef, itemMeta);
      else if (hasRef) await genEdits(cfg, prompt, quality, background, size, format, itemMeta);
      else await genImages(cfg, prompt, quality, background, size, format, itemMeta);
    } catch (error) {
      errors.push(error);
      addFailedResultCard({ ...resultMeta, error: normalizeGenerationError(error?.message || error), batchIndex: index, batchCount: actualCount });
    }
  }
  if (errors.length >= actualCount) throw errors[0];
}

async function genBackgroundImages(cfg, prompt, quality, background, size, format, hasRef, count = 1, resultMeta = {}) {
  const mode = backgroundModeFor(cfg, hasRef);
  const actualCount = getGenerationCount(count);
  const batchId = `batch_${genId()}`;
  const payload = {
    mode,
    cfg: publicJobCfg(cfg),
    prompt,
    quality,
    background,
    size,
    format,
    count: actualCount,
    batchId,
    watermarkSettings: getEffectiveWatermarkSettings(),
    storageSettings: { enabled: state.appSettings.storage.enabled !== false && canPersistImagesOnServer() },
    refImagesBase64: hasRef ? state.refImagesBase64 : undefined,
  };

  setGenerationStatus('request:send');
  let job;
  try {
    job = await createBackgroundJob(payload);
  } catch (e) {
    if (isBackgroundJobsUnavailableError(e)) {
      await genDirectImagesAfterJobFallback(cfg, prompt, quality, background, size, format, hasRef, actualCount, resultMeta);
      return;
    }
    throw e;
  }

  if (job.status === 'completed') {
    clearActiveJob();
    stopWaitingStatusSequence();
    setGenerationStatus('result:render');
    if (cfg.isOAuth) handleOAuthImageResult(job.result, format, resultMeta);
    else handleImagesResult(job.result, format, resultMeta);
    await loadStorageStats();
    return;
  }

  const jobId = job.jobId || job.id;
  if (!jobId) throw new Error('后台任务创建失败：缺少 jobId');
  saveActiveJob(state, { jobId, format, isOAuth: cfg.isOAuth, count: actualCount, batchId, resultMeta, createdAt: Date.now() });
  setGenerationStatus(actualCount > 1 ? `批量后台任务已提交（${actualCount} 张）` : '后台任务已提交，可以切到后台稍后回来查看');
  showActiveJobBanner('后台任务已提交', actualCount > 1 ? `批量生成 ${actualCount} 张，你可以切到后台稍后回来继续恢复结果` : '你可以切到后台，稍后回到页面继续恢复结果');

  try {
    await pollBackgroundJob(jobId, format, cfg.isOAuth, resultMeta);
  } catch (e) {
    if (isRetryableBackgroundJobError(e)) {
      stopWaitingStatusSequence();
      const active = loadActiveJob();
      const createdAtText = active?.createdAt ? `创建于 ${formatRelativeTime(active.createdAt)}` : '任务可能仍在后台执行';
      showActiveJobBanner('后台任务仍在进行', `${createdAtText}，网络恢复后会自动继续获取结果`);
      setGenerationStatus('已保留后台任务，网络恢复后会自动继续获取结果');
      return;
    }
    throw e;
  }
}

async function resumeActiveJobIfAny() {
  const active = loadActiveJob();
  if (!active?.jobId || state.generating) return;
  if (active.createdAt && Date.now() - Number(active.createdAt) > ACTIVE_JOB_STALE_MS) {
    clearActiveJob();
    setGenerationStatus(IDLE_GENERATION_HINT);
    return;
  }
  setLoading(true);
  $('#errorMsg').classList.add('hidden');
  const createdAtText = active.createdAt ? `创建于 ${formatRelativeTime(active.createdAt)}` : '正在恢复任务';
  showActiveJobBanner('正在恢复后台生成任务', createdAtText);
  setGenerationStatus('正在恢复后台生成任务');
  try {
    await pollBackgroundJob(active.jobId, active.format || 'png', !!active.isOAuth, active.resultMeta || {});
  } catch (e) {
    if (isMissingBackgroundJobError(e)) {
      clearActiveJob();
      stopWaitingStatusSequence();
      showActiveJobBanner('后台任务已失效', '任务记录可能已过期或服务已重启，无法继续恢复');
      setGenerationStatus(IDLE_GENERATION_HINT);
      setTimeout(() => hideActiveJobBanner(), 5000);
      return;
    }
    if (isRetryableBackgroundJobError(e)) {
      stopWaitingStatusSequence();
      const meta = active.createdAt ? `创建于 ${formatRelativeTime(active.createdAt)}，网络恢复后会自动继续获取结果` : '网络恢复后会自动继续获取结果';
      showActiveJobBanner('已保留后台任务', meta);
      setGenerationStatus('已保留后台任务，网络恢复后会自动继续获取结果');
      return;
    }
    showError(e, { context: 'background' });
  } finally {
    setLoading(false);
  }
}

// --- OAuth ChatGPT backend image generation ---
async function genOAuthImages(cfg, prompt, quality, background, size, format, resultMeta = {}) {
  const body = {
    accessToken: cfg.apiKey,
    accountId: cfg.accountId,
    openaiDeviceId: cfg.openaiDeviceId,
    openaiSessionId: cfg.openaiSessionId,
    model: cfg.model,
    prompt,
    refImagesBase64: state.refImagesBase64.length ? state.refImagesBase64 : undefined,
    n: 1,
    quality,
    background,
    size,
    format,
  };

  setGenerationStatus('request:send');
  const resp = await fetch('/api/oauth/images/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const contentType = resp.headers.get('content-type') || '';
  startWaitingStatusSequence();
  if (!contentType.includes('text/event-stream')) {
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(normalizeGenerationError(data.error?.message || data.error || data.message || `HTTP ${resp.status}`));
    handleOAuthImageResult(data, format, resultMeta);
    return;
  }

  let resultData = null;
  let streamError = null;
  await readSseText(resp, (event, data) => {
    const message = getSseProgressMessage(event, data);
    if (message) {
      stopWaitingStatusSequence();
      setGenerationStatus(message);
    }
    if (event === 'result') {
      resultData = data;
    } else if (event === 'error') {
      streamError = data;
      stopWaitingStatusSequence();
      setGenerationStatus('生成失败，正在整理错误信息');
    }
  });

  if (streamError) throw new Error(normalizeGenerationError(streamError.error || streamError.message || streamError));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  if (!resultData) throw new Error('OAuth 生图接口未返回结果');
  handleOAuthImageResult(resultData, format, resultMeta);
}

function getOAuthResultAccount(resultMeta = {}) {
  const targetAccountId = resultMeta.localAccountId || '';
  return targetAccountId
    ? state.data.accounts.find((item) => item.id === targetAccountId)
    : getActiveAccount();
}

function handleOAuthImageResult(data, format, resultMeta = {}) {
  const acc = getOAuthResultAccount(resultMeta);
  if (acc && acc.type === 'oauth') {
    const updates = {};
    if (data.openaiDeviceId && data.openaiDeviceId !== acc.openaiDeviceId) updates.openaiDeviceId = data.openaiDeviceId;
    if (data.openaiSessionId && data.openaiSessionId !== acc.openaiSessionId) updates.openaiSessionId = data.openaiSessionId;
    if (Object.keys(updates).length) updateAccount(acc.id, updates);
  }

  setGenerationStatus('result:render');
  stopWaitingStatusSequence();
  handleImagesResult(data, format, resultMeta);
}

async function readJsonResponse(resp, label = 'API') {
  const text = await resp.text();
  try {
    return JSON.parse(text || '{}');
  } catch {
    const prefix = String(text || '').trim().slice(0, 120).replace(/\s+/g, ' ');
    if (/^<!doctype html|^<html|^</i.test(prefix)) {
      throw new Error(`${label} 上游返回了 HTML 错误页面（HTTP ${resp.status}）。这通常是 API 站点/CDN 返回 502、404 或网关错误，不是图片 JSON 结果。`);
    }
    throw new Error(`${label} 返回的不是有效 JSON（HTTP ${resp.status}）：${prefix || '空响应'}`);
  }
}

// --- /v1/images/generations ---

async function genImages(cfg, prompt, quality, background, size, format, resultMeta = {}) {
  const body = { model: cfg.model, prompt, n: 1, response_format: 'b64_json' };
  if (quality) body.quality = quality;
  if (background && background !== 'auto') body.background = background;
  if (size && size !== 'auto') body.size = size;
  if (format !== 'png') body.output_format = format;

  setGenerationStatus('request:send');
  const resp = await smartFetch(`${cfg.apiUrl}/v1/images/generations`, {
    method: 'POST',
    headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    jsonBody: body,
    _forceProxy: cfg.isOAuth,
  });
  setGenerationStatus('request:accepted');
  startWaitingStatusSequence();
  const data = await readJsonResponse(resp, 'Images API');
  if (!resp.ok) throw new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`));
  setGenerationStatus('result:render');
  stopWaitingStatusSequence();
  handleImagesResult(data, format, resultMeta);
}

// --- /v1/images/edits ---

async function genEdits(cfg, prompt, quality, background, size, format, resultMeta = {}) {
  const compatMode = shouldUseCompatImageEdits(cfg);
  const body = compatMode ? null : {
    model: cfg.model, prompt, n: 1, response_format: 'b64_json',
    images: state.refImagesBase64.map((data) => ({ image_url: toImageDataUrl(data) })),
  };
  if (body && quality) body.quality = quality;
  if (body && background && background !== 'auto') body.background = background;
  if (body && size && size !== 'auto') body.size = size;
  if (body && format !== 'png') body.output_format = format;
  const compatRequest = compatMode
    ? buildCompatEditsRequest(state.refImagesBase64, { model: cfg.model, prompt, quality, background, size, format })
    : null;

  setGenerationStatus('request:send');
  const resp = await smartFetch(`${cfg.apiUrl}/v1/images/edits`, {
    method: 'POST',
    headers: compatMode ? buildHeaders(cfg) : buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: compatMode ? compatRequest.body : JSON.stringify(body),
    jsonBody: compatMode ? undefined : body,
    multipartBody: compatMode ? compatRequest.multipartBody : undefined,
    _forceProxy: cfg.isOAuth,
  });
  setGenerationStatus('request:accepted');
  startWaitingStatusSequence();
  const data = await readJsonResponse(resp, 'Images API');
  if (!resp.ok) throw new Error(withImageEditsCompatHint(data.error?.message || data.message || `HTTP ${resp.status}`, cfg));
  setGenerationStatus('result:render');
  stopWaitingStatusSequence();
  handleImagesResult(data, format, resultMeta);
}

function handleImagesResult(data, format, resultMeta = {}) {
  let found = false;
  if (data.data) {
    for (const item of [...data.data].reverse()) {
      const meta = { ...resultMeta, ...item, batchCount: item.batchCount || resultMeta.batchCount, batchIndex: item.batchIndex || resultMeta.batchIndex };
      if (item.failed) { addFailedResultCard(meta); found = true; }
      else if (item.b64_json) { addResultCard(item.b64_json, item.format || format, meta); found = true; }
      else if (item.url) { addResultCardFromUrl(item.url, item.format || format, meta); found = true; }
    }
  }
  if (!found) throw new Error('API 返回成功但未包含图片数据');
}

// --- /v1/responses (streaming) ---

async function genResponsesWithFallback(cfg, prompt, quality, background, size, format, hasRef, resultMeta = {}) {
  try {
    await genResponses(cfg, prompt, quality, background, size, format, hasRef, resultMeta);
  } catch (e) {
    if (normalizeGenerationError(e) === POLICY_VIOLATION_MESSAGE) throw e;
    if (!shouldAutoFallbackFromResponses(cfg)) throw new Error(withImageEditsCompatHint(e?.message || e, cfg));
    console.warn('Responses API failed, falling back to Images API:', e);
    setGenerationStatus('fallback:images');
    if (hasRef) await genEdits(cfg, prompt, quality, background, size, format, resultMeta);
    else await genImages(cfg, prompt, quality, background, size, format, resultMeta);
  }
}

async function genResponses(cfg, prompt, quality, background, size, format, hasRef, resultMeta = {}) {
  let input;
  if (hasRef) {
    input = [{ role: 'user', content: [
      ...state.refImagesBase64.map((data) => ({ type: 'input_image', image_url: toImageDataUrl(data) })),
      { type: 'input_text', text: prompt },
    ]}];
  } else {
    input = prompt;
  }

  const imageTool = {
    type: 'image_generation',
    action: hasRef ? 'edit' : 'generate',
    model: cfg.model || DEFAULT_IMAGE_MODEL,
    quality: quality || 'medium',
    size: size === 'auto' ? 'auto' : size,
    background: background || 'auto',
    output_format: format,
  };

  const body = {
    model: cfg.responsesModel || DEFAULT_RESPONSES_MODEL,
    input,
    stream: true,
    store: false,
    tool_choice: { type: 'image_generation' },
    tools: [imageTool],
  };

  setGenerationStatus('request:send');
  const resp = await smartFetch(`${cfg.apiUrl}/v1/responses`, {
    method: 'POST',
    headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    jsonBody: body,
    _forceProxy: cfg.isOAuth,
  });

  let found = false;
  let streamError = null;
  const contentType = resp.headers.get('content-type') || '';
  startWaitingStatusSequence();
  const rawText = contentType.includes('text/event-stream')
    ? await readSseText(resp, (event, data) => {
        if (!data || typeof data !== 'object') return;
        const message = getSseProgressMessage(event, data);
        if (message) {
          stopWaitingStatusSequence();
          setGenerationStatus(message);
        }
        const type = data.type || event;
        if (type === 'response.output_item.done' && data.item?.type === 'image_generation_call' && data.item.result) {
          stopWaitingStatusSequence();
          setGenerationStatus('result:render');
          addResultCard(data.item.result, format, resultMeta);
          found = true;
        }
        if (data.error) streamError = data.error;
      })
    : await resp.text();

  if (streamError) throw new Error(normalizeGenerationError(streamError.message || JSON.stringify(streamError)));

  try {
    setGenerationStatus('result:parse');
    const data = JSON.parse(rawText);
    if (!resp.ok) throw new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`));
    for (const item of (data.output || [])) {
      if (item.type === 'image_generation_call' && item.result) { stopWaitingStatusSequence(); setGenerationStatus('result:render'); addResultCard(item.result, format, resultMeta); found = true; }
    }
    if (found) return;
  } catch (e) {
    if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
  }

  if (found) return;
  for (const line of rawText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const s = line.slice(5).trim();
    if (!s || s === '[DONE]') continue;
    try {
      const ev = JSON.parse(s);
      const message = getResponseStreamProgressMessage(ev);
      if (message) { stopWaitingStatusSequence(); setGenerationStatus(message); }
      if (ev.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call' && ev.item.result) { stopWaitingStatusSequence(); setGenerationStatus('result:render'); addResultCard(ev.item.result, format, resultMeta); found = true; }
      if (ev.error) throw new Error(normalizeGenerationError(ev.error.message || JSON.stringify(ev.error)));
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
    }
  }

  if (isPolicyViolationText(rawText)) throw new Error(normalizeGenerationError(rawText));
  if (!found) throw new Error('未能从响应中提取到图片');
}

// --- File Helpers ---

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function formatFileSize(bytes = 0) {
  const mb = Number(bytes || 0) / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.ceil(Number(bytes || 0) / 1024)} KB`;
}

function validateRefImageFiles(files = []) {
  let totalBytes = 0;
  for (const file of files) {
    const mime = inferRefImageMime(file);
    if (!ALLOWED_REF_IMAGE_MIME_TYPES.has(mime)) {
      showError(`参考图格式不支持：${file?.name || '未命名文件'}，请上传 PNG、JPEG 或 WebP 图片`, { context: 'reference' });
      return false;
    }
    const size = Number(file?.size || 0);
    if (size > REF_IMAGE_MAX_BYTES) {
      showError(`参考图「${file?.name || '未命名图片'}」超过 ${formatFileSize(REF_IMAGE_MAX_BYTES)}，请换用更小图片`, { context: 'reference' });
      return false;
    }
    totalBytes += size;
  }
  if (totalBytes > REF_IMAGES_TOTAL_MAX_BYTES) {
    showError(`参考图总大小超过 ${formatFileSize(REF_IMAGES_TOTAL_MAX_BYTES)}，请减少数量或换用更小图片`, { context: 'reference' });
    return false;
  }
  return true;
}

function inferRefImageMime(file) {
  const mime = String(file?.type || '').trim().toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  if (mime) return mime;
  const name = String(file?.name || '').toLowerCase();
  if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  return '';
}

function toImageDataUrl(data, mime = 'image/png') {
  const value = String(data || '').trim();
  if (/^data:image\/[^;]+;base64,/i.test(value)) return value;
  return `data:${mime};base64,${value}`;
}

function parseImageInputData(data, fallbackMime = 'image/png') {
  const value = String(data || '').trim();
  const match = value.match(/^data:(image\/[^;]+);base64,(.*)$/is);
  if (match) return { mime: match[1].toLowerCase(), base64: match[2] };
  return { mime: fallbackMime, base64: value };
}

function imageExtensionFromMime(mime = 'image/png') {
  if (/image\/jpe?g/i.test(mime)) return 'jpg';
  if (/image\/webp/i.test(mime)) return 'webp';
  return 'png';
}

function base64ToUint8Array(base64) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildCompatEditsRequest(refImages, options = {}) {
  const form = new FormData();
  const fields = {
    model: options.model,
    prompt: options.prompt,
    n: '1',
    response_format: 'b64_json',
  };
  if (options.quality) fields.quality = options.quality;
  if (options.background && options.background !== 'auto') fields.background = options.background;
  if (options.size && options.size !== 'auto') fields.size = options.size;
  if (options.format && options.format !== 'png') fields.output_format = options.format;
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && String(value) !== '') form.append(key, String(value));
  }
  const images = refImages.map((data, index) => {
    const parsed = parseImageInputData(data);
    const filename = `reference-${index + 1}.${imageExtensionFromMime(parsed.mime)}`;
    form.append('image', new Blob([base64ToUint8Array(parsed.base64)], { type: parsed.mime }), filename);
    return {
      fieldName: 'image',
      filename,
      data: toImageDataUrl(data, parsed.mime),
    };
  });
  return { body: form, multipartBody: { fields, images } };
}

function shouldUseCompatImageEdits(cfg = {}) {
  return cfg.imageEditsCompatMode === true;
}

function shouldAutoFallbackFromResponses(cfg = {}) {
  return cfg.responsesAutoFallback !== false;
}

function isImageEditsCompatError(value) {
  return /failed to parse multipart form|convert_request_failed/i.test(normalizeGenerationError(value || ''));
}

function withImageEditsCompatHint(value, cfg = {}) {
  const message = normalizeGenerationError(value);
  if (cfg.imageEditsCompatMode === true || !isImageEditsCompatError(message)) return message;
  return `${message}。这个站点的 /v1/images/edits 可能只支持旧版 multipart 兼容模式，请到账号设置里开启“图生图兼容模式（旧版 multipart）”。`;
}

function renderRefPreviews() {
  const preview = $('#refPreview');
  preview.innerHTML = '';
  state.refImagesBase64.forEach((_, index) => {
    const item = document.createElement('div');
    item.className = 'ref-preview-item';
    const img = document.createElement('img');
    img.alt = `参考图 ${index + 1}`;
    img.src = state.refImagePreviewUrls[index] || '';
    const remove = document.createElement('button');
    remove.className = 'ref-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.onclick = (e) => {
      e.preventDefault();
      state.refImagesBase64.splice(index, 1);
      const [url] = state.refImagePreviewUrls.splice(index, 1);
      if (url) URL.revokeObjectURL(url);
      renderRefPreviews();
      if (!state.refImagesBase64.length) $('#refImage').value = '';
    };
    item.appendChild(img);
    item.appendChild(remove);
    preview.appendChild(item);
  });
  preview.classList.toggle('hidden', state.refImagesBase64.length === 0);
}

async function handleReferenceImagesChange(e) {
  const selectedFiles = Array.from(e.target.files || []);
  const files = selectedFiles.slice(0, MAX_REF_IMAGES);
  if (!files.length) return;
  if (selectedFiles.length > MAX_REF_IMAGES) showError('最多只能上传 3 张参考图，已保留前 3 张', { context: 'reference' });

  if (!validateRefImageFiles(files)) {
    e.target.value = '';
    return;
  }

  state.refImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.refImagesBase64 = await Promise.all(files.map(fileToBase64));
  state.refImagePreviewUrls = files.map((file) => URL.createObjectURL(file));
  renderRefPreviews();
}

export {
  applyImportedBackup,
  buildBackupPayload,
  decryptBackupEnvelope,
  encryptBackupPayload,
  getOAuthResultAccount,
  normalizeBackupPayload,
  sanitizeAccountForExport,
  summarizeBackupPayload,
};

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  loadData();
  try {
    await fetchServerRuntimeConfig();
  } catch (e) {
    console.warn('Failed to load server runtime config:', e?.message || e);
  }
  await fetchAccountStoreCapabilities();
  loadAppSettings();
  loadPromptHistory();
  renderPromptHistory();
  renderSwitcher();

  // Account switcher dropdown
  $('#switcherBtn').onclick = (e) => { e.stopPropagation(); renderDropdown(); toggleDropdown(); };
  $('#switcherBtn').addEventListener('keydown', handleSwitcherKeydown);
  $('#switcherDropdown').addEventListener('keydown', handleDropdownKeydown);
  document.addEventListener('click', (e) => {
    if (state.dropdownOpen && !$('#accountSwitcher').contains(e.target)) toggleDropdown(false);
  });

  // Account management now opens the unified settings center on the account panel.
  $('#dropdownManage').onclick = () => {
    toggleDropdown(false);
    void openSettingsCenter('accounts', { focusSelector: '#addManualBtn', restoreFocus: '#switcherBtn' });
  };
  $('#accountTabApi')?.addEventListener('click', () => setAccountTab('api'));
  $('#accountTabOauth')?.addEventListener('click', () => setAccountTab('oauth'));
  $('#accountTabAdvanced')?.addEventListener('click', () => setAccountTab('advanced'));

  // Settings center overlay
  $('#openSettings').onclick = () => { void openSettingsCenter('quick', { restoreFocus: '#openSettings' }); };
  document.querySelectorAll('#settingsCenterNav [data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => setSettingsPanel(btn.dataset.panel));
  });
  $('#quickAdminBtn')?.addEventListener('click', () => {
    setSettingsPanel('admin');
    $('#adminTokenInput')?.focus();
  });
  $('#quickAddManualBtn')?.addEventListener('click', () => {
    setSettingsPanel('accounts');
    setAccountTab('api');
    openEditModal(null);
  });
  $('#quickOauthLoginBtn')?.addEventListener('click', () => {
    setSettingsPanel('accounts');
    setAccountTab('oauth');
    void startOAuth();
  });
  $('#quickTestConnection')?.addEventListener('click', testConnection);
  $('#closeSettings').onclick = () => closeDialog($('#settingsOverlay'));
  $('#cancelSettings').onclick = () => closeDialog($('#settingsOverlay'));
  $('#saveSettings').onclick = saveSettingsFromForm;
  $('#adminLoginBtn')?.addEventListener('click', loginAdminFromForm);
  $('#adminLogoutBtn')?.addEventListener('click', logoutAdminSession);
  $('#adminTokenInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void loginAdminFromForm();
    }
  });
  $('#settingsOverlay').onclick = (e) => { if (e.target === $('#settingsOverlay')) closeDialog($('#settingsOverlay')); };
  ['watermarkEnabled', 'watermarkTemporaryMode', 'watermarkMode', 'watermarkText', 'watermarkTimeFormat', 'watermarkPosition', 'watermarkOpacity', 'watermarkFontSize', 'watermarkColor', 'watermarkShadow', 'watermarkBackground'].forEach((id) => {
    const el = $(`#${id}`);
    if (el) el.oninput = el.onchange = renderWatermarkPreview;
  });
  $('#promptEnhancementEnabled').onchange = () => syncPromptEnhancementUi('form');
  $('#promptEnhancementRunMode').onchange = () => syncPromptEnhancementUi('form');
  $('#clearConversationData').onclick = async () => { try { await clearStorageData('conversations'); } catch (e) { showError(e, { context: 'storage' }); } };
  $('#clearImageData').onclick = async () => { if (!confirmAction('确定清理已保存的图片？账号不会删除。')) return; try { await clearStorageData('images'); } catch (e) { showError(e, { context: 'storage' }); } };
  $('#clearAllData').onclick = async () => { if (!confirmAction('确定清理对话和图片数据？账号不会删除。')) return; try { await clearStorageData('all'); clearActiveJob(); $('#prompt').value = ''; } catch (e) { showError(e, { context: 'storage' }); } };
  $('#exportSafeBackup')?.addEventListener('click', () => { try { exportSafeBackup(); } catch (e) { setBackupPreview(normalizeGenerationError(e?.message || e), true); showError(e, { context: 'backup.export' }); } });
  $('#exportEncryptedBackup')?.addEventListener('click', async () => { try { await exportEncryptedBackup(); } catch (e) { setBackupPreview(normalizeGenerationError(e?.message || e), true); showError(e, { context: 'backup.export' }); } });
  $('#importBackupPick')?.addEventListener('click', () => $('#importBackupFile')?.click());
  $('#importBackupFile')?.addEventListener('change', async (event) => {
    try { await previewBackupImportFromFile(event.target.files?.[0]); }
    catch (e) {
      pendingBackupImport = null;
      setBackupPreview(normalizeGenerationError(e?.message || e), true);
      const confirmBtn = $('#confirmImportBackup');
      if (confirmBtn) confirmBtn.disabled = true;
      showError(e, { context: 'backup.import' });
    } finally {
      event.target.value = '';
    }
  });
  $('#confirmImportBackup')?.addEventListener('click', () => { try { confirmImportBackup(); } catch (e) { setBackupPreview(normalizeGenerationError(e?.message || e), true); showError(e, { context: 'backup.import' }); } });
  $('#savePromptHistory')?.addEventListener('click', () => { try { saveCurrentPromptToHistory(); } catch (e) { showError(e, { context: 'prompt-history' }); } });
  $('#clearPromptHistory')?.addEventListener('click', () => { try { clearPromptHistory(); } catch (e) { showError(e, { context: 'prompt-history' }); } });
  $('#promptHistorySelect')?.addEventListener('change', () => { try { applySelectedPromptHistory(); } catch (e) { showError(e, { context: 'prompt-history' }); } });
  $('#restorePromptBefore')?.addEventListener('click', () => { try { restorePromptHistoryVersion('source'); } catch (e) { showError(e, { context: 'prompt-history' }); } });
  $('#restorePromptAfter')?.addEventListener('click', () => { try { restorePromptHistoryVersion('final'); } catch (e) { showError(e, { context: 'prompt-history' }); } });
  $('#historyRefresh')?.addEventListener('click', async () => { try { await loadHistoryWithFilters(); } catch (e) { setHistoryStatus('历史读取失败', true); showError(e, { context: 'history' }); } });
  $('#historyFavoriteOnly')?.addEventListener('click', async () => { try { const btn = $('#historyFavoriteOnly'); const pressed = btn.getAttribute('aria-pressed') === 'true'; btn.setAttribute('aria-pressed', String(!pressed)); btn.classList.toggle('active', !pressed); await loadHistoryWithFilters(); } catch (e) { setHistoryStatus('历史读取失败', true); showError(e, { context: 'history' }); } });
  $('#historySearch')?.addEventListener('input', () => {
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(async () => {
      try { await loadHistoryWithFilters(); } catch (e) { setHistoryStatus('历史读取失败', true); showError(e, { context: 'history' }); }
    }, 250);
  });
  $('#retryActiveJobBtn')?.addEventListener('click', () => { void resumeActiveJobIfAny(); });
  $('#cancelActiveJobBtn')?.addEventListener('click', () => { void cancelActiveJob(); });

  // Add manual account
  $('#addManualBtn').onclick = () => openEditModal(null);
  $('#migrateBrowserAccountsBtn')?.addEventListener('click', () => { void migrateBrowserAccountsToServer(); });

  // OAuth login
  $('#oauthLoginBtn').onclick = startOAuth;
  $('#oauthOpenBtn').onclick = openOAuthAuthUrl;
  $('#oauthCopyBtn').onclick = copyOAuthAuthUrl;
  $('#oauthExchangeBtn').onclick = finishOAuthWithCode;
  $('#oauthCancelBtn').onclick = () => {
    resetOAuthManual();
    $('#oauthStatus').classList.add('hidden');
  };

  // Edit modal
  $('#saveEdit').onclick = saveEditModal;
  $('#cancelEdit').onclick = closeEditModal;
  $('#closeEdit').onclick = closeEditModal;
  $('#editOverlay').onclick = (e) => { if (e.target === $('#editOverlay')) closeEditModal(); };
  $('#toggleEditKey').onclick = () => {
    const el = $('#editKey');
    const btn = $('#toggleEditKey');
    const show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.setAttribute('aria-label', show ? '隐藏 API Key' : '显示 API Key');
    btn.title = show ? '隐藏 API Key' : '显示 API Key';
  };

  // Global settings
  $('#useProxy').onchange = () => { state.data.useProxy = $('#useProxy').checked; saveData(); };
  $('#configPlatformCheck')?.addEventListener('click', async () => {
    try {
      const result = await runPlatformAction('check', readServerConfigForm());
      notifyAction(result?.message || '平台校验成功');
    } catch (e) {
      showError(e?.message || e, { context: 'platform' });
    }
  });
  $('#configPlatformSync')?.addEventListener('click', async () => {
    try {
      const result = await runPlatformAction('sync', readServerConfigForm());
      notifyAction(result?.message || '环境变量同步成功');
    } catch (e) {
      showError(e?.message || e, { context: 'platform' });
    }
  });
  $('#configPlatformDeploy')?.addEventListener('click', async () => {
    try {
      const result = await runPlatformAction('deploy', readServerConfigForm());
      notifyAction(result?.message || '已触发重新部署');
    } catch (e) {
      showError(e?.message || e, { context: 'platform' });
    }
  });
  $('#testAccountStoreConfig')?.addEventListener('click', () => { void testAccountStoreConfigFromForm(); });
  $('#testConnection').onclick = testConnection;

  // Generate
  $('#generateBtn').onclick = generate;
  $('#enhancePromptBtn').onclick = enhancePromptManually;
  $('#generationErrorClose')?.addEventListener('click', hideGenerationErrorDialog);
  $('#generationErrorConfirm')?.addEventListener('click', hideGenerationErrorDialog);
  $('#generationErrorOverlay')?.addEventListener('click', (e) => { if (e.target === $('#generationErrorOverlay')) hideGenerationErrorDialog(); });

  // Segmented controls
  document.querySelectorAll('.seg').forEach((g) => {
    g.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => setSegmentValue(g, btn.dataset.value);
      btn.addEventListener('keydown', (event) => handleSegmentKeydown(event, g, btn));
    });
  });

  // Reference images
  $('#uploadLabel')?.addEventListener('click', () => $('#refImage')?.click());
  $('#refImage').onchange = handleReferenceImagesChange;

  // Lightbox
  $('#lightboxClose').onclick = () => closeDialog($('#lightbox'));
  $('#lightbox').onclick = (e) => { if (e.target === $('#lightbox')) closeDialog($('#lightbox')); };

  // Custom size select
  const csEl = $('#sizeSelect');
  const csTrigger = csEl.querySelector('.cs-trigger');
  const csDropdown = csEl.querySelector('.cs-dropdown');
  csTrigger.onclick = (e) => {
    e.stopPropagation();
    const shouldOpen = csDropdown.classList.contains('hidden');
    setSizeSelectOpen(csEl, shouldOpen, { focusActive: shouldOpen });
  };
  csTrigger.addEventListener('keydown', (event) => handleSizeTriggerKeydown(event, csEl));
  csEl.querySelectorAll('.cs-item').forEach((item) => {
    item.onclick = (event) => {
      event.stopPropagation();
      selectSizeItem(csEl, item);
    };
    item.addEventListener('keydown', (event) => handleSizeItemKeydown(event, csEl, item));
    if (item.dataset.value === csEl.dataset.value) selectSizeItem(csEl, item, { close: false, focusTrigger: false });
  });
  document.addEventListener('click', (e) => {
    if (!csEl.contains(e.target)) setSizeSelectOpen(csEl, false, { focusActive: false });
  });

  // Ctrl+Enter
  $('#prompt').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate(); });

  applyGenerationDefaultsToControls();
  syncPromptEnhancementUi();
  loadStorageStats();
  window.addEventListener('online', () => { void resumeActiveJobIfAny(); });
  window.addEventListener('focus', () => { void resumeActiveJobIfAny(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void resumeActiveJobIfAny();
  });
  void resumeActiveJobIfAny();
});

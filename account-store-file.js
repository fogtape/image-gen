import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_RESPONSES_MODEL = 'gpt-5.4';
const MAX_ACCOUNTS = 50;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteFile(file, content, mode = 0o600) {
  ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, mode); } catch {}
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw error;
  }
}

function cleanText(value = '', max = 500) {
  return String(value || '').trim().slice(0, max);
}

function cleanUrl(value = '') {
  return cleanText(value, 500).replace(/\/+$/, '');
}

function cleanBool(value, fallback = false) {
  return value === true ? true : value === false ? false : fallback;
}

function cleanTime(value) {
  const raw = Number(value || Date.now());
  return Number.isFinite(raw) && raw > 0 ? raw : Date.now();
}

function secretText(value = '') {
  return String(value || '').trim();
}

function keyFromSecret(secret) {
  const text = secretText(secret);
  if (!text) throw new Error('Account store encryption key is required');
  return crypto.createHash('sha256').update(text, 'utf8').digest();
}

export function encryptAccountStorePayload(payload, encryptionKey) {
  const key = keyFromSecret(encryptionKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    app: 'image-gen',
    store: 'accounts',
    encrypted: true,
    crypto: {
      alg: 'AES-256-GCM',
      iv: iv.toString('base64url'),
      tag: tag.toString('base64url'),
    },
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function decryptAccountStoreEnvelope(envelope, encryptionKey) {
  if (!envelope || envelope.app !== 'image-gen' || envelope.store !== 'accounts' || envelope.encrypted !== true) {
    throw new Error('Account store file format is invalid');
  }
  try {
    const key = keyFromSecret(encryptionKey);
    const iv = Buffer.from(String(envelope.crypto?.iv || ''), 'base64url');
    const tag = Buffer.from(String(envelope.crypto?.tag || ''), 'base64url');
    const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    const wrapped = new Error('Account store decrypt failed');
    wrapped.code = 'ACCOUNT_STORE_DECRYPT_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
}

export function normalizeAccountForStorage(input = {}) {
  const id = cleanText(input.id, 80) || crypto.randomUUID();
  const type = input.type === 'oauth' ? 'oauth' : 'manual';
  const account = {
    id,
    type,
    name: cleanText(input.name, 120) || (type === 'oauth' ? 'OpenAI' : '未命名'),
    apiUrl: cleanUrl(input.apiUrl || 'https://api.openai.com'),
    apiKey: secretText(input.apiKey),
    model: cleanText(input.model || DEFAULT_IMAGE_MODEL, 120) || DEFAULT_IMAGE_MODEL,
    responsesModel: cleanText(input.responsesModel || DEFAULT_RESPONSES_MODEL, 120) || DEFAULT_RESPONSES_MODEL,
    streamMode: cleanBool(input.streamMode, false),
    responsesAutoFallback: input.responsesAutoFallback !== false,
    imageEditsCompatMode: cleanBool(input.imageEditsCompatMode, false),
    createdAt: cleanTime(input.createdAt),
  };
  for (const key of ['refreshToken', 'email', 'accountId', 'planType', 'openaiDeviceId', 'openaiSessionId']) {
    const value = secretText(input[key]);
    if (value) account[key] = value;
  }
  if (input.tokenExpiresAt) {
    const expires = Number(input.tokenExpiresAt);
    if (Number.isFinite(expires) && expires > 0) account.tokenExpiresAt = expires;
  }
  return account;
}

function maskSecret(value = '') {
  const text = secretText(value);
  if (!text) return '';
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 3)}…${text.slice(-4)}`;
}

export function redactAccountForList(account = {}) {
  const normalized = normalizeAccountForStorage(account);
  const out = {
    id: normalized.id,
    type: normalized.type,
    name: normalized.name,
    apiUrl: normalized.apiUrl,
    model: normalized.model,
    responsesModel: normalized.responsesModel,
    streamMode: normalized.streamMode,
    responsesAutoFallback: normalized.responsesAutoFallback,
    imageEditsCompatMode: normalized.imageEditsCompatMode,
    createdAt: normalized.createdAt,
    hasApiKey: !!normalized.apiKey,
    apiKeyPreview: maskSecret(normalized.apiKey),
  };
  for (const key of ['email', 'accountId', 'planType', 'tokenExpiresAt']) {
    if (normalized[key]) out[key] = normalized[key];
  }
  if (normalized.refreshToken) out.hasRefreshToken = true;
  if (normalized.openaiDeviceId || normalized.openaiSessionId) out.hasOAuthSession = true;
  return out;
}

export function normalizeAccountState(input = {}) {
  const accounts = (Array.isArray(input.accounts) ? input.accounts : [])
    .map(normalizeAccountForStorage)
    .slice(0, MAX_ACCOUNTS);
  const activeId = accounts.some((item) => item.id === input.activeId)
    ? input.activeId
    : (accounts[0]?.id || null);
  return {
    version: 1,
    updatedAt: cleanTime(input.updatedAt),
    activeId,
    accounts,
  };
}

export function accountNotFoundError(id) {
  const error = new Error('Account not found');
  error.status = 404;
  error.code = 'ACCOUNT_NOT_FOUND';
  error.accountId = id;
  return error;
}

export function createFileAccountStore({ filePath, encryptionKey } = {}) {
  if (!filePath) throw new Error('Account store file path is required');
  keyFromSecret(encryptionKey);

  async function loadPlainState() {
    if (!fs.existsSync(filePath)) return normalizeAccountState({ accounts: [], activeId: null });
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeAccountState(decryptAccountStoreEnvelope(envelope, encryptionKey));
  }

  async function savePlainState(state) {
    const normalized = normalizeAccountState({ ...state, updatedAt: Date.now() });
    const envelope = encryptAccountStorePayload(normalized, encryptionKey);
    atomicWriteFile(filePath, JSON.stringify(envelope, null, 2));
    return normalized;
  }

  return {
    filePath,
    async getCapabilities() {
      return {
        type: 'file',
        available: true,
        encrypted: true,
        fallback: 'browser',
      };
    },
    async loadAccounts({ includeSecrets = false } = {}) {
      const state = await loadPlainState();
      if (includeSecrets) return state;
      return {
        ...state,
        accounts: state.accounts.map(redactAccountForList),
      };
    },
    async listAccounts() {
      return this.loadAccounts({ includeSecrets: false });
    },
    async saveAccounts(nextState = {}) {
      return savePlainState(nextState);
    },
    async upsertAccount(account, { activeId } = {}) {
      const state = await loadPlainState();
      const normalized = normalizeAccountForStorage(account);
      const index = state.accounts.findIndex((item) => item.id === normalized.id);
      if (index >= 0) state.accounts[index] = { ...state.accounts[index], ...normalized };
      else state.accounts.push(normalized);
      state.activeId = activeId || state.activeId || normalized.id;
      return savePlainState(state);
    },
    async patchAccount(id, patch = {}, { activeId } = {}) {
      const state = await loadPlainState();
      const index = state.accounts.findIndex((item) => item.id === id);
      if (index < 0) throw accountNotFoundError(id);
      const merged = normalizeAccountForStorage({
        ...state.accounts[index],
        ...(patch || {}),
        id,
      });
      state.accounts[index] = merged;
      if (activeId && state.accounts.some((item) => item.id === activeId)) state.activeId = activeId;
      return savePlainState(state);
    },
    async deleteAccount(id) {
      const state = await loadPlainState();
      const nextAccounts = state.accounts.filter((item) => item.id !== id);
      const nextActiveId = state.activeId === id
        ? (nextAccounts[0]?.id || null)
        : (nextAccounts.some((item) => item.id === state.activeId) ? state.activeId : (nextAccounts[0]?.id || null));
      return savePlainState({ ...state, activeId: nextActiveId, accounts: nextAccounts });
    },
  };
}

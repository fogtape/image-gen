import {
  accountNotFoundError,
  decryptAccountStoreEnvelope,
  encryptAccountStorePayload,
  normalizeAccountForStorage,
  normalizeAccountState,
  redactAccountForList,
} from './account-store-file.js';

const DEFAULT_NAMESPACE = 'image-gen';
const DEFAULT_DEPLOYMENT_ID = 'default';

function text(value = '') {
  return String(value || '').trim();
}

function cleanKeyPart(value = '', fallback = 'default') {
  return text(value)
    .replace(/[^a-zA-Z0-9:_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || fallback;
}

function normalizeRestUrl(value = '') {
  const raw = text(value).replace(/\/+$/, '');
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Upstash REST URL must be HTTPS');
  return url.toString().replace(/\/+$/, '');
}

function buildAccountsKey(namespace = DEFAULT_NAMESPACE, deploymentId = DEFAULT_DEPLOYMENT_ID) {
  return `${cleanKeyPart(namespace, DEFAULT_NAMESPACE)}:accounts:${cleanKeyPart(deploymentId, DEFAULT_DEPLOYMENT_ID)}`;
}

function safeUpstashError(message = 'Upstash account store request failed', status = 0) {
  const error = new Error(message);
  error.status = status;
  error.code = 'UPSTASH_ACCOUNT_STORE_FAILED';
  return error;
}

async function parseUpstashResponse(resp) {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.error) {
    throw safeUpstashError('Upstash account store request failed', resp.status);
  }
  return data.result;
}

export function createUpstashAccountStore({
  restUrl,
  restToken,
  encryptionKey,
  namespace = DEFAULT_NAMESPACE,
  deploymentId = DEFAULT_DEPLOYMENT_ID,
  fetchImpl = globalThis.fetch,
} = {}) {
  const url = normalizeRestUrl(restUrl);
  const token = text(restToken);
  const secret = text(encryptionKey);
  const fetcher = fetchImpl;
  if (!token) throw new Error('Upstash REST token is required');
  if (!secret) throw new Error('Account store encryption key is required');
  if (typeof fetcher !== 'function') throw new Error('fetch implementation is required');

  const key = buildAccountsKey(namespace, deploymentId);

  async function command(args = []) {
    try {
      const resp = await fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      });
      return await parseUpstashResponse(resp);
    } catch (error) {
      if (error?.code === 'UPSTASH_ACCOUNT_STORE_FAILED') throw error;
      throw safeUpstashError('Upstash account store request failed', error?.status || 0);
    }
  }

  async function loadPlainState() {
    const raw = await command(['GET', key]);
    if (!raw) return normalizeAccountState({ accounts: [], activeId: null });
    let envelope;
    try {
      envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return normalizeAccountState(decryptAccountStoreEnvelope(envelope, secret));
    } catch (error) {
      const wrapped = new Error('Upstash account store decrypt failed');
      wrapped.code = 'ACCOUNT_STORE_DECRYPT_FAILED';
      wrapped.status = 500;
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async function savePlainState(state) {
    const normalized = normalizeAccountState({ ...state, updatedAt: Date.now() });
    const envelope = encryptAccountStorePayload(normalized, secret);
    await command(['SET', key, JSON.stringify(envelope)]);
    return normalized;
  }

  return {
    key,
    async getCapabilities() {
      return {
        type: 'upstash',
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
      state.accounts[index] = normalizeAccountForStorage({
        ...state.accounts[index],
        ...(patch || {}),
        id,
      });
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

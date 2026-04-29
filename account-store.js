import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveAccountStoreCapabilities } from './account-store-capabilities.js';
import { createFileAccountStore } from './account-store-file.js';
import { createUpstashAccountStore } from './account-store-upstash.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ACCOUNT_STORE_KEY_FILE = '.account-store-key';

function text(value = '') {
  return String(value || '').trim();
}

function defaultConfigDir(env = process.env) {
  return text(env.IMAGE_GEN_CONFIG_DIR) || path.join(__dirname, 'config');
}

function defaultDataDir(env = process.env) {
  return text(env.IMAGE_GEN_DATA_DIR) || path.join(__dirname, 'data');
}

export function resolveAccountStoreFilePath({ env = process.env, dataDir = defaultDataDir(env) } = {}) {
  const configured = text(env.IMAGE_GEN_ACCOUNT_STORE_FILE);
  if (!configured) return path.join(dataDir, 'accounts.enc.json');
  if (path.isAbsolute(configured)) return configured;
  return path.resolve(configured);
}

function readFileIfExists(file) {
  try {
    if (!fs.existsSync(file)) return '';
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function writeNewKeyFile(file, secret) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, `${secret}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  try { fs.chmodSync(file, 0o600); } catch {}
  return readFileIfExists(file);
}

export function getAccountStoreEncryptionKey({
  env = process.env,
  configDir = defaultConfigDir(env),
  allowCreate = true,
} = {}) {
  const envSecret = text(env.IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY || env.IMAGE_GEN_ACCOUNT_STORE_ENCRYPTION_KEY);
  if (envSecret) return { key: envSecret, source: 'env' };

  const keyFile = path.join(configDir, DEFAULT_ACCOUNT_STORE_KEY_FILE);
  const existing = readFileIfExists(keyFile);
  if (existing) return { key: existing, source: 'local-file', keyFile };
  if (!allowCreate) return { key: '', source: 'missing', keyFile };

  const generated = crypto.randomBytes(32).toString('base64url');
  const key = writeNewKeyFile(keyFile, generated);
  return { key, source: 'local-file', keyFile };
}

export function createAccountStore({
  env = process.env,
  isServerless = false,
  dataDir = defaultDataDir(env),
  configDir = defaultConfigDir(env),
  fetchImpl = globalThis.fetch,
} = {}) {
  const capabilities = resolveAccountStoreCapabilities({ env, isServerless, dataDir });
  if (capabilities.store?.available !== true) {
    return { capabilities, store: null };
  }
  if (capabilities.store?.type === 'upstash') {
    const encryption = getAccountStoreEncryptionKey({ env, configDir, allowCreate: false });
    return {
      capabilities,
      store: createUpstashAccountStore({
        restUrl: text(env.IMAGE_GEN_UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_REST_URL),
        restToken: text(env.IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN || env.UPSTASH_REDIS_REST_TOKEN),
        encryptionKey: encryption.key,
        namespace: text(env.IMAGE_GEN_ACCOUNT_STORE_NAMESPACE) || 'image-gen',
        deploymentId: text(env.IMAGE_GEN_DEPLOYMENT_ID || env.VERCEL_PROJECT_PRODUCTION_URL || env.NETLIFY_SITE_ID || env.CF_PAGES_PROJECT_NAME) || 'default',
        fetchImpl,
      }),
    };
  }
  if (capabilities.store?.type !== 'file') return { capabilities, store: null };
  const encryption = getAccountStoreEncryptionKey({ env, configDir, allowCreate: true });
  const filePath = resolveAccountStoreFilePath({ env, dataDir });
  return {
    capabilities: {
      ...capabilities,
      store: {
        ...capabilities.store,
        encrypted: true,
      },
    },
    store: createFileAccountStore({
      filePath,
      encryptionKey: encryption.key,
    }),
  };
}

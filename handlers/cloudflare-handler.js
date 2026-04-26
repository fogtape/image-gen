import { BaseHandler } from './base-handler.js';

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!resp.ok) {
    const message = typeof data === 'object' && data ? (data.errors?.[0]?.message || data.messages?.[0]?.message) : text;
    throw new Error(message || `HTTP ${resp.status}`);
  }
  return data;
}

export class CloudflareHandler extends BaseHandler {
  getName() { return 'cloudflare'; }
  getCapabilities() {
    return { canWriteLocalEnv: true, canSyncPlatformEnv: true, canRedeploy: true };
  }
  requireParams() {
    const { accountId, projectId, apiToken } = this.getDeployConfig();
    if (!accountId || !projectId || !apiToken) throw new Error('Cloudflare 需要 accountId、projectId、apiToken');
    return { accountId, projectId, token: apiToken };
  }
  async getSettings(accountId, projectId, token) {
    return await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(projectId)}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  async check() {
    const { accountId, projectId, token } = this.requireParams();
    const data = await this.getSettings(accountId, projectId, token);
    const bindings = Array.isArray(data?.result?.bindings) ? data.result.bindings : [];
    return { ok: true, platform: 'cloudflare', message: 'Cloudflare 平台参数校验通过。', details: { accountId, projectId, bindingCount: bindings.length, tokenPreview: this.sanitizeSecretPreview(token) } };
  }
  async sync() {
    const { accountId, projectId, token } = this.requireParams();
    const data = await this.getSettings(accountId, projectId, token);
    const bindings = Array.isArray(data?.result?.bindings) ? data.result.bindings.filter((item) => item?.type === 'plain_text') : [];
    const desiredMap = this.getWhitelistedEnvMap();
    for (const [key, value] of Object.entries(desiredMap)) {
      const existing = bindings.find((item) => item.name === key);
      if (existing) existing.text = String(value);
      else bindings.push({ name: key, text: String(value), type: 'plain_text' });
    }
    const formData = new FormData();
    formData.append('settings', new Blob([JSON.stringify({ bindings })], { type: 'application/json' }), 'settings.json');
    await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(projectId)}/settings`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    return { ok: true, platform: 'cloudflare', message: `已同步 ${Object.keys(desiredMap).length} 个环境变量到 Cloudflare。`, details: { accountId, projectId, updatedKeys: Object.keys(desiredMap) } };
  }
  async deploy() {
    return { ok: true, platform: 'cloudflare', message: 'Cloudflare Workers / Pages 更新环境变量后通常自动生效，无需额外手动部署。' };
  }
}

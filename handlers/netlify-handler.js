import { BaseHandler } from './base-handler.js';

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!resp.ok) {
    const message = typeof data === 'object' && data ? (data.message || data.error || data.code) : text;
    throw new Error(message || `HTTP ${resp.status}`);
  }
  return data;
}

export class NetlifyHandler extends BaseHandler {
  getName() { return 'netlify'; }
  getCapabilities() {
    return { canWriteLocalEnv: true, canSyncPlatformEnv: true, canRedeploy: true };
  }
  requireParams() {
    const { accountId, projectId, apiToken } = this.getDeployConfig();
    if (!accountId || !projectId || !apiToken) throw new Error('Netlify 需要 accountId、projectId、apiToken');
    return { accountId, projectId, token: apiToken };
  }
  async listEnv(accountId, projectId, token) {
    return await fetchJson(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(accountId)}/env?site_id=${encodeURIComponent(projectId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  async check() {
    const { accountId, projectId, token } = this.requireParams();
    const envs = await this.listEnv(accountId, projectId, token);
    return { ok: true, platform: 'netlify', message: 'Netlify 平台参数校验通过。', details: { accountId, projectId, envCount: Array.isArray(envs) ? envs.length : 0, tokenPreview: this.sanitizeSecretPreview(token) } };
  }
  async sync() {
    const { accountId, projectId, token } = this.requireParams();
    const desiredMap = this.getWhitelistedEnvMap();
    const updatedKeys = [];
    for (const [key, value] of Object.entries(desiredMap)) {
      await fetchJson(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(accountId)}/env/${encodeURIComponent(key)}?site_id=${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, values: [{ context: 'all', value: String(value) }] }),
      }).catch(async () => {
        await fetchJson(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(accountId)}/env?site_id=${encodeURIComponent(projectId)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([{ key, values: [{ context: 'all', value: String(value) }] }]),
        });
      });
      updatedKeys.push(key);
    }
    return { ok: true, platform: 'netlify', message: `已同步 ${updatedKeys.length} 个环境变量到 Netlify。`, details: { accountId, projectId, updatedKeys } };
  }
  async deploy() {
    const { projectId, token } = this.requireParams();
    const result = await fetchJson(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(projectId)}/builds`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return { ok: true, platform: 'netlify', message: '已触发 Netlify 重新部署。', details: { buildId: result?.id || '', projectId } };
  }
}

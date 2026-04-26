import { BaseHandler } from './base-handler.js';

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!resp.ok) {
    const message = typeof data === 'object' && data ? (data.error?.message || data.message || data.error?.code) : text;
    throw new Error(message || `HTTP ${resp.status}`);
  }
  return data;
}

export class VercelHandler extends BaseHandler {
  getName() { return 'vercel'; }

  getCapabilities() {
    return { canWriteLocalEnv: true, canSyncPlatformEnv: true, canRedeploy: true };
  }

  getProjectId() { return this.getDeployConfig().projectId || ''; }
  getApiToken() { return this.getDeployConfig().apiToken || ''; }

  requireParams() {
    const projectId = this.getProjectId();
    const token = this.getApiToken();
    if (!projectId || !token) throw new Error('Vercel 需要 projectId 和 apiToken');
    return { projectId, token };
  }

  async listEnv(projectId, token) {
    const data = await fetchJson(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return Array.isArray(data?.envs) ? data.envs : [];
  }

  async check() {
    const { projectId, token } = this.requireParams();
    const envs = await this.listEnv(projectId, token);
    return {
      ok: true,
      platform: 'vercel',
      message: 'Vercel 平台参数校验通过。',
      details: {
        projectId,
        envCount: envs.length,
        tokenPreview: this.sanitizeSecretPreview(token),
      },
    };
  }

  async sync() {
    const { projectId, token } = this.requireParams();
    const desiredMap = this.getWhitelistedEnvMap();
    const envs = await this.listEnv(projectId, token);
    const updatedKeys = [];

    for (const [key, value] of Object.entries(desiredMap)) {
      const found = envs.find((item) => item.key === key);
      if (found?.id) {
        await fetchJson(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env/${found.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value, target: found.target || ['production', 'preview', 'development'], type: found.type || 'encrypted' }),
        });
      } else {
        await fetchJson(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value, target: ['production', 'preview', 'development'], type: 'encrypted' }),
        });
      }
      updatedKeys.push(key);
    }

    return {
      ok: true,
      platform: 'vercel',
      message: `已同步 ${updatedKeys.length} 个环境变量到 Vercel。`,
      details: { projectId, updatedKeys },
    };
  }

  async deploy() {
    const { projectId, token } = this.requireParams();
    const list = await fetchJson(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const latest = Array.isArray(list?.deployments) ? list.deployments[0] : null;
    if (!latest?.uid) throw new Error('未找到可复用的最新部署');
    const result = await fetchJson('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: projectId, deploymentId: latest.uid, target: 'production' }),
    });
    return {
      ok: true,
      platform: 'vercel',
      message: '已触发 Vercel 重新部署。',
      details: { deploymentId: result?.id || '', projectId },
    };
  }
}

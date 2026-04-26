import { BaseHandler } from './base-handler.js';

async function postJson(token, data) {
  const resp = await fetch('https://pages-api.cloud.tencent.com/v1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!resp.ok) throw new Error((json && json.message) || text || `HTTP ${resp.status}`);
  if (json?.Code && json.Code !== 0 && json?.data?.Code !== 0) throw new Error(json?.Message || json?.data?.Message || 'EdgeOne API failed');
  return json;
}

export class EdgeoneHandler extends BaseHandler {
  getName() { return 'edgeone'; }
  getCapabilities() {
    return { canWriteLocalEnv: true, canSyncPlatformEnv: true, canRedeploy: true };
  }
  requireParams() {
    const { projectId, apiToken } = this.getDeployConfig();
    if (!projectId || !apiToken) throw new Error('EdgeOne 需要 projectId、apiToken');
    return { projectId, token: apiToken };
  }
  async check() {
    const { projectId, token } = this.requireParams();
    const result = await postJson(token, { Action: 'ModifyPagesProjectEnvs', ProjectId: projectId });
    return { ok: true, platform: 'edgeone', message: 'EdgeOne 平台参数校验通过。', details: { projectId, tokenPreview: this.sanitizeSecretPreview(token), rawCode: result?.Code || result?.data?.Code || 0 } };
  }
  async sync() {
    const { projectId, token } = this.requireParams();
    const envs = Object.entries(this.getWhitelistedEnvMap()).map(([Key, Value]) => ({ Key, Value: String(Value) }));
    await postJson(token, { Action: 'ModifyPagesProjectEnvs', ProjectId: projectId, EnvVars: envs });
    return { ok: true, platform: 'edgeone', message: `已同步 ${envs.length} 个环境变量到 EdgeOne。`, details: { projectId, updatedKeys: envs.map((item) => item.Key) } };
  }
  async deploy() {
    const { projectId, token } = this.requireParams();
    await postJson(token, { Action: 'CreatePagesDeployment', ProjectId: projectId, RepoBranch: 'main', ViaMeta: 'Github', Provider: 'Github' });
    return { ok: true, platform: 'edgeone', message: '已触发 EdgeOne 重新部署。', details: { projectId } };
  }
}

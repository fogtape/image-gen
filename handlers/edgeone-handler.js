import { BaseHandler } from './base-handler.js';
import { collectRequestBodyRedactions, fetchJsonWithTimeout, redactMessage } from './platform-fetch.js';

async function postJson(token, data) {
  const body = JSON.stringify(data);
  const requestRedactions = [token, ...await collectRequestBodyRedactions(body)];
  const json = await fetchJsonWithTimeout('https://pages-api.cloud.tencent.com/v1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  }, { redactions: requestRedactions });
  if (json?.Code && json.Code !== 0 && json?.data?.Code !== 0) throw new Error(redactMessage(json?.Message || json?.data?.Message || 'EdgeOne API failed', requestRedactions));
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
    const { projectId } = this.requireParams();
    return {
      ok: true,
      platform: 'edgeone',
      message: 'EdgeOne 本地平台参数校验通过；检查动作不会写入云端环境变量，请使用“同步环境变量”执行实际更新。',
      details: {
        projectId,
        apiTokenConfigured: true,
        remoteWrite: false,
      },
    };
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

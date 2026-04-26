import { BaseHandler } from './base-handler.js';

export class NodeHandler extends BaseHandler {
  getName() {
    return 'node';
  }

  getCapabilities() {
    return {
      canWriteLocalEnv: true,
      canSyncPlatformEnv: false,
      canRedeploy: false,
    };
  }

  async check() {
    const cfg = this.getRuntimeConfig();
    return {
      ok: true,
      platform: 'node',
      message: '本地 / Docker 模式可直接写入 config/.env，并支持 watcher 热更新。',
      details: {
        envFile: this.configService?.envFile || '',
        autoSync: cfg?.deploy?.autoSync === true,
        autoRedeploy: cfg?.deploy?.autoRedeploy === true,
      },
    };
  }

  async sync() {
    return {
      ok: true,
      platform: 'node',
      message: 'Node 平台不需要额外同步云端环境变量，保存配置后已写入本地 config/.env。',
      details: {
        envFile: this.configService?.envFile || '',
        syncedKeys: Object.keys(this.getWhitelistedEnvMap()),
      },
    };
  }

  async deploy() {
    return {
      ok: true,
      platform: 'node',
      message: 'Node / Docker 本地模式无需远程重部署；如容器未挂载 config/，请自行重启容器。',
    };
  }
}

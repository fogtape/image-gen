export class BaseHandler {
  constructor({ configService, runtimeResolver } = {}) {
    this.configService = configService;
    this.runtimeResolver = runtimeResolver;
  }

  getName() {
    return 'base';
  }

  getCapabilities() {
    return {
      canWriteLocalEnv: false,
      canSyncPlatformEnv: false,
      canRedeploy: false,
    };
  }

  getRuntimeConfig() {
    return this.runtimeResolver ? this.runtimeResolver() : this.configService?.getRuntimeConfig?.();
  }

  getDeployConfig() {
    return this.getRuntimeConfig()?.deploy || {};
  }

  getWhitelistedEnvMap() {
    return this.configService?.getEnvMapForPlatformSync?.() || {};
  }

  sanitizeSecretPreview(value = '') {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 6) return '*'.repeat(text.length);
    return `${text.slice(0, 3)}***${text.slice(-3)}`;
  }

  async check() {
    throw new Error('check() must be implemented');
  }

  async sync() {
    throw new Error('sync() must be implemented');
  }

  async deploy() {
    throw new Error('deploy() must be implemented');
  }
}

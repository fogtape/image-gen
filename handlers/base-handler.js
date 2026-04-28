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

  unwrapRuntimeConfig(runtime) {
    if (!runtime || typeof runtime !== 'object') return {};
    return runtime.config && typeof runtime.config === 'object' ? runtime.config : runtime;
  }

  getRuntimeConfig() {
    const runtime = this.runtimeResolver
      ? this.runtimeResolver()
      : (this.configService?.getResolvedConfig?.() || this.configService?.getRuntimeConfig?.());
    return this.unwrapRuntimeConfig(runtime);
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

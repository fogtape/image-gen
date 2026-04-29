import { IDLE_GENERATION_HINT } from '../ui-feedback.js';

export const DEFAULT_APP_SETTINGS = {
  generation: { size: 'auto', quality: 'medium', format: 'png', background: 'auto', count: 1 },
  watermark: {
    enabled: false,
    temporaryMode: 'default',
    mode: 'camera-time',
    text: 'AI Image Studio',
    timeFormat: 'camera',
    position: 'bottom-right',
    opacity: 0.72,
    fontSize: 28,
    color: '#ffffff',
    shadow: true,
    background: true,
  },
  storage: { enabled: true },
  promptEnhancement: {
    enabled: false,
    runMode: 'manual',
    model: '',
    mode: 'balanced',
    language: 'auto',
  },
};

export function cloneDefaultSettings() {
  return typeof structuredClone === 'function' ? structuredClone(DEFAULT_APP_SETTINGS) : JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS));
}

export function mergeAppSettings(input = {}) {
  const defaults = cloneDefaultSettings();
  return {
    generation: { ...defaults.generation, ...(input.generation || {}) },
    watermark: { ...defaults.watermark, ...(input.watermark || {}) },
    storage: { ...defaults.storage, ...(input.storage || {}) },
    promptEnhancement: { ...defaults.promptEnhancement, ...(input.promptEnhancement || {}) },
  };
}

export const state = {
  data: { activeId: null, accounts: [], useProxy: false },
  serverConfig: null,
  serverCapabilities: null,
  accountStoreCapabilities: null,
  configSchema: null,
  appSettings: cloneDefaultSettings(),
  refImagesBase64: [],
  refImagePreviewUrls: [],
  generating: false,
  dropdownOpen: false,
  oauthPendingSessionId: null,
  oauthPendingState: null,
  oauthAuthUrl: '',
  oauthPollTimer: null,
  oauthPollSessionId: null,
  oauthPollGeneration: 0,
  oauthLoginInProgress: false,
  oauthCompletedKeys: new Set(),
  generationHintTimer: null,
  generationHintStep: 0,
  waitingStatusTimer: null,
  lastProgressKey: '',
  lastStatusText: IDLE_GENERATION_HINT,
  lastStatusPhase: '',
  currentGenerationMeta: null,
  enhancingPrompt: false,
  lastEnhancedPrompt: '',
  lastEnhancedSource: '',
  stoppedJobIds: new Set(),
};

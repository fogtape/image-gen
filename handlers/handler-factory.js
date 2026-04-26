import { NodeHandler } from './node-handler.js';
import { VercelHandler } from './vercel-handler.js';
import { NetlifyHandler } from './netlify-handler.js';
import { CloudflareHandler } from './cloudflare-handler.js';
import { EdgeoneHandler } from './edgeone-handler.js';

export function getSupportedPlatforms() {
  return ['node', 'vercel', 'netlify', 'cloudflare', 'edgeone'];
}

export function createPlatformHandler(platform, deps = {}) {
  switch (String(platform || 'node').toLowerCase()) {
    case 'vercel':
      return new VercelHandler(deps);
    case 'netlify':
      return new NetlifyHandler(deps);
    case 'cloudflare':
      return new CloudflareHandler(deps);
    case 'edgeone':
      return new EdgeoneHandler(deps);
    case 'node':
    default:
      return new NodeHandler(deps);
  }
}

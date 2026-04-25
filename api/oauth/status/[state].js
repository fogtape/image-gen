import { dispatchToNodeServer } from '../../_node-server-adapter.js';

export default function handler(req, res) {
  const state = typeof req.query?.state === 'string' ? req.query.state : '';
  const suffix = state ? `/${encodeURIComponent(state)}` : '';
  return dispatchToNodeServer(req, res, `/api/oauth/status${suffix}`);
}

import { dispatchToNodeServer } from '../../../vercel-node-server-adapter.js';
import { assertOAuthBodySize } from '../../../oauth-request-limits.js';

export default function handler(req, res) {
  // Validate request body size before dispatching to Node server
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  try {
    assertOAuthBodySize(rawBody);
  } catch (e) {
    res.status(413).json({ error: e.message || '请求体过大' });
    return;
  }

  return dispatchToNodeServer(req, res, '/api/oauth/images/stream');
}

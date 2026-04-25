import { dispatchToNodeServer } from '../_node-server-adapter.js';

export default function handler(req, res) {
  return dispatchToNodeServer(req, res, '/api/oauth/test');
}

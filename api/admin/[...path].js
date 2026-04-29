import { dispatchToNodeServer } from '../../vercel-node-server-adapter.js';

export default function handler(req, res) {
  return dispatchToNodeServer(req, res);
}

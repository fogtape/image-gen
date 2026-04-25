import { server } from '../server.js';

export default function handler(req, res) {
  return server.emit('request', req, res);
}

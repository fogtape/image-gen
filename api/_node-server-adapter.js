import { server } from '../server.js';

export function dispatchToNodeServer(req, res, forcedPath = '') {
  if (req.body !== undefined) {
    const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    req[Symbol.asyncIterator] = async function* requestBodyIterator() {
      yield Buffer.from(bodyText);
    };
  }
  if (forcedPath) {
    const originalUrl = typeof req.url === 'string' ? req.url : '';
    const query = originalUrl.includes('?') ? originalUrl.slice(originalUrl.indexOf('?')) : '';
    req.url = `${forcedPath}${query}`;
  }
  return server.emit('request', req, res);
}

import { getProxyAllowedHosts, isExplicitLocalDevProxyAllowed } from '../proxy-policy.js';
import { prepareProxyRequest, runProxyUpstream } from '../proxy-executor.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let prepared;
  try {
    prepared = prepareProxyRequest(req.body || {}, {
      allowedHosts: getProxyAllowedHosts(),
      allowLocalHttp: isExplicitLocalDevProxyAllowed(),
      allowMultipart: false,
    });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || 'Proxy request is invalid' });
  }

  try {
    const result = await runProxyUpstream(prepared, {
      onStreamStart: ({ status, contentType }) => {
        res.status(status);
        res.setHeader('Content-Type', contentType || 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
      },
      onStreamChunk: (chunk) => res.write(chunk),
    });
    if (result.stream) {
      res.end();
    } else {
      res.setHeader('Content-Type', result.contentType || 'application/json');
      res.status(result.status).send(result.body);
    }
  } catch (e) {
    if (res.headersSent) return res.end();
    res.status(e.status || 502).json({ error: e.message || 'Proxy upstream request failed' });
  }
}

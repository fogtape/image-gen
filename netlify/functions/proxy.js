import { getProxyAllowedHosts, isExplicitLocalDevProxyAllowed } from '../../proxy-policy.js';
import { prepareProxyRequest, runProxyUpstream } from '../../proxy-executor.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  let prepared;
  try {
    prepared = prepareProxyRequest(parsed, {
      allowedHosts: getProxyAllowedHosts(),
      allowLocalHttp: isExplicitLocalDevProxyAllowed(),
      allowMultipart: false,
    });
  } catch (e) {
    return { statusCode: e.status || 400, body: JSON.stringify({ error: e.message || 'Proxy request is invalid' }) };
  }

  try {
    const result = await runProxyUpstream(prepared);
    return {
      statusCode: result.status,
      headers: { 'Content-Type': result.contentType || 'application/json' },
      body: result.body || '',
    };
  } catch (e) {
    return { statusCode: e.status || 502, body: JSON.stringify({ error: e.message || 'Proxy upstream request failed' }) };
  }
}

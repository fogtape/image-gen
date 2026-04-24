export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const { url, method, headers, body } = JSON.parse(event.body);
  if (!url) return { statusCode: 400, body: JSON.stringify({ error: 'Missing url' }) };

  const fetchMethod = (method || 'POST').toUpperCase();

  try {
    const opts = { method: fetchMethod, headers: { ...headers } };
    if (fetchMethod !== 'GET' && body != null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(url, opts);
    const data = await resp.text();
    return {
      statusCode: resp.status,
      headers: { 'Content-Type': resp.headers.get('content-type') || 'application/json' },
      body: data,
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}

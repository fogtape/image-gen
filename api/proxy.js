export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, method, headers, body } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const fetchMethod = (method || 'POST').toUpperCase();

  try {
    const opts = { method: fetchMethod, headers: { ...headers } };
    if (fetchMethod !== 'GET' && body != null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(url, opts);
    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } else {
      const data = await resp.text();
      res.setHeader('Content-Type', contentType || 'application/json');
      res.status(resp.status).send(data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

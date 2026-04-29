import { handleOAuthImageRequestBody } from '../../openai-oauth-image.js';
import { applyVercelCors } from '../_cors.js';

export default async function handler(req, res) {
  applyVercelCors(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = await handleOAuthImageRequestBody(req.body || {});
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(data);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({ error: e.message || 'OAuth image generation failed' });
  }
}

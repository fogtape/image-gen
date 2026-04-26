import fs from 'fs';
import path from 'path';
const baseUrl = fs.readFileSync(path.join(process.cwd(), '.tmp_test_base_url'), 'utf8').trim().replace(/\/+$/, '');
const apiKey = fs.readFileSync(path.join(process.cwd(), '.tmp_test_api_key'), 'utf8').trim();

async function main() {
  const prompt = 'A minimal flat illustration of a blue cat face icon on white background';
  const genResp = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      size: '1024x1024',
      quality: 'low',
      output_format: 'png',
      background: 'opaque',
    }),
  });
  const genText = await genResp.text();
  console.log('GEN_STATUS', genResp.status);
  console.log('GEN_BODY', genText.slice(0, 1200));
}
main().catch((e) => { console.error('FATAL', e?.stack || e); process.exit(1); });

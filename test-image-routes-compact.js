import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const baseUrl = fs.readFileSync(path.join(cwd, '.tmp_test_base_url'), 'utf8').trim().replace(/\/+$/, '');
const apiKey = fs.readFileSync(path.join(cwd, '.tmp_test_api_key'), 'utf8').trim();

function makePng1x1Base64() {
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yh9sAAAAASUVORK5CYII=';
}

async function readSummary(resp) {
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return {
    status: resp.status,
    ok: resp.ok,
    hasB64: !!parsed?.data?.[0]?.b64_json,
    errorCode: parsed?.code || parsed?.error?.code || '',
    errorMessage: parsed?.message || parsed?.error?.message || text.slice(0, 300),
  };
}

async function testGenerations() {
  const resp = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: 'A simple blue geometric cat face icon on white background',
      size: '1024x1024',
      quality: 'low',
      output_format: 'png',
      background: 'opaque',
    }),
  });
  return { route: 'generations', ...(await readSummary(resp)) };
}

async function testEditsJson() {
  const image = `data:image/png;base64,${makePng1x1Base64()}`;
  const resp = await fetch(`${baseUrl}/v1/images/edits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      image: [image],
      prompt: 'Turn this tiny image into a clean blue square icon',
      size: '1024x1024',
      quality: 'low',
      output_format: 'png',
      background: 'opaque',
    }),
  });
  return { route: 'edits_json', ...(await readSummary(resp)) };
}

async function testEditsMultipart() {
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', 'Turn this tiny image into a clean blue square icon');
  form.append('size', '1024x1024');
  form.append('quality', 'low');
  form.append('output_format', 'png');
  form.append('background', 'opaque');
  form.append('image', new Blob([Buffer.from(makePng1x1Base64(), 'base64')], { type: 'image/png' }), 'tiny.png');
  const resp = await fetch(`${baseUrl}/v1/images/edits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: form,
  });
  return { route: 'edits_multipart', ...(await readSummary(resp)) };
}

for (const fn of [testGenerations, testEditsJson, testEditsMultipart]) {
  try {
    const result = await fn();
    console.log(JSON.stringify(result));
  } catch (e) {
    console.log(JSON.stringify({ route: fn.name, status: 0, ok: false, hasB64: false, errorCode: e?.code || e?.cause?.code || '', errorMessage: e?.message || String(e) }));
  }
}

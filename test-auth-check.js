import fs from 'fs';
import path from 'path';
const cwd = process.cwd();
const baseUrl = fs.readFileSync(path.join(cwd, '.tmp_test_base_url'), 'utf8').trim().replace(/\/+$/, '');
const apiKey = fs.readFileSync(path.join(cwd, '.tmp_test_api_key'), 'utf8').trim();
const resp = await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
const text = await resp.text();
console.log('STATUS', resp.status);
console.log('BODY', text.slice(0, 1200));

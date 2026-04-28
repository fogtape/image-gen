import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'dist');
const files = ['index.html', 'app.js', 'style.css', 'ui-feedback.js'];
const directories = ['frontend'];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(outDir, file));
}

for (const dir of directories) {
  const source = path.join(root, dir);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, path.join(outDir, dir), { recursive: true });
}

console.log(`Static build written to ${path.relative(root, outDir)}/`);

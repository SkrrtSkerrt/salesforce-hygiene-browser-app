import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const runtimeRoots = new Set(['index.html', 'src']);
const scannedExtensions = new Set(['.html', '.js', '.mjs', '.css', '.json']);
const deniedPatterns = [
  /fetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /EventSource/,
  /sendBeacon/,
  /serviceWorker\.register/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /https?:\/\//,
  /<form[^>]+action=/i,
  /<script[^>]+src=["']https?:/i,
  /<link[^>]+href=["']https?:/i,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const failures = [];
for (const file of walk(root)) {
  const rel = relative(root, file);
  const top = rel.split('/')[0];
  if (!runtimeRoots.has(top)) continue;
  const ext = file.slice(file.lastIndexOf('.'));
  if (!scannedExtensions.has(ext)) continue;
  const text = readFileSync(file, 'utf8');
  for (const pattern of deniedPatterns) {
    if (pattern.test(text)) failures.push(`${rel} matches ${pattern}`);
  }
}

if (failures.length) {
  console.error('Boundary check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Boundary check passed: no denied network/persistence patterns found.');

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const scannedExtensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.md', '.yml', '.yaml']);
const skippedDirs = new Set(['.git', 'node_modules']);

const split = (...parts) => parts.join('');
const deniedPatterns = [
  { label: 'local Linux home path', pattern: new RegExp(split('/', 'home', '/'), 'i') },
  { label: 'local Windows user path', pattern: new RegExp(split('C:', '\\\\', 'Users'), 'i') },
  { label: 'Salesforce org id', pattern: /\b00D[A-Za-z0-9]{12,15}\b/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { label: 'private key block', pattern: /BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY/ },
  { label: 'secret assignment', pattern: /\b(?:password|passwd|token|secret|client_secret|api_key)\b\s*[:=]\s*['\"]?[^\s'\"]{8,}/i },
  { label: 'private evidence directory', pattern: new RegExp(split('evi', 'dence/'), 'i') },
  { label: 'private milestone directory', pattern: new RegExp(split('mile', 'stones/'), 'i') },
  { label: 'private planning directory', pattern: new RegExp(split('plan', 'ning/'), 'i') },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
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
  if (!scannedExtensions.has(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  for (const { label, pattern } of deniedPatterns) {
    if (pattern.test(text)) failures.push(`${rel} matches ${label}`);
  }
}

if (failures.length) {
  console.error('Redaction/private-data sweep failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('redaction/private-data sweep passed');

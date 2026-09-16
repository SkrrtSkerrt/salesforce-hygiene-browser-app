import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const failures = [];

const requiredFiles = [
  'README.md',
  'index.html',
  'package.json',
  'docs/BOUNDARIES.md',
  'docs/PUBLIC_COPY.md',
  'docs/STATIC_SITE_INTEGRATION.md',
  'docs/LOCAL_PUBLICATION_PREP.md',
  '.github/ISSUE_TEMPLATE/browser-app-feedback.yml',
  'tests/static-boundary-check.mjs',
  'tests/test-public-copy.mjs',
  'tests/test-redaction-sweep.mjs',
];

for (const rel of requiredFiles) {
  if (!existsSync(join(root, rel))) failures.push(`missing required publication-prep file: ${rel}`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.private !== true) failures.push('package.json must remain private for local prep');
if (!String(pkg.version || '').includes('a5-local-prep')) failures.push('package version must mark A5 local prep');

const expectedFiles = ['.github/ISSUE_TEMPLATE/browser-app-feedback.yml', 'docs/', 'src/', 'tests/', 'index.html', 'README.md', 'package.json'];
for (const rel of expectedFiles) {
  if (!pkg.files?.includes(rel)) failures.push(`package files allowlist missing ${rel}`);
}

const deniedPackageEntries = [
  ['plan', 'ning/'].join(''),
  ['mile', 'stones/'].join(''),
  ['evi', 'dence/'].join(''),
  'backups/',
  '.env',
  'node_modules/',
];
for (const denied of deniedPackageEntries) {
  if (pkg.files?.includes(denied)) failures.push(`package files allowlist must not include ${denied}`);
}

const prepDoc = readFileSync(join(root, 'docs/LOCAL_PUBLICATION_PREP.md'), 'utf8');
for (const required of [
  'No public repo, push, publish, deploy',
  'local package dry run only',
  'independent read-only review',
  'A later exact gate must name the public action explicitly',
]) {
  if (!prepDoc.includes(required)) failures.push(`LOCAL_PUBLICATION_PREP missing required phrase: ${required}`);
}

const allowedTop = new Set(['.github', 'docs', 'src', 'tests', 'index.html', 'README.md', 'package.json']);
for (const entry of readdirSync(root)) {
  if (entry === '.git' || entry === 'node_modules') continue;
  if (!allowedTop.has(entry)) failures.push(`top-level entry not in public-prep allowlist: ${entry}`);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

for (const file of walk(root)) {
  const rel = relative(root, file);
  if (/^(?:planning|milestones|evidence|backups|raw|private)(?:\/|$)/i.test(rel)) {
    failures.push(`private-only path present in scaffold: ${rel}`);
  }
  if (/(?:^|\/)\.env(?:\.|$)/.test(rel)) failures.push(`env file present in scaffold: ${rel}`);
}

if (failures.length) {
  console.error('Publication prep check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('publication prep allowlist passed');

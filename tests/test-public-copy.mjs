import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = {
  publicCopy: 'docs/PUBLIC_COPY.md',
  staticPlan: 'docs/STATIC_SITE_INTEGRATION.md',
  issueTemplate: '.github/ISSUE_TEMPLATE/browser-app-feedback.yml',
  readme: 'README.md',
  index: 'index.html',
};

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const failures = [];
const publicCopy = read(files.publicCopy);
const staticPlan = read(files.staticPlan);
const issueTemplate = read(files.issueTemplate);
const readme = read(files.readme);
const index = read(files.index);

for (const [label, text] of Object.entries({ publicCopy, staticPlan, readme, index })) {
  for (const phrase of [
    'is a complete Salesforce security audit',
    'provides a compliance certification',
    'connects to your org',
    'official Salesforce',
    'upload your metadata',
    'submit your metadata',
    'paste your metadata',
    'powered by analytics',
  ]) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      failures.push(`${label} contains unsafe public claim/request: ${phrase}`);
    }
  }
}

for (const required of [
  'No Salesforce login',
  'No server upload',
  'No analytics',
  'No scan-data storage',
  'not upload metadata, reports, filenames, scan results, telemetry, or local labels',
  'Unsupported metadata is reported as Not Assessed',
]) {
  if (!publicCopy.includes(required)) failures.push(`PUBLIC_COPY missing required phrase: ${required}`);
}

for (const required of [
  'Public beta deployment is active on GitHub Pages',
  'No hosted upload endpoint',
  'No analytics script',
  'No query-string prefill from runtime state',
  'Secret/private-data scan before public commits',
]) {
  if (!staticPlan.includes(required)) failures.push(`STATIC_SITE_INTEGRATION missing required phrase: ${required}`);
}

for (const required of [
  'Do not paste metadata',
  'source code',
  'org IDs',
  'screenshots',
  'logs',
  'credentials',
  'tokens',
  'URLs',
  'report content',
  'filenames',
  'local paths',
  'I did not include metadata',
]) {
  if (!issueTemplate.includes(required)) failures.push(`issue template missing required warning: ${required}`);
}

for (const required of [
  'Try it: no Salesforce CLI needed',
  'Fictional_Blank_Description',
  'ask your Salesforce admin or dev team for a small ZIP containing ValidationRule metadata only',
  'Not Assessed means the file was recognized but no current browser rule ran on it',
]) {
  if (!index.includes(required)) failures.push(`index missing user walkthrough phrase: ${required}`);
}

if (/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|serviceWorker\.register|localStorage|sessionStorage|indexedDB/.test(index)) {
  failures.push('index.html contains denied runtime API pattern');
}

if (failures.length) {
  console.error('Public copy check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('public copy and feedback guardrails passed');

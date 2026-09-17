import assert from 'node:assert/strict';
import { classifyPath, extractZipEntryNames, summarizeCoverage } from '../src/file-classifier.js';

const unixAbsoluteFixture = ['/', 'home', '/josh/org/objects/Account/validationRules/Fictional.validationRule-meta.xml'].join('');
const windowsAbsoluteFixture = ['C:', '\\', 'Users', '\\Josh\\org\\objects\\Account\\validationRules\\Fictional.validationRule-meta.xml'].join('');

assert.equal(classifyPath('unpackaged/objects/Account/validationRules/Fictional.validationRule-meta.xml').status, 'Accepted');
assert.equal(classifyPath('unpackaged/objects/Account/fields/Fictional__c.field-meta.xml').metadataType, 'CustomField');
assert.equal(classifyPath('unpackaged/flows/Fictional.flow-meta.xml').metadataType, 'Flow');
assert.equal(classifyPath('force-app/main/default/classes/Fictional.cls').metadataType, 'ApexClass');
assert.equal(classifyPath('force-app/main/default/triggers/Fictional.trigger').metadataType, 'ApexTrigger');
assert.equal(classifyPath('objects/Account/fields/readme.txt').status, 'Unsupported');
assert.equal(classifyPath('objects/Account/validationRules/notes.txt').status, 'Unsupported');
assert.equal(classifyPath('force-app/main/default/classes/readme.txt').status, 'Unsupported');
assert.equal(classifyPath('force-app/main/default/flows/readme.txt').status, 'Unsupported');
assert.equal(classifyPath('objects/Account/fields/records.json').status, 'Not Assessed');
assert.equal(classifyPath('secret.zip').status, 'Rejected');
assert.equal(classifyPath('nested.zip', 'archive:outer.zip').status, 'Rejected');
assert.equal(classifyPath(unixAbsoluteFixture).status, 'Rejected');
assert.equal(classifyPath(windowsAbsoluteFixture).status, 'Rejected');
assert.equal(classifyPath(unixAbsoluteFixture).path, 'Fictional.validationRule-meta.xml');
assert.equal(classifyPath(windowsAbsoluteFixture).path, 'Fictional.validationRule-meta.xml');
assert.equal(classifyPath('../secret.env').status, 'Rejected');
assert.equal(classifyPath('../secret.env').path, 'secret.env');
assert.equal(classifyPath('/tmp/export/customers.csv').status, 'Rejected');
assert.equal(classifyPath('settings/Fictional.settings-meta.xml').status, 'Not Assessed');
assert.equal(classifyPath('readme.txt').status, 'Unsupported');

const coverage = [
  classifyPath('objects/Account/validationRules/Fictional.validationRule-meta.xml'),
  classifyPath('objects/Account/businessProcesses/Fictional.businessProcess-meta.xml'),
  classifyPath('debug.log'),
];
const summary = summarizeCoverage(coverage);
assert.equal(summary.counts.Accepted, 1);
assert.equal(summary.counts['Not Assessed'], 1);
assert.equal(summary.counts.Rejected, 1);

const zip = makeStoreZip([
  ['unpackaged/objects/Account/fields/Fictional__c.field-meta.xml', '<xml/>'],
  ['unpackaged/flows/Fictional.flow-meta.xml', '<xml/>'],
]);
assert.deepEqual(extractZipEntryNames(zip), [
  'unpackaged/objects/Account/fields/Fictional__c.field-meta.xml',
  'unpackaged/flows/Fictional.flow-meta.xml',
]);

const absoluteZip = makeStoreZip([
  [unixAbsoluteFixture, '<xml/>'],
  [windowsAbsoluteFixture, '<xml/>'],
]);
const absoluteEntries = extractZipEntryNames(absoluteZip);
assert.equal(absoluteEntries[0], unixAbsoluteFixture);
assert.equal(classifyPath(absoluteEntries[0], 'archive:absolute.zip').status, 'Rejected');
assert.equal(classifyPath(absoluteEntries[1], 'archive:absolute.zip').status, 'Rejected');
assert.equal(classifyPath(absoluteEntries[0], 'archive:absolute.zip').path, 'Fictional.validationRule-meta.xml');
assert.equal(classifyPath(absoluteEntries[1], 'archive:absolute.zip').path, 'Fictional.validationRule-meta.xml');

console.log('file classifier tests passed');

function makeStoreZip(entries) {
  const encoder = new TextEncoder();
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(text);
    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    fileParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return concat([...fileParts, ...centralParts, end]).buffer;
}

function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

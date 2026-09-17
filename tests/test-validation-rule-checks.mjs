import assert from 'node:assert/strict';
import { classifySelectedFiles } from '../src/scanner-adapter.js';
import { renderLimitations } from '../src/report-renderer.js';
import { evaluateValidationDescription } from '../src/validation-rule-checks.js';
import { makeZip } from './zip-fixtures.mjs';

const positiveXml = `<?xml version="1.0" encoding="UTF-8"?>
<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Fictional_Blank_Description</fullName>
  <active>true</active>
  <description>   </description>
  <errorConditionFormula>ISBLANK(Name)</errorConditionFormula>
  <errorMessage>Name is required</errorMessage>
</ValidationRule>`;
const linuxAbsoluteZipPath = ['/', 'home', '/fictional/org/objects/Account/validationRules/UnixAbsolute.validationRule-meta.xml'].join('');
const windowsAbsoluteZipPath = ['C:', '\\', 'Users', '\\Fictional\\org\\objects\\Account\\validationRules\\WindowsAbsolute.validationRule-meta.xml'].join('');

const negativeXml = `<ValidationRule><fullName>Fictional_With_Description</fullName><description>Clear business context.</description><errorMessage>Stop</errorMessage></ValidationRule>`;
const absentXml = `<ValidationRule><fullName>Fictional_Absent</fullName><errorMessage>Stop</errorMessage></ValidationRule>`;
const duplicateXml = `<ValidationRule><description></description><description></description><errorMessage>Stop</errorMessage></ValidationRule>`;
const surrogateXml = `<ValidationRule><errorMessage>Use this text only.</errorMessage></ValidationRule>`;
const nestedXml = `<ValidationRule><metadata><description></description></metadata><errorMessage>Stop</errorMessage></ValidationRule>`;
const malformedXml = `<ValidationRule><description></ValidationRule>`;

const positive = evaluateValidationDescription({
  path: 'objects/Account/validationRules/Fictional_Blank_Description.validationRule-meta.xml',
  source: 'selection',
  text: positiveXml,
});
assert.equal(positive.coverage.status, 'Finding');
assert.equal(positive.finding.ruleId, 'VALIDATION-001-BROWSER');
assert.equal(positive.finding.severity, 'low');
assert.equal(positive.finding.confidence, 'medium');
assert.equal(positive.finding.title, 'Validation rule missing description');
assert.equal(positive.finding.source.startLine, 5);
assert.equal(positive.finding.limitations.length, 1);
assert.deepEqual(positive, evaluateValidationDescription({
  path: 'objects/Account/validationRules/Fictional_Blank_Description.validationRule-meta.xml',
  source: 'selection',
  text: positiveXml,
}));

for (const [label, xml, status, reasonCode] of [
  ['negative', negativeXml, 'Assessed', 'description-present'],
  ['absent', absentXml, 'Not Assessed', 'description-field-unproven'],
  ['duplicate', duplicateXml, 'Not Assessed', 'ambiguous-description-field'],
  ['surrogate', surrogateXml, 'Not Assessed', 'description-field-unproven'],
  ['nested', nestedXml, 'Not Assessed', 'description-field-unproven'],
  ['malformed', malformedXml, 'Malformed input', 'malformed-validation-rule-xml'],
]) {
  const result = evaluateValidationDescription({ path: `objects/Account/validationRules/${label}.validationRule-meta.xml`, source: 'selection', text: xml });
  assert.equal(result.finding, null, label);
  assert.equal(result.coverage.status, status, label);
  assert.equal(result.coverage.reasonCode, reasonCode, label);
}

const zipEntry = evaluateValidationDescription({
  path: 'objects/Account/validationRules/Fictional.validationRule-meta.xml',
  source: 'archive:fictional.zip',
  text: positiveXml,
});
assert.equal(zipEntry.finding.ruleId, 'VALIDATION-001-BROWSER');
assert.equal(zipEntry.coverage.status, 'Finding');
assert.equal(zipEntry.coverage.reasonCode, 'blank-description');

const scanResult = await classifySelectedFiles([
  file('objects/Account/validationRules/Fictional_Blank_Description.validationRule-meta.xml', positiveXml),
  file('objects/Account/validationRules/Fictional_With_Description.validationRule-meta.xml', negativeXml),
  file('objects/Account/validationRules/notes.txt', 'not metadata'),
]);
assert.equal(scanResult.schemaVersion, 'browser-public-beta-result-v0');
assert.deepEqual(scanResult.rulesEvaluated, ['VALIDATION-001-BROWSER']);
assert.equal(scanResult.findings.length, 1);
assert.equal(scanResult.findings[0].title, 'Validation rule missing description');
assert.equal(scanResult.coverage.some((row) => row.status === 'Unsupported' && row.path.endsWith('notes.txt')), true);
assert.equal(scanResult.coverage.some((row) => row.ruleId === 'VALIDATION-001-BROWSER' && row.status === 'Finding'), true);
assert.equal(renderLimitations(scanResult).includes('public beta evaluates one browser ValidationRule XML check'), true);

const zipScanResult = await classifySelectedFiles([
  zipFile('fictional-metadata.zip', makeZip([
    {
      name: 'unpackaged/objects/Account/validationRules/Fictional_Zip_Blank.validationRule-meta.xml',
      text: positiveXml,
      method: 8,
    },
    {
      name: 'unpackaged/objects/Account/validationRules/Fictional_Zip_With_Description.validationRule-meta.xml',
      text: negativeXml,
      method: 8,
    },
    {
      name: 'unpackaged/objects/Account/validationRules/notes.txt',
      text: 'not metadata',
      method: 8,
    },
  ])),
]);
assert.equal(zipScanResult.findings.length, 1);
assert.equal(zipScanResult.findings[0].source.path, 'unpackaged/objects/Account/validationRules/Fictional_Zip_Blank.validationRule-meta.xml');
assert.equal(zipScanResult.coverage.some((row) => row.source === 'archive:fictional-metadata.zip' && row.status === 'Finding'), true);
assert.equal(zipScanResult.coverage.some((row) => row.source === 'archive:fictional-metadata.zip' && row.status === 'Assessed'), true);
assert.equal(zipScanResult.coverage.some((row) => row.status === 'Unsupported' && row.path.endsWith('notes.txt')), true);
assert.equal(renderLimitations(zipScanResult).includes('bounded ZIP content extraction'), true);

const blockedZipScanResult = await classifySelectedFiles([
  zipFile('blocked.zip', makeZip([
    {
      name: '../secrets/Fictional.validationRule-meta.xml',
      text: positiveXml,
      method: 8,
    },
    {
      name: linuxAbsoluteZipPath,
      text: positiveXml,
      method: 8,
    },
    {
      name: windowsAbsoluteZipPath,
      text: positiveXml,
      method: 8,
    },
    {
      name: 'unpackaged/objects/Account/validationRules/Big.validationRule-meta.xml',
      text: 'x'.repeat(1024 * 1024 + 1),
      method: 8,
    },
  ])),
]);
assert.equal(blockedZipScanResult.findings.length, 0);
assert.equal(blockedZipScanResult.coverage.some((row) => row.status === 'Rejected' && row.reason.includes('unsafe ZIP entry path')), true);
assert.equal(blockedZipScanResult.coverage.some((row) => row.status === 'Rejected' && row.reason.includes('Absolute-looking paths')), true);
assert.equal(blockedZipScanResult.coverage.some((row) => row.status === 'Not Assessed' && row.reason.includes('exceeds browser A7 per-entry content limit')), true);

const forgedZipScanResult = await classifySelectedFiles([
  zipFile('forged-size.zip', makeZip([
    {
      name: 'unpackaged/objects/Account/validationRules/ForgedSize.validationRule-meta.xml',
      text: 'x'.repeat(2 * 1024 * 1024),
      method: 8,
      declaredUncompressedSize: 1,
    },
  ])),
]);
assert.equal(forgedZipScanResult.findings.length, 0);
assert.equal(forgedZipScanResult.coverage.some((row) => row.status === 'Malformed input' && row.reason.includes('could not be extracted locally')), true);

const tooManyEntriesResult = await classifySelectedFiles([
  zipFile('too-many.zip', makeZip(Array.from({ length: 201 }, (_, index) => ({
    name: `unpackaged/objects/Account/validationRules/Entry_${index}.validationRule-meta.xml`,
    text: negativeXml,
    method: 8,
  })))),
]);
assert.equal(tooManyEntriesResult.findings.length, 0);
assert.equal(tooManyEntriesResult.coverage.some((row) => row.status === 'Rejected' && row.reason.includes('entry count limit')), true);

console.log('validation rule checks passed');

function file(name, text) {
  return {
    name,
    size: text.length,
    async text() { return text; },
  };
}

function zipFile(name, buffer) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer; },
  };
}

import assert from 'node:assert/strict';
import { classifySelectedFiles } from '../src/scanner-adapter.js';
import { renderLimitations } from '../src/report-renderer.js';
import { evaluateValidationDescription } from '../src/validation-rule-checks.js';

const positiveXml = `<?xml version="1.0" encoding="UTF-8"?>
<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Fictional_Blank_Description</fullName>
  <active>true</active>
  <description>   </description>
  <errorConditionFormula>ISBLANK(Name)</errorConditionFormula>
  <errorMessage>Name is required</errorMessage>
</ValidationRule>`;

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
assert.equal(zipEntry.finding, null);
assert.equal(zipEntry.coverage.status, 'Not Assessed');
assert.equal(zipEntry.coverage.reasonCode, 'zip-content-not-assessed');

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

console.log('validation rule checks passed');

function file(name, text) {
  return {
    name,
    size: text.length,
    async text() { return text; },
  };
}

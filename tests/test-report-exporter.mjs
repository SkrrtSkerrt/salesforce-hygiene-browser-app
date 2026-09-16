import assert from 'node:assert/strict';
import { buildHtmlReport, buildJsonReport, buildJsonReportText, createReportBlob, createReportFilename } from '../src/report-exporter.js';

const unixAbsoluteFixture = ['/', 'home', '/josh/org/objects/Account/validationRules/Fictional.validationRule-meta.xml'].join('');
const windowsAbsoluteFixture = ['C:', '\\', 'Users', '\\Josh\\org\\objects\\Account\\validationRules\\Fictional.validationRule-meta.xml'].join('');

const result = {
  schemaVersion: 'browser-a2-v0',
  processingModel: 'browser-only-no-upload',
  inputSummary: {
    selectedFileCount: 1,
    totalCoverageRows: 2,
    coverageCounts: { Accepted: 1, Finding: 1 },
  },
  rulesEvaluated: ['VALIDATION-001-BROWSER'],
  limitations: [
    'A2 evaluates one browser ValidationRule XML check against directly selected local files only.',
    'Browser VALIDATION-001 checks only selected local ValidationRule XML files with exactly one direct description element; review business intent manually.',
  ],
  findings: [{
    findingId: 'finding-test',
    ruleId: 'VALIDATION-001-BROWSER',
    severity: 'low',
    confidence: 'medium',
    title: 'Validation rule missing description',
    message: 'Validation rule Fictional has no description.',
    source: { path: '../objects/Account/validationRules/Fictional.validationRule-meta.xml', startLine: 5, endLine: 5 },
    limitations: ['Manual review required.'],
  }],
  coverage: [{
    status: 'Finding',
    ruleId: 'VALIDATION-001-BROWSER',
    path: '../objects/Account/validationRules/Fictional.validationRule-meta.xml',
    reasonCode: 'blank-description',
    reason: 'ValidationRule has exactly one direct blank description element.',
  }],
};

const json = buildJsonReport(result, { generatedAt: '2026-09-14T00:00:00.000Z' });
assert.equal(json.schema_version, 'browser-report-a3-v0');
assert.equal(json.tool_version, 'browser-a3-v0');
assert.equal(json.processing_model, 'browser-only-no-upload');
assert.equal(json.findings.length, 1);
assert.equal(json.findings[0].source.path, 'objects/Account/validationRules/Fictional.validationRule-meta.xml');
assert.equal(json.coverage[0].path, 'objects/Account/validationRules/Fictional.validationRule-meta.xml');
assert.equal(json.manifest.upload_model, 'no-server-upload');
assert.equal(json.manifest.persistence_model, 'in-memory-until-download');
assert.equal(json.manifest.customer_data_custody, 'none-by-app');

const jsonText = buildJsonReportText(result, { generatedAt: '2026-09-14T00:00:00.000Z' });
assert.equal(JSON.parse(jsonText).findings[0].rule_id, 'VALIDATION-001-BROWSER');
assert.equal(jsonText.includes('<ValidationRule>'), false);

const html = buildHtmlReport(result, { generatedAt: '2026-09-14T00:00:00.000Z' });
assert.equal(html.includes('Local processing statement'), true);
assert.equal(html.includes('Scope and limitations'), true);
assert.equal(html.indexOf('Scope and limitations') < html.indexOf('Findings'), true);
assert.equal(html.includes('does not upload files'), true);
assert.equal(html.includes('Validation rule missing description'), true);
assert.equal(html.includes('&lt;ValidationRule&gt;'), false);

const absoluteUnix = buildJsonReport({ ...result, findings: [{ ...result.findings[0], source: { path: unixAbsoluteFixture, startLine: 1, endLine: 1 } }], coverage: [] });
const absoluteWindows = buildJsonReport({ ...result, findings: [{ ...result.findings[0], source: { path: windowsAbsoluteFixture, startLine: 1, endLine: 1 } }], coverage: [] });
assert.equal(absoluteUnix.findings[0].source.path, 'Fictional.validationRule-meta.xml');
assert.equal(absoluteWindows.findings[0].source.path, 'Fictional.validationRule-meta.xml');

const jsonBlob = createReportBlob(result, 'json', { generatedAt: '2026-09-14T00:00:00.000Z' });
const htmlBlob = createReportBlob(result, 'html', { generatedAt: '2026-09-14T00:00:00.000Z' });
assert.equal(jsonBlob.type, 'application/json');
assert.equal(htmlBlob.type, 'text/html');
assert.equal(await jsonBlob.text(), jsonText);
assert.equal((await htmlBlob.text()).includes('Salesforce Hygiene Local Browser Report'), true);

assert.equal(createReportFilename('json', new Date('2026-09-14T00:00:00.000Z')), 'salesforce-hygiene-browser-report-2026-09-14T00-00-00-000Z.json');
assert.throws(() => createReportBlob(result, 'pdf'));

console.log('report exporter tests passed');

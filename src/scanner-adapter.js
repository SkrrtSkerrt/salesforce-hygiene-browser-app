import { classifyFiles } from './file-classifier.js';
import { evaluateValidationDescription, VALIDATION_001_BROWSER } from './validation-rule-checks.js';

export async function classifySelectedFiles(fileList) {
  const files = Array.from(fileList || []);
  const classification = await classifyFiles(files);
  const ruleResults = await runBrowserRules(files, classification.coverage);
  const findings = ruleResults.map((result) => result.finding).filter(Boolean);
  const ruleCoverage = ruleResults.map((result) => result.coverage).filter(Boolean);
  const coverage = [...classification.coverage, ...ruleCoverage];
  const counts = countStatuses(coverage);

  return {
    schemaVersion: 'browser-public-beta-result-v0',
    processingModel: 'browser-only-no-upload',
    inputSummary: {
      selectedFileCount: classification.selectedEntryCount,
      totalCoverageRows: coverage.length,
      coverageCounts: counts,
    },
    rulesEvaluated: [VALIDATION_001_BROWSER.ruleId],
    findings,
    coverage,
    limitations: [
      'The public beta evaluates one browser ValidationRule XML check against directly selected local files only.',
      'ZIP entries remain classification-only until a separately authorized decompression slice.',
      'Unsupported files become coverage rows instead of silent omissions.',
      VALIDATION_001_BROWSER.limitation,
    ],
  };
}

export function createEmptyScanResult({ fileCount = 0 } = {}) {
  return {
    schemaVersion: 'browser-public-beta-v0',
    processingModel: 'browser-only-no-upload',
    inputSummary: {
      selectedFileCount: fileCount,
      totalCoverageRows: 0,
      coverageCounts: {},
    },
    rulesEvaluated: [],
    findings: [],
    coverage: [],
    limitations: [
      'No local files have been classified yet.',
      'Use fictional fixtures when testing the public beta.',
    ],
  };
}

async function runBrowserRules(files, coverageRows) {
  const byPath = new Map(files.map((file) => [file.webkitRelativePath || file.name, file]));
  const results = [];

  for (const row of coverageRows) {
    if (row.metadataType !== 'ValidationRule') continue;
    if (row.source !== 'selection') {
      results.push(evaluateValidationDescription({ path: row.path, source: row.source, text: '' }));
      continue;
    }
    const file = byPath.get(row.path);
    if (!file) continue;
    const text = await file.text();
    results.push(evaluateValidationDescription({ path: row.path, source: row.source, text }));
  }

  return results;
}

function countStatuses(coverage) {
  const counts = {};
  for (const row of coverage) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

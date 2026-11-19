import { classifyFiles } from './file-classifier.js';
import { evaluateValidationDescription, VALIDATION_001_BROWSER } from './validation-rule-checks.js';

export async function classifySelectedFiles(fileList) {
  const files = Array.from(fileList || []);
  const classification = await classifyFiles(files);
  const ruleResults = await runBrowserRules(files, classification.coverage, classification.archiveTextEntries || []);
  const findings = ruleResults.map((result) => result.finding).filter(Boolean);
  const ruleCoverage = ruleResults.map((result) => result.coverage).filter(Boolean);
  const scanClassification = classification.coverage.map((row) => {
    if (row.status !== 'Accepted') return row;
    const eligible = row.metadataType === 'ValidationRule';
    return {
      ...row,
      classificationStatus: 'Accepted',
      status: eligible ? 'Accepted' : 'Not Assessed',
      reason: eligible
        ? 'Input classified as eligible ValidationRule metadata; see separate rule outcome coverage.'
        : 'Recognized metadata type has no browser rule implementation.',
    };
  });
  const coverage = [...scanClassification, ...ruleCoverage];
  const counts = countStatuses(coverage);

  return {
    schemaVersion: 'browser-public-beta-result-v0',
    processingModel: 'browser-only-no-upload',
    inputSummary: {
      selectedFileCount: classification.selectedEntryCount,
      totalCoverageRows: coverage.length,
      coverageCounts: counts,
      zipUsage: classification.zipUsage,
      // Classification counts are not counts of assessed metadata.
      classificationCounts: classification.counts,
      ruleOutcomeCounts: countStatuses(ruleCoverage.filter((row) => row.ruleId)),
    },
    rulesEvaluated: [...new Set(ruleCoverage.map((row) => row.ruleId).filter(Boolean))],
    findings,
    coverage,
    limitations: [
      'The public beta evaluates one browser ValidationRule XML check against directly selected local files and bounded client-side ZIP entries.',
      'Client-only bounded ZIP content extraction has both per-archive and selection-wide budgets for archive count/bytes, inspected entries, and extracted text; only safe relative paths are eligible.',
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

async function runBrowserRules(files, coverageRows, archiveTextEntries) {
  // Selection coverage preserves FileList order. Pair before filtering so a
  // rejected raw alias cannot overwrite an accepted normalized path's File.
  const selectedRows = coverageRows.filter((row) => row.source === 'selection');
  const byPath = new Map(selectedRows.flatMap((row, index) => (
    row.status === 'Accepted' ? [[row.path, files[index]]] : []
  )));
  const archiveTextBySourcePath = new Map(archiveTextEntries.map((entry) => [`${entry.source}\u0000${entry.path}`, entry.text]));
  const results = [];

  for (const row of coverageRows) {
    if (row.status !== 'Accepted' || row.metadataType !== 'ValidationRule') continue;
    if (row.source !== 'selection') {
      const text = archiveTextBySourcePath.get(`${row.source}\u0000${row.path}`);
      if (typeof text !== 'string') continue;
      results.push(evaluateValidationDescription({ path: row.path, source: row.source, text }));
      continue;
    }
    const file = byPath.get(row.path);
    if (!file) continue;
    try {
      const bytes = await file.arrayBuffer();
      if (!(bytes instanceof ArrayBuffer)) throw new TypeError('Expected file bytes');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      results.push(evaluateValidationDescription({ path: row.path, source: row.source, text }));
    } catch {
      results.push({ finding: null, coverage: { path: row.path, source: row.source, metadataType: row.metadataType, status: 'Not Assessed', reasonCode: 'content-read-or-utf8-failed', reason: 'Local file bytes could not be read or decoded as strict UTF-8.' } });
    }
  }

  return results;
}

function countStatuses(coverage) {
  const counts = {};
  for (const row of coverage) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

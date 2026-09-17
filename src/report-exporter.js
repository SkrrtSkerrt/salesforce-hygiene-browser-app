const TOOL_VERSION = 'browser-a7-v0';
const REPORT_SCHEMA_VERSION = 'browser-report-a3-v0'; // A7 keeps the A3 report shape for compatible local downloads.

export function buildJsonReport(result, { generatedAt = new Date().toISOString() } = {}) {
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    generated_at_local: generatedAt,
    processing_model: result.processingModel,
    input_summary: clonePlain(result.inputSummary || {}),
    rules_evaluated: [...(result.rulesEvaluated || [])],
    limitations: [...(result.limitations || [])],
    findings: (result.findings || []).map((finding) => ({
      finding_id: finding.findingId,
      rule_id: finding.ruleId,
      title: finding.title,
      severity: finding.severity,
      confidence: finding.confidence,
      message: finding.message,
      source: {
        path: sanitizeReportPath(finding.source?.path),
        start_line: finding.source?.startLine ?? 1,
        end_line: finding.source?.endLine ?? finding.source?.startLine ?? 1,
      },
      limitations: [...(finding.limitations || [])],
    })),
    coverage: (result.coverage || []).map((row) => ({
      status: row.status,
      rule_id: row.ruleId || null,
      metadata_type: row.metadataType || null,
      path: sanitizeReportPath(row.path),
      reason_code: row.reasonCode || null,
      reason: row.reason || '',
    })),
    manifest: {
      exported_by: 'static-browser-app',
      upload_model: 'no-server-upload',
      persistence_model: 'in-memory-until-download',
      customer_data_custody: 'none-by-app',
    },
  };
}

export function buildJsonReportText(result, options = {}) {
  return `${JSON.stringify(buildJsonReport(result, options), null, 2)}\n`;
}

export function buildHtmlReport(result, options = {}) {
  const report = buildJsonReport(result, options);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Salesforce Hygiene Local Browser Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.45; color: #1b1f24; }
    h1, h2 { line-height: 1.1; }
    table { width: 100%; border-collapse: collapse; margin-block: 1rem; }
    th, td { border: 1px solid #ccd3da; padding: .5rem; text-align: left; vertical-align: top; }
    th { background: #eef3f6; }
    .boundary { border: 2px solid #227a4d; padding: 1rem; background: #eefaf3; }
    .muted { color: #52606d; }
    .finding { border: 1px solid #d9a441; padding: 1rem; margin-block: 1rem; background: #fff8e6; }
  </style>
</head>
<body>
  <h1>Salesforce Hygiene Local Browser Report</h1>
  <section class="boundary">
    <h2>Local processing statement</h2>
    <p>This report was generated in a static browser app. The MVP does not upload files, reports, or scan results to a server.</p>
    <p class="muted">Processing model: ${escapeHtml(report.processing_model)}</p>
  </section>
  <section>
    <h2>Scope and limitations</h2>
    ${renderList(report.limitations)}
  </section>
  <section>
    <h2>Summary</h2>
    <ul>
      <li>Selected files: ${escapeHtml(report.input_summary.selectedFileCount ?? 0)}</li>
      <li>Coverage rows: ${escapeHtml(report.input_summary.totalCoverageRows ?? 0)}</li>
      <li>Findings: ${escapeHtml(report.findings.length)}</li>
      <li>Rules evaluated: ${escapeHtml(report.rules_evaluated.join(', ') || 'none')}</li>
    </ul>
  </section>
  <section>
    <h2>Coverage</h2>
    ${renderCoverage(report.coverage)}
  </section>
  <section>
    <h2>Findings</h2>
    ${renderFindings(report.findings)}
  </section>
  <section>
    <h2>Version and provenance</h2>
    <pre>${escapeHtml(JSON.stringify(report.manifest, null, 2))}</pre>
  </section>
</body>
</html>
`;
}

export function createReportBlob(result, format, options = {}) {
  if (format === 'json') {
    return new Blob([buildJsonReportText(result, options)], { type: 'application/json' });
  }
  if (format === 'html') {
    return new Blob([buildHtmlReport(result, options)], { type: 'text/html' });
  }
  throw new Error(`Unsupported report format: ${format}`);
}

export function createReportFilename(format, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `salesforce-hygiene-browser-report-${stamp}.${format}`;
}

export function downloadReport(result, format) {
  const blob = createReportBlob(result, format);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = createReportFilename(format);
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderCoverage(rows) {
  if (!rows.length) return '<p>No coverage rows.</p>';
  const body = rows.map((row) => `<tr><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.rule_id || row.metadata_type || '-')}</td><td>${escapeHtml(row.path)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('');
  return `<table><thead><tr><th>Status</th><th>Type / Rule</th><th>Entry</th><th>Reason</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderFindings(findings) {
  if (!findings.length) return '<p>No findings. Coverage and limitations still apply.</p>';
  return findings.map((finding) => `<article class="finding"><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.message)}</p><p>${escapeHtml(finding.severity)} / ${escapeHtml(finding.confidence)} - ${escapeHtml(finding.source.path)}:${escapeHtml(finding.source.start_line)}</p>${renderList(finding.limitations)}</article>`).join('');
}

function renderList(items) {
  if (!items.length) return '<p>No limitations recorded.</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function sanitizeReportPath(value) {
  const text = String(value || '');
  const normalized = text.replaceAll('\\', '/');
  if (text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(text) || normalized.startsWith('home/') || /^[A-Za-z]:\/Users\//i.test(normalized)) {
    return normalized.split('/').filter(Boolean).pop() || 'unknown-entry';
  }
  return normalized
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

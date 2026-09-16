export function renderSummary(result) {
  const counts = result.inputSummary.coverageCounts || {};
  const countText = Object.keys(counts).length
    ? Object.entries(counts).map(([label, count]) => `${label}: ${count}`).join(', ')
    : 'none';
  return [
    `Processing model: ${result.processingModel}`,
    `Selected files: ${result.inputSummary.selectedFileCount}`,
    `Coverage rows: ${result.inputSummary.totalCoverageRows}`,
    `Rules: ${(result.rulesEvaluated || []).join(', ') || 'none'}`,
    `Findings: ${result.findings.length}`,
    `Coverage counts: ${countText}`,
  ].join(' | ');
}

export function renderLimitations(result) {
  const limitations = result.limitations || [];
  if (!limitations.length) {
    return '<p class="muted">No run limitations yet.</p>';
  }
  return `<ul>${limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function renderCoverageRows(result) {
  if (!result.coverage.length) {
    return '<p class="muted">No coverage rows yet.</p>';
  }

  const rows = result.coverage.map((row) => `
    <tr>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.ruleId || row.metadataType || '-')}</td>
      <td>${escapeHtml(row.path)}</td>
      <td>${escapeHtml(row.reason || row.reasonCode || '')}</td>
    </tr>`).join('');

  return `
    <table>
      <thead>
        <tr><th>Status</th><th>Type / Rule</th><th>Entry</th><th>Reason</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderFindings(result) {
  if (!result.findings.length) {
    return '<p class="muted">No findings. Coverage and limitations still apply.</p>';
  }

  const items = result.findings.map((finding) => `
    <article class="finding">
      <h3>${escapeHtml(finding.title)}</h3>
      <p>${escapeHtml(finding.message)}</p>
      <p><strong>${escapeHtml(finding.severity)}</strong> / ${escapeHtml(finding.confidence)} - ${escapeHtml(finding.source.path)}:${finding.source.startLine}</p>
      <p class="muted">${escapeHtml(finding.limitations.join(' '))}</p>
    </article>`).join('');
  return items;
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

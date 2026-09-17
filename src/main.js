import { downloadReport } from './report-exporter.js';
import { classifySelectedFiles, createEmptyScanResult } from './scanner-adapter.js';
import { renderCoverageRows, renderFindings, renderLimitations, renderSummary } from './report-renderer.js';

const fileInput = document.querySelector('#metadataFiles');
const folderInput = document.querySelector('#metadataFolder');
const summary = document.querySelector('#fileSummary');
const status = document.querySelector('#scanStatus');
const limitations = document.querySelector('#limitationsRows');
const coverage = document.querySelector('#coverageRows');
const findings = document.querySelector('#findingsRows');
const downloadJson = document.querySelector('#downloadJson');
const downloadHtml = document.querySelector('#downloadHtml');
let currentResult = createEmptyScanResult();

function render(result) {
  currentResult = result;
  const hasRun = result.schemaVersion !== 'browser-public-beta-v0' && (result.coverage.length || result.findings.length);
  status.textContent = renderSummary(result);
  limitations.innerHTML = renderLimitations(result);
  coverage.innerHTML = renderCoverageRows(result);
  findings.innerHTML = renderFindings(result);
  if (downloadJson) downloadJson.disabled = !hasRun;
  if (downloadHtml) downloadHtml.disabled = !hasRun;
}

async function handleSelection(input) {
  const files = Array.from(input.files || []);
  if (!files.length) {
    summary.textContent = 'No files selected.';
    render(createEmptyScanResult());
    return;
  }

  summary.textContent = `${files.length} local file${files.length === 1 ? '' : 's'} selected. Classifying and applying browser beta checks locally in this browser tab.`;
  const result = await classifySelectedFiles(files);
  render(result);
}

fileInput?.addEventListener('change', () => handleSelection(fileInput));
folderInput?.addEventListener('change', () => handleSelection(folderInput));
downloadJson?.addEventListener('click', () => downloadReport(currentResult, 'json'));
downloadHtml?.addEventListener('click', () => downloadReport(currentResult, 'html'));

render(createEmptyScanResult());

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
let currentResult = null;
let pending = false;
let selectionGeneration = 0;

function canDownload() {
  return !pending && currentResult !== null
    && currentResult.schemaVersion !== 'browser-public-beta-v0'
    && (currentResult.coverage.length > 0 || currentResult.findings.length > 0);
}

function render(result) {
  status.textContent = renderSummary(result);
  limitations.innerHTML = renderLimitations(result);
  coverage.innerHTML = renderCoverageRows(result);
  findings.innerHTML = renderFindings(result);
  if (downloadJson) downloadJson.disabled = !canDownload();
  if (downloadHtml) downloadHtml.disabled = !canDownload();
}

async function handleSelection(input) {
  // Both inputs share one generation: a selection or clear supersedes all older work.
  const generation = ++selectionGeneration;
  currentResult = null;
  pending = false;
  render(createEmptyScanResult());

  const files = Array.from(input.files || []);
  if (!files.length) {
    summary.textContent = 'No files selected.';
    status.textContent = 'No files selected.';
    return;
  }

  pending = true;
  summary.textContent = `${files.length} local file${files.length === 1 ? '' : 's'} selected. Classifying and applying browser beta checks locally in this browser tab.`;
  status.textContent = 'Processing local files. Please wait; report downloads are unavailable until this scan completes.';
  try {
    const result = await classifySelectedFiles(files);
    if (generation !== selectionGeneration) return;
    pending = false;
    currentResult = result;
    render(result);
    status.textContent = `Scan complete. ${renderSummary(result)}`;
  } catch {
    if (generation !== selectionGeneration) return;
    pending = false;
    currentResult = null;
    render(createEmptyScanResult());
    status.textContent = 'Unable to complete the local scan. No report is available. Select files again to retry.';
  }
}

function handleDownload(format) {
  if (!canDownload()) return;
  downloadReport(currentResult, format);
}

fileInput?.addEventListener('change', () => handleSelection(fileInput));
folderInput?.addEventListener('change', () => handleSelection(folderInput));
downloadJson?.addEventListener('click', () => handleDownload('json'));
downloadHtml?.addEventListener('click', () => handleDownload('html'));

render(createEmptyScanResult());

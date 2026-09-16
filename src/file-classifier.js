const SUPPORTED_METADATA = [
  { kind: 'ValidationRule', detail: 'Validation rule metadata XML', match: (path) => path.endsWith('.validationrule-meta.xml') },
  { kind: 'CustomField', detail: 'Custom field metadata XML', match: (path) => path.endsWith('.field-meta.xml') },
  { kind: 'Flow', detail: 'Flow metadata XML', match: (path) => path.endsWith('.flow-meta.xml') },
  { kind: 'ApexClass', detail: 'Apex class source or metadata', match: (path) => path.endsWith('.cls') || path.endsWith('.cls-meta.xml') },
  { kind: 'ApexTrigger', detail: 'Apex trigger source or metadata', match: (path) => path.endsWith('.trigger') || path.endsWith('.trigger-meta.xml') },
];

const MAX_ZIP_INSPECTION_BYTES = 10 * 1024 * 1024;

const SENSITIVE_MARKERS = [
  '.sfdx-url',
  '.env',
  '.pem',
  '.key',
  'credential',
  'password',
  'secret',
  'session',
  'token',
  'cookie',
  'auth',
];

const CUSTOMER_DATA_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls', '.jsonl', '.log']);
const ZIP_EXTENSION = '.zip';

export function sanitizeEntryName(name) {
  return String(name || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

export function classifyPath(rawName, source = 'selection') {
  if (isAbsoluteLikePath(rawName)) {
    return makeCoverage(rawName || '(empty)', source, 'Rejected', 'Absolute-looking paths are outside browser scope');
  }
  const name = sanitizeEntryName(rawName);
  const lower = name.toLowerCase();
  const basename = lower.split('/').pop() || lower;
  const extension = basename.includes('.') ? basename.slice(basename.lastIndexOf('.')) : '';

  if (!name) {
    return makeCoverage(rawName || '(empty)', source, 'Rejected', 'Empty or unsafe path');
  }

  if (SENSITIVE_MARKERS.some((marker) => lower.includes(marker))) {
    return makeCoverage(name, source, 'Rejected', 'Sensitive/auth-like filename rejected before scanning');
  }

  if (lower.endsWith(ZIP_EXTENSION)) {
    if (String(source).startsWith('archive:')) {
      return makeCoverage(name, source, 'Rejected', 'Nested ZIP archive is outside browser A1 scope');
    }
    return makeCoverage(name, source, 'Archive', 'ZIP archive selected for local entry classification');
  }

  if (CUSTOMER_DATA_EXTENSIONS.has(extension)) {
    return makeCoverage(name, source, 'Rejected', 'Customer-data-like or log file extension is outside metadata scope');
  }

  const supported = SUPPORTED_METADATA.find((candidate) => candidate.match(lower));
  if (supported) {
    return makeCoverage(name, source, 'Accepted', supported.detail, supported.kind);
  }

  if (extension === '.xml' || extension === '.json' || extension === '.js' || extension === '.page' || extension === '.component') {
    return makeCoverage(name, source, 'Not Assessed', 'Metadata-like file is not supported in browser A1');
  }

  return makeCoverage(name, source, 'Unsupported', 'File type is outside browser A1 classification scope');
}

export async function classifyFiles(fileList) {
  const files = Array.from(fileList || []);
  const coverage = [];
  const archives = [];

  for (const file of files) {
    const relativeName = file.webkitRelativePath || file.name;
    const base = classifyPath(relativeName, 'selection');
    coverage.push(base);

    if (base.status === 'Archive') {
      if (archiveSize(file) > MAX_ZIP_INSPECTION_BYTES) {
        coverage.push(makeCoverage(relativeName, 'archive', 'Rejected', 'ZIP archive exceeds browser A1 inspection size limit'));
        continue;
      }
      archives.push({ file, relativeName });
    }
  }

  for (const archive of archives) {
    try {
      const buffer = await archive.file.arrayBuffer();
      const entries = extractZipEntryNames(buffer);
      if (!entries.length) {
        coverage.push(makeCoverage(archive.relativeName, 'archive', 'Malformed input', 'ZIP archive has no readable central-directory entries'));
        continue;
      }
      for (const entryName of entries) {
        coverage.push(classifyPath(entryName, `archive:${sanitizeEntryName(archive.relativeName)}`));
      }
    } catch (error) {
      coverage.push(makeCoverage(archive.relativeName, 'archive', 'Malformed input', 'ZIP archive could not be inspected locally'));
    }
  }

  return summarizeCoverage(coverage);
}

export function summarizeCoverage(coverage) {
  const counts = {};
  for (const row of coverage) counts[row.status] = (counts[row.status] || 0) + 1;
  return {
    selectedEntryCount: coverage.filter((row) => row.source === 'selection').length,
    totalCoverageRows: coverage.length,
    counts,
    coverage,
  };
}

export function extractZipEntryNames(input) {
  const bytes = input instanceof ArrayBuffer
    ? input
    : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const view = new DataView(bytes);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) return [];

  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (centralDirectoryOffset + centralDirectorySize > view.byteLength) return [];

  const names = [];
  let offset = centralDirectoryOffset;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  while (offset + 46 <= centralDirectoryOffset + centralDirectorySize) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > view.byteLength) break;
    const name = decoder.decode(new Uint8Array(bytes, nameStart, nameLength));
    if (name && !name.endsWith('/')) names.push(name);
    offset = nameEnd + extraLength + commentLength;
  }

  return names.filter(Boolean);
}

function findEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

function makeCoverage(path, source, status, reason, metadataType = null) {
  return {
    path: sanitizeEntryName(path),
    source,
    status,
    metadataType,
    reason,
  };
}

function archiveSize(file) {
  return Number.isFinite(file?.size) ? file.size : 0;
}

function isAbsoluteLikePath(value) {
  const text = String(value || '');
  return text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(text);
}

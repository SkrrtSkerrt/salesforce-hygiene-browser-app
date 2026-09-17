const SUPPORTED_METADATA = [
  { kind: 'ValidationRule', detail: 'Validation rule metadata XML', match: (path) => path.endsWith('.validationrule-meta.xml') },
  { kind: 'CustomField', detail: 'Custom field metadata XML', match: (path) => path.endsWith('.field-meta.xml') },
  { kind: 'Flow', detail: 'Flow metadata XML', match: (path) => path.endsWith('.flow-meta.xml') },
  { kind: 'ApexClass', detail: 'Apex class source or metadata', match: (path) => path.endsWith('.cls') || path.endsWith('.cls-meta.xml') },
  { kind: 'ApexTrigger', detail: 'Apex trigger source or metadata', match: (path) => path.endsWith('.trigger') || path.endsWith('.trigger-meta.xml') },
];

const MAX_ZIP_INSPECTION_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRY_COUNT = 200;
const MAX_ZIP_ENTRY_CONTENT_BYTES = 1024 * 1024;
const MAX_ZIP_TOTAL_CONTENT_BYTES = 4 * 1024 * 1024;

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

export function sanitizeRejectedEntryName(name) {
  const sanitized = sanitizeEntryName(name);
  return sanitized.split('/').filter(Boolean).pop() || 'rejected-entry';
}

export function classifyPath(rawName, source = 'selection') {
  if (isAbsoluteLikePath(rawName)) {
    return makeCoverage(sanitizeRejectedEntryName(rawName), source, 'Rejected', 'Absolute-looking paths are outside browser scope');
  }
  if (hasTraversalSegment(rawName)) {
    const reason = String(source).startsWith('archive:')
      ? 'Rejected unsafe ZIP entry path before scanning'
      : 'Rejected unsafe relative path before scanning';
    return makeCoverage(sanitizeRejectedEntryName(rawName), source, 'Rejected', reason);
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
      return makeCoverage(name, source, 'Rejected', 'Nested ZIP archive is outside browser A7 scope');
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
    return makeCoverage(name, source, 'Not Assessed', 'Metadata-like file is not supported in the browser beta');
  }

  return makeCoverage(name, source, 'Unsupported', 'File type is outside browser beta classification scope');
}

export async function classifyFiles(fileList) {
  const files = Array.from(fileList || []);
  const coverage = [];
  const archives = [];
  const archiveTextEntries = [];

  for (const file of files) {
    const relativeName = file.webkitRelativePath || file.name;
    const base = classifyPath(relativeName, 'selection');
    coverage.push(base);

    if (base.status === 'Archive') {
      if (archiveSize(file) > MAX_ZIP_INSPECTION_BYTES) {
        coverage.push(makeCoverage(relativeName, 'archive', 'Rejected', 'ZIP archive exceeds browser A7 inspection size limit'));
        continue;
      }
      archives.push({ file, relativeName });
    }
  }

  for (const archive of archives) {
    try {
      const buffer = await archive.file.arrayBuffer();
      const entries = extractZipEntries(buffer);
      if (!entries.length) {
        coverage.push(makeCoverage(archive.relativeName, 'archive', 'Malformed input', 'ZIP archive has no readable central-directory entries'));
        continue;
      }
      if (entries.length > MAX_ZIP_ENTRY_COUNT) {
        coverage.push(makeCoverage(archive.relativeName, 'archive', 'Rejected', `ZIP archive exceeds browser A7 entry count limit (${MAX_ZIP_ENTRY_COUNT})`));
        continue;
      }
      let totalContentBytes = 0;
      const archiveSource = `archive:${sanitizeEntryName(archive.relativeName)}`;
      for (const entryName of entries) {
        const row = classifyPath(entryName.name, archiveSource);
        coverage.push(row);
        if (row.status !== 'Accepted') continue;
        if (entryName.encrypted) {
          coverage.push(makeCoverage(entryName.name, archiveSource, 'Not Assessed', 'Encrypted ZIP entry is outside browser A7 scope'));
          continue;
        }
        if (entryName.compressionMethod !== 0 && entryName.compressionMethod !== 8) {
          coverage.push(makeCoverage(entryName.name, archiveSource, 'Not Assessed', 'ZIP entry compression method is outside browser A7 scope'));
          continue;
        }
        if (entryName.uncompressedSize > MAX_ZIP_ENTRY_CONTENT_BYTES) {
          coverage.push(makeCoverage(entryName.name, archiveSource, 'Not Assessed', 'ZIP entry exceeds browser A7 per-entry content limit'));
          continue;
        }
        if (totalContentBytes + entryName.uncompressedSize > MAX_ZIP_TOTAL_CONTENT_BYTES) {
          coverage.push(makeCoverage(entryName.name, archiveSource, 'Not Assessed', 'ZIP archive exceeds browser A7 total extracted content limit'));
          continue;
        }
        try {
          const maxEntryBytes = Math.min(MAX_ZIP_ENTRY_CONTENT_BYTES, MAX_ZIP_TOTAL_CONTENT_BYTES - totalContentBytes);
          const extracted = await extractZipEntryText(buffer, entryName, { maxBytes: maxEntryBytes });
          totalContentBytes += extracted.byteLength;
          const text = extracted.text;
          archiveTextEntries.push({ path: row.path, source: archiveSource, text });
        } catch (error) {
          coverage.push(makeCoverage(entryName.name, archiveSource, 'Malformed input', 'ZIP entry content could not be extracted locally'));
        }
      }
    } catch (error) {
      coverage.push(makeCoverage(archive.relativeName, 'archive', 'Malformed input', 'ZIP archive could not be inspected locally'));
    }
  }

  return { ...summarizeCoverage(coverage), archiveTextEntries };
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
  return extractZipEntries(input).map((entry) => entry.name);
}

export function extractZipEntries(input) {
  const bytes = input instanceof ArrayBuffer
    ? input
    : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const view = new DataView(bytes);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) return [];

  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (centralDirectoryOffset + centralDirectorySize > view.byteLength) return [];

  const entries = [];
  let offset = centralDirectoryOffset;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  while (offset + 46 <= centralDirectoryOffset + centralDirectorySize) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > view.byteLength) break;
    const name = decoder.decode(new Uint8Array(bytes, nameStart, nameLength));
    if (name && !name.endsWith('/')) {
      entries.push({
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        encrypted: Boolean(flags & 1),
      });
    }
    offset = nameEnd + extraLength + commentLength;
  }

  return entries.filter((entry) => entry.name);
}

export async function extractZipEntryText(input, entry, { maxBytes = MAX_ZIP_ENTRY_CONTENT_BYTES } = {}) {
  const bytes = input instanceof ArrayBuffer
    ? input
    : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const view = new DataView(bytes);
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error('Invalid ZIP local file header');
  }
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart > view.byteLength || dataEnd > view.byteLength) {
    throw new Error('ZIP entry data extends past archive boundary');
  }

  const compressed = new Uint8Array(bytes, dataStart, entry.compressedSize);
  const data = entry.compressionMethod === 0
    ? copyStoredEntry(compressed, maxBytes)
    : await inflateRawBounded(compressed, maxBytes);
  if (data.byteLength !== entry.uncompressedSize) {
    throw new Error('ZIP entry extracted size mismatch');
  }
  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(data),
    byteLength: data.byteLength,
  };
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

function hasTraversalSegment(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .split('/')
    .some((part) => part === '..');
}

function copyStoredEntry(bytes, maxBytes) {
  if (bytes.byteLength > maxBytes) {
    throw new Error('ZIP entry exceeds bounded extraction limit');
  }
  return new Uint8Array(bytes);
}

async function inflateRawBounded(bytes, maxBytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is not available');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('ZIP entry exceeded bounded extraction limit');
        throw new Error('ZIP entry exceeds bounded extraction limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

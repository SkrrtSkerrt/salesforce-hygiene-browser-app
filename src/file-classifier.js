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
  const sanitized = sanitizeEntryName(name).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  return sanitized.split('/').filter(Boolean).pop() || 'rejected-entry';
}

export function classifyPath(rawName, source = 'selection') {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(String(rawName || ''))) {
    return makeCoverage(sanitizeRejectedEntryName(rawName), source, 'Rejected', 'Control characters in raw paths are unsafe before scanning');
  }
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

  // Resolve identity before reading any content: no winner is chosen for duplicates.
  const selectionRows = files.map((file) => classifyPath(file.webkitRelativePath || file.name, 'selection'));
  rejectDuplicatePaths(selectionRows);
  coverage.push(...selectionRows);
  for (const [index, file] of files.entries()) {
    const base = selectionRows[index];
    const relativeName = base.path;
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
      const entries = readZipDirectory(buffer);
      if (!entries.length) {
        coverage.push(makeCoverage(archive.relativeName, 'archive', 'Malformed input', 'ZIP archive has no readable central-directory entries'));
        continue;
      }
      if (entries.length > MAX_ZIP_ENTRY_COUNT) {
        coverage.push(makeCoverage(archive.relativeName, 'archive', 'Rejected', `ZIP archive exceeds browser A7 entry count limit (${MAX_ZIP_ENTRY_COUNT})`));
        continue;
      }
      let totalContentBytes = 0;
      const archiveSource = `archive:${archive.relativeName}`;
      const entryRows = entries.map((entry) => classifyPath(entry.name, archiveSource));
      rejectDuplicatePaths(entryRows);
      for (const [index, entryName] of entries.entries()) {
        const row = entryRows[index];
        // Ordinary directory records remain hidden, but rejected/ambiguous ones are explicit.
        if (entryName.directory && row.status !== 'Rejected') continue;
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
  return readZipDirectory(input).filter((entry) => !entry.directory);
}

function zipBuffer(input) {
  const bytes = input instanceof ArrayBuffer
    ? input
    : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  if (bytes.byteLength > MAX_ZIP_INSPECTION_BYTES) throw new Error('ZIP inspection size limit exceeded');
  return bytes;
}

// Parse the entire directory before returning anything, including directory records
// in the count. Unsupported ZIP64/multipart and any malformed tail fail closed.
function readZipDirectory(input) {
  const bytes = zipBuffer(input);
  const view = new DataView(bytes);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) return [];
  const disk = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const diskCount = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (disk !== 0 || centralDisk !== 0 || diskCount !== entryCount || entryCount === 0xffff
      || centralSize === 0xffffffff || centralOffset === 0xffffffff
      || (eocdOffset >= 20 && view.getUint32(eocdOffset - 20, true) === 0x07064b50)) {
    throw new Error('ZIP64 or multipart ZIP archives are unsupported');
  }
  if (centralOffset + centralSize !== eocdOffset) throw new Error('Invalid ZIP central-directory bounds');

  const entries = [];
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Invalid or truncated ZIP central directory');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const recordEnd = nameEnd + extraLength + commentLength;
    if (!nameLength || recordEnd > eocdOffset) throw new Error('Invalid ZIP central-directory record bounds');
    validateZipExtra(view, nameEnd, extraLength);
    const entry = {
      name: decoder.decode(new Uint8Array(bytes, nameStart, nameLength)),
      flags: view.getUint16(offset + 8, true),
      compressionMethod: view.getUint16(offset + 10, true),
      crc32: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    };
    if (view.getUint16(offset + 34, true) !== 0 || entry.compressedSize === 0xffffffff
        || entry.uncompressedSize === 0xffffffff || entry.localHeaderOffset === 0xffffffff) {
      throw new Error('ZIP64 or multipart ZIP entries are unsupported');
    }
    entry.encrypted = Boolean(entry.flags & 1);
    entry.directory = entry.name.endsWith('/') || entry.name.endsWith('\\');
    const local = validateZipLocal(view, entry, new Uint8Array(bytes, nameStart, nameLength), centralOffset);
    entries.push({ ...entry, ...local });
    offset = recordEnd;
  }
  if (offset !== eocdOffset) throw new Error('ZIP central-directory count or consumed size mismatch');
  const ranges = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].localHeaderOffset < ranges[index - 1].localEnd) throw new Error('Overlapping ZIP local entries');
  }
  return entries;
}

function validateZipExtra(view, start, length) {
  const end = start + length;
  for (let offset = start; offset < end;) {
    if (offset + 4 > end) throw new Error('Truncated ZIP extra field');
    const tag = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    if (tag === 1) throw new Error('ZIP64 extra fields are unsupported');
    offset += 4 + size;
    if (offset > end) throw new Error('Invalid ZIP extra field bounds');
  }
}

function validateZipLocal(view, entry, nameBytes, centralOffset) {
  const start = entry.localHeaderOffset;
  if (start + 30 > centralOffset || view.getUint32(start, true) !== 0x04034b50) {
    throw new Error('Invalid ZIP local file header bounds');
  }
  const nameLength = view.getUint16(start + 26, true);
  const extraLength = view.getUint16(start + 28, true);
  const dataStart = start + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > centralOffset || nameLength !== nameBytes.length
      || view.getUint16(start + 6, true) !== entry.flags
      || view.getUint16(start + 8, true) !== entry.compressionMethod) {
    throw new Error('ZIP local/central header mismatch or data bounds');
  }
  for (let index = 0; index < nameLength; index += 1) {
    if (view.getUint8(start + 30 + index) !== nameBytes[index]) throw new Error('ZIP local/central name mismatch');
  }
  validateZipExtra(view, start + 30 + nameLength, extraLength);
  const hasDescriptor = Boolean(entry.flags & 8);
  for (const [fieldOffset, expected] of [[14, entry.crc32], [18, entry.compressedSize], [22, entry.uncompressedSize]]) {
    const value = view.getUint32(start + fieldOffset, true);
    if (value !== expected && !(hasDescriptor && value === 0)) throw new Error('ZIP local/central size or CRC mismatch');
  }
  let localEnd = dataEnd;
  if (hasDescriptor) {
    const signed = dataEnd + 4 <= centralOffset && view.getUint32(dataEnd, true) === 0x08074b50;
    const descriptor = dataEnd + (signed ? 4 : 0);
    localEnd = descriptor + 12;
    if (localEnd > centralOffset || view.getUint32(descriptor, true) !== entry.crc32
        || view.getUint32(descriptor + 4, true) !== entry.compressedSize
        || view.getUint32(descriptor + 8, true) !== entry.uncompressedSize) {
      throw new Error('Invalid ZIP data descriptor');
    }
  }
  return { dataStart, localEnd };
}

export async function extractZipEntryText(input, entry, { maxBytes = MAX_ZIP_ENTRY_CONTENT_BYTES } = {}) {
  const bytes = zipBuffer(input);
  // Revalidate the input so callers cannot bypass directory/local bounds with a
  // forged entry object or a stale entry from a different archive.
  const entries = readZipDirectory(bytes);
  const rows = entries.map((candidate) => classifyPath(candidate.name, 'archive:entry'));
  rejectDuplicatePaths(rows);
  const index = entries.findIndex((candidate) => candidate.localHeaderOffset === entry.localHeaderOffset && candidate.name === entry.name);
  const current = entries[index];
  if (!current || rows[index].status === 'Rejected' || current.directory || current.encrypted
      || ![0, 8].includes(current.compressionMethod)
      || ['flags', 'compressionMethod', 'crc32', 'compressedSize', 'uncompressedSize'].some((key) => current[key] !== entry[key])) {
    throw new Error('Invalid, unsafe, or ambiguous ZIP extraction entry');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid ZIP extraction limit');
  maxBytes = Math.min(maxBytes, MAX_ZIP_ENTRY_CONTENT_BYTES);
  if (current.uncompressedSize > maxBytes) throw new Error('ZIP entry exceeds bounded extraction limit');
  const compressed = new Uint8Array(bytes, current.dataStart, current.compressedSize);
  const data = current.compressionMethod === 0
    ? copyStoredEntry(compressed, maxBytes)
    : await inflateRawBounded(compressed, maxBytes);
  if (data.byteLength !== current.uncompressedSize) throw new Error('ZIP entry extracted size mismatch');
  if (crc32(data) !== current.crc32) throw new Error('ZIP entry extracted CRC mismatch');
  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(data),
    byteLength: data.byteLength,
  };
}

function findEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 65557);
  let invalidEnd = false;
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    if (offset + 22 + view.getUint16(offset + 20, true) === view.byteLength) return offset;
    invalidEnd = true;
  }
  if (invalidEnd) throw new Error('Invalid ZIP end-of-directory comment or trailing data');
  return -1;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rejectDuplicatePaths(rows) {
  const groups = new Map();
  for (const row of rows) {
    // Rejected raw paths must never become safe aliases through sanitation.
    if (row.status === 'Rejected') continue;
    const group = groups.get(row.path) || [];
    group.push(row);
    groups.set(row.path, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.status = 'Rejected';
      row.reason = 'Duplicate normalized path is ambiguous; all matching entries rejected before scanning';
    }
  }
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
  return text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:/.test(text);
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

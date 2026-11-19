import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFiles, classifyPath, extractZipEntries, extractZipEntryNames, extractZipEntryText, summarizeCoverage } from '../src/file-classifier.js';
import { crc32, makeZip as makeStoreZip } from './zip-fixtures.mjs';

const unixAbsoluteFixture = ['/', 'home', '/josh/org/objects/Account/validationRules/Fictional.validationRule-meta.xml'].join('');
const windowsAbsoluteFixture = ['C:', '\\', 'Users', '\\Josh\\org\\objects\\Account\\validationRules\\Fictional.validationRule-meta.xml'].join('');

assert.equal(classifyPath('unpackaged/objects/Account/validationRules/Fictional.validationRule-meta.xml').status, 'Accepted');
assert.equal(classifyPath('unpackaged/objects/Account/fields/Fictional__c.field-meta.xml').metadataType, 'CustomField');
assert.equal(classifyPath('unpackaged/flows/Fictional.flow-meta.xml').metadataType, 'Flow');
assert.equal(classifyPath('force-app/main/default/classes/Fictional.cls').metadataType, 'ApexClass');
assert.equal(classifyPath('force-app/main/default/triggers/Fictional.trigger').metadataType, 'ApexTrigger');
assert.equal(classifyPath('objects/Account/fields/readme.txt').status, 'Unsupported');
assert.equal(classifyPath('objects/Account/validationRules/notes.txt').status, 'Unsupported');
assert.equal(classifyPath('force-app/main/default/classes/readme.txt').status, 'Unsupported');
assert.equal(classifyPath('force-app/main/default/flows/readme.txt').status, 'Unsupported');
assert.equal(classifyPath('objects/Account/fields/records.json').status, 'Not Assessed');
assert.equal(classifyPath('secret.zip').status, 'Rejected');
assert.equal(classifyPath('nested.zip', 'archive:outer.zip').status, 'Rejected');
assert.equal(classifyPath(unixAbsoluteFixture).status, 'Rejected');
assert.equal(classifyPath(windowsAbsoluteFixture).status, 'Rejected');
assert.equal(classifyPath(unixAbsoluteFixture).path, 'Fictional.validationRule-meta.xml');
assert.equal(classifyPath(windowsAbsoluteFixture).path, 'Fictional.validationRule-meta.xml');
assert.equal(classifyPath('../secret.env').status, 'Rejected');
assert.equal(classifyPath('../secret.env').path, 'secret.env');
assert.equal(classifyPath('/tmp/export/customers.csv').status, 'Rejected');
assert.equal(classifyPath('settings/Fictional.settings-meta.xml').status, 'Not Assessed');
assert.equal(classifyPath('readme.txt').status, 'Unsupported');

const coverage = [
  classifyPath('objects/Account/validationRules/Fictional.validationRule-meta.xml'),
  classifyPath('objects/Account/businessProcesses/Fictional.businessProcess-meta.xml'),
  classifyPath('debug.log'),
];
const summary = summarizeCoverage(coverage);
assert.equal(summary.counts.Accepted, 1);
assert.equal(summary.counts['Not Assessed'], 1);
assert.equal(summary.counts.Rejected, 1);

const zip = makeStoreZip([
  ['unpackaged/objects/Account/fields/Fictional__c.field-meta.xml', '<xml/>'],
  ['unpackaged/flows/Fictional.flow-meta.xml', '<xml/>'],
]);
assert.deepEqual(extractZipEntryNames(zip), [
  'unpackaged/objects/Account/fields/Fictional__c.field-meta.xml',
  'unpackaged/flows/Fictional.flow-meta.xml',
]);

const absoluteZip = makeStoreZip([
  [unixAbsoluteFixture, '<xml/>'],
  [windowsAbsoluteFixture, '<xml/>'],
]);
const absoluteEntries = extractZipEntryNames(absoluteZip);
assert.equal(absoluteEntries[0], unixAbsoluteFixture);
assert.equal(classifyPath(absoluteEntries[0], 'archive:absolute.zip').status, 'Rejected');
assert.equal(classifyPath(absoluteEntries[1], 'archive:absolute.zip').status, 'Rejected');
assert.equal(classifyPath(absoluteEntries[0], 'archive:absolute.zip').path, 'Fictional.validationRule-meta.xml');
assert.equal(classifyPath(absoluteEntries[1], 'archive:absolute.zip').path, 'Fictional.validationRule-meta.xml');

console.log('legacy file classifier assertions passed');

const sampleEntries = [['one.cls', 'first'], ['two.cls', 'second']];
function editZip(edit, entries = sampleEntries) {
  const buffer = makeStoreZip(entries);
  const view = new DataView(buffer);
  const end = buffer.byteLength - 22;
  const central = view.getUint32(end + 16, true);
  const second = central + 46 + view.getUint16(central + 28, true);
  edit(view, { end, central, second });
  return buffer;
}
function selectedZip(buffer, name = 'fictional.zip') {
  return { name, size: buffer.byteLength, arrayBuffer: async () => buffer };
}

const malformedCases = [
  ['corrupt second central signature', (v, p) => v.setUint32(p.second, 0, true)],
  ['central name crosses its directory', (v, p) => v.setUint16(p.second + 28, 500, true)],
  ['central extra crosses its directory', (v, p) => v.setUint16(p.second + 30, 100, true)],
  ['central comment crosses its directory', (v, p) => v.setUint16(p.second + 32, 100, true)],
  ['central directory too short', (v, p) => v.setUint32(p.end + 12, 46 + 7, true)],
  ['central directory overlaps EOCD', (v, p) => v.setUint32(p.end + 12, p.end, true)],
  ['central offset outside archive', (v, p) => v.setUint32(p.end + 16, p.end + 100, true)],
  ['entry count too small', (v, p) => { v.setUint16(p.end + 8, 1, true); v.setUint16(p.end + 10, 1, true); }],
  ['entry count too large', (v, p) => { v.setUint16(p.end + 8, 3, true); v.setUint16(p.end + 10, 3, true); }],
  ['entry count differs by disk', (v, p) => v.setUint16(p.end + 8, 1, true)],
  ['nonzero archive disk', (v, p) => v.setUint16(p.end + 4, 1, true)],
  ['nonzero directory disk', (v, p) => v.setUint16(p.end + 6, 1, true)],
  ['nonzero entry disk', (v, p) => v.setUint16(p.central + 34, 1, true)],
  ['ZIP64 entry count', (v, p) => { v.setUint16(p.end + 8, 0xffff, true); v.setUint16(p.end + 10, 0xffff, true); }],
  ['ZIP64 directory size', (v, p) => v.setUint32(p.end + 12, 0xffffffff, true)],
  ['ZIP64 directory offset', (v, p) => v.setUint32(p.end + 16, 0xffffffff, true)],
  ['ZIP64 entry size', (v, p) => v.setUint32(p.central + 20, 0xffffffff, true)],
  ['ZIP64 local offset', (v, p) => v.setUint32(p.central + 42, 0xffffffff, true)],
  ['ZIP64 entry disk', (v, p) => v.setUint16(p.central + 34, 0xffff, true)],
  ['truncated EOCD comment', (v, p) => v.setUint16(p.end + 20, 1, true)],
];
for (const [label, edit] of malformedCases) {
  test(`reject entire archive: ${label}`, async () => {
    const malformed = editZip(edit);
    assert.throws(() => extractZipEntries(malformed), /ZIP/i);
    const result = await classifyFiles([selectedZip(malformed)]);
    assert.deepEqual(result.archiveTextEntries, []);
    assert.equal(result.counts['Malformed input'], 1);
    assert.equal(result.counts.Accepted || 0, 0);
  });
}

test('EOCD trailing junk is rejected, valid comments including signatures are accepted', () => {
  const original = new Uint8Array(makeStoreZip(sampleEntries));
  const trailing = new Uint8Array(original.length + 1);
  trailing.set(original);
  assert.throws(() => extractZipEntries(trailing), /ZIP/i);
  const commented = new Uint8Array(original.length + 30);
  commented.set(original);
  const view = new DataView(commented.buffer);
  view.setUint16(original.length - 2, 30, true);
  view.setUint32(original.length, 0x06054b50, true);
  assert.deepEqual(extractZipEntryNames(commented), ['one.cls', 'two.cls']);
});

test('empty ZIP and non-ZIP API compatibility, typed-array slice boundaries', () => {
  assert.deepEqual(extractZipEntries(new Uint8Array()), []);
  assert.deepEqual(extractZipEntries(new TextEncoder().encode('not a ZIP')), []);
  assert.deepEqual(extractZipEntries(makeStoreZip([])), []);
  const original = new Uint8Array(makeStoreZip(sampleEntries));
  const wrapped = new Uint8Array(original.length + 12);
  wrapped.set(original, 5);
  assert.deepEqual(extractZipEntryNames(wrapped.subarray(5, 5 + original.length)), ['one.cls', 'two.cls']);
});

test('directories count toward EOCD consumption and archive entry limit', async () => {
  const entries = [['folder/', ''], ['folder/one.cls', 'source']];
  assert.deepEqual(extractZipEntryNames(makeStoreZip(entries)), ['folder/one.cls']);
  assert.throws(() => extractZipEntries(editZip((v, p) => {
    v.setUint16(p.end + 8, 1, true);
    v.setUint16(p.end + 10, 1, true);
  }, entries)), /ZIP/i);
  const many = [...Array.from({ length: 200 }, (_, i) => [`folder-${i}/`, '']), ['one.cls', 'source']];
  const result = await classifyFiles([selectedZip(makeStoreZip(many))]);
  assert.deepEqual(result.archiveTextEntries, []);
  assert(result.coverage.some((row) => row.status === 'Rejected' && /entry count limit/.test(row.reason)));
});

for (const raw of ['C:relative.cls', 'C:folder/one.cls', 'folder/one\u0000.cls', 'folder/one\n.cls', 'folder/one\u007f.cls', 'folder/one\u0085.cls']) {
  test(`unsafe raw path ${JSON.stringify(raw)} never extracts`, async () => {
    for (const source of ['selection', 'archive:fictional.zip']) {
      const row = classifyPath(raw, source);
      assert.equal(row.status, 'Rejected');
      assert(!/[\u0000-\u001f\u007f-\u009f]/.test(row.path));
    }
    const result = await classifyFiles([selectedZip(makeStoreZip([[raw, 'source']]))]);
    assert.deepEqual(result.archiveTextEntries, []);
  });
}

for (const names of [['folder/one.cls', 'folder/one.cls'], ['folder/one.cls', 'folder\\one.cls'], ['folder/one.cls', 'folder/./one.cls'], ['folder/one.cls', 'folder//one.cls']]) {
  test(`all ambiguous archive paths rejected: ${JSON.stringify(names)}`, async () => {
    const buffer = makeStoreZip([...names.map((name, i) => [name, `source ${i}`]), ['unique.cls', 'unique']]);
    for (const entry of extractZipEntries(buffer).slice(0, 2)) {
      await assert.rejects(() => extractZipEntryText(buffer, entry), /ambiguous/i);
    }
    const result = await classifyFiles([selectedZip(buffer)]);
    assert.deepEqual(result.archiveTextEntries.map((entry) => entry.path), ['unique.cls']);
    const duplicates = result.coverage.filter((row) => row.path === 'folder/one.cls');
    assert.equal(duplicates.length, 2);
    assert(duplicates.every((row) => row.status === 'Rejected' && /duplicate|ambiguous/i.test(row.reason)));
  });
}

test('duplicate directly selected normalized paths are all rejected, without reading archives', async () => {
  let reads = 0;
  const buffer = makeStoreZip([['one.cls', 'source']]);
  const result = await classifyFiles([
    { name: 'one.cls', webkitRelativePath: 'folder/one.cls' },
    { name: 'one.cls', webkitRelativePath: 'folder\\one.cls' },
    { name: 'fictional.zip', arrayBuffer: async () => { reads += 1; return buffer; } },
    { name: './fictional.zip', arrayBuffer: async () => { reads += 1; return buffer; } },
    { name: 'unique.cls' },
  ]);
  assert.equal(reads, 0);
  assert.deepEqual(result.archiveTextEntries, []);
  assert.equal(result.selectedEntryCount, 5);
  assert.equal(result.counts.Rejected, 4);
  assert.equal(result.counts.Accepted, 1);
  assert(result.coverage.filter((row) => row.status === 'Rejected').every((row) => /duplicate|ambiguous/i.test(row.reason)));
});

const localMismatchCases = [
  ['name bytes', (v) => v.setUint8(30, 'x'.charCodeAt(0))],
  ['method', (v) => v.setUint16(8, 8, true)],
  ['flags', (v) => v.setUint16(6, 1, true)],
  ['CRC', (v) => v.setUint32(14, 0, true)],
  ['compressed size', (v) => v.setUint32(18, 1, true)],
  ['uncompressed size', (v) => v.setUint32(22, 1, true)],
  ['name length', (v) => v.setUint16(26, 1, true)],
  ['extra bounds', (v) => v.setUint16(28, 0xffff, true)],
  ['data overlaps directory', (v, p) => { v.setUint32(18, p.central, true); v.setUint32(p.central + 20, p.central, true); }],
  ['header in directory', (v, p) => v.setUint32(p.central + 42, p.central, true)],
];
for (const [label, edit] of localMismatchCases) {
  test(`local/central mismatch is never extracted: ${label}`, async () => {
    const original = makeStoreZip(sampleEntries);
    const entry = extractZipEntries(original)[0];
    const malformed = editZip(edit);
    await assert.rejects(() => extractZipEntryText(malformed, entry), /ZIP/i);
    const result = await classifyFiles([selectedZip(malformed)]);
    assert(!result.archiveTextEntries.some((item) => item.path === 'one.cls'));
    assert(result.coverage.some((row) => row.status === 'Malformed input'));
  });
}

test('CRC validates actual contents, stored extraction retains bounds', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const original = makeStoreZip([['one.cls', 'source']]);
  const [entry] = extractZipEntries(original);
  assert.deepEqual(await extractZipEntryText(original, entry), { text: 'source', byteLength: 6 });
  await assert.rejects(() => extractZipEntryText(original, entry, { maxBytes: 5 }), /limit/i);
  const corrupt = original.slice(0);
  new Uint8Array(corrupt)[30 + 'one.cls'.length] ^= 1;
  await assert.rejects(() => extractZipEntryText(corrupt, entry), /CRC/i);
  const result = await classifyFiles([selectedZip(corrupt)]);
  assert.deepEqual(result.archiveTextEntries, []);
  assert.equal(result.counts['Malformed input'], 1);
});

for (const descriptor of [true, 'unsigned']) {
  for (const method of [0, 8]) {
    test(`valid ${descriptor === true ? 'signed' : 'unsigned'} data descriptor, method ${method}`, async () => {
      const buffer = makeStoreZip([{ name: 'one.cls', text: 'source', method, descriptor }]);
      const [entry] = extractZipEntries(buffer);
      assert.deepEqual(await extractZipEntryText(buffer, entry), { text: 'source', byteLength: 6 });
      const result = await classifyFiles([selectedZip(buffer)]);
      assert.equal(result.archiveTextEntries[0].text, 'source');
      const corrupt = buffer.slice(0);
      new DataView(corrupt).setUint32(entry.localEnd - 4, 999, true);
      assert.throws(() => extractZipEntries(corrupt), /descriptor/i);
      assert.deepEqual((await classifyFiles([selectedZip(corrupt)])).archiveTextEntries, []);
    });
  }
}

for (const field of ['localExtra', 'centralExtra']) {
  for (const [label, extra] of [
    ['ZIP64', new Uint8Array([1, 0, 0, 0])],
    ['truncated', new Uint8Array([2, 0, 0])],
    ['invalid bounds', new Uint8Array([2, 0, 1, 0])],
  ]) {
    test(`${field} ${label} is rejected before extraction`, async () => {
      const buffer = makeStoreZip([{ name: 'one.cls', text: 'source', [field]: extra }]);
      assert.throws(() => extractZipEntries(buffer), /ZIP/i);
      assert.deepEqual((await classifyFiles([selectedZip(buffer)])).archiveTextEntries, []);
    });
  }
}

test('valid unknown extras, deflated CRC integrity and expansion bounds', async () => {
  const buffer = makeStoreZip([{
    name: 'one.cls', text: 'source', method: 8,
    localExtra: new Uint8Array([2, 0, 1, 0, 7]),
    centralExtra: new Uint8Array([2, 0, 1, 0, 9]),
  }]);
  const [entry] = extractZipEntries(buffer);
  assert.equal((await extractZipEntryText(buffer, entry)).text, 'source');
  const corrupt = buffer.slice(0);
  const view = new DataView(corrupt);
  const central = view.getUint32(corrupt.byteLength - 6, true);
  view.setUint32(14, 0, true);
  view.setUint32(central + 16, 0, true);
  await assert.rejects(() => extractZipEntryText(corrupt, extractZipEntries(corrupt)[0]), /CRC/i);
  const bomb = makeStoreZip([{ name: 'one.cls', text: 'x'.repeat(2048), method: 8, declaredUncompressedSize: 1 }]);
  await assert.rejects(() => extractZipEntryText(bomb, extractZipEntries(bomb)[0], { maxBytes: 1024 }), /limit/i);
});

test('directory/file aliases all reject and unsafe rejected paths do not poison safe identities', async () => {
  const buffer = makeStoreZip([
    ['folder/one.cls/', ''], ['folder/one.cls', 'source'],
    ['../unique.cls', 'unsafe'], ['unique.cls', 'unique'],
  ]);
  const result = await classifyFiles([selectedZip(buffer)]);
  assert.deepEqual(result.archiveTextEntries.map((entry) => entry.path), ['unique.cls']);
  const aliases = result.coverage.filter((row) => row.path === 'folder/one.cls');
  assert.equal(aliases.length, 2);
  assert(aliases.every((row) => row.status === 'Rejected' && /ambiguous/i.test(row.reason)));
});

test('matching paths in different archives remain distinct accepted identities', async () => {
  const result = await classifyFiles([
    selectedZip(makeStoreZip([['one.cls', 'first']]), 'first.zip'),
    selectedZip(makeStoreZip([['one.cls', 'second']]), 'second.zip'),
  ]);
  assert.deepEqual(result.archiveTextEntries.map(({ source, text }) => [source, text]), [
    ['archive:first.zip', 'first'], ['archive:second.zip', 'second'],
  ]);
});

test('selection ZIP count budget bounds actual archive reads in order', async () => {
  let reads = 0;
  const buffer = makeStoreZip([['one.cls', 'source']]);
  const result = await classifyFiles(Array.from({ length: 12 }, (_, i) => ({ name: `part-${i}.zip`, size: buffer.byteLength, arrayBuffer: async () => { reads++; return buffer; } })));
  assert.equal(reads, 10);
  assert.equal(result.archiveTextEntries.length, 10);
  assert.equal(result.zipUsage.archives, 10);
  assert(result.coverage.some((row) => row.status === 'Rejected' && /selection.*archive count/i.test(row.reason)));
});

test('selection archive bytes are reserved before reading, unsafe/oversized files never read', async () => {
  let reads = 0;
  const tiny = makeStoreZip([['one.cls', 'source']]);
  const files = ['first.zip', 'second.zip', 'third.zip'].map((name) => ({ name, size: 10 * 1024 * 1024, arrayBuffer: async () => { reads++; return tiny; } }));
  files.unshift({ name: '../unsafe.zip', size: 1, arrayBuffer: async () => { throw new Error('must not read'); } });
  files.unshift({ name: 'oversized.zip', size: 10 * 1024 * 1024 + 1, arrayBuffer: async () => { throw new Error('must not read'); } });
  const result = await classifyFiles(files);
  assert.equal(reads, 2);
  assert.equal(result.zipUsage.archiveBytes, 20 * 1024 * 1024);
});

test('selection inspected-entry budget includes directories and rejects before entry parsing', async () => {
  const directories = makeStoreZip(Array.from({ length: 200 }, (_, i) => [`folder-${i}/`, '']));
  const result = await classifyFiles([selectedZip(directories, 'a.zip'), selectedZip(directories, 'b.zip'), selectedZip(makeStoreZip([['one.cls', 'text']]), 'c.zip')]);
  assert.equal(result.zipUsage.entries, 400);
  assert.deepEqual(result.archiveTextEntries, []);
  assert(result.coverage.some((row) => /selection.*entry count/i.test(row.reason)));
});

test('selection decompressed-text budget is shared and inclusive at exact boundary', async () => {
  const archive = makeStoreZip(Array.from({ length: 4 }, (_, i) => ({ name: `one-${i}.cls`, text: 'x'.repeat(1024 * 1024), method: 8 })));
  const result = await classifyFiles([selectedZip(archive, 'a.zip'), selectedZip(archive, 'b.zip'), selectedZip(archive, 'c.zip')]);
  assert.equal(result.archiveTextEntries.length, 8);
  assert.equal(result.zipUsage.contentBytes, 8 * 1024 * 1024);
  assert(result.coverage.some((row) => row.status === 'Not Assessed' && /selection.*content/i.test(row.reason)));
});

test('failed inflate attempts retain bounded runtime reservations across archives', async () => {
  const bomb = makeStoreZip([{ name: 'one.cls', text: 'x'.repeat(1024 * 1024 + 1), method: 8, declaredUncompressedSize: 1 }]);
  let attempts = 0;
  const NativeDecompressionStream = globalThis.DecompressionStream;
  globalThis.DecompressionStream = class extends NativeDecompressionStream {
    constructor(format) { super(format); attempts++; }
  };
  try {
    const result = await classifyFiles(Array.from({ length: 10 }, (_, i) => selectedZip(bomb, `part-${i}.zip`)));
    assert.deepEqual(result.archiveTextEntries, []);
    assert.equal(attempts, 8, 'only budgeted inflate attempts execute');
    assert.equal(result.zipUsage.contentBytes, 8 * 1024 * 1024);
    assert(result.coverage.some((row) => /selection.*content/i.test(row.reason)));
  } finally {
    globalThis.DecompressionStream = NativeDecompressionStream;
  }
});

test('zero-declared ZIP members cannot inflate after archive or selection budget exhaustion', async () => {
  const archive = makeStoreZip(Array.from({ length: 12 }, (_, i) => ({
    name: `zero-${i}.cls`, text: 'x'.repeat(1024 * 1024 + 1), method: 8, declaredUncompressedSize: 0,
  })));
  const NativeDecompressionStream = globalThis.DecompressionStream;
  let attempts = 0;
  globalThis.DecompressionStream = class extends NativeDecompressionStream {
    constructor(format) { super(format); attempts++; }
  };
  try {
    const one = await classifyFiles([selectedZip(archive, 'one.zip')]);
    assert.equal(attempts, 4, 'no zero-reservation inflate after per-archive exhaustion');
    assert.equal(one.zipUsage.contentBytes, 4 * 1024 * 1024);
    assert.deepEqual(one.archiveTextEntries, []);
    assert(one.coverage.some((row) => row.status === 'Not Assessed' && /archive.*content/i.test(row.reason)));
    attempts = 0;
    const three = await classifyFiles(['a.zip', 'b.zip', 'c.zip'].map((name) => selectedZip(archive, name)));
    assert.equal(attempts, 8, 'no zero-reservation inflate after selection exhaustion');
    assert.equal(three.zipUsage.contentBytes, 8 * 1024 * 1024);
    assert.deepEqual(three.archiveTextEntries, []);
    assert(three.coverage.some((row) => row.status === 'Not Assessed' && /selection.*content/i.test(row.reason)));
  } finally {
    globalThis.DecompressionStream = NativeDecompressionStream;
  }
});

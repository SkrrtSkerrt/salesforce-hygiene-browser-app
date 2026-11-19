import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySelectedFiles } from '../src/scanner-adapter.js';
import { makeZip } from './zip-fixtures.mjs';

const blankXml = '<ValidationRule><description/></ValidationRule>';
const path = 'objects/Account/validationRules/Fictional.validationRule-meta.xml';

for (const names of [[path, path], [path, path.replaceAll('/', '\\')], [path, path.replace('objects/', 'objects/./')]]) {
  test(`rejected duplicate selections never reach content readers: ${JSON.stringify(names)}`, async () => {
    let reads = 0;
    const result = await classifySelectedFiles(names.map((name) => ({ name, async arrayBuffer() { reads += 1; return new TextEncoder().encode(blankXml).buffer; } })));
    assert.equal(reads, 0);
    assert.equal(result.findings.length, 0);
    assert.deepEqual(result.rulesEvaluated, []);
    assert.equal(result.coverage.length, 2);
    assert.ok(result.coverage.every((row) => row.status === 'Rejected'));
  });
}

for (const name of [path.replaceAll('/', '\\'), path.replace('objects/', 'objects/./'), path.replace('objects/', 'objects//')]) {
  test(`accepted normalized selection retains its matching File: ${JSON.stringify(name)}`, async () => {
    let reads = 0;
    const result = await classifySelectedFiles([{ name, async arrayBuffer() { reads += 1; return new TextEncoder().encode(blankXml).buffer; } }]);
    assert.equal(reads, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].source.path, path);
  });
}

test('rejected raw aliases cannot replace safe selection content', async () => {
  let rejectedReads = 0;
  const result = await classifySelectedFiles([
    { name: path, async arrayBuffer() { return new TextEncoder().encode(blankXml).buffer; } },
    { name: '/' + path, async arrayBuffer() { rejectedReads += 1; return '<ValidationRule><description>different</description></ValidationRule>'; } },
  ]);
  assert.equal(rejectedReads, 0);
  assert.equal(result.findings.length, 1);
});

test('duplicate archive ValidationRules never execute the rule', async () => {
  const buffer = makeZip([{ name: path, text: blankXml }, { name: path, text: blankXml }]);
  const result = await classifySelectedFiles([{ name: 'fictional.zip', size: buffer.byteLength, async arrayBuffer() { return buffer; } }]);
  assert.equal(result.findings.length, 0);
  assert.equal(result.coverage.filter((row) => row.ruleId).length, 0);
  assert.deepEqual(result.rulesEvaluated, []);
});

for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xff]), new Uint8Array([0xe2, 0x82])]) {
  test(`malformed UTF-8 fails closed for direct and ZIP content: ${bytes}`, async () => {
    const raw = new Uint8Array([...new TextEncoder().encode('<ValidationRule><description/>'), ...bytes, ...new TextEncoder().encode('</ValidationRule>')]);
    const zip = makeZip([{ name: path, bytes: raw }]);
    for (const files of [[{ name: path, arrayBuffer: async () => raw.buffer, text: async () => blankXml }], [{ name: 'invalid.zip', size: zip.byteLength, arrayBuffer: async () => zip }]]) {
      const result = await classifySelectedFiles(files);
      assert.deepEqual(result.findings, []);
      assert.deepEqual(result.rulesEvaluated, []);
      assert(result.coverage.some((row) => row.status === 'Not Assessed'));
    }
  });
}

test('no eligible input means no claimed execution; recognized other types are explicitly Not Assessed', async () => {
  for (const files of [[], [{ name: 'readme.txt' }], [{ name: 'one.field-meta.xml' }, { name: 'two.flow-meta.xml' }, { name: 'three.cls' }, { name: 'four.trigger' }]]) {
    const result = await classifySelectedFiles(files);
    assert.deepEqual(result.rulesEvaluated, []);
    assert.deepEqual(result.findings, []);
    assert(result.coverage.filter((row) => row.metadataType).every((row) => row.status === 'Not Assessed' && row.classificationStatus === 'Accepted'));
  }
});

test('byte API only; unavailable or failing readers are safe local Not Assessed results', async () => {
  for (const file of [{ name: path, text: async () => blankXml }, { name: path, arrayBuffer: async () => { throw new Error('PRIVATE_SENTINEL'); } }]) {
    const result = await classifySelectedFiles([file]);
    assert.deepEqual(result.rulesEvaluated, []);
    assert.deepEqual(result.findings, []);
    assert(result.coverage.some((row) => row.status === 'Not Assessed'));
    assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  }
});

test('execution summaries derive from invoked rules, including assessed non-findings', async () => {
  for (const text of [blankXml, '<ValidationRule><description>documented</description></ValidationRule>']) {
    const result = await classifySelectedFiles([{ name: path, arrayBuffer: async () => new TextEncoder().encode(text).buffer }]);
    assert.deepEqual(result.rulesEvaluated, ['VALIDATION-001-BROWSER']);
    assert.equal(result.coverage.filter((row) => row.ruleId).length, 1);
  }
});

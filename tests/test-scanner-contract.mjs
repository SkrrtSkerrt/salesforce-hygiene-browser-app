import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySelectedFiles } from '../src/scanner-adapter.js';
import { makeZip } from './zip-fixtures.mjs';

const blankXml = '<ValidationRule><description/></ValidationRule>';
const path = 'objects/Account/validationRules/Fictional.validationRule-meta.xml';

for (const names of [[path, path], [path, path.replaceAll('/', '\\')], [path, path.replace('objects/', 'objects/./')]]) {
  test(`rejected duplicate selections never reach content readers: ${JSON.stringify(names)}`, async () => {
    let reads = 0;
    const result = await classifySelectedFiles(names.map((name) => ({ name, async text() { reads += 1; return blankXml; } })));
    assert.equal(reads, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(result.coverage.length, 2);
    assert.ok(result.coverage.every((row) => row.status === 'Rejected'));
  });
}

for (const name of [path.replaceAll('/', '\\'), path.replace('objects/', 'objects/./'), path.replace('objects/', 'objects//')]) {
  test(`accepted normalized selection retains its matching File: ${JSON.stringify(name)}`, async () => {
    let reads = 0;
    const result = await classifySelectedFiles([{ name, async text() { reads += 1; return blankXml; } }]);
    assert.equal(reads, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].source.path, path);
  });
}

test('rejected raw aliases cannot replace safe selection content', async () => {
  let rejectedReads = 0;
  const result = await classifySelectedFiles([
    { name: path, async text() { return blankXml; } },
    { name: '/' + path, async text() { rejectedReads += 1; return '<ValidationRule><description>different</description></ValidationRule>'; } },
  ]);
  assert.equal(rejectedReads, 0);
  assert.equal(result.findings.length, 1);
});

test('duplicate archive ValidationRules never execute the rule', async () => {
  const buffer = makeZip([{ name: path, text: blankXml }, { name: path, text: blankXml }]);
  const result = await classifySelectedFiles([{ name: 'fictional.zip', size: buffer.byteLength, async arrayBuffer() { return buffer; } }]);
  assert.equal(result.findings.length, 0);
  assert.equal(result.coverage.filter((row) => row.ruleId).length, 0);
});

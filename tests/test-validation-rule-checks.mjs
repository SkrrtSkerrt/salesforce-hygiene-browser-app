import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifySelectedFiles } from '../src/scanner-adapter.js';
import { renderLimitations } from '../src/report-renderer.js';
import { evaluateValidationDescription } from '../src/validation-rule-checks.js';
import { readXml } from '../src/xml-reader.js';
import { makeZip } from './zip-fixtures.mjs';

const root = new URL('..', import.meta.url).pathname;

// Synthetic-only tokenizer and provenance regressions. Run all cases so the RED
// receipt identifies independent failures rather than stopping at the first one.
const xmlRegressionFailures = [];
let xmlRegressionCount = 0;
function xmlRegression(label, check) {
  xmlRegressionCount += 1;
  try { check(); } catch (error) { xmlRegressionFailures.push(`${label}: ${error.message}`); }
}
const syntheticPath = 'objects/Account/validationRules/Synthetic.validationRule-meta.xml';
const wrap = (body) => `<ValidationRule>${body}</ValidationRule>`;
const evaluateSynthetic = (text, source) => evaluateValidationDescription({ path: syntheticPath, text, ...(source === undefined ? {} : { source }) });
for (const [label, text, status, reasonCode] of [
  ['comment-only lookalike', wrap('<!-- <description/> -->'), 'Not Assessed', 'description-field-unproven'],
  ['CDATA-only lookalike', wrap('<![CDATA[<description/>]]>'), 'Not Assessed', 'description-field-unproven'],
  ['PI-only lookalike', wrap('<?note <description/> ?>'), 'Not Assessed', 'description-field-unproven'],
  ['comment before real field', wrap('<!-- <description/> --><description/>'), 'Finding', 'blank-description'],
  ['CDATA before real field', wrap('<![CDATA[<description/>]]><description/>'), 'Finding', 'blank-description'],
  ['PI before real field', wrap('<?note <description/> ?><description/>'), 'Finding', 'blank-description'],
  ['nested comment lookalike', wrap('<metadata><!-- <description/> --></metadata>'), 'Not Assessed', 'description-field-unproven'],
  ['comment after actual text', wrap('<description>Business context.</description><!-- <description/> -->'), 'Assessed', 'description-present'],
  ['decimal whitespace references', wrap('<description>&#32;&#9;&#10;&#13;</description>'), 'Finding', 'blank-description'],
  ['hexadecimal whitespace references', wrap('<description>&#x20;&#x9;&#xA;&#xD;</description>'), 'Finding', 'blank-description'],
  ['nonblank numeric reference', wrap('<description>&#65;&#x1F600;</description>'), 'Assessed', 'description-present'],
  ['predefined entities', wrap('<description>&lt;&gt;&amp;&quot;&apos;</description>'), 'Assessed', 'description-present'],
  ['encoded markup stays text', wrap('<description>&lt;description/&gt;</description>'), 'Assessed', 'description-present'],
  ['entities decoded once', wrap('<description>&amp;#32;</description>'), 'Assessed', 'description-present'],
  ['nested description is child markup', wrap('<description><description/></description>'), 'Not Assessed', 'description-content-unproven'],
  ['ordinary child markup', wrap('<description><b/></description>'), 'Not Assessed', 'description-content-unproven'],
  ['comment inside field', wrap('<description><!-- <description/> --></description>'), 'Not Assessed', 'description-content-unproven'],
  ['CDATA inside field', wrap('<description><![CDATA[<description/>]]></description>'), 'Not Assessed', 'description-content-unproven'],
  ['PI inside field', wrap('<description><?note empty ?></description>'), 'Not Assessed', 'description-content-unproven'],
  ['real duplicate fields', wrap('<description/><description/>'), 'Not Assessed', 'ambiguous-description-field'],
  ['self-closing root', '<ValidationRule/>', 'Not Assessed', 'description-field-unproven'],
  ['quoted greater-than', '<ValidationRule note="a > b"><description note=\'c > d\'/></ValidationRule>', 'Finding', 'blank-description'],
  ['opposite quote in attribute', wrap('<description note="a\'b"/>'), 'Finding', 'blank-description'],
  ['encoded less-than in attribute', wrap('<description note="&lt;description/&gt;"/>'), 'Finding', 'blank-description'],
  ['prolog and epilog misc', '<?xml version="1.0"?>\n<!-- before --><?note x?><ValidationRule><description/></ValidationRule><!-- after --><?note y?>', 'Finding', 'blank-description'],
  ['BOM and CRLF', '\uFEFF<?xml version="1.0"?>\r\n<ValidationRule>\r\n<description/>\r\n</ValidationRule>', 'Finding', 'blank-description'],
  ['declaration lookalike in comment', wrap('<!-- <!DOCTYPE fake> --><description/>'), 'Finding', 'blank-description'],
  ['declaration lookalike in CDATA sibling', wrap('<other><![CDATA[<!ENTITY fake>]]></other><description/>'), 'Finding', 'blank-description'],
  ['namespace alias direct field', '<m:ValidationRule xmlns:m="http://soap.sforce.com/2006/04/metadata" xmlns:n="http://soap.sforce.com/2006/04/metadata"><n:description/></m:ValidationRule>', 'Finding', 'blank-description'],
  ['standalone declaration', '<?xml version=\'1.0\' standalone=\'yes\'?>' + wrap('<description/>'), 'Finding', 'blank-description'],
  ['complete declaration', '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' + wrap('<description/>'), 'Finding', 'blank-description'],
  ['scoped namespace binding', '<ValidationRule><other xmlns:m="urn:synthetic"><m:child/></other><description xml:space="preserve"/></ValidationRule>', 'Finding', 'blank-description'],
  ['raw entity lookalikes in comment', wrap('<!-- &unknown; &#0; --><description/>'), 'Finding', 'blank-description'],
  ['raw entity lookalikes in CDATA sibling', wrap('<other><![CDATA[&unknown; &#0;]]></other><description/>'), 'Finding', 'blank-description'],
  ['close-tag lookalike in comment', wrap('<other><!-- </other> --></other><description/>'), 'Finding', 'blank-description'],
  ['empty input', '', 'Malformed input', 'malformed-validation-rule-xml'],
  ['wrong root', '<Other><description/></Other>', 'Malformed input', 'malformed-validation-rule-xml'],
  ['same expanded name duplicates', '<m:ValidationRule xmlns:m="http://soap.sforce.com/2006/04/metadata" xmlns:n="http://soap.sforce.com/2006/04/metadata"><m:description/><n:description/></m:ValidationRule>', 'Not Assessed', 'ambiguous-description-field'],
]) {
  xmlRegression(label, () => {
    const result = evaluateSynthetic(text);
    assert.equal(result.coverage.status, status);
    assert.equal(result.coverage.reasonCode, reasonCode);
    assert.equal(Boolean(result.finding), status === 'Finding');
  });
}
for (const [label, text] of [
  ['unquoted root attribute', '<ValidationRule broken=value><description/></ValidationRule>'],
  ['bare root attribute', '<ValidationRule broken><description/></ValidationRule>'],
  ['bare description attribute', wrap('<description broken/>')],
  ['unquoted description attribute', wrap('<description broken=value/>')],
  ['duplicate root attributes', '<ValidationRule x="a" x="b"><description/></ValidationRule>'],
  ['duplicate field attributes', wrap('<description x="a" x="b"/>')],
  ['adjacent attributes', wrap('<description x="a"y="b"/>')],
  ['raw less-than in attribute', wrap('<description note="<description/>"/>')],
  ['unclosed quote', wrap('<description note="bad/>')],
  ['invalid attribute name', wrap('<description 1bad="x"/>')],
  ['whitespace after self-close slash', wrap('<description / >')],
  ['unknown entity in description', wrap('<description>&missing;</description>')],
  ['unknown entity elsewhere', wrap('<description/><other>&missing;</other>')],
  ['unknown entity in attribute', wrap('<description note="&missing;"/>')],
  ['bare ampersand', wrap('<description/><other>a & b</other>')],
  ['missing reference semicolon', wrap('<description>&#32</description>')],
  ['decimal reference trailing newline', wrap('<description>&#32\n;</description>')],
  ['hexadecimal reference trailing newline', wrap('<description>&#x20\n;</description>')],
  ['decimal reference trailing CR', wrap('<description>&#32\r;</description>')],
  ['reference trailing Unicode line separator', wrap('<description>&#32\u2028;</description>')],
  ['empty numeric reference', wrap('<description>&#;</description>')],
  ['invalid hex reference', wrap('<description>&#xGG;</description>')],
  ['uppercase reference marker', wrap('<description>&#X20;</description>')],
  ['negative reference', wrap('<description>&#-1;</description>')],
  ['null reference', wrap('<description>&#0;</description>')],
  ['surrogate reference', wrap('<description>&#xD800;</description>')],
  ['out-of-range reference', wrap('<description>&#x110000;</description>')],
  ['forbidden literal control', wrap('<description/>\u0001')],
  ['lone surrogate', wrap('<description/>\uD800')],
  ['forbidden text terminator', wrap('<description/>]]>')],
  ['mismatched prefix', '<ValidationRule xmlns:a="urn:synthetic" xmlns:b="urn:synthetic"><description/><a:other></b:other></ValidationRule>'],
  ['case-mismatched tag', wrap('<description/><Other></other>')],
  ['unclosed sibling', wrap('<description/><other>')],
  ['stray close', wrap('<description/></other>')],
  ['two roots', wrap('<description/>') + '<other/>'],
  ['trailing text', wrap('<description/>') + 'oops'],
  ['leading text', 'oops' + wrap('<description/>')],
  ['unclosed comment', wrap('<!-- <description/>')],
  ['invalid comment double hyphen', wrap('<!-- bad -- comment --><description/>')],
  ['invalid comment trailing hyphen', wrap('<!-- bad ---><description/>')],
  ['unclosed CDATA', wrap('<![CDATA[<description/>')],
  ['unclosed PI', wrap('<?note <description/>')],
  ['missing PI target', wrap('<? ?><description/>')],
  ['PI target separator', wrap('<?note!bad?><description/>')],
  ['namespace-incompatible PI target', wrap('<?not:e x?><description a="b"/>')],
  ['prefix out of scope', '<ValidationRule><other xmlns:m="urn:synthetic"/><m:description/></ValidationRule>'],
  ['illegal XML namespace alias', '<ValidationRule xmlns:m="http://www.w3.org/XML/1998/namespace"><description/></ValidationRule>'],
  ['illegal xmlns namespace alias', '<ValidationRule xmlns:m="http://www.w3.org/2000/xmlns/"><description/></ValidationRule>'],
  ['multiple QName colons', '<ValidationRule xmlns:m="urn:synthetic"><m:n:description/></ValidationRule>'],
  ['CDATA outside root', '<![CDATA[ ]]>' + wrap('<description/>')],
  ['non-XML space between attributes', wrap('<description x="a"\u00A0y="b"/>')],
  ['reference outside root', '&#32;' + wrap('<description/>')],
  ['noncharacter reference', wrap('<description>&#xFFFE;</description>')],
  ['unsupported depth', wrap('<other>'.repeat(256) + '</other>'.repeat(256) + '<description/>')],
  ['unsupported Unicode QName', wrap('<\u00E9/><description/>')],
  ['reserved XML PI', wrap('<?XML version="1.0"?><description/>')],
  ['misplaced declaration', wrap('<?xml version="1.0"?><description/>')],
  ['unquoted XML version', '<?xml version=1.0?>' + wrap('<description/>')],
  ['invalid XML version', '<?xml version="9.9"?>' + wrap('<description/>')],
  ['duplicate XML declaration attribute', '<?xml version="1.0" version="1.0"?>' + wrap('<description/>')],
  ['DOCTYPE', '<!DOCTYPE ValidationRule>' + wrap('<description/>')],
  ['entity declaration', wrap('<!ENTITY ws " "><description/>')],
  ['unbound element prefix', wrap('<m:description/>')],
  ['unbound attribute prefix', wrap('<description m:note="x"/>')],
  ['empty prefixed namespace', '<ValidationRule xmlns:m=""><description/></ValidationRule>'],
  ['reserved namespace rebound', '<ValidationRule xmlns:xml="urn:synthetic"><description/></ValidationRule>'],
  ['xmlns prefix binding', '<ValidationRule xmlns:xmlns="urn:synthetic"><description/></ValidationRule>'],
  ['duplicate expanded attributes', '<ValidationRule xmlns:a="urn:synthetic" xmlns:b="urn:synthetic"><description a:x="a" b:x="b"/></ValidationRule>'],
]) {
  xmlRegression(label, () => {
    const result = evaluateSynthetic(text);
    assert.equal(result.finding, null);
    assert.equal(result.coverage.status, 'Malformed input');
  });
}
xmlRegression('real source location ignores comments CDATA and PI', () => {
  const result = evaluateSynthetic('<ValidationRule>\n<!-- <description/> -->\n<![CDATA[<description/>]]>\n<?note <description/> ?>\n<description/>\n</ValidationRule>');
  assert.equal(result.finding.source.startLine, 5);
  assert.equal(result.finding.source.endLine, 5);
});
xmlRegression('CR-only source lines', () => {
  assert.equal(evaluateSynthetic('<ValidationRule>\r<description/>\r</ValidationRule>').finding.source.startLine, 2);
});
xmlRegression('selection and archives retain distinct stable origins', () => {
  const text = wrap('<description/>');
  const sources = [undefined, 'archive:synthetic-a.zip', 'archive:synthetic-b.zip'];
  const results = sources.map((source) => evaluateSynthetic(text, source));
  assert.equal(new Set(results.map((result) => result.finding.findingId)).size, 3);
  for (const [index, result] of results.entries()) {
    assert.equal(result.finding.source.origin, sources[index] ?? 'selection');
    assert.deepEqual(result.finding.source, result.coverage.sourceRef);
    assert.deepEqual(result, evaluateSynthetic(text, sources[index]));
  }
});
xmlRegression('nonfinding provenance', () => {
  const result = evaluateSynthetic(wrap(''), 'archive:synthetic-a.zip');
  assert.equal(result.coverage.sourceRef.origin, 'archive:synthetic-a.zip');
});
// Namespace identity is the expanded name, never the spelling of a prefix.
// Empty namespaces remain supported only as a consistent legacy root/field pair.
const metadataNamespace = 'http://soap.sforce.com/2006/04/metadata';
const canonicalWrap = (body) => `<ValidationRule xmlns="${metadataNamespace}" xmlns:m="${metadataNamespace}" xmlns:f="urn:foreign">${body}</ValidationRule>`;
for (const [label, text, status, reasonCode] of [
  ['legacy blank field', wrap('<description/>'), 'Finding', 'blank-description'],
  ['legacy present field', wrap('<description>Context</description>'), 'Assessed', 'description-present'],
  ['canonical inherited default', canonicalWrap('<description/>'), 'Finding', 'blank-description'],
  ['canonical present field', canonicalWrap('<description>Context</description>'), 'Assessed', 'description-present'],
  ['canonical explicit field default', canonicalWrap(`<description xmlns="${metadataNamespace}"/>`), 'Finding', 'blank-description'],
  ['canonical prefixed field default root', canonicalWrap('<m:description/>'), 'Finding', 'blank-description'],
  ['canonical prefixed root default field', `<m:ValidationRule xmlns:m="${metadataNamespace}" xmlns="${metadataNamespace}"><description/></m:ValidationRule>`, 'Finding', 'blank-description'],
  ['canonical field local prefix declaration', `<m:ValidationRule xmlns:m="${metadataNamespace}"><n:description xmlns:n="${metadataNamespace}"/></m:ValidationRule>`, 'Finding', 'blank-description'],
  ['canonical prefix independent of foreign default', `<m:ValidationRule xmlns:m="${metadataNamespace}" xmlns="urn:foreign"><m:description/></m:ValidationRule>`, 'Finding', 'blank-description'],
  ['foreign sibling does not leak default', canonicalWrap('<other xmlns="urn:foreign"><description/></other><description/>'), 'Finding', 'blank-description'],
  ['foreign sibling does not leak prefix', canonicalWrap('<other xmlns:m="urn:foreign"><m:description/></other><m:description/>'), 'Finding', 'blank-description'],
  ['foreign default root', '<ValidationRule xmlns="urn:foreign"><description/></ValidationRule>', 'Not Assessed', 'validation-rule-namespace-unproven'],
  ['foreign prefixed root', '<f:ValidationRule xmlns:f="urn:foreign"><f:description>Context</f:description></f:ValidationRule>', 'Not Assessed', 'validation-rule-namespace-unproven'],
  ['foreign root canonical field', `<ValidationRule xmlns="urn:foreign"><description xmlns="${metadataNamespace}"/></ValidationRule>`, 'Not Assessed', 'validation-rule-namespace-unproven'],
  ['namespace URI is case sensitive', '<ValidationRule xmlns="http://soap.sforce.com/2006/04/Metadata"><description/></ValidationRule>', 'Not Assessed', 'validation-rule-namespace-unproven'],
  ['namespace URI trailing slash differs', `<ValidationRule xmlns="${metadataNamespace}/"><description/></ValidationRule>`, 'Not Assessed', 'validation-rule-namespace-unproven'],
  ['foreign direct blank field', canonicalWrap('<f:description/>'), 'Not Assessed', 'description-namespace-unproven'],
  ['foreign direct present field', canonicalWrap('<f:description>Context</f:description>'), 'Not Assessed', 'description-namespace-unproven'],
  ['default namespace shadowed on field', canonicalWrap('<description xmlns="urn:foreign"/>'), 'Not Assessed', 'description-namespace-unproven'],
  ['prefix namespace shadowed on field', canonicalWrap('<m:description xmlns:m="urn:foreign"/>'), 'Not Assessed', 'description-namespace-unproven'],
  ['default namespace removed on field', canonicalWrap('<description xmlns=""/>'), 'Not Assessed', 'description-namespace-unproven'],
  ['prefixed root does not default unprefixed field', `<m:ValidationRule xmlns:m="${metadataNamespace}"><description/></m:ValidationRule>`, 'Not Assessed', 'description-namespace-unproven'],
  ['legacy root foreign field', wrap('<f:description xmlns:f="urn:foreign"/>'), 'Not Assessed', 'description-namespace-unproven'],
  ['legacy root canonical field is mixed dialect', wrap(`<description xmlns="${metadataNamespace}"/>`), 'Not Assessed', 'description-namespace-unproven'],
  ['canonical plus foreign blank duplicate', canonicalWrap('<description/><f:description/>'), 'Not Assessed', 'ambiguous-description-field'],
  ['foreign present plus canonical blank duplicate', canonicalWrap('<f:description>Context</f:description><description/>'), 'Not Assessed', 'ambiguous-description-field'],
  ['canonical present plus foreign blank duplicate', canonicalWrap('<description>Context</description><f:description/>'), 'Not Assessed', 'ambiguous-description-field'],
  ['canonical plus removed namespace duplicate', canonicalWrap('<description/><description xmlns=""/>'), 'Not Assessed', 'ambiguous-description-field'],
  ['legacy plus foreign duplicate', wrap('<description/><f:description xmlns:f="urn:foreign"/>'), 'Not Assessed', 'ambiguous-description-field'],
  ['canonical plus shadowed prefix duplicate', canonicalWrap('<m:description/><m:description xmlns:m="urn:foreign"/>'), 'Not Assessed', 'ambiguous-description-field'],
  ['unbound root prefix', '<m:ValidationRule><description/></m:ValidationRule>', 'Malformed input', 'malformed-validation-rule-xml'],
  ['canonical root unbound field prefix', canonicalWrap('<missing:description/>'), 'Malformed input', 'malformed-validation-rule-xml'],
]) {
  xmlRegression(`namespace: ${label}`, () => {
    const result = evaluateSynthetic(text);
    assert.equal(result.coverage.status, status);
    assert.equal(result.coverage.reasonCode, reasonCode);
    assert.equal(Boolean(result.finding), status === 'Finding');
  });
}
xmlRegression('reader resolves inherited, overridden and restored namespaces', () => {
  const result = readXml(canonicalWrap('<m:description/><other xmlns="urn:foreign"><child/></other><description/><description xmlns=""/>'));
  assert.equal(result.ok, true);
  assert.equal(result.root.namespaceURI, metadataNamespace);
  assert.deepEqual(result.root.children.map((node) => node.namespaceURI), [metadataNamespace, 'urn:foreign', metadataNamespace, '']);
  assert.equal(result.root.children[1].children[0].namespaceURI, 'urn:foreign');
  assert.equal(readXml(wrap('<description/>')).root.namespaceURI, '');
});
assert.deepEqual(xmlRegressionFailures, [], 'synthetic XML regressions');
console.log(`${xmlRegressionCount} synthetic XML/provenance regressions passed`);

const positiveXml = `<?xml version="1.0" encoding="UTF-8"?>
<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Fictional_Blank_Description</fullName>
  <active>true</active>
  <description>   </description>
  <errorConditionFormula>ISBLANK(Name)</errorConditionFormula>
  <errorMessage>Name is required</errorMessage>
</ValidationRule>`;
const linuxAbsoluteZipPath = ['/', 'home', '/fictional/org/objects/Account/validationRules/UnixAbsolute.validationRule-meta.xml'].join('');
const windowsAbsoluteZipPath = ['C:', '\\', 'Users', '\\Fictional\\org\\objects\\Account\\validationRules\\WindowsAbsolute.validationRule-meta.xml'].join('');

const negativeXml = `<ValidationRule><fullName>Fictional_With_Description</fullName><description>Clear business context.</description><errorMessage>Stop</errorMessage></ValidationRule>`;
const absentXml = `<ValidationRule><fullName>Fictional_Absent</fullName><errorMessage>Stop</errorMessage></ValidationRule>`;
const duplicateXml = `<ValidationRule><description></description><description></description><errorMessage>Stop</errorMessage></ValidationRule>`;
const surrogateXml = `<ValidationRule><errorMessage>Use this text only.</errorMessage></ValidationRule>`;
const nestedXml = `<ValidationRule><metadata><description></description></metadata><errorMessage>Stop</errorMessage></ValidationRule>`;
const malformedXml = `<ValidationRule><description></ValidationRule>`;
const doctypeXml = `<!DOCTYPE ValidationRule [<!ENTITY xxe SYSTEM "file:///not-used">]><ValidationRule><description></description></ValidationRule>`;
const namespacedDescriptionXml = `<md:ValidationRule xmlns:md="http://soap.sforce.com/2006/04/metadata">
  <md:fullName>Fictional_Namespaced_Blank</md:fullName>
  <md:description>   </md:description>
  <md:errorMessage>Stop</md:errorMessage>
</md:ValidationRule>`;
const commentDescriptionXml = `<ValidationRule><description><!-- intentionally empty --></description><errorMessage>Stop</errorMessage></ValidationRule>`;
const cdataDescriptionXml = `<ValidationRule><description><![CDATA[   ]]></description><errorMessage>Stop</errorMessage></ValidationRule>`;

const positive = evaluateValidationDescription({
  path: 'objects/Account/validationRules/Fictional_Blank_Description.validationRule-meta.xml',
  source: 'selection',
  text: positiveXml,
});
assert.equal(positive.coverage.status, 'Finding');
assert.equal(positive.finding.ruleId, 'VALIDATION-001-BROWSER');
assert.equal(positive.finding.severity, 'low');
assert.equal(positive.finding.confidence, 'medium');
assert.equal(positive.finding.title, 'Validation rule missing description');
assert.equal(positive.finding.source.startLine, 5);
assert.equal(positive.finding.limitations.length, 1);
assert.deepEqual(positive, evaluateValidationDescription({
  path: 'objects/Account/validationRules/Fictional_Blank_Description.validationRule-meta.xml',
  source: 'selection',
  text: positiveXml,
}));

for (const [label, xml, status, reasonCode] of [
  ['negative', negativeXml, 'Assessed', 'description-present'],
  ['absent', absentXml, 'Not Assessed', 'description-field-unproven'],
  ['duplicate', duplicateXml, 'Not Assessed', 'ambiguous-description-field'],
  ['surrogate', surrogateXml, 'Not Assessed', 'description-field-unproven'],
  ['nested', nestedXml, 'Not Assessed', 'description-field-unproven'],
  ['malformed', malformedXml, 'Malformed input', 'malformed-validation-rule-xml'],
  ['doctype', doctypeXml, 'Malformed input', 'malformed-validation-rule-xml'],
  ['comment-description', commentDescriptionXml, 'Not Assessed', 'description-content-unproven'],
  ['cdata-description', cdataDescriptionXml, 'Not Assessed', 'description-content-unproven'],
]) {
  const result = evaluateValidationDescription({ path: `objects/Account/validationRules/${label}.validationRule-meta.xml`, source: 'selection', text: xml });
  assert.equal(result.finding, null, label);
  assert.equal(result.coverage.status, status, label);
  assert.equal(result.coverage.reasonCode, reasonCode, label);
}

const namespaced = evaluateValidationDescription({
  path: 'objects/Account/validationRules/Fictional_Namespaced_Blank.validationRule-meta.xml',
  source: 'selection',
  text: namespacedDescriptionXml,
});
assert.equal(namespaced.coverage.status, 'Finding');
assert.equal(namespaced.finding.source.startLine, 3);

const zipEntry = evaluateValidationDescription({
  path: 'objects/Account/validationRules/Fictional.validationRule-meta.xml',
  source: 'archive:fictional.zip',
  text: positiveXml,
});
assert.equal(zipEntry.finding.ruleId, 'VALIDATION-001-BROWSER');
assert.equal(zipEntry.coverage.status, 'Finding');
assert.equal(zipEntry.coverage.reasonCode, 'blank-description');

const scanResult = await classifySelectedFiles([
  file('objects/Account/validationRules/Fictional_Blank_Description.validationRule-meta.xml', positiveXml),
  file('objects/Account/validationRules/Fictional_With_Description.validationRule-meta.xml', negativeXml),
  file('objects/Account/validationRules/notes.txt', 'not metadata'),
]);
assert.equal(scanResult.schemaVersion, 'browser-public-beta-result-v0');
assert.deepEqual(scanResult.rulesEvaluated, ['VALIDATION-001-BROWSER']);
assert.equal(scanResult.findings.length, 1);
assert.equal(scanResult.findings[0].title, 'Validation rule missing description');
assert.equal(scanResult.coverage.some((row) => row.status === 'Unsupported' && row.path.endsWith('notes.txt')), true);
assert.equal(scanResult.coverage.some((row) => row.ruleId === 'VALIDATION-001-BROWSER' && row.status === 'Finding'), true);
assert.equal(renderLimitations(scanResult).includes('public beta evaluates one browser ValidationRule XML check'), true);

const zipScanResult = await classifySelectedFiles([
  zipFile('fictional-metadata.zip', makeZip([
    {
      name: 'unpackaged/objects/Account/validationRules/Fictional_Zip_Blank.validationRule-meta.xml',
      text: positiveXml,
      method: 8,
    },
    {
      name: 'unpackaged/objects/Account/validationRules/Fictional_Zip_With_Description.validationRule-meta.xml',
      text: negativeXml,
      method: 8,
    },
    {
      name: 'unpackaged/objects/Account/validationRules/notes.txt',
      text: 'not metadata',
      method: 8,
    },
  ])),
]);
assert.equal(zipScanResult.findings.length, 1);
assert.equal(zipScanResult.findings[0].source.path, 'unpackaged/objects/Account/validationRules/Fictional_Zip_Blank.validationRule-meta.xml');
assert.equal(zipScanResult.findings[0].source.origin, 'archive:fictional-metadata.zip');
assert.equal(scanResult.findings[0].source.origin, 'selection');
assert.equal(zipScanResult.coverage.some((row) => row.source === 'archive:fictional-metadata.zip' && row.status === 'Finding'), true);
assert.equal(zipScanResult.coverage.some((row) => row.source === 'archive:fictional-metadata.zip' && row.status === 'Assessed'), true);
assert.equal(zipScanResult.coverage.some((row) => row.status === 'Unsupported' && row.path.endsWith('notes.txt')), true);
assert.equal(renderLimitations(zipScanResult).includes('bounded ZIP content extraction'), true);

const blockedZipScanResult = await classifySelectedFiles([
  zipFile('blocked.zip', makeZip([
    {
      name: '../secrets/Fictional.validationRule-meta.xml',
      text: positiveXml,
      method: 8,
    },
    {
      name: linuxAbsoluteZipPath,
      text: positiveXml,
      method: 8,
    },
    {
      name: windowsAbsoluteZipPath,
      text: positiveXml,
      method: 8,
    },
    {
      name: 'unpackaged/objects/Account/validationRules/Big.validationRule-meta.xml',
      text: 'x'.repeat(1024 * 1024 + 1),
      method: 8,
    },
  ])),
]);
assert.equal(blockedZipScanResult.findings.length, 0);
assert.equal(blockedZipScanResult.coverage.some((row) => row.status === 'Rejected' && row.reason.includes('unsafe ZIP entry path')), true);
assert.equal(blockedZipScanResult.coverage.some((row) => row.status === 'Rejected' && row.reason.includes('Absolute-looking paths')), true);
assert.equal(blockedZipScanResult.coverage.some((row) => row.status === 'Not Assessed' && row.reason.includes('exceeds browser A7 per-entry content limit')), true);

const forgedZipScanResult = await classifySelectedFiles([
  zipFile('forged-size.zip', makeZip([
    {
      name: 'unpackaged/objects/Account/validationRules/ForgedSize.validationRule-meta.xml',
      text: 'x'.repeat(2 * 1024 * 1024),
      method: 8,
      declaredUncompressedSize: 1,
    },
  ])),
]);
assert.equal(forgedZipScanResult.findings.length, 0);
assert.equal(forgedZipScanResult.coverage.some((row) => row.status === 'Malformed input' && row.reason.includes('could not be extracted or decoded locally')), true);

const sampleZipScanResult = await classifySelectedFiles([
  zipFile('fictional-validation-rule-metadata.zip', readFileSync(join(root, 'docs/samples/fictional-validation-rule-metadata.zip'))),
]);
assert.equal(sampleZipScanResult.findings.length, 1);
assert.equal(sampleZipScanResult.findings[0].source.path, 'unpackaged/objects/Account/validationRules/Fictional_Blank_Description.validationRule-meta.xml');
assert.equal(sampleZipScanResult.coverage.some((row) => row.source === 'archive:fictional-validation-rule-metadata.zip' && row.status === 'Finding'), true);

const tooManyEntriesResult = await classifySelectedFiles([
  zipFile('too-many.zip', makeZip(Array.from({ length: 201 }, (_, index) => ({
    name: `unpackaged/objects/Account/validationRules/Entry_${index}.validationRule-meta.xml`,
    text: negativeXml,
    method: 8,
  })))),
]);
assert.equal(tooManyEntriesResult.findings.length, 0);
assert.equal(tooManyEntriesResult.coverage.some((row) => row.status === 'Rejected' && row.reason.includes('entry count limit')), true);

console.log('validation rule checks passed');

function file(name, text) {
  return {
    name,
    size: new TextEncoder().encode(text).byteLength,
    async arrayBuffer() { return new TextEncoder().encode(text).buffer; },
  };
}

function zipFile(name, buffer) {
  const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() { return bytes; },
  };
}

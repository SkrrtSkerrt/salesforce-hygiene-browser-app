import { readXml } from './xml-reader.js';

export const VALIDATION_001_BROWSER = {
  ruleId: 'VALIDATION-001-BROWSER',
  title: 'Validation rule missing description',
  severity: 'low',
  confidence: 'medium',
  limitation: 'Browser VALIDATION-001 checks local ValidationRule XML files from direct selection or bounded client-side ZIP extraction with exactly one direct description element; review business intent manually.',
};

export function evaluateValidationDescription({ path, source = 'selection', text }) {
  const parsed = readXml(text);
  let sourceRef = buildSource(path, source, text, parsed.ok ? parsed.root.offset : 0);
  if (!parsed.ok || parsed.root.localName !== 'ValidationRule') {
    return ruleCoverage(path, source, 'Malformed input', 'malformed-validation-rule-xml', parsed.ok ? 'XML root is not ValidationRule.' : parsed.reason, sourceRef);
  }

  const descriptions = parsed.root.children.filter((node) => node.localName === 'description');
  if (descriptions.length !== 1) {
    return ruleCoverage(path, source, 'Not Assessed', descriptions.length === 0 ? 'description-field-unproven' : 'ambiguous-description-field', 'ValidationRule description is not represented by exactly one direct description element.', sourceRef);
  }

  const [description] = descriptions;
  sourceRef = buildSource(path, source, text, description.offset);
  if (description.hasMarkup) {
    return ruleCoverage(path, source, 'Not Assessed', 'description-content-unproven', 'ValidationRule description contains child markup or XML constructs outside the conservative browser check.', sourceRef);
  }

  if (description.text.trim()) {
    return ruleCoverage(path, source, 'Assessed', 'description-present', 'ValidationRule has a nonblank direct description.', sourceRef);
  }

  return {
    coverage: ruleCoverage(path, source, 'Finding', 'blank-description', 'ValidationRule has exactly one direct blank description element.', sourceRef).coverage,
    finding: {
      findingId: stableId([VALIDATION_001_BROWSER.ruleId, source, path, String(sourceRef.startLine), VALIDATION_001_BROWSER.title], 'finding'),
      ruleId: VALIDATION_001_BROWSER.ruleId,
      severity: VALIDATION_001_BROWSER.severity,
      confidence: VALIDATION_001_BROWSER.confidence,
      title: VALIDATION_001_BROWSER.title,
      message: `Validation rule ${metadataName(path)} has no description.`,
      source: sourceRef,
      limitations: [VALIDATION_001_BROWSER.limitation],
    },
  };
}

function ruleCoverage(path, source, status, reasonCode, reason, sourceRef) {
  return {
    coverage: {
      ruleId: VALIDATION_001_BROWSER.ruleId,
      path,
      source,
      status,
      reasonCode,
      reason,
      sourceRef,
    },
    finding: null,
  };
}

function buildSource(path, source, text, offset) {
  // Offsets come only from real element tokens, never lookalikes in XML trivia.
  const line = String(text || '').slice(0, offset).split(/\r\n|\r|\n/).length;
  return { path, origin: source, startLine: line, endLine: line };
}

function metadataName(path) {
  return String(path || '')
    .split('/')
    .pop()
    .replace(/\.validationrule-meta\.xml$/i, '') || 'unknown';
}

function stableId(parts, prefix) {
  const text = JSON.stringify(parts);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
}

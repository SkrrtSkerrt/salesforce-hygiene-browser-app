export const VALIDATION_001_BROWSER = {
  ruleId: 'VALIDATION-001-BROWSER',
  title: 'Validation rule missing description',
  severity: 'low',
  confidence: 'medium',
  limitation: 'Browser VALIDATION-001 checks local ValidationRule XML files from direct selection or bounded client-side ZIP extraction with exactly one direct description element; review business intent manually.',
};

export function evaluateValidationDescription({ path, source = 'selection', text }) {
  const sourceRef = buildSource(path, text, 'description');

  const parsed = parseValidationRuleXml(text);
  if (!parsed.ok) {
    return ruleCoverage(path, source, 'Malformed input', 'malformed-validation-rule-xml', parsed.reason, sourceRef);
  }

  const descriptions = directChildTexts(parsed.body, 'description');
  if (!descriptions.ok) {
    return ruleCoverage(path, source, 'Malformed input', 'malformed-validation-rule-xml', descriptions.reason, sourceRef);
  }

  if (descriptions.values.length !== 1) {
    return ruleCoverage(path, source, 'Not Assessed', descriptions.values.length === 0 ? 'description-field-unproven' : 'ambiguous-description-field', 'ValidationRule description is not represented by exactly one direct description element.', sourceRef);
  }

  if (hasUnsupportedDescriptionChildContent(descriptions.values[0])) {
    return ruleCoverage(path, source, 'Not Assessed', 'description-content-unproven', 'ValidationRule description contains child markup or XML constructs outside the conservative browser check.', sourceRef);
  }

  if (descriptions.values[0].trim()) {
    return ruleCoverage(path, source, 'Assessed', 'description-present', 'ValidationRule has a nonblank direct description.', sourceRef);
  }

  return {
    coverage: ruleCoverage(path, source, 'Finding', 'blank-description', 'ValidationRule has exactly one direct blank description element.', sourceRef).coverage,
    finding: {
      findingId: stableId([VALIDATION_001_BROWSER.ruleId, path, String(sourceRef.startLine), VALIDATION_001_BROWSER.title], 'finding'),
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

function parseValidationRuleXml(text) {
  const trimmed = String(text || '').trim().replace(/^<\?xml[^>]*>\s*/i, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(trimmed)) {
    return { ok: false, reason: 'XML DTD or entity declarations are outside the conservative browser ValidationRule check.' };
  }
  const rootMatch = trimmed.match(/^<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([\s\S]*)<\/\1>\s*$/);
  if (!rootMatch) {
    return { ok: false, reason: 'XML does not have one complete ValidationRule root element.' };
  }
  if (localName(rootMatch[1]) !== 'ValidationRule') {
    return { ok: false, reason: 'XML root is not ValidationRule.' };
  }
  return { ok: true, body: rootMatch[2] };
}

function directChildTexts(body, wantedLocalName) {
  const values = [];
  const tagPattern = /<([^!?/][^>\s/]*)([^>]*)>|<\/([^>]+)>/g;
  const stack = [];
  let match;

  while ((match = tagPattern.exec(body)) !== null) {
    const [token, openName, openRest = '', closeName] = match;
    if (openName) {
      const selfClosing = /\/\s*>$/.test(token) || /\/$/.test(openRest.trim());
      if (stack.length === 0 && localName(openName) === wantedLocalName) {
        if (selfClosing) {
          values.push('');
          continue;
        }
        const close = findClose(body, openName, tagPattern.lastIndex);
        if (!close.ok) return { ok: false, reason: close.reason };
        values.push(body.slice(tagPattern.lastIndex, close.start));
        tagPattern.lastIndex = close.end;
        continue;
      }
      if (!selfClosing) stack.push(openName);
      continue;
    }

    if (closeName) {
      const last = stack.pop();
      if (!last || localName(last) !== localName(closeName.trim())) {
        return { ok: false, reason: 'XML direct-child scan encountered mismatched closing tags.' };
      }
    }
  }

  if (stack.length) return { ok: false, reason: 'XML direct-child scan ended with unclosed tags.' };
  return { ok: true, values };
}

function findClose(body, openName, offset) {
  const closePattern = new RegExp(`<\\/${escapeRegExp(openName)}\\s*>`, 'g');
  closePattern.lastIndex = offset;
  const close = closePattern.exec(body);
  if (!close) return { ok: false, reason: `XML direct child ${localName(openName)} is not closed.` };
  return { ok: true, start: close.index, end: closePattern.lastIndex };
}

function hasUnsupportedDescriptionChildContent(value) {
  return /<!\[CDATA\[|<!--|<[^>]+>/.test(String(value || ''));
}

function buildSource(path, text, localElementName) {
  const line = lineForElement(text, localElementName);
  return { path, startLine: line, endLine: line };
}

function lineForElement(text, localElementName) {
  const pattern = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${escapeRegExp(localElementName)}(?:\\s|>|/)`, 'i');
  const match = pattern.exec(String(text || ''));
  if (!match) return 1;
  return String(text || '').slice(0, match.index).split('\n').length;
}

function metadataName(path) {
  return String(path || '')
    .split('/')
    .pop()
    .replace(/\.validationrule-meta\.xml$/i, '') || 'unknown';
}

function localName(name) {
  return String(name || '').split(':').pop();
}

function stableId(parts, prefix) {
  const text = parts.join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

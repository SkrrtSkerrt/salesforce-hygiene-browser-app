// Conservative XML 1.0 reader for local metadata, not a general XML processor.
// ASCII QNames only, bounded nesting, no DTD/entity declarations or XML 1.1.
// Unsupported syntax fails closed; comments/CDATA/PIs are never element tokens.
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const XML_SPACE = /^[ \t\r\n]*$/;
const MAX_DEPTH = 256;

export function readXml(text) {
  try {
    return { ok: true, root: parseXml(String(text || '')) };
  } catch (error) {
    if (!(error instanceof XmlReadError)) throw error;
    return { ok: false, reason: error.message };
  }
}

class XmlReadError extends Error {}
function reject(reason) { throw new XmlReadError(reason); }

function parseXml(input) {
  for (const character of input) {
    if (!isXmlCharacter(character.codePointAt(0))) reject('XML contains an invalid XML 1.0 character.');
  }
  const start = input.startsWith('\uFEFF') ? 1 : 0;
  let cursor = start;
  let root = null;
  const stack = [];
  const baseNamespaces = Object.create(null);
  baseNamespaces.xml = XML_NAMESPACE;
  const namePattern = /[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?/y;

  function readName() {
    namePattern.lastIndex = cursor;
    const match = namePattern.exec(input);
    if (!match) reject('XML contains an invalid or unsupported QName.');
    cursor = namePattern.lastIndex;
    return match[0];
  }
  function skipSpace() {
    const before = cursor;
    while (cursor < input.length && /[ \t\r\n]/.test(input[cursor])) cursor += 1;
    return cursor !== before;
  }
  function markConstruct() {
    if (stack.length) stack[stack.length - 1].hasMarkup = true;
  }

  while (cursor < input.length) {
    const parent = stack[stack.length - 1];
    if (input[cursor] !== '<') {
      const next = input.indexOf('<', cursor);
      const end = next < 0 ? input.length : next;
      const raw = input.slice(cursor, end);
      if (!parent) {
        if (!XML_SPACE.test(raw)) reject('XML has text outside its root element.');
      } else {
        if (raw.includes(']]>')) reject('XML character data contains a reserved CDATA terminator.');
        parent.text += decodeEntities(raw);
      }
      cursor = end;
      continue;
    }

    if (input.startsWith('<!--', cursor)) {
      const end = input.indexOf('-->', cursor + 4);
      if (end < 0) reject('XML comment is not closed.');
      const content = input.slice(cursor + 4, end);
      if (content.includes('--') || content.endsWith('-')) reject('XML comment contains an invalid double hyphen.');
      markConstruct();
      cursor = end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', cursor)) {
      if (!parent) reject('XML CDATA is outside the root element.');
      const end = input.indexOf(']]>', cursor + 9);
      if (end < 0) reject('XML CDATA section is not closed.');
      markConstruct();
      parent.text += input.slice(cursor + 9, end);
      cursor = end + 3;
      continue;
    }
    if (input.startsWith('<?', cursor)) {
      const offset = cursor;
      cursor += 2;
      const target = readName();
      // Namespace-aware XML reserves colons for element/attribute QNames.
      if (target.includes(':')) reject('XML processing instruction target contains an unsupported colon.');
      const end = input.indexOf('?>', cursor);
      if (end < 0) reject('XML processing instruction is not closed.');
      const data = input.slice(cursor, end);
      if (data && !/^[ \t\r\n]/.test(data)) reject('XML processing instruction target is not separated from its data.');
      if (target.toLowerCase() === 'xml') {
        // XML declarations have fixed ordering and are allowed only at the start.
        const declaration = /^xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(["'])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(["'])(?:yes|no)\3)?[ \t\r\n]*$/;
        if (offset !== start || !declaration.test(target + data)) reject('XML declaration is misplaced, malformed, or unsupported.');
      }
      markConstruct();
      cursor = end + 2;
      continue;
    }
    if (input.startsWith('<!', cursor)) {
      reject('XML declarations, including DTDs and entity declarations, are unsupported.');
    }
    if (input.startsWith('</', cursor)) {
      cursor += 2;
      const name = readName();
      skipSpace();
      if (input[cursor] !== '>' || !parent || name !== parent.name) reject('XML has mismatched closing QNames.');
      cursor += 1;
      stack.pop();
      continue;
    }

    const offset = cursor;
    cursor += 1;
    const name = readName();
    const attributes = [];
    const attributeNames = new Set();
    let selfClosing = false;
    while (cursor < input.length) {
      const separated = skipSpace();
      if (input.startsWith('/>', cursor)) {
        cursor += 2;
        selfClosing = true;
        break;
      }
      if (input[cursor] === '>') {
        cursor += 1;
        break;
      }
      if (!separated) reject('XML attributes must be whitespace-separated.');
      const attributeName = readName();
      if (attributeNames.has(attributeName)) reject('XML contains duplicate attributes.');
      attributeNames.add(attributeName);
      skipSpace();
      if (input[cursor] !== '=') reject('XML attribute is missing an equals sign.');
      cursor += 1;
      skipSpace();
      const quote = input[cursor];
      if (quote !== '"' && quote !== "'") reject('XML attribute values must be quoted.');
      cursor += 1;
      const end = input.indexOf(quote, cursor);
      if (end < 0) reject('XML attribute quote is not closed.');
      const raw = input.slice(cursor, end);
      if (raw.includes('<')) reject('XML attribute contains a literal less-than character.');
      // Normalize literal whitespace before decoding: character refs stay literal.
      const value = decodeEntities(raw.replace(/\r\n?/g, '\n').replace(/[\t\n]/g, ' '));
      attributes.push({ name: attributeName, value });
      cursor = end + 1;
    }
    if (input[cursor - 1] !== '>') reject('XML start tag is not closed.');
    if (stack.length >= MAX_DEPTH) reject('XML nesting exceeds the conservative reader limit.');
    if (!parent && root) reject('XML has multiple root elements.');

    const namespaces = Object.create(parent ? parent.namespaces : baseNamespaces);
    for (const attribute of attributes) {
      if (attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:')) continue;
      const prefix = attribute.name === 'xmlns' ? '' : attribute.name.slice(6);
      const uri = attribute.value;
      if ((prefix && !uri) || /\s/.test(uri) || prefix === 'xmlns' || uri === XMLNS_NAMESPACE
        || (prefix === 'xml') !== (uri === XML_NAMESPACE)) {
        reject('XML namespace declaration is invalid or unsupported.');
      }
      namespaces[prefix] = uri;
    }
    checkNamespace(name, namespaces);
    const expandedAttributes = new Set();
    for (const attribute of attributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
      checkNamespace(attribute.name, namespaces);
      const [prefix, local] = splitName(attribute.name);
      const expanded = JSON.stringify([prefix ? namespaces[prefix] : '', local]);
      if (expandedAttributes.has(expanded)) reject('XML contains duplicate expanded attribute names.');
      expandedAttributes.add(expanded);
    }
    const node = { name, localName: splitName(name)[1], offset, text: '', hasMarkup: false, children: [], namespaces };
    if (parent) {
      parent.hasMarkup = true;
      parent.children.push(node);
    } else {
      root = node;
    }
    if (!selfClosing) stack.push(node);
  }
  if (!root || stack.length) reject('XML does not have one complete root element.');
  return root;
}

function splitName(name) {
  const colon = name.indexOf(':');
  return colon < 0 ? ['', name] : [name.slice(0, colon), name.slice(colon + 1)];
}
function checkNamespace(name, namespaces) {
  const [prefix] = splitName(name);
  if (prefix && (prefix === 'xmlns' || !namespaces[prefix])) reject('XML QName has an undeclared or reserved prefix.');
}
function isXmlCharacter(code) {
  return code === 0x9 || code === 0xA || code === 0xD
    || (code >= 0x20 && code <= 0xD7FF)
    || (code >= 0xE000 && code <= 0xFFFD)
    || (code >= 0x10000 && code <= 0x10FFFF);
}
function decodeEntities(raw) {
  let decoded = '';
  let cursor = 0;
  while (cursor < raw.length) {
    const ampersand = raw.indexOf('&', cursor);
    if (ampersand < 0) return decoded + raw.slice(cursor);
    decoded += raw.slice(cursor, ampersand);
    const end = raw.indexOf(';', ampersand + 1);
    if (end < 0) reject('XML entity reference is not terminated.');
    const entity = raw.slice(ampersand + 1, end);
    if (Object.hasOwn(ENTITIES, entity)) {
      decoded += ENTITIES[entity];
    } else {
      let code;
      if (/^#[0-9]+$/.test(entity)) code = Number(entity.slice(1));
      else if (/^#x[0-9A-Fa-f]+$/.test(entity)) code = Number.parseInt(entity.slice(2), 16);
      else reject('XML entity reference is unknown or malformed.');
      if (!isXmlCharacter(code)) reject('XML character reference is outside the XML 1.0 character range.');
      decoded += String.fromCodePoint(code);
    }
    cursor = end + 1;
  }
  return decoded;
}

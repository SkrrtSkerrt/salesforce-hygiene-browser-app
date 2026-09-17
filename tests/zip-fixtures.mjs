import { deflateRawSync } from 'node:zlib';

export function makeZip(entries) {
  const encoder = new TextEncoder();
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Array.isArray(entry) ? entry[0] : entry.name;
    const text = Array.isArray(entry) ? entry[1] : entry.text;
    const method = Array.isArray(entry) ? 0 : entry.method || 0;
    const declaredUncompressedSize = Array.isArray(entry)
      ? undefined
      : entry.declaredUncompressedSize;
    const nameBytes = encoder.encode(name);
    const sourceBytes = encoder.encode(text);
    const dataBytes = method === 8 ? deflateRawSync(sourceBytes) : sourceBytes;
    const uncompressedSize = declaredUncompressedSize ?? sourceBytes.length;

    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, uncompressedSize, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    fileParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, uncompressedSize, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return concat([...fileParts, ...centralParts, end]).buffer;
}

function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

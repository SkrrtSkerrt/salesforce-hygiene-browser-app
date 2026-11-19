import { deflateRawSync } from 'node:zlib';

export function makeZip(entries) {
  const encoder = new TextEncoder();
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const options = Array.isArray(entry) ? { name: entry[0], text: entry[1] } : entry;
    const { name, text, method = 0, flags = 0, descriptor = false,
      localExtra = new Uint8Array(), centralExtra = new Uint8Array() } = options;
    const nameBytes = encoder.encode(name);
    const sourceBytes = encoder.encode(text);
    const dataBytes = method === 8 ? deflateRawSync(sourceBytes) : sourceBytes;
    const uncompressedSize = options.declaredUncompressedSize ?? sourceBytes.length;
    const checksum = crc32(sourceBytes);
    const entryFlags = flags | (descriptor ? 8 : 0);

    const local = new Uint8Array(30 + nameBytes.length + localExtra.length + dataBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, entryFlags, true);
    localView.setUint16(8, method, true);
    if (!descriptor) {
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, uncompressedSize, true);
    }
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, localExtra.length, true);
    local.set(nameBytes, 30);
    local.set(localExtra, 30 + nameBytes.length);
    local.set(dataBytes, 30 + nameBytes.length + localExtra.length);
    fileParts.push(local);
    let descriptorSize = 0;
    if (descriptor) {
      const signed = descriptor !== 'unsigned';
      const part = new Uint8Array(signed ? 16 : 12);
      const view = new DataView(part.buffer);
      const start = signed ? 4 : 0;
      if (signed) view.setUint32(0, 0x08074b50, true);
      view.setUint32(start, checksum, true);
      view.setUint32(start + 4, dataBytes.length, true);
      view.setUint32(start + 8, uncompressedSize, true);
      fileParts.push(part);
      descriptorSize = part.length;
    }

    const central = new Uint8Array(46 + nameBytes.length + centralExtra.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, entryFlags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, uncompressedSize, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, centralExtra.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    central.set(centralExtra, 46 + nameBytes.length);
    centralParts.push(central);
    offset += local.length + descriptorSize;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concat([...fileParts, ...centralParts, end]).buffer;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
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

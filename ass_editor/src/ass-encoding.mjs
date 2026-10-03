/** Decode without discarding a BOM. Reject legacy byte encodings instead of losing text. */
export function decodeASS(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try {
    const source = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
    // A missing UTF-16 BOM often produces an apparently valid UTF-8 string with NULs.
    if (encoding === 'utf-8' && source.includes('\0')) throw new Error('NUL');
    return { source, encoding };
  } catch {
    throw new Error('无法读取字幕编码。请使用 UTF-8，或带 BOM 的 UTF-16；旧 ANSI / GBK 文件请先转换编码。');
  }
}

export function encodeASS(source, encoding = 'utf-8') {
  if (encoding === 'utf-8') return new TextEncoder().encode(source);
  if (encoding !== 'utf-16le' && encoding !== 'utf-16be') throw new Error('不支持的字幕编码');
  const text = source.startsWith('\uFEFF') ? source : '\uFEFF' + source;
  const bytes = new Uint8Array(text.length * 2);
  const littleEndian = encoding === 'utf-16le';
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    bytes[index * 2 + (littleEndian ? 0 : 1)] = code & 255;
    bytes[index * 2 + (littleEndian ? 1 : 0)] = code >> 8;
  }
  return bytes;
}

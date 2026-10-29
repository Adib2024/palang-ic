// Minimal ZIP reader for .docx / .xlsx (stored or deflated entries), using
// the browser's own DecompressionStream. Reads the central directory, so
// data descriptors and odd local headers don't matter.

const dec = new TextDecoder();

/**
 * @param {Uint8Array} bytes
 * @returns {Map<string, () => Promise<Uint8Array>>} entry name → loader
 */
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: search back from the end (comment ≤ 64 KB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('notzip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('notzip');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    out.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + size);
      if (method === 0) return raw;
      if (method !== 8) throw new Error('zipmethod');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
  }
  return out;
}

/** Read one entry as text ('' if missing). */
export async function zipText(zip, name) {
  const get = zip.get(name);
  return get ? dec.decode(await get()) : '';
}

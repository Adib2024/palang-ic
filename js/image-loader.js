// Load a user-picked photo into a correctly-oriented, size-capped canvas.
// Everything happens in memory via object URLs; nothing is sent anywhere.

// Phones rarely need more than this for a document photo, and it keeps
// memory use sane on low-end devices.
export const MAX_SIDE = 3000;

// 2x1 JPEG tagged EXIF orientation 6 (rotate 90°). If the browser decodes
// it as 1x2, it already applies EXIF orientation when drawing images.
const ORIENTATION_PROBE =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAFA3PEY8MlBGQUZaVVBfeMiCeG5uePWvuZHI////////////////////////////////////////////////////2wBDAVVaWnhpeOuCguv/////////////////////////////////////////////////////////////////////////wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC7RRRQB//Z';

let autoOrientPromise;
function browserAutoOrients() {
  if (!autoOrientPromise) {
    autoOrientPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.width === 1 && img.height === 2);
      img.onerror = () => resolve(false);
      img.src = ORIENTATION_PROBE;
    });
  }
  return autoOrientPromise;
}

/** Read the EXIF orientation tag (1-8) from a JPEG ArrayBuffer; 1 if absent. */
export function readExifOrientation(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 10 > view.byteLength) break;
        if (view.getUint16(entry, little) === 0x0112) {
          const v = view.getUint16(entry + 8, little);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    offset += 2 + size;
  }
  return 1;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
}

// Apply the canvas transform for an EXIF orientation (only used on old
// browsers that don't rotate images themselves).
function applyOrientation(ctx, o, w, h) {
  switch (o) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    default: break;
  }
}

/**
 * Decode `file` into an upright canvas no larger than `maxSide`.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function loadPhoto(file, maxSide = MAX_SIDE) {
  try {
    return await loadWithBrowser(file, maxSide);
  } catch (err) {
    // iPhone photos (HEIC) only open natively in Safari: decode them ourselves.
    if (await isHeic(file)) return decodeHeic(file, maxSide);
    throw err;
  }
}

/** Is this a HEIC/HEIF picture (by type, name or the file's own header)? */
export async function isHeic(file) {
  if (/image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '')) return true;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const tag = String.fromCharCode(...head.subarray(4, 12));
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(tag);
}

let heicWorker = null;
/** Decode HEIC in a worker (libheif, loaded only now) into an upright canvas. */
async function decodeHeic(file, maxSide) {
  const buf = await file.arrayBuffer();
  if (!heicWorker) heicWorker = new Worker(new URL('./heic-worker.js', import.meta.url));
  const res = await new Promise((resolve, reject) => {
    const onMsg = (e) => { heicWorker.removeEventListener('message', onMsg); resolve(e.data); };
    heicWorker.addEventListener('message', onMsg);
    heicWorker.addEventListener('error', reject, { once: true });
    heicWorker.postMessage(buf, [buf]);
  });
  if (res.error) throw new Error(`heic: ${res.error}`);
  const full = document.createElement('canvas');
  full.width = res.width;
  full.height = res.height;
  full.getContext('2d').putImageData(new ImageData(res.data, res.width, res.height), 0, 0);
  const s = Math.min(1, maxSide / Math.max(res.width, res.height));
  if (s === 1) return full;
  const out = document.createElement('canvas');
  out.width = Math.round(res.width * s);
  out.height = Math.round(res.height * s);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, out.width, out.height);
  full.width = full.height = 0;
  return out;
}

async function loadWithBrowser(file, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const [img, auto] = await Promise.all([loadImage(url), browserAutoOrients()]);
    let orientation = 1;
    if (!auto && /jpe?g/i.test(file.type || 'image/jpeg')) {
      orientation = readExifOrientation(await file.arrayBuffer());
    }
    const swap = orientation >= 5;
    // naturalWidth is already post-rotation when the browser auto-orients.
    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const outW0 = swap ? srcH : srcW;
    const outH0 = swap ? srcW : srcH;
    const scale = Math.min(1, maxSide / Math.max(outW0, outH0));
    const outW = Math.round(outW0 * scale);
    const outH = Math.round(outH0 * scale);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    const dw = Math.round(srcW * scale);
    const dh = Math.round(srcH * scale);
    applyOrientation(ctx, orientation, dw, dh);
    ctx.drawImage(img, 0, 0, dw, dh);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

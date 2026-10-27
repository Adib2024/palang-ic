/* HEIC/HEIF decoder (iPhone photos) for browsers that can't show them.
   Runs libheif (vendored, WebAssembly) in this worker; the picture never
   leaves the device. Receives an ArrayBuffer, replies {width, height, data}. */
/* global importScripts, libheif */
let lib = null;

async function load() {
  if (!lib) {
    importScripts('../vendor/libheif/libheif-bundle.js');
    let L = typeof libheif !== 'undefined' ? libheif : self.libheif;
    if (L && typeof L === 'function' && !L.HeifDecoder) L = L();
    if (L && typeof L.then === 'function') L = await L;
    if (L && L.default && !L.HeifDecoder) L = L.default;
    if (!L || !L.HeifDecoder) throw new Error('libheif');
    lib = L;
  }
  return lib;
}

self.onmessage = async (e) => {
  try {
    const L = await load();
    const images = new L.HeifDecoder().decode(new Uint8Array(e.data));
    if (!images || !images.length) throw new Error('empty');
    const im = images[0];
    const width = im.get_width();
    const height = im.get_height();
    const data = new Uint8ClampedArray(width * height * 4);
    await new Promise((resolve, reject) => {
      im.display({ data, width, height }, (out) => (out ? resolve(out) : reject(new Error('decode'))));
    });
    if (typeof im.free === 'function') im.free();
    self.postMessage({ width, height, data }, [data.buffer]);
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};

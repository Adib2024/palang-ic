// Unlock (decrypt) and protect (encrypt, AES-256) whole PDF documents using
// pdf-lib's object model plus our Standard Security Handler (pdf-crypto.js).
import { loadPdfLib } from './pdf-kit.js';
import { fileKey, objectKey, decryptData, encryptData, makeR6, randomBytes } from './pdf-crypto.js';

const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Parse a PDF with pdf-lib's parser but *defer* object streams: in an
 * encrypted file they must be decrypted before they can be decoded.
 */
async function parseDeferred(L, bytes) {
  const { PDFParser, PDFObjectStreamParser } = L;
  const origHeader = PDFParser.prototype.parseIndirectObjectHeader;
  const origFor = PDFObjectStreamParser.forStream;
  const deferred = [];
  let last = null;
  PDFParser.prototype.parseIndirectObjectHeader = function header(...args) {
    last = origHeader.apply(this, args);
    return last;
  };
  PDFObjectStreamParser.forStream = (raw) => {
    deferred.push({ ref: last, raw });
    return { parseIntoContext: async () => {} };
  };
  try {
    const context = await PDFParser.forBytesWithOptions(bytes, Infinity, false, false).parseDocument();
    return { context, deferred, parseObjStm: (raw) => origFor(raw, false).parseIntoContext() };
  } finally {
    PDFParser.prototype.parseIndirectObjectHeader = origHeader;
    PDFObjectStreamParser.forStream = origFor;
  }
}

/** Read the Encrypt dictionary into a plain handler description. */
function readHandler(L, context) {
  const { PDFName, PDFNumber, PDFDict, PDFBool } = L;
  const encRef = context.trailerInfo.Encrypt;
  if (!encRef) return null;
  const enc = context.lookup(encRef, PDFDict);
  const get = (k) => enc.lookup(PDFName.of(k));
  const num = (k, d) => { const v = get(k); return v instanceof PDFNumber ? v.asNumber() : d; };
  const bytes = (k) => { const v = get(k); return v && v.asBytes ? v.asBytes() : new Uint8Array(0); };
  const filter = get('Filter');
  if (!filter || filter.asString() !== '/Standard') throw new Error('unsupported');
  const V = num('V', 0);
  const R = num('R', 2);
  const em = get('EncryptMetadata');
  const h = {
    V, R, P: num('P', 0) | 0, O: bytes('O'), U: bytes('U'), OE: bytes('OE'), UE: bytes('UE'),
    length: Math.floor(num('Length', 40) / 8), encryptMetadata: !(em instanceof PDFBool) || em.asBoolean(),
    id0: new Uint8Array(0), stm: 'V2', str: 'V2', ref: encRef,
  };
  const id = context.trailerInfo.ID;
  const idArr = id && (id.asArray ? id : context.lookup(id));
  if (idArr && idArr.size && idArr.size() > 0) h.id0 = idArr.get(0).asBytes();
  if (V >= 4) {
    const cf = get('CF');
    const method = (name) => {
      if (!name || name.asString() === '/Identity') return 'Identity';
      const d = cf && cf.lookup(name);
      const cfm = d && d.lookup(PDFName.of('CFM'));
      const m = cfm ? cfm.asString().slice(1) : 'None';
      if (m === 'AESV2' || m === 'AESV3' || m === 'V2' || m === 'None') return m;
      throw new Error('unsupported');
    };
    h.stm = method(get('StmF'));
    h.str = method(get('StrF'));
    const lenFromCF = (() => { const d = cf && cf.lookup(PDFName.of('StdCF')); const l = d && d.lookup(PDFName.of('Length')); return l ? l.asNumber() : 0; })();
    if (V === 4 && lenFromCF) h.length = lenFromCF > 32 ? lenFromCF / 8 : lenFromCF;
    if (V === 4 && !lenFromCF) h.length = 16;
  }
  if (R >= 5) { h.stm = h.stm === 'Identity' ? 'Identity' : 'AESV3'; h.str = h.str === 'Identity' ? 'Identity' : 'AESV3'; }
  return h;
}

/** Replace every string inside `obj` (dicts/arrays, recursively) via `fn(bytes)`. */
async function mapStrings(L, obj, fn) {
  const { PDFString, PDFHexString, PDFDict, PDFArray } = L;
  if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(toHex(await fn(obj.asBytes())));
  if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) {
      const r = await mapStrings(L, v, fn);
      if (r !== v) obj.set(k, r);
    }
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i);
      const r = await mapStrings(L, v, fn);
      if (r !== v) obj.set(i, r);
    }
  }
  return obj;
}

const typeOf = (L, dict) => { const t = dict.lookup(L.PDFName.of('Type')); return t ? t.asString() : ''; };

/** Is this PDF encrypted? */
export async function isEncrypted(bytes) {
  const L = await loadPdfLib();
  const { context } = await parseDeferred(L, bytes);
  return !!context.trailerInfo.Encrypt;
}

/**
 * Remove encryption. `password` may be the user or owner password ('' works
 * for files that only restrict printing/copying).
 * @returns {Promise<Uint8Array>} the decrypted PDF
 * @throws Error('not-encrypted' | 'password' | 'unsupported')
 */
export async function unlockPdf(bytes, password) {
  const L = await loadPdfLib();
  const { context, deferred, parseObjStm } = await parseDeferred(L, bytes);
  const h = readHandler(L, context);
  if (!h) throw new Error('not-encrypted');
  const fk = await fileKey(h, password);
  if (!fk) throw new Error('password');
  const aes = (m) => m === 'AESV2';
  const keyFor = (ref, method) => objectKey(h, fk, ref.objectNumber, ref.generationNumber, aes(method));

  const main = context.enumerateIndirectObjects();
  for (const [ref, obj] of main) {
    if (ref === h.ref) continue;
    if (obj instanceof L.PDFRawStream) {
      const type = typeOf(L, obj.dict);
      if (type === '/XRef') { context.delete(ref); continue; }
      await mapStrings(L, obj.dict, (b) => decryptData(h.str, keyFor(ref, h.str), b));
      if (!(type === '/Metadata' && !h.encryptMetadata)) {
        obj.contents = await decryptData(h.stm, keyFor(ref, h.stm), obj.contents);
      }
    } else {
      const r = await mapStrings(L, obj, (b) => decryptData(h.str, keyFor(ref, h.str), b));
      if (r !== obj) context.assign(ref, r);
    }
  }
  // Object streams: decrypt as a whole, then let pdf-lib unpack them. Objects
  // inside are not individually encrypted. Objects from the main pass win.
  const mainFinal = main.map(([ref]) => [ref, context.lookup(ref)]).filter(([ref, obj]) => obj && ref !== h.ref);
  for (const { ref, raw } of deferred) {
    raw.contents = await decryptData(h.stm, keyFor(ref, h.stm), raw.contents);
    await parseObjStm(raw);
  }
  for (const [ref, obj] of mainFinal) if (context.lookup(ref) !== obj) context.assign(ref, obj);

  context.delete(h.ref);
  delete context.trailerInfo.Encrypt;
  return L.PDFWriter.forContext(context, Infinity).serializeToBuffer();
}

/**
 * Encrypt with AES-256 (R6). `ownerPassword` defaults to a random secret.
 * @param {number} P permission bits (see pdf-crypto `permissions`)
 * @returns {Promise<Uint8Array>}
 * @throws Error('encrypted') if the input is already encrypted
 */
export async function protectPdf(bytes, userPassword, ownerPassword, P) {
  const L = await loadPdfLib();
  let doc;
  try {
    doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message))) throw new Error('encrypted');
    throw err;
  }
  await doc.flush();
  const { context } = doc;
  const r6 = await makeR6(userPassword, ownerPassword || toHex(randomBytes(16)), P);
  const enc = (b) => encryptData(r6.fileKey, b);

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof L.PDFStream) {
      if (typeOf(L, obj.dict) === '/XRef') { context.delete(ref); continue; }
      const contents = obj instanceof L.PDFRawStream ? obj.contents : obj.getContents();
      if (obj.updateDict) obj.updateDict();
      await mapStrings(L, obj.dict, enc);
      context.assign(ref, L.PDFRawStream.of(obj.dict, await enc(contents)));
    } else {
      const r = await mapStrings(L, obj, enc);
      if (r !== obj) context.assign(ref, r);
    }
  }
  const hex = (b) => L.PDFHexString.of(toHex(b));
  const encDict = context.obj({
    Filter: 'Standard', V: 5, R: 6, Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF', StrF: 'StdCF',
    O: hex(r6.O), U: hex(r6.U), OE: hex(r6.OE), UE: hex(r6.UE), Perms: hex(r6.Perms),
    P: r6.P, EncryptMetadata: true,
  });
  context.trailerInfo.Encrypt = context.register(encDict);
  if (!context.trailerInfo.ID) {
    const id = randomBytes(16);
    context.trailerInfo.ID = context.obj([hex(id), hex(id)]);
  }
  return L.PDFWriter.forContext(context, Infinity).serializeToBuffer();
}

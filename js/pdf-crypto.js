// PDF Standard Security Handler, written for DokuJaga because pdf-lib has no
// encryption support. Decrypts RC4 / AES-128 / AES-256 (R2–R6) with a known
// password and encrypts with AES-256 (R6). Uses WebCrypto for AES and SHA;
// MD5 and RC4 (needed by older PDFs) are implemented below. Nothing leaves
// the device.

/* ---------- MD5 (RFC 1321) ---------- */

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bits >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301; let b0 = 0xefcdab89; let c0 = 0x98badcfe; let d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0; let B = b0; let C = c0; let D = d0;
    for (let i = 0; i < 64; i++) {
      let F; let g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => o.setUint32(i * 4, v, true));
  return out;
}

/* ---------- RC4 ---------- */

export function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}

/* ---------- AES / SHA via WebCrypto ---------- */

const subtle = () => globalThis.crypto.subtle;
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function aesKey(raw) { return subtle().importKey('raw', raw, 'AES-CBC', false, ['encrypt', 'decrypt']); }

/** AES-CBC encrypt with PKCS#7 padding. */
export async function aesEncrypt(key, iv, data) {
  return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, await aesKey(key), data));
}
/** AES-CBC encrypt without padding (data length must be a multiple of 16). */
async function aesEncryptNoPad(key, iv, data) {
  return (await aesEncrypt(key, iv, data)).subarray(0, data.length);
}
/** AES-CBC decrypt (PKCS#7 padding removed). */
export async function aesDecrypt(key, iv, data) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, await aesKey(key), data));
}
/** AES-CBC decrypt without padding: append a valid padding block, then decrypt. */
async function aesDecryptNoPad(key, iv, data) {
  // Encrypt a full padding block chained from the last ciphertext block so
  // WebCrypto sees valid PKCS#7 padding, then drop it.
  const last = data.subarray(data.length - 16);
  const pad = (await aesEncrypt(key, last, new Uint8Array(0))).subarray(0, 16);
  return (await aesDecrypt(key, iv, concat(data, pad))).subarray(0, data.length);
}
const sha = async (alg, data) => new Uint8Array(await subtle().digest(alg, data));

/* ---------- Key derivation ---------- */

const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);

function latin1Bytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}
const pad32 = (pw) => concat(pw.subarray(0, 32), PAD.subarray(0, Math.max(0, 32 - pw.length)));
const int32le = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return b; };
const eq = (a, b, n = Math.min(a.length, b.length)) => { for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false; return true; };

/** Algorithm 2: file key for R2–R4 from a (user) password. */
function key2(pwBytes, h) {
  const n = h.R === 2 ? 5 : h.length;
  let k = md5(concat(pad32(pwBytes), h.O.subarray(0, 32), int32le(h.P), h.id0, h.R >= 4 && !h.encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array(0)));
  if (h.R >= 3) for (let i = 0; i < 50; i++) k = md5(k.subarray(0, n));
  return k.subarray(0, n);
}
/** Algorithms 4/5: the U value a file key would produce. */
function computeU(key, h) {
  if (h.R === 2) return rc4(key, PAD);
  let x = rc4(key, md5(concat(PAD, h.id0)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
  return x;
}
/** Algorithm 7: recover the user password from the owner password. */
function userPwFromOwner(pwBytes, h) {
  const n = h.R === 2 ? 5 : h.length;
  let k = md5(pad32(pwBytes));
  if (h.R >= 3) for (let i = 0; i < 50; i++) k = md5(k);
  k = k.subarray(0, n);
  if (h.R === 2) return rc4(k, h.O.subarray(0, 32));
  let data = h.O.subarray(0, 32);
  for (let i = 19; i >= 0; i--) data = rc4(k.map((b) => b ^ i), data);
  return data;
}

/** Algorithm 2.B (R6) hash; R5 uses plain SHA-256. */
async function hash6(pw, salt, udata, R) {
  let K = await sha('SHA-256', concat(pw, salt, udata));
  if (R === 5) return K;
  for (let i = 0; ; i++) {
    const unit = concat(pw, K, udata);
    const K1 = new Uint8Array(unit.length * 64);
    for (let r = 0; r < 64; r++) K1.set(unit, r * unit.length);
    const E = await aesEncryptNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
    let mod = 0;
    for (let b = 0; b < 16; b++) mod += E[b];
    mod %= 3;
    K = await sha(mod === 0 ? 'SHA-256' : mod === 1 ? 'SHA-384' : 'SHA-512', E);
    // Stop once at least 64 rounds are done and E's last byte <= rounds - 32.
    const rounds = i + 1;
    if (rounds >= 64 && E[E.length - 1] <= rounds - 32) break;
  }
  return K.subarray(0, 32);
}

const utf8pw = (password) => new TextEncoder().encode(password.normalize('NFKC')).subarray(0, 127);

/**
 * Work out the file key for `password` (tried as user, then owner password).
 * @returns {Promise<Uint8Array|null>} null if the password is wrong
 */
export async function fileKey(h, password) {
  if (h.R >= 5) {
    const pw = utf8pw(password);
    const U = h.U.subarray(0, 48);
    if (eq(await hash6(pw, U.subarray(32, 40), new Uint8Array(0), h.R), U, 32)) {
      return aesDecryptNoPad(await hash6(pw, U.subarray(40, 48), new Uint8Array(0), h.R), new Uint8Array(16), h.UE.subarray(0, 32));
    }
    const O = h.O.subarray(0, 48);
    if (eq(await hash6(pw, O.subarray(32, 40), U, h.R), O, 32)) {
      return aesDecryptNoPad(await hash6(pw, O.subarray(40, 48), U, h.R), new Uint8Array(16), h.OE.subarray(0, 32));
    }
    return null;
  }
  const tryUser = (pwBytes) => {
    const k = key2(pwBytes, h);
    const u = computeU(k, h);
    return eq(u, h.U, h.R === 2 ? 32 : 16) ? k : null;
  };
  const pw = latin1Bytes(password);
  return tryUser(pw) || tryUser(userPwFromOwner(pw, h));
}

/** Per-object key (RC4 / AESV2); AESV3 uses the file key directly. */
export function objectKey(h, fk, num, gen, aes) {
  if (h.R >= 5) return fk;
  const k = md5(concat(fk, Uint8Array.of(num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255), aes ? latin1Bytes('sAlT') : new Uint8Array(0)));
  return k.subarray(0, Math.min(fk.length + 5, 16));
}

/* ---------- R6 encryption dictionary ---------- */

/**
 * Build the values for an AES-256 (R6) Encrypt dictionary.
 * @returns {Promise<{fileKey, O, U, OE, UE, Perms, P}>}
 */
export async function makeR6(userPassword, ownerPassword, P) {
  const fk = randomBytes(32);
  const upw = utf8pw(userPassword);
  const opw = utf8pw(ownerPassword);
  const uVal = randomBytes(8);
  const uKey = randomBytes(8);
  const U = concat(await hash6(upw, uVal, new Uint8Array(0), 6), uVal, uKey);
  const UE = await aesEncryptNoPad(await hash6(upw, uKey, new Uint8Array(0), 6), new Uint8Array(16), fk);
  const oVal = randomBytes(8);
  const oKey = randomBytes(8);
  const O = concat(await hash6(opw, oVal, U, 6), oVal, oKey);
  const OE = await aesEncryptNoPad(await hash6(opw, oKey, U, 6), new Uint8Array(16), fk);
  const perms = concat(int32le(P), Uint8Array.of(255, 255, 255, 255), latin1Bytes('Tadb'), randomBytes(4));
  const Perms = await aesEncryptNoPad(fk, new Uint8Array(16), perms);
  return { fileKey: fk, O, U, OE, UE, Perms, P };
}

/** Encrypt bytes for a string/stream (AES-256 with random IV prefix). */
export async function encryptData(fk, data) {
  const iv = randomBytes(16);
  return concat(iv, await aesEncrypt(fk, iv, data));
}

/** Decrypt bytes for a string/stream with the given crypt method. */
export async function decryptData(method, key, data) {
  if (method === 'None' || method === 'Identity') return data;
  if (method === 'V2') return rc4(key, data);
  if (data.length < 32 || data.length % 16) return data.length === 16 ? new Uint8Array(0) : data; // empty / malformed
  return aesDecrypt(key, data.subarray(0, 16), data.subarray(16));
}

/** Permission bits (P) for "allow print" / "allow copy" choices. */
export function permissions({ print = true, copy = true, modify = false } = {}) {
  let p = 0xfffff0c0 | 0; // reserved bits set as required
  if (print) p |= (1 << 2) | (1 << 11); // print + high quality print
  if (modify) p |= (1 << 3) | (1 << 5) | (1 << 8) | (1 << 10); // modify, annotate, fill forms, assemble
  if (copy) p |= (1 << 4) | (1 << 9); // copy + accessibility extraction
  return p | 0;
}

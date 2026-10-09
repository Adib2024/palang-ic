// Word diff (Myers' O(ND) algorithm) for Compare PDF. Pure functions.

const MAX_D = 3000;

/**
 * Shortest edit script between two token arrays.
 * @param {string[]} a old tokens
 * @param {string[]} b new tokens
 * @returns {{op: 'eq'|'del'|'ins', a?: number, b?: number}[]} one entry per token, in order
 */
export function diffTokens(a, b) {
  // Trim the common prefix and suffix first: cheap, and most documents share a lot.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const n = A.length;
  const m = B.length;
  // Each step d stores the diagonals -d..d, so memory grows with d². Past
  // MAX_D edits the documents are mostly different anyway: report the rest
  // as one deletion plus one insertion.
  const maxD = Math.min(n + m, MAX_D);
  const off = maxD + 1;
  const v = new Int32Array(2 * maxD + 3);
  const trace = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= maxD && !found; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2)); // diagonals -d-1..d+1
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }

  const mid = [];
  if (!found) {
    for (let i = 0; i < n; i++) mid.push({ op: 'del', a: start + i });
    for (let j = 0; j < m; j++) mid.push({ op: 'ins', b: start + j });
  } else {
    // Walk the trace backwards to recover the edits.
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
      const vd = trace[d];
      const at = (k) => vd[k + d + 1]; // trace[d] holds diagonals -d-1..d+1
      const k = x - y;
      const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
      const prevX = at(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { mid.push({ op: 'eq', a: start + x - 1, b: start + y - 1 }); x--; y--; }
      if (d > 0) {
        if (x === prevX) mid.push({ op: 'ins', b: start + y - 1 });
        else mid.push({ op: 'del', a: start + x - 1 });
      }
      x = prevX;
      y = prevY;
    }
    mid.reverse();
  }

  const out = [];
  for (let i = 0; i < start; i++) out.push({ op: 'eq', a: i, b: i });
  for (const e of mid) out.push(e);
  for (let i = 0; i < a.length - endA; i++) out.push({ op: 'eq', a: endA + i, b: endB + i });
  return out;
}

/**
 * Group a token diff into runs: [{op, tokens: [...]}] with old tokens for
 * 'eq'/'del' and new tokens for 'ins'.
 */
export function runs(a, b, script) {
  const out = [];
  for (const s of script) {
    const tok = s.op === 'ins' ? b[s.b] : a[s.a];
    const last = out[out.length - 1];
    if (last && last.op === s.op) last.tokens.push(tok);
    else out.push({ op: s.op, tokens: [tok], a: s.a, b: s.b });
  }
  return out;
}

/** Split text into word tokens (whitespace collapsed). */
export function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

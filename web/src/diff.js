// Line diff (Myers, O(ND)) used for the side-by-side view and the unified patch.
//
// Pure. Lines keep their own `\r`, so a CRLF file produces a patch that
// `git apply` accepts on a CRLF checkout (requirement 7.4).

const NO_NEWLINE = '\u0000NO_NEWLINE_AT_EOF';
const MAX_EDIT_DISTANCE = 2000; // beyond this a file is shown as fully replaced

/** Split text into lines. `finalNewline` tells whether the last line ends with \n. */
export function splitLines(text) {
  if (text === '') return { lines: [], finalNewline: true };
  const parts = text.split('\n');
  const finalNewline = parts[parts.length - 1] === '';
  if (finalNewline) parts.pop();
  return { lines: parts, finalNewline };
}

// Compare lines including whether the final line has a newline.
function comparable({ lines, finalNewline }) {
  if (finalNewline || lines.length === 0) return lines;
  const out = lines.slice();
  out[out.length - 1] += NO_NEWLINE;
  return out;
}

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  v[offset + 1] = 0;
  const trace = [];

  for (let d = 0; d <= max; d++) {
    if (d > MAX_EDIT_DISTANCE) return null;
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, n, m);
    }
  }
  return null;
}

function backtrack(trace, a, b, n, m) {
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d]; // v before step d, indexed by k + d + 1
    const at = (k) => snap[k + d + 1];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && at(k - 1) < at(k + 1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'eq', text: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ type: 'add', text: b[prevY] });
      else ops.push({ type: 'del', text: a[prevX] });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/**
 * Diff two texts.
 * @returns {{ops:Array<{type:'eq'|'del'|'add', text:string, oldNo:number|null, newNo:number|null, noNewline:boolean}>,
 *            identical:boolean}}
 */
export function diffLines(oldText, newText) {
  const A = splitLines(oldText);
  const B = splitLines(newText);
  const a = comparable(A);
  const b = comparable(B);

  // Trim the common prefix and suffix; real changes are usually sparse.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let mid;
  if (midA.length === 0) mid = midB.map((text) => ({ type: 'add', text }));
  else if (midB.length === 0) mid = midA.map((text) => ({ type: 'del', text }));
  else mid = myers(midA, midB) || [...midA.map((text) => ({ type: 'del', text })), ...midB.map((text) => ({ type: 'add', text }))];

  const raw = [
    ...a.slice(0, start).map((text) => ({ type: 'eq', text })),
    ...mid,
    ...a.slice(endA).map((text) => ({ type: 'eq', text })),
  ];

  let oldNo = 0;
  let newNo = 0;
  let changed = false;
  const ops = raw.map((op) => {
    const noNewline = op.text.endsWith(NO_NEWLINE);
    const text = noNewline ? op.text.slice(0, -NO_NEWLINE.length) : op.text;
    if (op.type !== 'add') oldNo++;
    if (op.type !== 'del') newNo++;
    if (op.type !== 'eq') changed = true;
    return {
      type: op.type,
      text,
      oldNo: op.type === 'add' ? null : oldNo,
      newNo: op.type === 'del' ? null : newNo,
      noNewline,
    };
  });
  return { ops, identical: !changed };
}

/**
 * Pair removed and added lines for a side-by-side view.
 * @returns {Array<{left:{no:number,text:string}|null, right:{no:number,text:string}|null, changed:boolean}>}
 */
export function sideBySide(ops) {
  const rows = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'eq') {
      rows.push({
        left: { no: ops[i].oldNo, text: ops[i].text },
        right: { no: ops[i].newNo, text: ops[i].text },
        changed: false,
      });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < ops.length && ops[i].type !== 'eq') {
      (ops[i].type === 'del' ? dels : adds).push(ops[i]);
      i++;
    }
    const n = Math.max(dels.length, adds.length);
    for (let r = 0; r < n; r++) {
      rows.push({
        left: dels[r] ? { no: dels[r].oldNo, text: dels[r].text } : null,
        right: adds[r] ? { no: adds[r].newNo, text: adds[r].text } : null,
        changed: true,
      });
    }
  }
  return rows;
}

// --- Unified patch -----------------------------------------------------------

function gitName(prefix, path) {
  const name = `${prefix}/${path}`;
  if (/[^\x20-\x7e]|["\\]/.test(name)) {
    const bytes = new TextEncoder().encode(name);
    let out = '"';
    for (const byte of bytes) {
      const ch = String.fromCharCode(byte);
      if (byte === 0x22) out += '\\"';
      else if (byte === 0x5c) out += '\\\\';
      else if (byte < 0x20 || byte > 0x7e) out += '\\' + byte.toString(8).padStart(3, '0');
      else out += ch;
    }
    return out + '"';
  }
  return name;
}

/**
 * Unified diff for ONE modified file, in the format `git diff` prints.
 * Returns '' when the texts are identical.
 *
 * @param {string} path      repository-relative POSIX path
 * @param {string} oldText
 * @param {string} newText
 * @param {number} [context]
 */
export function unifiedPatch(path, oldText, newText, context = 3) {
  const { ops, identical } = diffLines(oldText, newText);
  if (identical) return '';

  // Ranges of ops that belong to the same hunk (changes closer than 2*context merge).
  const changeIdx = [];
  ops.forEach((op, i) => {
    if (op.type !== 'eq') changeIdx.push(i);
  });
  const ranges = [];
  for (const idx of changeIdx) {
    const from = Math.max(0, idx - context);
    const to = Math.min(ops.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }

  const oldBefore = [];
  const newBefore = [];
  let oc = 0;
  let nc = 0;
  for (const op of ops) {
    oldBefore.push(oc);
    newBefore.push(nc);
    if (op.type !== 'add') oc++;
    if (op.type !== 'del') nc++;
  }

  const a = gitName('a', path);
  const b = gitName('b', path);
  const tab = /^[^"]*\s/.test(a) ? '\t' : '';
  let out = `diff --git ${a} ${b}\n--- ${a}${tab}\n+++ ${b}${tab}\n`;

  for (const { from, to } of ranges) {
    const slice = ops.slice(from, to + 1);
    const oldCount = slice.filter((o) => o.type !== 'add').length;
    const newCount = slice.filter((o) => o.type !== 'del').length;
    const oldStart = oldCount === 0 ? oldBefore[from] : oldBefore[from] + 1;
    const newStart = newCount === 0 ? newBefore[from] : newBefore[from] + 1;
    const range = (start, count) => (count === 1 ? `${start}` : `${start},${count}`);
    out += `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@\n`;
    for (const op of slice) {
      const sign = op.type === 'eq' ? ' ' : op.type === 'del' ? '-' : '+';
      out += `${sign}${op.text}\n`;
      if (op.noNewline) out += '\\ No newline at end of file\n';
    }
  }
  return out;
}

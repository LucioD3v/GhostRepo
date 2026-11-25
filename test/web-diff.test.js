import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { diffLines, sideBySide, splitLines, unifiedPatch } from '../web/src/diff.js';
import { processFile } from '../src/engine.js';

// Small deterministic PRNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomText(rand, { crlf, maxLines = 12 }) {
  const alphabet = ['a', 'b', 'c', 'd', 'e', '', '  x', 'var a = 1;', 'const a = 1;', '}', '{'];
  const n = Math.floor(rand() * maxLines);
  const eol = crlf ? '\r\n' : '\n';
  const lines = Array.from({ length: n }, () => alphabet[Math.floor(rand() * alphabet.length)]);
  const finalNewline = rand() < 0.7;
  return lines.length === 0 ? '' : lines.join(eol) + (finalNewline ? eol : '');
}

function git(cwd, args, input) {
  return spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, input, encoding: 'utf8' });
}

function applies(oldText, newText, name = 'file.js') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-patch-'));
  try {
    // `git apply` works outside a repository, so no `git init` is needed.
    fs.writeFileSync(path.join(dir, name), Buffer.from(oldText, 'utf8'));
    const patch = unifiedPatch(name, oldText, newText);
    if (patch === '') return { patch, same: oldText === newText, applied: true };
    const res = git(dir, ['apply', '--whitespace=nowarn', '-'], patch);
    if (res.status !== 0) return { patch, applied: false, error: res.stderr };
    const result = fs.readFileSync(path.join(dir, name)).toString('utf8');
    return { patch, applied: true, same: result === newText, result };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('identical texts have no changes and an empty patch', () => {
  assert.equal(diffLines('a\nb\n', 'a\nb\n').identical, true);
  assert.equal(unifiedPatch('x.js', 'a\nb\n', 'a\nb\n'), '');
  assert.equal(diffLines('', '').identical, true);
});

test('ops carry old and new line numbers', () => {
  const { ops } = diffLines('a\nb\nc\n', 'a\nB\nc\n');
  assert.deepEqual(
    ops.map((o) => [o.type, o.text, o.oldNo, o.newNo]),
    [
      ['eq', 'a', 1, 1],
      ['del', 'b', 2, null],
      ['add', 'B', null, 2],
      ['eq', 'c', 3, 3],
    ],
  );
});

test('property: ops always reconstruct both inputs exactly (300 random cases)', () => {
  const rand = rng(42);
  for (let i = 0; i < 300; i++) {
    const crlf = rand() < 0.3;
    const a = randomText(rand, { crlf });
    const b = randomText(rand, { crlf });
    const { ops } = diffLines(a, b);
    const oldLines = ops.filter((o) => o.type !== 'add').map((o) => o.text);
    const newLines = ops.filter((o) => o.type !== 'del').map((o) => o.text);
    assert.deepEqual(oldLines, splitLines(a).lines, `old side, case ${i}: ${JSON.stringify([a, b])}`);
    assert.deepEqual(newLines, splitLines(b).lines, `new side, case ${i}: ${JSON.stringify([a, b])}`);
  }
});

test('side by side pairs a replaced line and aligns equal lines', () => {
  const rows = sideBySide(diffLines('a\nvar b = 1;\nc\n', 'a\nconst b = 1;\nc\n').ops);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].changed, false);
  assert.deepEqual(rows[1], {
    left: { no: 2, text: 'var b = 1;' },
    right: { no: 2, text: 'const b = 1;' },
    changed: true,
  });
});

test('side by side leaves the other side empty for pure insertions and deletions', () => {
  const ins = sideBySide(diffLines('a\nc\n', 'a\nb\nc\n').ops);
  assert.deepEqual(ins[1], { left: null, right: { no: 2, text: 'b' }, changed: true });
  const del = sideBySide(diffLines('a\nb\nc\n', 'a\nc\n').ops);
  assert.deepEqual(del[1], { left: { no: 2, text: 'b' }, right: null, changed: true });
});

test('git apply accepts the patch for a single changed line', () => {
  const r = applies('a\nvar b = 1;\nc\n', 'a\nconst b = 1;\nc\n');
  assert.equal(r.applied, true, r.error);
  assert.equal(r.same, true);
  assert.match(r.patch, /^diff --git a\/file\.js b\/file\.js\n--- a\/file\.js\n\+\+\+ b\/file\.js\n@@ /);
});

test('git apply reproduces the new file for 60 random changes (LF and CRLF, with and without final newline)', () => {
  const rand = rng(7);
  for (let i = 0; i < 60; i++) {
    const crlf = rand() < 0.4;
    const a = randomText(rand, { crlf, maxLines: 25 });
    const b = randomText(rand, { crlf, maxLines: 25 });
    if (a === '' || b === '') continue; // creating or emptying a file is a different git patch kind
    const r = applies(a, b);
    assert.equal(r.applied, true, `case ${i} did not apply: ${r.error}\n${JSON.stringify([a, b])}\n${r.patch}`);
    assert.equal(r.same, true, `case ${i} produced a different file\n${JSON.stringify([a, b])}`);
  }
});

test('CRLF files keep their line endings in the patch', () => {
  const a = 'a\r\nvar b = 1;\r\nc\r\n';
  const b = 'a\r\nconst b = 1;\r\nc\r\n';
  const r = applies(a, b);
  assert.equal(r.applied, true, r.error);
  assert.equal(r.same, true);
  assert.ok(r.patch.includes('-var b = 1;\r\n'), 'removed line keeps \\r');
  assert.ok(r.patch.includes('+const b = 1;\r\n'), 'added line keeps \\r');
});

test('a missing final newline is reported to git', () => {
  const r = applies('a\nb', 'a\nB');
  assert.equal(r.applied, true, r.error);
  assert.equal(r.same, true);
  assert.match(r.patch, /\\ No newline at end of file/);
});

test('distant changes make separate hunks that still apply', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  const changed = lines.slice();
  changed[3] = 'CHANGED 3';
  changed[50] = 'CHANGED 50';
  const r = applies(lines.join('\n') + '\n', changed.join('\n') + '\n');
  assert.equal(r.applied, true, r.error);
  assert.equal(r.same, true);
  assert.equal((r.patch.match(/^@@ /gm) || []).length, 2);
});

test('file names with spaces are written the way git expects', () => {
  const r = applies('a\n', 'b\n', 'my file.js');
  assert.equal(r.applied, true, r.error);
  assert.equal(r.same, true);
});

test('the patch for a real engine transform applies and reproduces the engine output', () => {
  const original = fs.readFileSync(new URL('../fixtures/legacy-sample.js', import.meta.url), 'utf8');
  const { output } = processFile('legacy-sample.js', original);
  assert.ok(output && output !== original);
  const r = applies(original, output, 'legacy-sample.js');
  assert.equal(r.applied, true, r.error);
  assert.equal(r.same, true);
});

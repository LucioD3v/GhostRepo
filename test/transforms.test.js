// Self-test over the fixture. Verifies the pure codemods and counters without
// cloning any external repo. Run with:  node --test
//
// Covers docs/RESURRECT-CLI.md §10:
//   * var -> const/let, == -> ===, innerHTML -> textContent all fire where safe;
//   * nullish idiom, unknown operand types, markup and dynamic innerHTML skip;
//   * transformed source still PARSES;
//   * reported-only categories (es5_prototype, vendor_api) are counted in
//     `before`, unchanged in `after`, and report 0 removed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { countPatterns } from '../src/scan.js';
import { exorcise } from '../src/exorcise.js';
import { transmute } from '../src/transmute.js';
import { buildReport, deriveRepository } from '../src/report.js';
import jscodeshift from 'jscodeshift';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'legacy-sample.js');
const source = fs.readFileSync(FIXTURE, 'utf8');

const parse = (src) => jscodeshift.withParser('babel')(src);

test('scan counts all five categories in the fixture (before)', () => {
  const c = countPatterns(source);
  assert.ok(c.var >= 3, `var count ${c.var}`);
  assert.ok(c.loose_equality >= 2, `loose_equality count ${c.loose_equality}`);
  assert.ok(c.innerHTML >= 3, `innerHTML count ${c.innerHTML}`);
  assert.ok(c.vendor_api >= 1, `vendor_api count ${c.vendor_api}`);
  assert.ok(c.es5_prototype >= 1, `es5_prototype count ${c.es5_prototype}`);
});

test('exorcise converts plain-text innerHTML only', () => {
  const { code, stats } = exorcise(source);
  assert.equal(stats.applied, 1, 'only the plain-text literal is converted');
  assert.ok(code.includes("textContent = '0'"), "'0' -> textContent");
  assert.ok(code.includes('innerHTML = String(total)'), 'dynamic value kept as innerHTML');
  assert.ok(code.includes("innerHTML = '<b>!</b>'"), 'markup literal kept as innerHTML');
  const skippedReasons = stats.skipped.map((s) => s.reason);
  assert.ok(skippedReasons.includes('markup-or-entity-literal'));
  assert.ok(skippedReasons.includes('dynamic-value-needs-review'));
});

test('transmute converts var and provably-safe equality, skips the rest', () => {
  const { code, stats } = transmute(source);
  assert.ok(code.includes('const label'), 'label -> const (never reassigned)');
  assert.ok(code.includes('let total'), 'total -> let (reassigned)');
  assert.ok(code.includes("typeof el.pop === 'function'"), 'typeof == string -> ===');
  assert.ok(code.includes('total == 0'), 'unknown operand types preserved');
  // The nullish-idiom comparison must be preserved.
  assert.ok(code.includes('count != undefined'), 'nullish idiom preserved');
  assert.ok(!code.includes('count !== undefined'), 'nullish idiom NOT strictened');
  const skippedReasons = stats.skipped.map((s) => s.reason);
  assert.ok(skippedReasons.includes('nullish-idiom'), 'records nullish-idiom skip');
  assert.ok(skippedReasons.includes('operand-types-unknown'), 'records operand-types-unknown skip');
});

test('full transform pipeline output still PARSES', () => {
  const ex = exorcise(source);
  const tr = transmute(ex.code);
  assert.doesNotThrow(() => parse(tr.code), 'transformed source must parse');
});

test('reported-only categories are counted but never removed', () => {
  const ex = exorcise(source);
  const tr = transmute(ex.code);
  const before = countPatterns(source);
  const after = countPatterns(tr.code);

  // Counted in before.
  assert.ok(before.es5_prototype >= 1);
  assert.ok(before.vendor_api >= 1);
  // Unchanged in after (v1 applies no transform to them).
  assert.equal(after.es5_prototype, before.es5_prototype);
  assert.equal(after.vendor_api, before.vendor_api);

  // The report breakdown shows 0 removed for both.
  const report = buildReport({
    targetUrl: 'https://github.com/example/demo.git',
    targetPath: null,
    files: [
      {
        path: 'legacy-sample.js',
        before,
        after,
        transforms_applied: ['var_to_const_let', 'loose_equality', 'insecure_innerHTML'],
        skipped: [],
      },
    ],
    linesChanged: 10,
    filesScanned: 1,
    filesSkipped: 0,
  });
  assert.equal(report.metrics.breakdown.dead_vendor_api, 0);
  assert.equal(report.metrics.breakdown.es5_prototype, 0);
});

test('report honesty: removed clamps at 0 and status reflects changes', () => {
  const noChange = buildReport({
    targetUrl: null,
    targetPath: null,
    files: [],
    linesChanged: 0,
    filesScanned: 0,
    filesSkipped: 0,
  });
  assert.equal(noChange.status, 'SCANNED_ONLY');
  assert.equal(noChange.repository, null);

  const scannedOnly = buildReport({
    targetUrl: 'git@github.com:mozilla-b2g/gaia.git',
    targetPath: null,
    files: [
      {
        path: 'a.js',
        before: { var: 1, loose_equality: 0, innerHTML: 0, vendor_api: 0, es5_prototype: 0 },
        after: { var: 1, loose_equality: 0, innerHTML: 0, vendor_api: 0, es5_prototype: 0 },
        transforms_applied: [],
        skipped: [],
      },
    ],
    linesChanged: 0,
    filesScanned: 1,
    filesSkipped: 0,
  });
  assert.equal(scannedOnly.status, 'NO_CHANGES');
  assert.equal(scannedOnly.repository, 'gaia');
});

test('deriveRepository handles every target shape', () => {
  assert.equal(deriveRepository('https://github.com/mozilla-b2g/gaia'), 'gaia');
  assert.equal(deriveRepository('https://github.com/mozilla-b2g/gaia.git'), 'gaia');
  assert.equal(deriveRepository('git@github.com:mozilla-b2g/gaia.git'), 'gaia');
  assert.equal(deriveRepository('C:\\work\\gaia-calculator'), 'gaia-calculator');
  assert.equal(deriveRepository('/home/me/projects/thing/'), 'thing');
  assert.equal(deriveRepository(''), null);
  assert.equal(deriveRepository(null), null);
});

// Integration test for src/pipeline.js (docs/RESURRECT-CLI.md §10).
//
// Runs the real pipeline against the committed fixture, copied into a temporary
// directory so the original is never touched. No network, no git, no new
// dependency: `processTree` for the report contract and `run` with a local-path
// target for the end-to-end copy-out.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { processTree, run } from '../src/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'legacy-sample.js');

const BREAKDOWN_TO_SCAN = {
  var_to_const_let: 'var',
  loose_equality: 'loose_equality',
  insecure_innerHTML: 'innerHTML',
  dead_vendor_api: 'vendor_api',
  es5_prototype: 'es5_prototype',
};

function makeTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('processTree on the fixture writes a report with only measured values', (t) => {
  const tmp = makeTmp(t);
  const fixtureBefore = fs.readFileSync(FIXTURE);

  const scanRoot = path.join(tmp, 'tree');
  fs.mkdirSync(scanRoot);
  fs.copyFileSync(FIXTURE, path.join(scanRoot, 'legacy-sample.js'));
  const reportPath = path.join(tmp, 'resurrection-report.json');

  processTree({ scanRoot, targetUrl: 'fixtures/legacy-sample', targetPath: null, reportPath });

  // (a) the report exists and parses as JSON
  assert.ok(fs.existsSync(reportPath), 'report file is written');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  // (b) identity, scope, status and counters
  assert.equal(report.scope, 'javascript-web-legacy');
  assert.equal(report.status, 'RESURRECTED');
  assert.equal(report.agent_signature, 'GhostRepo resurrect CLI');
  assert.equal(report.metrics.files_scanned, 1);
  assert.equal(report.metrics.files_transformed, 1);

  // (c) every number is derived from the file's measured before/after counts
  const [file] = report.files;
  let sum = 0;
  for (const [breakdownKey, scanKey] of Object.entries(BREAKDOWN_TO_SCAN)) {
    const expected = Math.max(0, file.before[scanKey] - file.after[scanKey]);
    assert.equal(report.metrics.breakdown[breakdownKey], expected, breakdownKey);
    sum += expected;
  }
  assert.equal(report.metrics.legacy_patterns_removed, sum);
  assert.ok(sum > 0, 'the fixture has patterns that are removed');
  assert.equal(report.metrics.breakdown.dead_vendor_api, 0, 'reported-only in v1');
  assert.equal(report.metrics.breakdown.es5_prototype, 0, 'reported-only in v1');

  // (d) a real diff count, and POSIX-style relative paths
  assert.ok(Number.isInteger(report.metrics.lines_changed));
  assert.ok(report.metrics.lines_changed > 0);
  assert.equal(file.path, 'legacy-sample.js');
  assert.ok(!path.isAbsolute(file.path) && !file.path.includes('\\'));

  // The transformed copy changed; the committed fixture did not.
  const transformed = fs.readFileSync(path.join(scanRoot, 'legacy-sample.js'), 'utf8');
  assert.ok(transformed.includes('const label'), 'label -> const');
  assert.ok(transformed.includes("el.textContent = '0'"), 'plain-text innerHTML -> textContent');

  // (e) the committed fixture is byte-identical
  assert.ok(fs.readFileSync(FIXTURE).equals(fixtureBefore), 'fixture is not mutated');
});

test('processTree reports NO_CHANGES when nothing needs a transform', (t) => {
  const tmp = makeTmp(t);
  const scanRoot = path.join(tmp, 'tree');
  fs.mkdirSync(scanRoot);
  fs.writeFileSync(path.join(scanRoot, 'clean.js'), 'const a = 1;\nexport default a;\n');
  const reportPath = path.join(tmp, 'report.json');

  const { report } = processTree({ scanRoot, targetUrl: null, targetPath: null, reportPath });

  assert.equal(report.status, 'NO_CHANGES');
  assert.equal(report.metrics.files_scanned, 1);
  assert.equal(report.metrics.files_transformed, 0);
  assert.equal(report.metrics.lines_changed, 0);
  assert.equal(report.metrics.legacy_patterns_removed, 0);
});

test('processTree reports SCANNED_ONLY with all-zero metrics for an empty tree', (t) => {
  const tmp = makeTmp(t);
  const scanRoot = path.join(tmp, 'tree');
  fs.mkdirSync(scanRoot);
  const reportPath = path.join(tmp, 'report.json');

  const { report } = processTree({ scanRoot, targetUrl: null, targetPath: null, reportPath });

  assert.equal(report.status, 'SCANNED_ONLY');
  assert.equal(report.metrics.files_scanned, 0);
  assert.equal(report.metrics.files_transformed, 0);
  assert.equal(report.metrics.lines_changed, 0);
  assert.equal(report.metrics.legacy_patterns_removed, 0);
  assert.deepEqual(Object.values(report.metrics.breakdown), [0, 0, 0, 0, 0]);
});

test('run copies a local target, writes the resurrected code and leaves the source alone', (t) => {
  const tmp = makeTmp(t);
  const source = path.join(tmp, 'legacy-repo');
  fs.mkdirSync(source);
  fs.copyFileSync(FIXTURE, path.join(source, 'legacy-sample.js'));
  const sourceBefore = fs.readFileSync(path.join(source, 'legacy-sample.js'));

  const outDir = path.join(tmp, 'out');
  const reportPath = path.join(tmp, 'report.json');
  const result = run({ target: source, reportPath, outDir });

  assert.equal(result.report.status, 'RESURRECTED');
  assert.equal(result.report.repository, 'legacy-repo');
  assert.ok(fs.existsSync(reportPath));

  const resurrected = fs.readFileSync(path.join(outDir, 'legacy-sample.js'), 'utf8');
  assert.ok(resurrected.includes('const label'));
  assert.ok(
    fs.readFileSync(path.join(source, 'legacy-sample.js')).equals(sourceBefore),
    'the original target is never modified in place',
  );
});

test('run refuses to write into a non-empty output directory', (t) => {
  const tmp = makeTmp(t);
  const source = path.join(tmp, 'legacy-repo');
  fs.mkdirSync(source);
  fs.copyFileSync(FIXTURE, path.join(source, 'legacy-sample.js'));
  const outDir = path.join(tmp, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'keep.txt'), 'do not overwrite');

  assert.throws(
    () => run({ target: source, reportPath: path.join(tmp, 'r.json'), outDir }),
    (e) => e.exitCode === 2 && /not empty/.test(e.message),
  );
  assert.equal(fs.readFileSync(path.join(outDir, 'keep.txt'), 'utf8'), 'do not overwrite');
});

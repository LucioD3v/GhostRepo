import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildPrKit, summarizeSkips } from '../web/src/prkit.js';
import { buildReport } from '../src/report.js';
import { processFile } from '../src/engine.js';
import { unifiedPatch } from '../web/src/diff.js';

const FIXTURE = fs.readFileSync(new URL('../fixtures/legacy-sample.js', import.meta.url), 'utf8');

function reportFor(files) {
  const results = files.map(([p, src]) => processFile(p, src));
  return {
    report: buildReport({
      targetUrl: 'https://github.com/o/r',
      files: results.map((r) => r.entry),
      linesChanged: results.reduce((s, r) => s + r.linesChanged, 0),
      filesScanned: results.length,
      filesSkipped: results.filter((r) => r.parseFailed).length,
      agentSignature: 'GhostRepo web UI',
    }),
    results,
  };
}

const kitInput = (report, over = {}) => ({
  report,
  owner: 'o',
  repo: 'r',
  sha: 'a'.repeat(40),
  subfolder: '',
  changedPaths: ['legacy-sample.js'],
  patchFileName: 'ghostrepo-resurrect.patch',
  toolUrl: 'https://example.github.io/GhostRepo/',
  date: new Date('2026-11-08T12:00:00Z'),
  ...over,
});

test('the kit has a branch, title, commit message, description and commands', () => {
  const { report } = reportFor([['legacy-sample.js', FIXTURE]]);
  const kit = buildPrKit(kitInput(report));
  assert.equal(kit.branch, 'ghostrepo/resurrect-js-20261108');
  assert.match(kit.title, /^Modernize legacy JavaScript \(/);
  assert.ok(kit.commitMessage.startsWith(kit.title));
  assert.ok(kit.body.length > 200);
  assert.deepEqual(kit.changedPaths, ['legacy-sample.js']);
  assert.equal(kit.commands[0], 'git clone https://github.com/o/r.git');
  assert.ok(kit.commands.includes('git apply --index ../ghostrepo-resurrect.patch'));
  assert.ok(kit.commands.includes('gh repo fork --remote'), 'the push goes to a fork, not to the original');
  assert.ok(kit.commands.at(-1).startsWith('git push -u origin ghostrepo/resurrect-js-'));
});

test('the description reports the measured counts and nothing else', () => {
  const { report } = reportFor([['legacy-sample.js', FIXTURE]]);
  const { body } = buildPrKit(kitInput(report));
  const m = report.metrics;
  assert.ok(body.includes(`${m.legacy_patterns_removed} patterns removed`));
  assert.ok(body.includes(`${m.lines_changed} lines changed`));
  for (const [key, n] of Object.entries(m.breakdown)) {
    if (n > 0) assert.ok(body.includes(`| ${n}`) || body.includes(`${n} |`), key);
  }
  // Categories with zero removals do not appear in the table.
  assert.ok(!body.includes('| 0 |'));
});

test('the description never claims tests, speed, security or an agent', () => {
  const { report } = reportFor([['legacy-sample.js', FIXTURE]]);
  const { body } = buildPrKit(kitInput(report));
  assert.match(body, /did \*\*not\*\* run this repository's tests/);
  for (const forbidden of [
    /all tests pass/i,
    /tests pass/i,
    /no regressions?/i,
    /zero regressions?/i,
    /faster|performance/i,
    /vulnerabilit|secur(e|ity) fix|XSS fix|fixes? (a )?security/i,
    /\bAI\b|\bagent\b|autonomous|multi-agent|Kiro/i,
  ]) {
    assert.ok(!forbidden.test(body), `description must not match ${forbidden}`);
  }
});

test('skipped sites are listed with reason code and line, grouped by reason', () => {
  const { report } = reportFor([['legacy-sample.js', FIXTURE]]);
  const groups = summarizeSkips(report);
  assert.ok(groups.length > 0);
  const { body } = buildPrKit(kitInput(report));
  assert.match(body, /What was left unchanged, and why/);
  assert.match(body, /`nullish-idiom`/);
  assert.match(body, /legacy-sample\.js:\d+/);
});

test('unparsable files are listed as left untouched', () => {
  const { report } = reportFor([
    ['legacy-sample.js', FIXTURE],
    ['old/broken.js', 'function ( {'],
  ]);
  const { body } = buildPrKit(kitInput(report, { changedPaths: ['legacy-sample.js'] }));
  assert.match(body, /Files that could not be parsed/);
  assert.match(body, /`old\/broken\.js`/);
});

test('a subfolder prefixes every path so the patch applies from the repository root', () => {
  const { report } = reportFor([['legacy-sample.js', FIXTURE]]);
  const kit = buildPrKit(kitInput(report, { subfolder: 'legacy' }));
  assert.deepEqual(kit.changedPaths, ['legacy/legacy-sample.js']);
  assert.ok(kit.body.includes('`legacy/legacy-sample.js`'));
  assert.ok(kit.commands.includes(`git checkout -b ${kit.branch} ${'a'.repeat(40)}`));
  assert.ok(kit.commands.includes('git apply --index ../ghostrepo-resurrect.patch'));
});

test('no repository-controlled text reaches the commands', () => {
  // Valid git branch names and file names, and valid shell syntax once pasted.
  const evilPath = 'x$(touch PWNED).js';
  const { report } = reportFor([[evilPath, 'function f() {\n  var a = 1;\n  return a;\n}\n']]);
  const kit = buildPrKit(kitInput(report, { subfolder: 'a`id`', changedPaths: [evilPath], ref: 'main;id' }));
  for (const c of kit.commands) {
    assert.doesNotMatch(c, /PWNED|`id`|main;id/, c);
    assert.match(c, /^[\w@:/.\- "→(),]+$/, `unexpected character in: ${c}`);
  }
});

test('the kit refuses anything but a full commit sha', () => {
  const { report } = reportFor([['legacy-sample.js', FIXTURE]]);
  for (const sha of [undefined, null, 'main', 'a'.repeat(39), 'A'.repeat(40), `${'a'.repeat(40)};id`]) {
    assert.throws(() => buildPrKit(kitInput(report, { sha })), /full commit sha/, String(sha));
  }
});

test('a report with nothing skipped says so', () => {
  const { report } = reportFor([['a.js', 'function f() {\n  var x = 1;\n  return x;\n}\n']]);
  const { body } = buildPrKit(kitInput(report, { changedPaths: ['a.js'] }));
  assert.match(body, /Nothing was skipped/);
});

test('the commands really work: clone-like repo, apply the patch, commit on the branch', (t) => {
  const { report, results } = reportFor([['legacy-sample.js', FIXTURE]]);
  const patch = unifiedPatch('legacy-sample.js', FIXTURE, results[0].output);

  // The patch sits in the folder that holds the clone, as the UI tells people.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-kit-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = path.join(parent, 'r');
  fs.mkdirSync(dir);
  const g = (...args) => spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });

  assert.equal(g('init', '-q').status, 0);
  fs.writeFileSync(path.join(dir, 'legacy-sample.js'), FIXTURE);
  g('add', '.');
  assert.equal(g('commit', '-q', '-m', 'init').status, 0);
  fs.writeFileSync(path.join(parent, 'ghostrepo-resurrect.patch'), patch);
  const sha = g('rev-parse', 'HEAD').stdout.trim();
  g('commit', '-q', '--allow-empty', '-m', 'the branch moved on after the analysis');
  const kit = buildPrKit(kitInput(report, { sha }));

  // Run the kit's own commands, minus clone/cd/fork/push (they need a network).
  const local = kit.commands.filter((c) => !/^git (clone|push)|^cd |^gh /.test(c));
  for (const cmd of local) {
    const args = cmd.replace(/^git /, '').match(/"[^"]*"|\S+/g).map((a) => a.replace(/^"|"$/g, ''));
    const res = g(...args);
    assert.equal(res.status, 0, `${cmd}\n${res.stderr}`);
  }
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), kit.branch);
  assert.equal(fs.readFileSync(path.join(dir, 'legacy-sample.js'), 'utf8'), results[0].output);
  assert.equal(g('log', '-1', '--format=%s').stdout.trim(), kit.title);
  assert.equal(g('rev-parse', 'HEAD~1').stdout.trim(), sha, 'the branch starts at the analyzed commit');
});

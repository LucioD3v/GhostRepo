// The web run must give the same report and the same resurrected files as the
// CLI for the same tree (requirement 10.2), and its artifacts must be usable.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { processTree } from '../src/pipeline.js';
import { runResurrection, resurrectedFiles, WEB_SIGNATURE } from '../web/src/run.js';
import { assessListing } from '../web/src/assess.js';
import { buildArchive, buildKit, buildPatch, buildReportJson, changedPaths } from '../web/src/artifacts.js';

const FIXTURE = fs.readFileSync(new URL('../fixtures/legacy-sample.js', import.meta.url), 'utf8');

// A tree that exercises what a real legacy repository contains.
const TREE = {
  'index.html': '<!doctype html>\r\n<script src="js/app.js"></script>\r\n',
  'js/app.js': 'function f() {\r\n  var a = 1;\r\n  var b = a == 1;\r\n  return b;\r\n}\r\n',
  'js/sample.js': FIXTURE,
  'js/clean.js': 'const x = 1;\nexport default x;\n',
  'js/broken.js': 'function ( {',
  'js/vendor.min.js': 'var a=1;var b=2;',
  'node_modules/dep/index.js': 'var inside = 1;\n',
  'style/app.css': 'body { color: red; }\n',
  'img/pixel.png': 'PNG\u0000\u0001',
  'README.md': '# legacy\n',
};

function writeTree(root, tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function fakeClient(tree) {
  const enc = new TextEncoder();
  return {
    async fetchFile({ path: p }) {
      if (!(p in tree)) throw new Error(`unexpected fetch ${p}`);
      return enc.encode(tree[p]);
    },
  };
}

const target = (over = {}) => ({
  owner: 'o',
  repo: 'r',
  sha: 'abc123',
  subfolder: '',
  canonicalUrl: 'https://github.com/o/r',
  ...over,
});

const listing = (tree) => Object.entries(tree).map(([p, c]) => ({ path: p, size: Buffer.byteLength(c) }));

test('the web run and the CLI give the same report for the same tree', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-parity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cliRoot = path.join(root, 'cli');
  writeTree(cliRoot, TREE);
  const { report: cli } = processTree({
    scanRoot: cliRoot,
    targetUrl: 'https://github.com/o/r',
    targetPath: null,
    reportPath: path.join(root, 'report.json'),
  });

  const web = await runResurrection({
    client: fakeClient(TREE),
    target: target(),
    entries: listing(TREE),
    yieldFn: async () => {},
  });

  assert.deepEqual(web.report.metrics, cli.metrics);
  assert.deepEqual(web.report.files, cli.files);
  assert.equal(web.report.status, cli.status);
  assert.equal(web.report.scope, cli.scope);
  assert.equal(web.report.repository, cli.repository);
  assert.deepEqual(web.report.target, cli.target);
  // The only fields allowed to differ (requirement 10.2).
  assert.equal(web.report.agent_signature, WEB_SIGNATURE);
  assert.notEqual(web.report.agent_signature, cli.agent_signature);
  assert.ok(!/agent|orchestrator|kiro/i.test(WEB_SIGNATURE));
});

test('the web run writes byte-identical files to the CLI, including CRLF', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-parity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cliRoot = path.join(root, 'cli');
  writeTree(cliRoot, TREE);
  processTree({ scanRoot: cliRoot, targetUrl: null, targetPath: null, reportPath: path.join(root, 'r.json') });

  const web = await runResurrection({
    client: fakeClient(TREE),
    target: target(),
    entries: listing(TREE),
    yieldFn: async () => {},
  });
  const finalFiles = resurrectedFiles(web);

  for (const [rel, bytes] of finalFiles) {
    const onDisk = fs.readFileSync(path.join(cliRoot, ...rel.split('/')));
    assert.ok(Buffer.from(bytes).equals(onDisk), `${rel} differs from the CLI output`);
  }
  assert.ok(Buffer.from(finalFiles.get('js/app.js')).toString().includes('const a = 1;\r\n'), 'CRLF preserved');
});

test('node_modules and .git are never downloaded; the other files all are', async () => {
  const fetched = [];
  const client = { fetchFile: async ({ path: p }) => (fetched.push(p), new TextEncoder().encode(TREE[p])) };
  const web = await runResurrection({ client, target: target(), entries: listing(TREE), yieldFn: async () => {} });
  assert.ok(!fetched.some((p) => p.startsWith('node_modules/')));
  assert.deepEqual([...web.files.keys()].sort(), Object.keys(TREE).filter((p) => !p.startsWith('node_modules/')).sort());
});

test('the report matches what the assessment promised', async () => {
  const a = assessListing({ entries: listing(TREE) });
  const web = await runResurrection({ client: fakeClient(TREE), target: target(), entries: listing(TREE), yieldFn: async () => {} });
  assert.equal(web.report.metrics.files_scanned, a.eligible.length);
  assert.deepEqual(web.report.files.map((f) => f.path), a.eligible);
});

test('a file that is not valid UTF-8 is left alone and listed as skipped', async () => {
  const bytes = new Uint8Array([0x76, 0x61, 0x72, 0x20, 0xe9, 0x3b]); // "var é;" in Latin-1
  const client = { fetchFile: async () => bytes };
  const web = await runResurrection({
    client,
    target: target(),
    entries: [{ path: 'latin1.js', size: 6 }],
    yieldFn: async () => {},
  });
  assert.equal(web.report.metrics.files_skipped, 1);
  assert.equal(web.report.metrics.files_transformed, 0);
  assert.equal(web.report.status, 'NO_CHANGES');
  assert.match(web.report.files[0].skipped[0].reason, /not valid UTF-8/);
  assert.deepEqual(Buffer.from(resurrectedFiles(web).get('latin1.js')), Buffer.from(bytes));
});

test('a UTF-8 byte order mark survives a transform', async () => {
  const src = '\uFEFFfunction f() {\n  var a = 1;\n  return a;\n}\n';
  const client = { fetchFile: async () => new TextEncoder().encode(src) };
  const web = await runResurrection({ client, target: target(), entries: [{ path: 'bom.js', size: 40 }], yieldFn: async () => {} });
  const out = Buffer.from(resurrectedFiles(web).get('bom.js'));
  assert.deepEqual([...out.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(out.toString('utf8').includes('const a = 1;'));
});

test('progress reports the four phases in order and ends done', async () => {
  const events = [];
  await runResurrection({
    client: fakeClient(TREE),
    target: target(),
    entries: listing(TREE),
    onProgress: (e) => events.push(e),
    yieldFn: async () => {},
  });
  const firstSeen = [...new Set(events.map((e) => e.phase))];
  assert.deepEqual(firstSeen, ['necromancy', 'exorcism', 'transmutation', 'resurrection']);
  for (const phase of firstSeen) {
    assert.equal(events.filter((e) => e.phase === phase).at(-1).state, 'done', phase);
  }
  const last = events.filter((e) => e.phase === 'necromancy' && e.state === 'running').at(-1);
  assert.equal(last.done, last.total);
});

test('cancelling stops the run', async () => {
  const controller = new AbortController();
  const client = {
    fetchFile: async ({ path: p }) => {
      controller.abort();
      return new TextEncoder().encode(TREE[p]);
    },
  };
  await assert.rejects(
    runResurrection({ client, target: target(), entries: listing(TREE), signal: controller.signal, yieldFn: async () => {} }),
    (e) => e.name === 'AbortError',
  );
});

test('a failed download aborts the run instead of producing a partial result', async () => {
  const client = {
    fetchFile: async ({ path: p }) => {
      if (p === 'js/sample.js') throw new Error('Could not download js/sample.js');
      return new TextEncoder().encode(TREE[p]);
    },
  };
  await assert.rejects(runResurrection({ client, target: target(), entries: listing(TREE), yieldFn: async () => {} }), /sample\.js/);
});

test('the archive holds every fetched file with the transformed bytes, and no report', async () => {
  const web = await runResurrection({ client: fakeClient(TREE), target: target(), entries: listing(TREE), yieldFn: async () => {} });
  const zip = buildArchive(web);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const names = [];
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint16(p + 28, true);
    names.push(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen;
  }
  assert.deepEqual(names.sort(), [...web.files.keys()].sort());
  assert.ok(!names.some((n) => /resurrection-report/.test(n)));
});

test('the report JSON has the CLI schema', async () => {
  const web = await runResurrection({ client: fakeClient(TREE), target: target(), entries: listing(TREE), yieldFn: async () => {} });
  const parsed = JSON.parse(buildReportJson(web));
  assert.deepEqual(Object.keys(parsed), ['project', 'repository', 'scope', 'status', 'timestamp', 'target', 'metrics', 'files', 'agent_signature']);
  assert.equal(parsed.project, 'GhostRepo');
});

test('applying the patch to the original tree gives exactly the resurrected files', async (t) => {
  const web = await runResurrection({ client: fakeClient(TREE), target: target(), entries: listing(TREE), yieldFn: async () => {} });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-apply-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeTree(dir, TREE);

  const patch = buildPatch(web, '');
  assert.ok(patch.length > 0);
  fs.writeFileSync(path.join(dir, 'x.patch'), patch);
  const res = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', 'x.patch'], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);

  for (const [rel, bytes] of resurrectedFiles(web)) {
    const onDisk = fs.readFileSync(path.join(dir, ...rel.split('/')));
    assert.ok(Buffer.from(bytes).equals(onDisk), `${rel} differs after git apply`);
  }
  assert.deepEqual(changedPaths(web), ['js/app.js', 'js/sample.js']);
});

test('with a subfolder the patch uses repository-root paths', async (t) => {
  const sub = { 'a.js': 'function f() {\n  var x = 1;\n  return x;\n}\n' };
  const web = await runResurrection({
    client: fakeClient(sub),
    target: target({ subfolder: 'legacy' }),
    entries: listing(sub),
    yieldFn: async () => {},
  });
  assert.equal(web.report.target.path, 'legacy');
  const patch = buildPatch(web, 'legacy');
  assert.match(patch, /^diff --git a\/legacy\/a\.js b\/legacy\/a\.js\n/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-apply-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeTree(dir, { 'legacy/a.js': sub['a.js'], 'other.txt': 'x' });
  fs.writeFileSync(path.join(dir, 'x.patch'), patch);
  const res = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', 'x.patch'], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.readFileSync(path.join(dir, 'legacy', 'a.js'), 'utf8').includes('const x = 1;'));

  const kit = buildKit(web, { owner: 'o', repo: 'r', ref: 'main', subfolder: 'legacy', toolUrl: 'https://example.test/' });
  assert.deepEqual(kit.changedPaths, ['legacy/a.js']);
  assert.equal(kit.patch, patch);
});

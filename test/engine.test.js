// The engine is shared by the CLI and the web UI. These tests pin the two
// guarantees the web UI relies on:
//   * the file-selection rule used for the browser assessment is the very same
//     rule the CLI walker applies on disk;
//   * processFile() (what the browser calls) yields exactly the report entry
//     and output that processTree() (what the CLI calls) produces.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEligibleJsPath, isEligibleFileName } from '../src/files.js';
import { walkJsFiles } from '../src/walk.js';
import { processFile, lineDiffCount } from '../src/engine.js';
import { processTree } from '../src/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'legacy-sample.js');

test('isEligibleJsPath: .js only, never minified, never inside node_modules or .git', () => {
  assert.equal(isEligibleJsPath('a.js'), true);
  assert.equal(isEligibleJsPath('src/deep/a.js'), true);
  assert.equal(isEligibleJsPath('a.min.js'), false);
  assert.equal(isEligibleJsPath('src/a.min.js'), false);
  assert.equal(isEligibleJsPath('node_modules/x/a.js'), false);
  assert.equal(isEligibleJsPath('src/node_modules/a.js'), false);
  assert.equal(isEligibleJsPath('.git/hooks/a.js'), false);
  assert.equal(isEligibleJsPath('a.mjs'), false);
  assert.equal(isEligibleJsPath('a.json'), false);
  assert.equal(isEligibleJsPath('a.ts'), false);
  assert.equal(isEligibleJsPath(''), false);
  assert.equal(isEligibleFileName('lib.js'), true);
  assert.equal(isEligibleFileName('lib.min.js'), false);
});

test('the disk walker and isEligibleJsPath select exactly the same files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-walk-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const all = [
    'index.js',
    'lib/util.js',
    'lib/deep/more.js',
    'lib/vendor.min.js',
    'node_modules/pkg/index.js',
    'lib/node_modules/inner/index.js',
    '.git/hooks/pre-commit.js',
    'readme.md',
    'data.json',
    'style/app.css',
    'app.mjs',
  ];
  for (const rel of all) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '// x\n');
  }

  const walked = walkJsFiles(root)
    .map((abs) => path.relative(root, abs).split(path.sep).join('/'))
    .sort();
  const byRule = all.filter(isEligibleJsPath).sort();

  assert.deepEqual(walked, byRule);
  assert.deepEqual(walked, ['index.js', 'lib/deep/more.js', 'lib/util.js']);
});

test('processFile matches what processTree writes and reports for the same file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-engine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scanRoot = path.join(root, 'tree');
  fs.mkdirSync(scanRoot);
  fs.copyFileSync(FIXTURE, path.join(scanRoot, 'legacy-sample.js'));
  const original = fs.readFileSync(FIXTURE, 'utf8');

  const direct = processFile('legacy-sample.js', original);
  const { report } = processTree({
    scanRoot,
    targetUrl: null,
    targetPath: null,
    reportPath: path.join(root, 'r.json'),
  });

  assert.deepEqual(report.files[0], direct.entry);
  assert.equal(report.metrics.lines_changed, direct.linesChanged);
  assert.equal(fs.readFileSync(path.join(scanRoot, 'legacy-sample.js'), 'utf8'), direct.output);
  assert.equal(direct.parseFailed, false);
});

test('processFile on an unparsable file reports a parse skip and writes nothing', () => {
  const r = processFile('broken.js', 'function ( {');
  assert.equal(r.parseFailed, true);
  assert.equal(r.output, null);
  assert.equal(r.linesChanged, 0);
  assert.equal(r.entry.before, null);
  assert.equal(r.entry.skipped[0].transform, 'parse');
  assert.equal('line' in r.entry.skipped[0], false);
});

test('processFile leaves a file that needs no transform untouched', () => {
  const src = 'const a = 1;\nexport default a;\n';
  const r = processFile('clean.js', src);
  assert.equal(r.output, null);
  assert.equal(r.linesChanged, 0);
  assert.deepEqual(r.entry.transforms_applied, []);
});

test('lineDiffCount ignores line-ending differences and counts real changes', () => {
  assert.equal(lineDiffCount('a\nb\n', 'a\r\nb\r\n'), 0);
  assert.equal(lineDiffCount('var a = 1;\n', 'const a = 1;\n'), 2);
  assert.equal(lineDiffCount('same', 'same'), 0);
});

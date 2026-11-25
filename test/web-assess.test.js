import test from 'node:test';
import assert from 'node:assert/strict';

import { assessListing, suggestFolders, LIMITS } from '../web/src/assess.js';

const files = (...paths) => paths.map((p) => ({ path: p, size: 1000 }));

// The shape of the Gaia calculator's legacy/ folder as GitHub lists it.
const GAIA_LEGACY = files(
  'index.html',
  'js/calculator.js',
  'js/parser.js',
  'manifest.webapp',
  'style/calculator.css',
  'style/icons/Calculator.png',
  'style/images/background.png',
  'test/integration/atoms/hold.js',
  'test/integration/calculator_integration.js',
  'test/integration/calculator_test.js',
);

test('a web project with JavaScript and an index.html can be resurrected, with live run', () => {
  const a = assessListing({ entries: GAIA_LEGACY });
  assert.equal(a.verdict, 'READY');
  assert.equal(a.headline, 'Can be resurrected');
  assert.equal(a.entryPoint, 'index.html');
  // Same count the CLI reports as files_scanned for this tree.
  assert.equal(a.eligible.length, 5);
  assert.ok(a.details.some((d) => /live run will be available/.test(d)));
});

test('JavaScript without index.html can be resurrected, without live run', () => {
  const a = assessListing({ entries: files('lib/a.js', 'lib/b.js', 'README.md') });
  assert.equal(a.verdict, 'READY_NO_PREVIEW');
  assert.equal(a.entryPoint, null);
  assert.ok(a.details.some((d) => /not the live run/.test(d)));
});

test('a repository with no .js files is not supported and says what it looks like', () => {
  const py = [];
  for (let i = 0; i < 214; i++) py.push(`pkg/mod${i}.py`);
  const a = assessListing({ entries: files(...py, 'setup.cfg', 'README.md') });
  assert.equal(a.verdict, 'NOT_SUPPORTED');
  assert.equal(a.headline, 'Not supported by this version');
  assert.equal(a.detected.name, 'Python');
  assert.equal(a.detected.files, 214);
  assert.equal(a.detected.mostly, true);
  const text = a.details.join(' ');
  assert.match(text, /only JavaScript\/web code/);
  assert.match(text, /mostly like Python: 214 files/);
  assert.match(text, /detected from file extensions/);
  assert.match(text, /0 eligible \.js files/);
});

test('a repository with no recognizable source still gets an honest message', () => {
  const a = assessListing({ entries: files('README.md', 'LICENSE', 'docs/a.txt') });
  assert.equal(a.verdict, 'NOT_SUPPORTED');
  assert.equal(a.detected, null);
  assert.match(a.details.join(' '), /No eligible \.js files were found/);
});

test('only minified or vendored .js is not supported, and says why they were excluded', () => {
  const a = assessListing({
    entries: files('dist/app.min.js', 'node_modules/x/index.js', 'node_modules/y/index.js'),
  });
  assert.equal(a.verdict, 'NOT_SUPPORTED');
  assert.deepEqual(a.excluded, { minified: 1, vendored: 2 });
  assert.match(a.details.join(' '), /1 minified/);
  assert.match(a.details.join(' '), /2 inside node_modules/);
});

test('TypeScript-only projects are named as not processed, not silently ignored', () => {
  const a = assessListing({ entries: files('src/a.ts', 'src/b.ts', 'src/c.tsx') });
  assert.equal(a.verdict, 'NOT_SUPPORTED');
  assert.equal(a.detected.name, 'TypeScript');
});

test('an index.html in a subfolder points the user to that folder', () => {
  const a = assessListing({ entries: files('web/app.js', 'web/index.html', 'docs/index.html') });
  assert.equal(a.verdict, 'READY_NO_PREVIEW');
  assert.match(a.details.join(' '), /An index\.html exists in docs, web\. Select that folder/);
});

test('mixed repositories follow the JavaScript verdict and say other languages are untouched', () => {
  const a = assessListing({
    entries: files('app.js', 'index.html', 'server/main.py', 'server/util.py', 'src/a.ts'),
  });
  assert.equal(a.verdict, 'READY');
  const text = a.details.join(' ');
  assert.match(text, /other languages \(Python: 2\) will be left untouched/);
  assert.match(text, /TypeScript \(1\) are not processed/);
});

test('node_modules and .git never count toward the limits or the eligible list', () => {
  const entries = [
    ...files('app.js', 'index.html'),
    ...Array.from({ length: 5000 }, (_, i) => ({ path: `node_modules/p${i}/index.js`, size: 5000 })),
  ];
  const a = assessListing({ entries });
  assert.equal(a.verdict, 'READY');
  assert.deepEqual(a.eligible, ['app.js']);
  assert.equal(a.totalFiles, 2);
  assert.equal(a.excluded.vendored, 5000);
});

test('too many files is too large and suggests the folders with the most .js files', () => {
  const entries = [
    ...Array.from({ length: LIMITS.maxFiles }, (_, i) => ({ path: `apps/calc/f${i}.js`, size: 10 })),
    ...files('apps/clock/a.js', 'tools/x.js', 'top.js'),
  ];
  const a = assessListing({ entries });
  assert.equal(a.verdict, 'TOO_LARGE');
  assert.equal(a.headline, 'Too large to analyze as a whole');
  assert.deepEqual(a.suggestions[0], { folder: 'apps', jsFiles: LIMITS.maxFiles + 1 });
  assert.match(a.details.join(' '), /Select a subfolder/);
});

test('too many bytes is too large', () => {
  const a = assessListing({ entries: [{ path: 'big.js', size: LIMITS.maxBytes + 1 }] });
  assert.equal(a.verdict, 'TOO_LARGE');
});

test('a truncated GitHub listing is too large and is marked partial', () => {
  const a = assessListing({ entries: files('a.js'), truncated: true });
  assert.equal(a.verdict, 'TOO_LARGE');
  assert.equal(a.partial, true);
  assert.match(a.details.join(' '), /partial file listing/);
});

test('the assessment never promises an outcome', () => {
  const a = assessListing({ entries: GAIA_LEGACY });
  const text = a.details.join(' ');
  assert.match(text, /can be analyzed/);
  assert.match(text, /may still end with no changes/);
});

test('suggestFolders ignores root files and ranks by count', () => {
  const s = suggestFolders(['a.js', 'x/1.js', 'x/2.js', 'y/1.js']);
  assert.deepEqual(s, [
    { folder: 'x', jsFiles: 2 },
    { folder: 'y', jsFiles: 1 },
  ]);
});

// Build the web UI into dist/ (static files, ready for GitHub Pages).
//
//   node scripts/build-web.mjs
//
// The engine (src/engine.js and everything it imports) is bundled as-is: the web
// UI runs the same code as the CLI. Only Node modules that jscodeshift and recast
// name but never execute in a browser are replaced by tiny shims (web/shims).

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const shim = (name) => path.join(root, 'web', 'shims', name);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Two bundles: the page (app.js) and the resurrection worker (worker.js), which
// carries the engine so a long engine call never blocks the page.
const result = await build({
  entryPoints: {
    app: path.join(root, 'web', 'src', 'main.js'),
    worker: path.join(root, 'web', 'src', 'worker.js'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
  alias: {
    assert: shim('assert.cjs'),
    os: shim('os.cjs'),
    'flow-parser': shim('empty.cjs'),
  },
});

fs.copyFileSync(path.join(root, 'web', 'style.css'), path.join(dist, 'style.css'));

// Cache busting: browsers and GitHub Pages cache style.css and app.js, so a new
// page could load with the previous stylesheet. A content hash in the URL makes
// every change a new URL.
const hashOf = (f) => createHash('sha256').update(fs.readFileSync(path.join(dist, f))).digest('hex').slice(0, 10);
// The worker URL lives in app.js (web/src/run-worker.js), so version it first;
// app.js's own hash then covers the change.
const appPath = path.join(dist, 'app.js');
const app = fs.readFileSync(appPath, 'utf8');
const workerRefs = app.split('"./worker.js"').length - 1;
if (workerRefs !== 1) {
  console.error(`expected one "./worker.js" reference in app.js, found ${workerRefs}`);
  process.exit(1);
}
fs.writeFileSync(appPath, app.replace('"./worker.js"', `"./worker.js?v=${hashOf('worker.js')}"`));
const html = fs
  .readFileSync(path.join(root, 'web', 'index.html'), 'utf8')
  .replace('href="./style.css"', `href="./style.css?v=${hashOf('style.css')}"`)
  .replace('src="./app.js"', `src="./app.js?v=${hashOf('app.js')}"`);
if (!html.includes('style.css?v=') || !html.includes('app.js?v=')) {
  console.error('index.html no longer references ./style.css and ./app.js; update the cache busting in build-web.mjs');
  process.exit(1);
}
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

// Fail loudly if a Node-only import slipped into the browser bundle.
const nodeOnly = Object.keys(result.metafile.inputs).filter((p) => /(^|\/)node:/.test(p));
if (nodeOnly.length > 0) {
  console.error('Node-only modules in the browser bundle:', nodeOnly);
  process.exit(1);
}

const kb = (f) => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0);
console.log(`Built dist/ — app.js ${kb("app.js")} KB, worker.js ${kb("worker.js")} KB`);

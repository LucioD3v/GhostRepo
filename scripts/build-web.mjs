// Build the web UI into dist/ (static files, ready for GitHub Pages).
//
//   node scripts/build-web.mjs
//
// The engine (src/engine.js and everything it imports) is bundled as-is: the web
// UI runs the same code as the CLI. Only Node modules that jscodeshift and recast
// name but never execute in a browser are replaced by tiny shims (web/shims).

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const shim = (name) => path.join(root, 'web', 'shims', name);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'web', 'src', 'main.js')],
  outfile: path.join(dist, 'app.js'),
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

fs.copyFileSync(path.join(root, 'web', 'index.html'), path.join(dist, 'index.html'));
fs.copyFileSync(path.join(root, 'web', 'style.css'), path.join(dist, 'style.css'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

// Fail loudly if a Node-only import slipped into the browser bundle.
const nodeOnly = Object.keys(result.metafile.inputs).filter((p) => /(^|\/)node:/.test(p));
if (nodeOnly.length > 0) {
  console.error('Node-only modules in the browser bundle:', nodeOnly);
  process.exit(1);
}

const size = fs.statSync(path.join(dist, 'app.js')).size;
console.log(`Built dist/ — app.js ${(size / 1024).toFixed(0)} KB`);

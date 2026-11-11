// Node-only directory walker. Kept out of scan.js so that scan.js, the codemods
// and the engine stay free of `fs` and can run in a browser.

import fs from 'node:fs';
import path from 'node:path';

import { SKIP_DIRS, isEligibleFileName } from './files.js';

/**
 * Recursively collect eligible .js files under `dir`, skipping node_modules/,
 * .git/, and minified *.min.js files. Returns absolute paths, sorted.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function walkJsFiles(dir) {
  const results = [];

  function recurse(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      // Permission / IO error on a directory — skip it, keep walking the rest.
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        recurse(full);
      } else if (entry.isFile()) {
        if (isEligibleFileName(entry.name)) results.push(full);
      }
    }
  }

  recurse(dir);
  results.sort();
  return results;
}

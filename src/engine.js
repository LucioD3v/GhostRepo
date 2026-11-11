// The resurrection engine for ONE file: scan -> exorcise -> transmute -> re-scan.
//
// Pure: takes source text, returns data. No filesystem, no git, no network. The
// CLI (src/pipeline.js) and the web UI both call processFile(), so a report
// produced in either place comes from the very same code path.
// docs/RESURRECT-CLI.md §3, §5.

import { countPatterns } from './scan.js';
import { exorcise } from './exorcise.js';
import { transmute } from './transmute.js';

/**
 * Process one file.
 *
 * @param {string} relPath   POSIX-style path relative to the scanned root
 * @param {string} original  file content
 * @returns {{
 *   entry: object,            the `files[]` entry of the report
 *   output: string|null,      transformed source to write, or null if the file stays as is
 *   linesChanged: number,     line-diff count for this file (0 when nothing is written)
 *   parseFailed: boolean      true when the file could not be parsed
 * }}
 */
export function processFile(relPath, original) {
  let before;
  try {
    before = countPatterns(original);
  } catch (e) {
    return {
      entry: {
        path: relPath,
        before: null,
        after: null,
        transforms_applied: [],
        skipped: [{ transform: 'parse', reason: String(e.message || e) }],
      },
      output: null,
      linesChanged: 0,
      parseFailed: true,
    };
  }

  // --- Phase 2: Exorcism ----------------------------------------------------
  const ex = exorcise(original);
  // --- Phase 3: Transmutation -----------------------------------------------
  const tr = transmute(ex.code);
  const transformedSource = tr.code;

  const transformsApplied = new Set(tr.stats.transforms);
  if (ex.stats.applied > 0) transformsApplied.add('insecure_innerHTML');

  const skipped = [...ex.stats.skipped, ...tr.stats.skipped];

  // Re-count the transformed source with the SAME counter (symmetric).
  let after;
  try {
    after = countPatterns(transformedSource);
  } catch {
    // A transform should never produce unparsable code; if it somehow did,
    // discard the transform and keep the original (never corrupt output).
    after = before;
  }

  const changed = transformedSource !== original;
  const writable = changed && isParsable(transformedSource);

  return {
    entry: {
      path: relPath,
      before,
      after: changed ? after : before,
      transforms_applied: changed ? [...transformsApplied] : [],
      skipped,
    },
    output: writable ? transformedSource : null,
    linesChanged: writable ? lineDiffCount(original, transformedSource) : 0,
    parseFailed: false,
  };
}

function isParsable(source) {
  try {
    countPatterns(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * Line-level diff count (insertions + deletions) without requiring git.
 * Symmetric difference of the line multisets of both versions, with CRLF/LF
 * normalized so a line-ending difference never counts as a change.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function lineDiffCount(a, b) {
  const aLines = a.replace(/\r\n/g, '\n').split('\n');
  const bLines = b.replace(/\r\n/g, '\n').split('\n');

  const countMap = new Map();
  for (const l of aLines) countMap.set(l, (countMap.get(l) || 0) + 1);
  for (const l of bLines) countMap.set(l, (countMap.get(l) || 0) - 1);

  let deletions = 0;
  let insertions = 0;
  for (const v of countMap.values()) {
    if (v > 0) deletions += v;
    else if (v < 0) insertions += -v;
  }
  return insertions + deletions;
}

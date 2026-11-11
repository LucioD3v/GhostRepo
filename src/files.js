// File-selection rule shared by the CLI and the web UI.
//
// Pure: no I/O. Which files the engine processes must be decided in exactly one
// place, otherwise the web assessment could promise files the run never reads.
// docs/RESURRECT-CLI.md §3 (Phase 1) and §9.

// Directories that are never entered, at any depth.
export const SKIP_DIRS = new Set(['node_modules', '.git']);

/** True for `.js` files that are not minified (`*.min.js`). */
export function isEligibleFileName(name) {
  return name.endsWith('.js') && !name.endsWith('.min.js');
}

/**
 * True when a repository-relative POSIX path (`a/b/c.js`) is processed by the
 * engine: an eligible file name with no skipped directory in its path.
 *
 * @param {string} posixPath
 * @returns {boolean}
 */
export function isEligibleJsPath(posixPath) {
  const segments = posixPath.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  const name = segments[segments.length - 1];
  const dirs = segments.slice(0, -1);
  if (dirs.some((d) => SKIP_DIRS.has(d))) return false;
  return isEligibleFileName(name);
}

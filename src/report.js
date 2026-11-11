// Phase 4 — Resurrection (report with REAL metrics)
//
// Pure assembly of the resurrection-report.json object from measured inputs.
// No I/O: the CLI writes the file (src/pipeline.js). Honesty rules (docs/RESURRECT-CLI.md §7):
//   * every number comes from a real before/after AST count or a real diff;
//   * unmeasurable values are 0 (counts) or null (identifiers), never faked;
//   * *_removed = before - after, clamped at 0;
//   * reported-only categories (dead_vendor_api, es5_prototype) stay 0 unless a
//     transform genuinely removed them;
//   * status reflects what actually happened.

// Names the tool that generated the report. It identifies the generator only and
// does not imply that an agent ran (docs/RESURRECT-CLI.md §7).
const DEFAULT_SIGNATURE = 'GhostRepo resurrect CLI';

const ZERO = { var: 0, loose_equality: 0, innerHTML: 0, vendor_api: 0, es5_prototype: 0 };

// Map a scan-category key -> report breakdown key.
const BREAKDOWN_KEYS = {
  var: 'var_to_const_let',
  loose_equality: 'loose_equality',
  innerHTML: 'insecure_innerHTML',
  vendor_api: 'dead_vendor_api',
  es5_prototype: 'es5_prototype',
};

function clampRemoved(before, after) {
  const diff = (before || 0) - (after || 0);
  return diff < 0 ? 0 : diff;
}

/**
 * Derive the repository name from any target shape. Returns null if underivable.
 * @param {string|null|undefined} target
 * @returns {string|null}
 */
export function deriveRepository(target) {
  if (!target || typeof target !== 'string') return null;
  let s = target.trim();
  if (s === '') return null;

  // git@host:owner/repo.git -> take the part after ':'
  const scpMatch = s.match(/^[^/]+@[^:]+:(.+)$/);
  if (scpMatch) s = scpMatch[1];

  // Strip querystring / fragment.
  s = s.replace(/[?#].*$/, '');
  // Normalize both separators, drop trailing separators.
  s = s.replace(/\\/g, '/').replace(/\/+$/, '');

  const segments = s.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  let last = segments[segments.length - 1];
  // Strip a trailing drive-only segment like "C:" (edge case).
  if (/^[a-zA-Z]:$/.test(last)) return null;
  last = last.replace(/\.git$/i, '');
  return last === '' ? null : last;
}

/**
 * Build the report object from measured inputs.
 *
 * @param {object} input
 * @param {string|null} input.targetUrl
 * @param {string|null} input.targetPath
 * @param {Array<{path:string, before:object, after:object, transforms_applied:string[], skipped:Array}>} input.files
 * @param {number} input.linesChanged   real diff insertions+deletions (0 if unmeasurable)
 * @param {number} input.filesScanned
 * @param {number} input.filesSkipped   files that failed to parse
 * @param {string} [input.timestamp]
 * @param {string} [input.agentSignature]  names the tool that generated the report
 * @returns {object}
 */
export function buildReport(input) {
  const {
    targetUrl = null,
    targetPath = null,
    files = [],
    linesChanged = 0,
    filesScanned = 0,
    filesSkipped = 0,
    timestamp = new Date().toISOString(),
    agentSignature = DEFAULT_SIGNATURE,
  } = input;

  const breakdown = {
    var_to_const_let: 0,
    loose_equality: 0,
    insecure_innerHTML: 0,
    dead_vendor_api: 0,
    es5_prototype: 0,
  };

  let filesTransformed = 0;

  for (const file of files) {
    const before = { ...ZERO, ...(file.before || {}) };
    const after = { ...ZERO, ...(file.after || {}) };

    if (file.transforms_applied && file.transforms_applied.length > 0) {
      filesTransformed += 1;
    }

    for (const [scanKey, breakdownKey] of Object.entries(BREAKDOWN_KEYS)) {
      breakdown[breakdownKey] += clampRemoved(before[scanKey], after[scanKey]);
    }
  }

  const legacyPatternsRemoved = Object.values(breakdown).reduce((a, b) => a + b, 0);

  let status;
  if (filesScanned === 0) status = 'SCANNED_ONLY';
  else if (filesTransformed === 0) status = 'NO_CHANGES';
  else status = 'RESURRECTED';

  return {
    project: 'GhostRepo',
    repository: deriveRepository(targetUrl),
    scope: 'javascript-web-legacy',
    status,
    timestamp,
    target: { url: targetUrl, path: targetPath },
    metrics: {
      files_scanned: filesScanned,
      files_transformed: filesTransformed,
      files_skipped: filesSkipped,
      lines_changed: linesChanged || 0,
      legacy_patterns_removed: legacyPatternsRemoved,
      breakdown,
    },
    files,
    agent_signature: agentSignature,
  };
}

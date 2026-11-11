// What the user can take away: the archive, the report, the patch and the PR kit.
// Pure: bytes and strings in, bytes and strings out.

import { createZip } from './zip.js';
import { unifiedPatch } from './diff.js';
import { buildPrKit } from './prkit.js';
import { resurrectedFiles } from './run.js';

export const PATCH_FILE_NAME = 'ghostrepo-resurrect.patch';

const encoder = new TextEncoder();

/** Paths of the files the engine changed, sorted. */
export function changedPaths(result) {
  return [...result.outputs.keys()].sort();
}

/** One zip with every fetched file of the scanned root (requirement 7.1, 7.5). */
export function buildArchive(result) {
  const entries = [...resurrectedFiles(result).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, data]) => ({ path, data }));
  return createZip(entries);
}

/** The report exactly as the CLI writes it (requirement 7.2). */
export function buildReportJson(result) {
  return JSON.stringify(result.report, null, 2) + '\n';
}

/**
 * Unified patch of every changed file, with repository-root paths so that
 * `git apply` works on a checkout of the repository (requirement 7.3).
 */
export function buildPatch(result, subfolder) {
  let out = '';
  for (const path of changedPaths(result)) {
    const repoPath = subfolder ? `${subfolder}/${path}` : path;
    out += unifiedPatch(repoPath, result.sources.get(path), result.outputs.get(path));
  }
  return out;
}

/** Everything the "Prepare pull request" panel shows. */
export function buildKit(result, { owner, repo, ref, subfolder, toolUrl }) {
  const kit = buildPrKit({
    report: result.report,
    owner,
    repo,
    ref,
    subfolder,
    changedPaths: changedPaths(result),
    patchFileName: PATCH_FILE_NAME,
    toolUrl,
  });
  return { ...kit, patch: buildPatch(result, subfolder) };
}

export function textBytes(text) {
  return encoder.encode(text);
}

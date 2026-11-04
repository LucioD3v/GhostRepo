// Pipeline orchestrator — wires phases 1→4 and owns the working-dir lifecycle.
//
// This is the only module that touches the filesystem working directory and
// shells out to git. The codemods and counters it calls are pure functions.
// See docs/RESURRECT-CLI.md §3, §5, §8.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { countPatterns, walkJsFiles } from './scan.js';
import { exorcise } from './exorcise.js';
import { transmute } from './transmute.js';
import { buildReport, writeReport, deriveRepository } from './report.js';

const DEFAULT_REPORT = 'resurrection-report.json';

/**
 * Run the full 4-phase pipeline.
 *
 * @param {object} opts
 * @param {string} opts.target        repo URL or local path
 * @param {string|null} [opts.subpath] optional --path subfolder
 * @param {string} [opts.reportPath]  where to write the report
 * @param {string} [opts.outDir]      where to write the resurrected code
 * @param {(msg:string)=>void} [opts.log]
 * @returns {{report:object, reportPath:string, outDir:string}}
 */
export function run(opts) {
  const log = opts.log || (() => {});
  const reportPath = opts.reportPath || path.resolve(process.cwd(), DEFAULT_REPORT);
  const subpath = opts.subpath || null;
  const outDir = path.resolve(
    opts.outDir || path.join('resurrected', deriveRepository(opts.target) || 'output'),
  );
  assertWritableOutDir(outDir);

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-'));
  let cloneDir = path.join(workRoot, 'clone');

  try {
    // --- Phase 1a: acquire the target ---------------------------------------
    log('👻 Phase 1 (Necromancy): acquiring target...');
    acquire(opts.target, subpath, cloneDir, log);

    // Scanned root is the --path subfolder when given, else the clone root.
    const scanRoot = subpath ? path.join(cloneDir, subpath) : cloneDir;
    if (!fs.existsSync(scanRoot)) {
      const err = new Error(`path not found in repo: ${subpath}`);
      err.exitCode = 2;
      throw err;
    }

    const result = processTree({
      scanRoot,
      targetUrl: opts.target,
      targetPath: subpath,
      reportPath,
      log,
    });

    // Keep the resurrected code: copy the transformed tree out of the temp
    // working directory before it is cleaned up (without the clone's .git).
    log(`✨ Phase 4 (Resurrection): writing resurrected code to ${outDir}`);
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    fs.cpSync(scanRoot, outDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== '.git',
    });

    return { ...result, outDir };
  } finally {
    // Clean the working directory; never leave temp clones behind.
    try {
      fs.rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Process an already-present tree (used by the pipeline after clone, and by the
 * integration test with a local fixture). Scans, transforms, re-scans, diffs,
 * and writes the report.
 */
export function processTree({ scanRoot, targetUrl, targetPath, reportPath, log = () => {} }) {
  log('👻 Phase 1 (Necromancy): scanning JavaScript files...');
  const jsFiles = walkJsFiles(scanRoot);

  const files = [];
  let filesSkipped = 0;
  let linesChanged = 0;

  for (const abs of jsFiles) {
    const relRaw = path.relative(scanRoot, abs);
    const rel = relRaw.split(path.sep).join('/'); // POSIX-style
    const original = fs.readFileSync(abs, 'utf8');

    let before;
    try {
      before = countPatterns(original);
    } catch (e) {
      filesSkipped += 1;
      files.push({
        path: rel,
        before: null,
        after: null,
        transforms_applied: [],
        skipped: [{ transform: 'parse', reason: String(e.message || e) }],
      });
      continue;
    }

    // --- Phase 2: Exorcism --------------------------------------------------
    const ex = exorcise(original);
    // --- Phase 3: Transmutation --------------------------------------------
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
    if (changed && countPatternsSafe(transformedSource)) {
      fs.writeFileSync(abs, transformedSource, 'utf8');
      linesChanged += lineDiffCount(original, transformedSource);
    }

    files.push({
      path: rel,
      before,
      after: changed ? after : before,
      transforms_applied: changed ? [...transformsApplied] : [],
      skipped,
    });
  }

  // --- Phase 4: Resurrection (report) --------------------------------------
  log('✨ Phase 4 (Resurrection): writing report...');
  const report = buildReport({
    targetUrl,
    targetPath,
    files,
    linesChanged,
    filesScanned: jsFiles.length,
    filesSkipped,
  });
  writeReport(report, reportPath);

  log(
    `   files_scanned=${report.metrics.files_scanned} ` +
      `files_transformed=${report.metrics.files_transformed} ` +
      `lines_changed=${report.metrics.lines_changed} ` +
      `patterns_removed=${report.metrics.legacy_patterns_removed} ` +
      `status=${report.status}`,
  );

  return { report, reportPath };
}

// Refuse to overwrite: the output dir must be absent or empty.
function assertWritableOutDir(outDir) {
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    const err = new Error(`output directory is not empty: ${outDir} (use --out-dir)`);
    err.exitCode = 2;
    throw err;
  }
}

function countPatternsSafe(source) {
  try {
    countPatterns(source);
    return true;
  } catch {
    return false;
  }
}

// Line-level diff count (insertions + deletions) without requiring git.
// Uses a simple LCS-free symmetric difference of line multisets, which is a
// conservative, deterministic measure of changed lines.
function lineDiffCount(a, b) {
  // Normalize line endings so CRLF vs LF never counts as a change.
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

// --- Target acquisition ------------------------------------------------------

function acquire(target, subpath, cloneDir, log) {
  // Local path target: copy the tree into the working dir (no git needed).
  if (isLocalPath(target)) {
    const src = path.resolve(target);
    if (!fs.existsSync(src)) {
      const err = new Error(`local target not found: ${target}`);
      err.exitCode = 2;
      throw err;
    }
    fs.cpSync(src, cloneDir, { recursive: true });
    return;
  }

  fs.mkdirSync(cloneDir, { recursive: true });

  if (subpath) {
    // Sparse checkout of just the subfolder.
    runGit(['clone', '--depth', '1', '--filter=blob:none', '--sparse', target, cloneDir], log);
    runGit(['-C', cloneDir, 'sparse-checkout', 'set', subpath], log);
  } else {
    runGit(['clone', '--depth', '1', target, cloneDir], log);
  }
}

function isLocalPath(target) {
  if (!target) return false;
  if (/^(https?:\/\/|git@|ssh:\/\/)/i.test(target)) return false;
  // Windows drive path or POSIX path or relative path.
  if (/^[a-zA-Z]:[\\/]/.test(target)) return true;
  if (target.startsWith('/') || target.startsWith('./') || target.startsWith('../')) return true;
  if (target.startsWith('.\\') || target.startsWith('..\\')) return true;
  // Bare existing path.
  return fs.existsSync(target);
}

function runGit(args, log) {
  log(`   git ${args.join(' ')}`);
  const res = spawnSync('git', args, { encoding: 'utf8' });
  if (res.error) {
    const err = new Error(`git not available: ${res.error.message}`);
    err.exitCode = 1;
    throw err;
  }
  if (res.status !== 0) {
    const err = new Error(`git failed (exit ${res.status}): ${res.stderr || ''}`.trim());
    err.exitCode = 1;
    throw err;
  }
  return res.stdout;
}

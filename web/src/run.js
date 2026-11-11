// The resurrection run, in the browser: fetch the files, push every eligible
// .js through the SAME engine the CLI uses (src/engine.js), assemble the report.
//
// No DOM here. `client` and `yieldFn` are injected, so the run is testable in
// Node against a fake file source and compared with the CLI's own output.

import { processFile } from '../../src/engine.js';
import { buildReport } from '../../src/report.js';
import { isEligibleJsPath } from '../../src/files.js';
import { isInSkippedDir } from './assess.js';

export const WEB_SIGNATURE = 'GhostRepo web UI';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw Object.assign(new Error('Run cancelled'), { name: 'AbortError' });
}

const defaultYield = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapPool(items, limit, fn, signal) {
  let next = 0;
  const results = new Array(items.length);
  async function worker() {
    while (next < items.length) {
      throwIfAborted(signal);
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * @param {object} input
 * @param {object} input.client       createGitHubClient()-like: fetchFile()
 * @param {{owner:string,repo:string,sha:string,subfolder:string,canonicalUrl:string}} input.target
 * @param {Array<{path:string,size:number}>} input.entries   the listing the assessment used
 * @param {(e:{phase:string,state:string,done?:number,total?:number,note?:string})=>void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @param {()=>Promise<void>} [input.yieldFn]
 * @param {number} [input.concurrency]
 */
export async function runResurrection({
  client,
  target,
  entries,
  onProgress = () => {},
  signal,
  yieldFn = defaultYield,
  concurrency = 6,
}) {
  const fetchable = entries.filter((e) => !isInSkippedDir(e.path)).map((e) => e.path).sort();

  // --- Phase 1: Necromancy (acquire) -------------------------------------------
  onProgress({ phase: 'necromancy', state: 'running', done: 0, total: fetchable.length });
  const files = new Map();
  let fetched = 0;
  await mapPool(
    fetchable,
    concurrency,
    async (path) => {
      const bytes = await client.fetchFile({ ...target, path }, { signal });
      files.set(path, bytes);
      fetched += 1;
      onProgress({ phase: 'necromancy', state: 'running', done: fetched, total: fetchable.length });
    },
    signal,
  );
  onProgress({ phase: 'necromancy', state: 'done', done: fetchable.length, total: fetchable.length });

  // --- Phases 2 and 3: Exorcism and Transmutation (one engine pass per file) -----
  const eligible = fetchable.filter(isEligibleJsPath); // already sorted, like the CLI walker
  onProgress({ phase: 'exorcism', state: 'running', done: 0, total: eligible.length });
  onProgress({ phase: 'transmutation', state: 'running', done: 0, total: eligible.length });

  const entriesOut = [];
  const outputs = new Map(); // path -> transformed source, only for files that change
  const sources = new Map(); // path -> original text, for the diff view
  let filesSkipped = 0;
  let linesChanged = 0;

  for (let i = 0; i < eligible.length; i++) {
    throwIfAborted(signal);
    const path = eligible[i];

    let original;
    try {
      original = decoder.decode(files.get(path));
    } catch {
      // Not valid UTF-8: decoding would corrupt the file on write-back. Leave it alone.
      filesSkipped += 1;
      entriesOut.push({
        path,
        before: null,
        after: null,
        transforms_applied: [],
        skipped: [{ transform: 'parse', reason: 'File is not valid UTF-8; left unchanged' }],
      });
      continue;
    }

    sources.set(path, original);
    const result = processFile(path, original);
    if (result.parseFailed) filesSkipped += 1;
    if (result.output !== null) {
      outputs.set(path, result.output);
      linesChanged += result.linesChanged;
    }
    entriesOut.push(result.entry);

    const note = { done: i + 1, total: eligible.length };
    onProgress({ phase: 'exorcism', state: 'running', ...note });
    onProgress({ phase: 'transmutation', state: 'running', ...note });
    await yieldFn();
  }
  onProgress({ phase: 'exorcism', state: 'done', done: eligible.length, total: eligible.length });
  onProgress({ phase: 'transmutation', state: 'done', done: eligible.length, total: eligible.length });

  // --- Phase 4: Resurrection (report) --------------------------------------------
  onProgress({ phase: 'resurrection', state: 'running' });
  const report = buildReport({
    targetUrl: target.canonicalUrl,
    targetPath: target.subfolder || null,
    files: entriesOut,
    linesChanged,
    filesScanned: eligible.length,
    filesSkipped,
    agentSignature: WEB_SIGNATURE,
  });
  onProgress({ phase: 'resurrection', state: 'done' });

  return { report, files, sources, outputs };
}

/** Final bytes of every fetched file: transformed where the engine changed it. */
export function resurrectedFiles(result) {
  const out = new Map();
  for (const [path, bytes] of result.files) {
    out.set(path, result.outputs.has(path) ? encoder.encode(result.outputs.get(path)) : bytes);
  }
  return out;
}

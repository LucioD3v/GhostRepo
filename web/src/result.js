// Helpers over a finished run's result. Kept apart from run.js so the page bundle
// does not pull in the engine, which only the worker needs.

const encoder = new TextEncoder();

/** Final bytes of every fetched file: transformed where the engine changed it. */
export function resurrectedFiles(result) {
  const out = new Map();
  for (const [path, bytes] of result.files) {
    out.set(path, result.outputs.has(path) ? encoder.encode(result.outputs.get(path)) : bytes);
  }
  return out;
}

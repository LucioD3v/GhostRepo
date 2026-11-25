// Page side of the resurrection worker (worker.js): same contract as
// runResurrection(), but the engine runs in a Web Worker. Cancelling terminates
// the worker, which stops even an engine call that is in the middle of a file.

import { GitHubError } from './github.js';

export const WORKER_URL = './worker.js';

function abortError() {
  return Object.assign(new Error('Run cancelled'), { name: 'AbortError' });
}

/** Rebuild the error the worker sent, so describeError() still recognizes it. */
export function reviveError(data) {
  if (data && data.name === 'GitHubError') {
    const { code, message, name, ...extra } = data;
    return new GitHubError(code, message, extra);
  }
  if (data && data.name === 'AbortError') return abortError();
  return new Error(data && data.message ? data.message : 'The resurrection failed.');
}

/**
 * @param {object} input
 * @param {object} input.target
 * @param {Array<{path:string,size:number}>} input.entries
 * @param {(e:object)=>void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @param {(url:string)=>Worker} [input.createWorker]  injectable for tests
 */
export function runInWorker({ target, entries, onProgress = () => {}, signal, createWorker = (url) => new Worker(url) }) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(abortError());
      return;
    }
    const worker = createWorker(WORKER_URL);
    const finish = () => {
      worker.terminate();
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data.event);
      else if (data.type === 'done') {
        finish();
        resolve(data.result);
      } else if (data.type === 'error') {
        finish();
        reject(reviveError(data.error));
      }
    };
    worker.onerror = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      finish();
      reject(new Error(e && e.message ? e.message : 'The resurrection worker failed to start.'));
    };
    worker.postMessage({ type: 'run', target, entries });
  });
}

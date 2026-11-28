// The resurrection run, off the page's main thread.
//
// One engine call on a large unminified file (jQuery 1.12.4, 11,000 lines) takes
// about a minute. Here it blocks only this worker, so the page keeps repainting
// the progress and the user can start another run, which terminates this worker.
//
// Protocol (see run-worker.js):
//   in:  { type: 'run', target, entries, lang }
//   out: { type: 'progress', event } ... then { type: 'done', result } | { type: 'error', error }

import { createGitHubClient } from './github.js';
import { runResurrection } from './run.js';
import { setLang } from './lang.js';

self.onmessage = async (msg) => {
  if (!msg.data || msg.data.type !== 'run') return;
  const { target, entries, lang } = msg.data;
  setLang(lang);
  try {
    const result = await runResurrection({
      client: createGitHubClient(),
      target,
      entries,
      onProgress: (event) => self.postMessage({ type: 'progress', event }),
    });
    // Maps of strings and Uint8Arrays survive structured cloning.
    self.postMessage({ type: 'done', result });
  } catch (e) {
    // Error subclasses lose their class across postMessage: send the fields.
    self.postMessage({
      type: 'error',
      error: { ...e, name: e && e.name, code: e && e.code, message: e && e.message ? e.message : String(e) },
    });
  }
};

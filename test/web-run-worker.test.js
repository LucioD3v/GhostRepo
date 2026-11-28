// The page side of the resurrection worker (web/src/run-worker.js), against a
// fake Worker. The real worker runs in the browser e2e (npm run e2e:web).

import test from 'node:test';
import assert from 'node:assert/strict';

import { runInWorker, reviveError, WORKER_URL } from '../web/src/run-worker.js';
import { GitHubError } from '../web/src/github.js';

function fakeWorker(script) {
  const w = {
    url: null,
    terminated: false,
    posted: [],
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      this.posted.push(msg);
      queueMicrotask(() => script(w, msg));
    },
    terminate() {
      this.terminated = true;
    },
    send(data) {
      if (!this.terminated && this.onmessage) this.onmessage({ data });
    },
  };
  return w;
}

const input = { target: { owner: 'o', repo: 'r' }, entries: [{ path: 'a.js', size: 1 }] };

test('progress is forwarded, the result resolves and the worker is terminated', async () => {
  let worker;
  const events = [];
  const result = await runInWorker({
    ...input,
    onProgress: (e) => events.push(e),
    createWorker: (url) => {
      worker = fakeWorker((w) => {
        w.send({ type: 'progress', event: { phase: 'necromancy', state: 'running' } });
        w.send({ type: 'done', result: { report: { status: 'RESURRECTED' } } });
      });
      worker.url = url;
      return worker;
    },
  });
  assert.equal(worker.url, WORKER_URL);
  // The worker gets the page's language, so the errors it reports match the page.
  assert.deepEqual(worker.posted, [{ type: 'run', ...input, lang: 'en' }]);
  assert.deepEqual(events, [{ phase: 'necromancy', state: 'running' }]);
  assert.equal(result.report.status, 'RESURRECTED');
  assert.ok(worker.terminated);
});

test('cancelling terminates the worker, even in the middle of an engine call', async () => {
  let worker;
  const controller = new AbortController();
  const run = runInWorker({
    ...input,
    signal: controller.signal,
    createWorker: () => (worker = fakeWorker(() => {})), // never answers: a long engine call
  });
  controller.abort();
  await assert.rejects(run, (e) => e.name === 'AbortError');
  assert.ok(worker.terminated);
});

test('an already aborted signal never starts a worker', async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  await assert.rejects(
    runInWorker({ ...input, signal: controller.signal, createWorker: () => ((started = true), fakeWorker(() => {})) }),
    (e) => e.name === 'AbortError',
  );
  assert.equal(started, false);
});

test('a GitHub error from the worker comes back as a GitHubError', async () => {
  const sent = { ...new GitHubError('file-failed', 'a.js could not be downloaded', { path: 'a.js' }), name: 'GitHubError', message: 'a.js could not be downloaded' };
  const err = await runInWorker({
    ...input,
    createWorker: () => fakeWorker((w) => w.send({ type: 'error', error: sent })),
  }).catch((e) => e);
  assert.ok(err instanceof GitHubError);
  assert.equal(err.code, 'file-failed');
  assert.equal(err.message, 'a.js could not be downloaded');
  assert.equal(err.path, 'a.js');
});

test('other errors keep their message', () => {
  const e = reviveError({ name: 'TypeError', message: 'boom' });
  assert.ok(!(e instanceof GitHubError));
  assert.equal(e.message, 'boom');
});

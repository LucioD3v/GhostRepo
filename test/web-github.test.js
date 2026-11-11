import test from 'node:test';
import assert from 'node:assert/strict';

import { createGitHubClient, GitHubError } from '../web/src/github.js';

// A scripted fetch: maps URL substrings to responses and records the calls.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    for (const [match, response] of routes) {
      if (url.includes(match)) {
        const r = typeof response === 'function' ? response(url) : response;
        if (r instanceof Error) throw r;
        const headers = new Map(Object.entries(r.headers || {}));
        return {
          status: r.status ?? 200,
          ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
          headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
          json: async () => r.json,
          arrayBuffer: async () => (r.bytes || new Uint8Array(0)).buffer.slice(0),
        };
      }
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { impl, calls };
}

const commitJson = { sha: 'abc123', commit: { message: 'first line\nsecond', committer: { date: '2016-09-20T18:48:56Z' } } };

test('resolveCommit returns sha, date and first line of the message', async () => {
  const f = fakeFetch([['/commits/HEAD', { json: commitJson }]]);
  const c = await createGitHubClient({ fetch: f.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: null });
  assert.deepEqual(c, { sha: 'abc123', date: '2016-09-20T18:48:56Z', message: 'first line' });
});

test('resolveCommit uses the given ref, URL-encoded', async () => {
  const f = fakeFetch([['/commits/', { json: commitJson }]]);
  await createGitHubClient({ fetch: f.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: 'feat/x y' });
  assert.ok(f.calls[0].url.endsWith('/repos/o/r/commits/feat%2Fx%20y'));
});

test('a missing repository is reported as not found or private (indistinguishable anonymously)', async () => {
  const f = fakeFetch([['/commits/HEAD', { status: 404 }]]);
  await assert.rejects(
    createGitHubClient({ fetch: f.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: null }),
    (e) => e instanceof GitHubError && e.code === 'not-found-or-private' && /private/.test(e.message),
  );
});

test('a missing ref on an existing repository is a different message', async () => {
  const f = fakeFetch([
    ['/commits/nope', { status: 404 }],
    ['/repos/o/r', { json: { name: 'r' } }],
  ]);
  await assert.rejects(
    createGitHubClient({ fetch: f.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: 'nope' }),
    (e) => e.code === 'ref-not-found' && /"nope"/.test(e.message),
  );
});

test('a missing ref on a missing repository is still not found or private', async () => {
  const f = fakeFetch([
    ['/commits/nope', { status: 404 }],
    ['/repos/o/r', { status: 404 }],
  ]);
  await assert.rejects(
    createGitHubClient({ fetch: f.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: 'nope' }),
    (e) => e.code === 'not-found-or-private',
  );
});

test('an empty repository has its own message', async () => {
  const f = fakeFetch([['/commits/HEAD', { status: 409 }]]);
  await assert.rejects(
    createGitHubClient({ fetch: f.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: null }),
    (e) => e.code === 'empty-repo',
  );
});

test('the anonymous rate limit is reported with the reset time', async () => {
  const f = fakeFetch([
    ['/commits/HEAD', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } }],
  ]);
  await assert.rejects(
    createGitHubClient({ fetch: f.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: null }),
    (e) => e.code === 'rate-limited' && /limit for anonymous requests/.test(e.message) && /Try again after/.test(e.message),
  );
});

test('a 403 that is not the rate limit is not reported as one', async () => {
  const f = fakeFetch([['/commits/HEAD', { status: 403, headers: { 'x-ratelimit-remaining': '12' } }]]);
  await assert.rejects(
    createGitHubClient({ fetch: f.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: null }),
    (e) => e.code === 'http',
  );
});

test('a network failure is reported as such, and an abort is passed through', async () => {
  const down = fakeFetch([['/commits/HEAD', new TypeError('Failed to fetch')]]);
  await assert.rejects(
    createGitHubClient({ fetch: down.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: null }),
    (e) => e.code === 'network',
  );
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const aborted = fakeFetch([['/commits/HEAD', abort]]);
  await assert.rejects(
    createGitHubClient({ fetch: aborted.impl }).resolveCommit({ owner: 'o', repo: 'r', ref: null }),
    (e) => e.name === 'AbortError',
  );
});

test('listFiles keeps only real files and reports truncation', async () => {
  const f = fakeFetch([
    [
      '/git/trees/abc123?recursive=1',
      {
        json: {
          truncated: true,
          tree: [
            { path: 'a.js', type: 'blob', mode: '100644', size: 10 },
            { path: 'lib', type: 'tree', mode: '040000' },
            { path: 'link.js', type: 'blob', mode: '120000', size: 5 },
            { path: 'sub', type: 'commit', mode: '160000' },
            { path: 'lib/b.js', type: 'blob', mode: '100755', size: 20 },
          ],
        },
      },
    ],
  ]);
  const r = await createGitHubClient({ fetch: f.impl }).listFiles({ owner: 'o', repo: 'r', sha: 'abc123', subfolder: '' });
  assert.deepEqual(r.entries, [
    { path: 'a.js', size: 10 },
    { path: 'lib/b.js', size: 20 },
  ]);
  assert.equal(r.truncated, true);
});

test('listFiles asks for a subfolder with the sha:path form, encoding each segment', async () => {
  const f = fakeFetch([['/git/trees/', { json: { tree: [], truncated: false } }]]);
  await createGitHubClient({ fetch: f.impl }).listFiles({ owner: 'o', repo: 'r', sha: 'abc123', subfolder: 'apps/my app' });
  assert.ok(f.calls[0].url.endsWith('/git/trees/abc123:apps/my%20app?recursive=1'), f.calls[0].url);
});

test('a missing subfolder is path-not-found and names the folder', async () => {
  const f = fakeFetch([['/git/trees/', { status: 404 }]]);
  await assert.rejects(
    createGitHubClient({ fetch: f.impl }).listFiles({ owner: 'o', repo: 'r', sha: 'abc123', subfolder: 'nope' }),
    (e) => e.code === 'path-not-found' && /"nope"/.test(e.message),
  );
});

test('fetchFile downloads from the raw host at the pinned sha, with subfolder and encoding', async () => {
  const bytes = new TextEncoder().encode('const a = 1;');
  const f = fakeFetch([['raw.githubusercontent.com', { bytes }]]);
  const out = await createGitHubClient({ fetch: f.impl }).fetchFile({
    owner: 'o',
    repo: 'r',
    sha: 'abc123',
    subfolder: 'legacy',
    path: 'js/my file.js',
  });
  assert.equal(new TextDecoder().decode(out), 'const a = 1;');
  assert.equal(f.calls[0].url, 'https://raw.githubusercontent.com/o/r/abc123/legacy/js/my%20file.js');
});

test('fetchFile reports which file failed', async () => {
  const f = fakeFetch([['raw.githubusercontent.com', { status: 404 }]]);
  await assert.rejects(
    createGitHubClient({ fetch: f.impl }).fetchFile({ owner: 'o', repo: 'r', sha: 'abc123', subfolder: '', path: 'x.js' }),
    (e) => e.code === 'file-failed' && e.path === 'x.js',
  );
});

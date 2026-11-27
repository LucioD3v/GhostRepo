// web/src/pr-link.js: the prefilled GitHub compare link (.kiro/specs/open-pull-request).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompareLink, isValidGitHubUsername, MAX_LINK_LENGTH } from '../web/src/pr-link.js';

const base = {
  owner: 'LucioD3v',
  repo: 'ghostrepo-gaia-calculator',
  base: 'main',
  user: 'octo-cat',
  branch: 'ghostrepo/resurrect-js-20261127',
  title: 'Resurrect legacy JavaScript: 29 patterns removed',
  body: '## Summary\n\nLine one & two?\n\n- `js/calculator.js`',
};

test('usernames: GitHub rules', () => {
  for (const ok of ['a', 'octo-cat', 'A1', 'x'.repeat(39), 'a-b-c']) assert.ok(isValidGitHubUsername(ok), ok);
  for (const bad of ['', '-a', 'a-', 'a--b', 'x'.repeat(40), 'a_b', 'a.b', 'a b', 'a/b', 'a:b', 'é', null, undefined, 7]) {
    assert.equal(isValidGitHubUsername(bad), false, String(bad));
  }
});

test('the link opens the compare page from the fork branch to the default branch, prefilled', () => {
  const { url, shortened } = buildCompareLink(base);
  assert.equal(shortened, false);
  const u = new URL(url);
  assert.equal(u.origin, 'https://github.com');
  assert.equal(u.pathname, '/LucioD3v/ghostrepo-gaia-calculator/compare/main...octo-cat:ghostrepo/resurrect-js-20261127');
  assert.equal(u.searchParams.get('quick_pull'), '1');
  assert.equal(u.searchParams.get('title'), base.title);
  assert.equal(u.searchParams.get('body'), base.body);
});

test('branch names keep "/" and escape everything else', () => {
  const { url } = buildCompareLink({ ...base, base: 'release/1.x?a=b#c&d', branch: 'x/y z' });
  const path = new URL(url).pathname;
  assert.equal(path, '/LucioD3v/ghostrepo-gaia-calculator/compare/release/1.x%3Fa%3Db%23c%26d...octo-cat:x/y%20z');
  assert.equal(new URL(url).searchParams.get('title'), base.title, 'a hostile base branch cannot inject query parameters');
});

test('no link without a valid username or a default branch', () => {
  assert.equal(buildCompareLink({ ...base, user: 'bad user' }), null);
  assert.equal(buildCompareLink({ ...base, user: '' }), null);
  assert.equal(buildCompareLink({ ...base, base: null }), null);
  assert.equal(buildCompareLink({ ...base, base: '' }), null);
});

test('a long description is shortened at a line boundary, with a note, under the cap', () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `- \`file-${i}.js\`: line ${i}`);
  const body = lines.join('\n');
  const { url, shortened } = buildCompareLink({ ...base, body });
  assert.equal(shortened, true);
  assert.ok(url.length <= MAX_LINK_LENGTH, String(url.length));
  const got = new URL(url).searchParams.get('body');
  assert.match(got, /shortened to fit in a link/);
  const kept = got.split('\n\n_The description')[0].split('\n');
  assert.ok(kept.length > 10, 'keeps a useful part of the description');
  assert.deepEqual(kept, lines.slice(0, kept.length), 'only whole lines, from the start');
  // The longest prefix: one more line would not fit under the cap.
  const withOneMore = new URL(url);
  withOneMore.searchParams.set('body', `${lines.slice(0, kept.length + 1).join('\n')}\n\n${got.split('\n\n').pop()}`);
  assert.ok(withOneMore.href.length > MAX_LINK_LENGTH, String(withOneMore.href.length));
});

test('a short description is never shortened', () => {
  assert.equal(buildCompareLink({ ...base, maxLength: 100000 }).shortened, false);
});

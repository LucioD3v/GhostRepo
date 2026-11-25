import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRepoInput, validateSubfolder } from '../web/src/github-url.js';

const ok = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
};
const bad = (r, code) => {
  assert.equal(r.ok, false, `expected a rejection, got ${JSON.stringify(r)}`);
  assert.equal(r.error.code, code);
  assert.ok(r.error.message.length > 10, 'message explains what is wrong');
};

test('accepts a plain repository URL and normalizes it', () => {
  const r = ok(parseRepoInput('https://github.com/LucioD3v/ghostrepo-gaia-calculator'));
  assert.equal(r.owner, 'LucioD3v');
  assert.equal(r.repo, 'ghostrepo-gaia-calculator');
  assert.equal(r.ref, null);
  assert.equal(r.subfolder, '');
  assert.equal(r.canonicalUrl, 'https://github.com/LucioD3v/ghostrepo-gaia-calculator');
});

test('accepts .git suffix, trailing slash, www host and surrounding spaces', () => {
  assert.equal(ok(parseRepoInput('  https://github.com/o/r.git  ')).repo, 'r');
  assert.equal(ok(parseRepoInput('https://github.com/o/r/')).repo, 'r');
  assert.equal(ok(parseRepoInput('https://www.github.com/o/r')).owner, 'o');
});

test('derives ref and subfolder from a /tree/ link', () => {
  const r = ok(parseRepoInput('https://github.com/o/r/tree/main/legacy/js'));
  assert.equal(r.ref, 'main');
  assert.equal(r.subfolder, 'legacy/js');
  assert.equal(ok(parseRepoInput('https://github.com/o/r/tree/dev')).subfolder, '');
});

test('the subfolder field wins over the folder in the link', () => {
  const r = ok(parseRepoInput('https://github.com/o/r/tree/main/a', 'b/c'));
  assert.equal(r.subfolder, 'b/c');
});

test('rejects empty input, non-URLs, other schemes and other hosts', () => {
  bad(parseRepoInput(''), 'empty');
  bad(parseRepoInput('   '), 'empty');
  bad(parseRepoInput('not a url'), 'not-a-url');
  bad(parseRepoInput('github.com/o/r'), 'not-a-url');
  bad(parseRepoInput('http://github.com/o/r'), 'not-https');
  bad(parseRepoInput('git@github.com:o/r.git'), 'not-a-url');
  bad(parseRepoInput('ssh://git@github.com/o/r'), 'not-https');
  bad(parseRepoInput('https://gitlab.com/o/r'), 'not-github');
  bad(parseRepoInput('https://github.com.evil.com/o/r'), 'not-github');
  bad(parseRepoInput('https://user:pw@github.com/o/r'), 'not-github');
  bad(parseRepoInput('--upload-pack=echo'), 'not-a-url');
});

test('rejects links that are not a repository', () => {
  bad(parseRepoInput('https://github.com/'), 'no-repo');
  bad(parseRepoInput('https://github.com/o'), 'no-repo');
  bad(parseRepoInput('https://github.com/o/r/blob/main/a.js'), 'unsupported-link');
  bad(parseRepoInput('https://github.com/o/r/issues/1'), 'unsupported-link');
  bad(parseRepoInput('https://github.com/o/r/tree'), 'unsupported-link');
  bad(parseRepoInput('https://github.com/o/..'), 'no-repo');
});

test('rejects dangerous subfolders (same rules as the CLI --path)', () => {
  bad(parseRepoInput('https://github.com/o/r', '../x'), 'bad-subfolder');
  bad(parseRepoInput('https://github.com/o/r', 'a/../b'), 'bad-subfolder');
  bad(parseRepoInput('https://github.com/o/r', '/etc'), 'bad-subfolder');
  bad(parseRepoInput('https://github.com/o/r', 'C:\\x'), 'bad-subfolder');
  bad(parseRepoInput('https://github.com/o/r', 'a\\b'), 'bad-subfolder');
  bad(parseRepoInput('https://github.com/o/r', '-rf'), 'bad-subfolder');
  bad(parseRepoInput('https://github.com/o/r/tree/-x/a'), 'bad-ref');
});

test('an encoded ".." in a link is collapsed by the URL parser and never reaches the subfolder', () => {
  // `new URL` resolves %2E%2E as a dot segment, so this link is really /o/r/tree/x.
  const r = ok(parseRepoInput('https://github.com/o/r/tree/main/%2E%2E/x'));
  assert.equal(r.ref, 'x');
  assert.equal(r.subfolder, '');
  assert.ok(!r.subfolder.split('/').includes('..'));
});

test('validateSubfolder normalizes slashes and allows empty', () => {
  assert.deepEqual(validateSubfolder(''), { ok: true, value: '' });
  assert.deepEqual(validateSubfolder(undefined), { ok: true, value: '' });
  assert.deepEqual(validateSubfolder(' apps//calculator/ '), { ok: true, value: 'apps/calculator' });
});

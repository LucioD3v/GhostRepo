// CLI argument validation (docs/RESURRECT-CLI.md §6 and §8).
//
// Every case is rejected before `run()` starts, so no git and no network are
// involved. The "Phase 1" check proves the pipeline never started.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'resurrect');
const FIXTURES = path.join(ROOT, 'fixtures');

function resurrect(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('--help prints usage and exits 0', () => {
  const res = resurrect('--help');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage:/);
});

const INVALID = [
  ['a target that starts with "-"', ['--', '--upload-pack=x'], /<repo-url> must not start with "-"/],
  ['a --path that starts with "-"', [FIXTURES, '--path=--foo'], /--path must not start with "-"/],
  ['a --path with ".." segments', [FIXTURES, '--path', '../outside'], /must not contain "\.\." segments/],
  ['an absolute --path', [FIXTURES, '--path', '/abs'], /--path must be relative/],
  ['a target that is neither a git URL nor a path', ['no-such-target'], /not a git URL or an existing path/],
];

for (const [label, args, message] of INVALID) {
  test(`rejects ${label} with exit 2 before the pipeline starts`, () => {
    const res = resurrect(...args);
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, message);
    assert.doesNotMatch(res.stderr, /Phase 1/);
  });
}

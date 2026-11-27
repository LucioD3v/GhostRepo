// scripts/guard-legacy.js: the Kiro Pre Tool Use hook that keeps agents away
// from recovered legacy code and test fixtures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, pathsIn, protectedReason } from '../scripts/guard-legacy.js';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'guard-legacy.js');
const run = (input) => spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
const ctx = (tool_input) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'fsWrite', tool_input });

test('protectedReason: legacy/ at any depth and fixtures/ are protected', () => {
  assert.ok(protectedReason('legacy/js/calculator.js'));
  assert.ok(protectedReason('targets/gaia/legacy/index.html'));
  assert.ok(protectedReason('C:\\Solutions\\GhostRepo\\fixtures\\legacy-sample.js'));
  assert.ok(protectedReason('./fixtures/legacy-sample.js'));
});

test('protectedReason: names that only contain the words are not protected', () => {
  assert.equal(protectedReason('src/legacy-utils.js'), null);
  assert.equal(protectedReason('test/fixtures-helper.js'), null);
  assert.equal(protectedReason('src/engine.js'), null);
});

test('pathsIn: finds path-like keys at any depth, ignores content', () => {
  assert.deepEqual(pathsIn({ path: 'a.js', text: 'legacy/x' }), ['a.js']);
  assert.deepEqual(pathsIn({ edits: [{ filePath: 'b.js' }, { target_file: 'c.js' }] }), ['b.js', 'c.js']);
  assert.deepEqual(pathsIn(null), []);
});

test('check: blocks a write to a fixture, allows a write to src/', () => {
  assert.equal(check(ctx({ path: 'fixtures/legacy-sample.js', text: 'x' })).block, true);
  assert.equal(check(ctx({ path: 'src/files.js', text: '// legacy/' })).block, false);
});

test('check: invalid or empty input is allowed', () => {
  assert.equal(check('not json').block, false);
  assert.equal(check('').block, false);
  assert.equal(check('{}').block, false);
});

test('CLI: exit 2 with a reason on stderr when blocked, exit 0 otherwise', () => {
  const blocked = run(ctx({ path: 'legacy/js/parser.js' }));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /legacy\/ folder/);

  assert.equal(run(ctx({ path: 'web/src/views.js' })).status, 0);
  assert.equal(run('garbage').status, 0);
});

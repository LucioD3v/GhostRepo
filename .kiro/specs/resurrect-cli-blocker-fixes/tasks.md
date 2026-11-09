# Implementation Plan

## Overview

This plan fixes the two blocking defects found in PR `feat/resurrect-cli` (HEAD `d148dc4`) using the exploratory bugfix methodology: write failing exploration tests first to confirm the bugs, capture a preservation baseline, apply the surgical fixes, then verify. Scope is strictly these two blockers plus regression tests — Blocker 1 (TDZ on `var`→`const`/`let` in `src/transmute.js`) and Blocker 2 (git option injection in `src/pipeline.js` and `resurrect`). All work ships as atomic commits on `feat/resurrect-cli` (no new PR). Node >=20, ESM, `node:test`, dependencies pinned.

## Task Dependency Graph

```
Task 1 (Blocker 1 exploration test — expected to FAIL on unfixed code)
Task 2 (Preservation baseline — expected to PASS on unfixed code)
        │  (1 and 2 are independent; both run on UNFIXED code before any fix)
        ▼
Task 3.1 (Fix Blocker 1 in src/transmute.js) ── depends on 1, 2
Task 3.2 (Fix Blocker 2 in src/pipeline.js + resurrect) ── depends on 2
        ▼
Task 3.3 (Verify Blocker 1 exploration now passes) ── depends on 3.1
Task 3.4 (Verify Blocker 2 manual check) ── depends on 3.2
Task 3.5 (Verify preservation still passes) ── depends on 3.1, 3.2
        ▼
Task 4 (Checkpoint — all tests green) ── depends on 3.3, 3.4, 3.5
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3.1", "3.2"] },
    { "wave": 3, "tasks": ["3.3", "3.4", "3.5"] },
    { "wave": 4, "tasks": ["4"] }
  ]
}
```

## Tasks

- [ ] 1. Write bug condition exploration test for Blocker 1 (TDZ)
  - **Property 1: Bug Condition** - TDZ on `var`→`const`/`let`
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the TDZ bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples where the original code returns a value but the transformed code throws `ReferenceError: Cannot access 'x' before initialization`
  - **Scoped PBT Approach**: These are deterministic snippets; add them as concrete entries to the existing `hazards` table in `test/zero-breaking-logic.test.js`, which runs original vs. transformed in a fresh VM via `assertSameBehavior` and compares observable results (including thrown exceptions)
  - Add the four buggy snippets (each as `'name': [src, [[]]]`) to the `hazards` table:
    - `'namespace default idiom in IIFE': ['function f() { var ns = ns || { v: 1 }; return ns.v; }', [[]]]` (original returns `1`) — Bug Condition: `referenceWithinInitializer` via `ref.node.start < decl.end`
    - `'forward reference within one declaration': ['function f() { var a = b, b = 1; return String(a); }', [[]]]` (original returns `"undefined"`) — Bug Condition: forward reference in same declaration, `ref.node.start < decl.end`
    - `'self-reference from initializer IIFE': ['function f() { var App = (function () { return typeof App; })(); return App; }', [[]]]` (original returns `"undefined"`) — Bug Condition: nested-initializer self-reference, `ref.node.start < decl.end`
    - `'hoisted function reads var before init': ['function f() { var r = g(); var x = 1; function g() { return x; } return String(r); }', [[]]]` (original returns `"undefined"`) — Bug Condition: `hoistedFunctionReadsBeforeInit`
  - The test assertions match the Expected Behavior: transformed output must be behavior-identical to the original (no `ReferenceError`)
  - Run test on UNFIXED code (`npm test`)
  - **EXPECTED OUTCOME**: The four new cases FAIL (this is correct - it proves the bug exists: transformed throws `ReferenceError` while original returns a value)
  - Document counterexamples found (e.g. "`var ns = ns || { v: 1 }` → original returns `1`, transformed throws `ReferenceError: Cannot access 'ns' before initialization`") to understand the root cause
  - Mark task complete when the four cases are written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-buggy transforms and inputs are unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on the UNFIXED code first, then assert it is preserved
  - These are cases where `isBugCondition` returns false and must be completely unaffected by the fix
  - Observe: the full pipeline against `ghostrepo-gaia-calculator/legacy` removes 28 `var` + 1 `innerHTML` = 29 legacy patterns (this exercises `parser.js` `_tokenizeNumber`, where `var number` / `var me` are read by `tokenizeNumberInternal` only *after* initialization — a read-after-init that must CONTINUE to rewrite)
  - Observe: the existing `node:test` suite passes 25/25 on unfixed code (every existing `hazards`-table entry, the loose-equality `==`/`!=`→`===`/`!==` transform, and the `innerHTML`→`textContent` transform)
  - Observe: a valid git URL (matching `GIT_URL`), an existing local path, and a valid relative `--path` are accepted and run the pipeline normally
  - Capture these observed behaviors as the preservation baseline using the existing `hazards`-table harness (property-style: original vs. transformed across inputs in a fresh VM) plus the Gaia calculator integration run — no new PBT framework is introduced (minimal scope, pinned dependencies)
  - Run tests/baseline on UNFIXED code (`npm test` and the Gaia calculator run)
  - **EXPECTED OUTCOME**: All baseline observations PASS on unfixed code (25/25 green, 29 patterns removed) — this confirms the behavior to preserve
  - Mark task complete when the baseline is observed, recorded, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix for TDZ on `var`→`const`/`let` and git option injection

  - [ ] 3.1 Fix Blocker 1 — add TDZ guards in `src/transmute.js`
    - Add two module-level helpers alongside the existing helpers (e.g. next to `isInNestedFunction`):
      - `isInNestedFunctionDeclaration(refPath, scopePath)` — walk `refPath.parent` up to (but not including) `scopePath`, return true if any ancestor is a `FunctionDeclaration`
      - `hoistedFunctionUsedBefore(scopePath, pos)` — collect the ids of functions declared directly in `scopePath` (via `enclosingFunction(p) === scopePath`), return true when any such function name is referenced (not the declaration id itself) at `r.node.start < pos`
    - Inside the per-reference loop `for (const ref of referencesWithin(name, scopePath))`, AFTER the existing `used-before-declaration` and `used-outside-block` guards (both kept in place, in current order), add two new guards:
      - `if (ref.node.start < decl.end) return 'used-in-initializer';` (covers the namespace-default idiom, same-declaration forward reference, and initializer-IIFE self-reference)
      - `if (isInNestedFunctionDeclaration(ref, scopePath) && hoistedFunctionUsedBefore(scopePath, d.end)) return 'hoisted-function-capture';`
    - Keep the new reasons flowing through the existing `skipped.push({ transform: 'var_to_const_let', reason, line })` path (no schema change); the two new reasons are `used-in-initializer` and `hoisted-function-capture`
    - Keep the hoisted-function guard NARROW: it must only skip when a hoisted function is actually referenced before the binding's initializer ends (`d.end`), so `parser.js` `_tokenizeNumber` is NOT over-skipped
    - _Bug_Condition: isBugCondition(X) = eligibleByCurrentGuards(X) AND (referenceWithinInitializer(X) OR hoistedFunctionReadsBeforeInit(X))_
    - _Expected_Behavior: skip the rewrite with reason IN { 'used-in-initializer', 'hoisted-function-capture' } so behaviorOf(transformed) = behaviorOf(original)_
    - _Preservation: read-after-init var rewrites (parser.js _tokenizeNumber) and all existing skip reasons and transforms unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1_

  - [ ] 3.2 Fix Blocker 2 — validate flag-looking targets/paths and add `--` separator
    - In `src/pipeline.js` `acquire()`, insert `'--'` immediately before `target` in both `git clone` invocations:
      - sparse branch: `runGit(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--', target, cloneDir], log)`
      - plain branch: `runGit(['clone', '--depth', '1', '--', target, cloneDir], log)`
    - In `resurrect`, add the import `import fs from 'node:fs';` at the top (currently absent)
    - In `resurrect`, rewrite `validateTarget(t)` to validate before the pipeline (and therefore before any git invocation): fail with exit code 2 if empty/blank; fail with exit code 2 and message `<repo-url> must not start with "-"` if it begins with `-`; return `t` if `GIT_URL.test(t) || fs.existsSync(t)`; otherwise fail with exit code 2 and a `not a git URL or an existing path: ${t}` message
    - In `resurrect`, in `validatePath(p)`, after the existing null/empty check, add `if (p.startsWith('-')) fail('--path must not start with "-"', 2);` (because `--path` flows into `git sparse-checkout set`); keep all other `validatePath` checks (absolute path, drive letter, `..` segments) unchanged
    - _Bug_Condition: isBugCondition(X) = startsWith(X, '-') AND NOT rejectedBeforeGit(X)_
    - _Expected_Behavior: exitCode = 2 AND git_was_NOT_invoked AND message CONTAINS 'must not start with "-"'; acquire() passes '--' before target in both clone calls_
    - _Preservation: valid git URLs / existing paths and `--path` not beginning with `-` still run the pipeline normally_
    - _Requirements: 2.5, 2.6, 3.6_

  - [ ] 3.3 Verify bug condition exploration test now passes (Blocker 1)
    - **Property 1: Expected Behavior** - TDZ on `var`→`const`/`let`
    - **IMPORTANT**: Re-run the SAME four `hazards` cases from task 1 - do NOT write new tests
    - The cases from task 1 encode the expected behavior; when they pass, the expected behavior is satisfied
    - Run the full suite (`npm test`)
    - **EXPECTED OUTCOME**: The four snippets now PASS — each is skipped (transformed source is behavior-identical to the original) and none throws `ReferenceError`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.4 Verify Blocker 2 fix via documented manual check
    - **Property 3: Expected Behavior** - Flag-looking targets and paths never reach git
    - Run `node resurrect -- "--upload-pack=echo"` → **EXPECTED OUTCOME**: exit code 2, stderr contains `<repo-url> must not start with "-"`, and git is NOT invoked (no `git clone ...` line)
    - Run `node resurrect --path "--foo" <valid-git-url>` → **EXPECTED OUTCOME**: exit code 2, stderr contains `--path must not start with "-"`
    - Confirm a valid git URL (matching `GIT_URL`) and an existing local path are still accepted and run the pipeline
    - Document the observed outputs in the commit / PROVENANCE notes
    - _Requirements: 2.5, 2.6, 3.4, 3.6_

  - [ ] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-buggy transforms and inputs are unchanged
    - **IMPORTANT**: Re-run the SAME baseline from task 2 - do NOT write new tests
    - Run the full suite (`npm test`) and the Gaia calculator pipeline run
    - **EXPECTED OUTCOME**: The existing 25 tests remain green (now 25 + 4 = 29 cases all green), and the Gaia calculator run is identical: 28 `var` + 1 `innerHTML` = 29 legacy patterns removed (proving the hoisted-function guard does NOT over-skip `parser.js` `_tokenizeNumber`)
    - Confirm the loose-equality and `innerHTML` transforms behave exactly as before (their tests stay green)
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run `npm test` and confirm all 29 cases (25 existing + 4 new) are green
  - Confirm the Gaia calculator run still removes 29 legacy patterns with no change to the resurrected output
  - Confirm the Blocker 2 manual checks exit with code 2 and the valid-input path still runs
  - Structure the work as atomic, reviewable commits on `feat/resurrect-cli` (no new PR); update the §9 skip-reason table in `docs/RESURRECT-CLI.md` with the two new reasons as part of the Blocker 1 commit
  - Ensure all tests pass, ask the user if questions arise

## Notes

- **Exploration-first ordering**: Task 1 (Blocker 1 exploration) is expected to FAIL on the unfixed code — that failure is the confirmation the TDZ bug exists. Do not attempt to fix the test or the code when it fails in task 1.
- **Preservation baseline**: Task 2 is expected to PASS on the unfixed code (25/25 tests, 29 patterns removed in the Gaia run). It is the baseline the fix must not change.
- **Narrow hoisted-function guard**: The `hoistedFunctionUsedBefore` guard in task 3.1 must only skip when a hoisted function is referenced before the binding's initializer ends (`d.end`). A naive "skip any reference inside a nested function" rule would over-skip `parser.js` `_tokenizeNumber` and drop the Gaia run from 29 to 27 removed patterns, breaking preservation.
- **Blocker 2 verification mechanism**: Verified via a documented manual check (task 3.4). The `resurrect` validators call `process.exit`, so an in-process `node:test` would require `process.exit` stubbing; adding one is optional and only if it fits without new infrastructure. The acceptance criteria (exit code 2, `must not start with "-"` message, git not invoked) are fixed regardless of mechanism.
- **Out of scope**: Yellow-level findings and nits from the review. No new PR — commits land on `feat/resurrect-cli`.
- **Long-running commands**: Run `npm test` with a single-execution invocation (not watch mode). The Gaia pipeline run and the `node resurrect` manual checks are one-shot commands.

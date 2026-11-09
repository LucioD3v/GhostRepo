# resurrect CLI Blocker Fixes Bugfix Design

## Overview

The code review of PR `feat/resurrect-cli` (HEAD `d148dc4`) surfaced two blocking defects. Both are fixed here; the scope is strictly these two blockers plus regression tests. Yellow-level findings and nits are out of scope.

- **Blocker 1 — TDZ on `var`→`const`/`let` (`src/transmute.js`).** `varSkipReason` only rejects references that appear textually *before* the `var` declaration (`ref.node.start < declStart`). It does not reject references that appear textually *after* the `var` but are *evaluated before the binding is initialized*: initializer self-reference, same-declaration forward reference, and reads from hoisted functions that run before initialization. For those inputs the transform rewrites `var`→`const`/`let` and the modernized code throws `ReferenceError: Cannot access 'x' before initialization` — a hard break of business logic that violates the Zero Breaking Logic guardrail. The fix adds two new, narrow guards inside the per-reference loop and two module-level helpers. The guards must be *targeted*: the hoisted-function guard must not over-skip `parser.js` `_tokenizeNumber`, which reads `var number`/`var me` from an inner function *after* they are initialized.

- **Blocker 2 — Git option injection on clone (`src/pipeline.js` `acquire()`, `resurrect` `validateTarget`/`validatePath`).** `acquire()` passes the user-supplied `target` to `git clone` with no `--` argument separator, and `validateTarget()` returns any non-URL value unvalidated (contradicting §6 of the design doc). A target beginning with `-` is parsed by git as a flag (e.g. `--upload-pack=echo ...`), enabling arbitrary command execution. The fix validates flag-looking targets and `--path` values before any git invocation and inserts `--` before `target` in both `git clone` calls.

The general strategy is minimal, surgical, and provably behavior-preserving: each change is additive (new guards, new validation, an argument separator) and leaves all existing transforms, skip reasons, and valid-input paths untouched. Preservation is proven concretely by the existing `node:test` suite staying green, four new regression snippets, and an unchanged Gaia calculator run (29 legacy patterns removed). All work ships as atomic commits on `feat/resurrect-cli` (no new PR). Node >=20, ESM, `node:test`, dependencies pinned to exact versions.

## Glossary

- **Bug_Condition (C)**: The condition that triggers a bug. For Blocker 1: a `var` declaration that passes every current guard yet has a reference evaluated before its binding is initialized. For Blocker 2: a CLI target or `--path` value that begins with `-` (flag-looking) and reaches git unvalidated.
- **Property (P)**: The desired behavior. For Blocker 1: the rewrite is skipped with reason `used-in-initializer` or `hoisted-function-capture`, preserving the original runtime behavior (no `ReferenceError`). For Blocker 2: the value is rejected with exit code 2 and a `must not start with "-"` message before git runs, and `--` precedes `target` in both clone calls.
- **Preservation**: Existing behavior that the fix must not change — all current transforms and skip reasons, read-after-init `var` rewrites (notably `parser.js` `_tokenizeNumber`), valid git URLs / existing paths running normally, and the full Gaia calculator run (29 patterns removed).
- **`varSkipReason(path)`**: The function in `src/transmute.js` that returns a skip-reason string for a `var` declaration, or `null` when the `var`→`const`/`let` rewrite is provably safe.
- **`referencesWithin(name, scopePath)`**: Helper in `src/transmute.js` returning every real Identifier reference to `name` within the function scope (nested functions included on purpose).
- **`acquire(target, subpath, cloneDir, log)`**: The function in `src/pipeline.js` that clones (or copies) the target into the working directory, shelling out to `git clone`.
- **`validateTarget(t)` / `validatePath(p)`**: The input validators in the `resurrect` executable that run before the pipeline (and therefore before any git invocation).
- **`decl` / `d` / `declStart` / `block` / `scopePath`**: Loop locals in `varSkipReason`. `decl` is the whole `VariableDeclaration`; `d` is the current `VariableDeclarator`; `declStart = decl.start`; `decl.end` is the end of the whole declaration (spanning every initializer); `d.end` is the end of the current declarator; `block` is the declaring `BlockStatement`/`Program`; `scopePath` is the enclosing function/program path.
- **TDZ (temporal dead zone)**: The interval in which a `let`/`const` binding exists but is uninitialized; accessing it throws `ReferenceError`. `var` has no TDZ (it reads `undefined`), which is why rewriting a `var` whose binding is read early breaks behavior.

## Bug Details

### Bug Condition — Blocker 1 (TDZ in `var`→`const`/`let`)

The bug manifests when a `var` declaration is eligible for the `const`/`let` rewrite under the *current* guards (not used before declaration, not used outside its block, not a loop-closure/loop-uninitialized/redeclaration/parameter-shadow hazard) yet some reference to the binding is *evaluated before the binding is initialized*. `varSkipReason` is either not detecting references that live inside the declaration's own initializers, or not detecting reads performed by a hoisted function that runs before the binding is initialized.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type VarDeclarationInScope
  OUTPUT: boolean

  RETURN eligibleByCurrentGuards(input)
         AND ( referenceWithinInitializer(input)        // -> used-in-initializer
            OR hoistedFunctionReadsBeforeInit(input) )  // -> hoisted-function-capture
END FUNCTION
```

Where:
- `referenceWithinInitializer(input)` is detected by `ref.node.start < decl.end` (a reference that already passed `used-before-declaration`, so `ref.node.start >= declStart`, and falls within the span of the declaration's initializers). The range `declStart..decl.end` covers every initializer of the declaration, so a reference in that range is textually inside initializer code and is evaluated before the binding finishes initializing.
- `hoistedFunctionReadsBeforeInit(input)` is detected by `isInNestedFunctionDeclaration(ref, scopePath) && hoistedFunctionUsedBefore(scopePath, d.end)`.

### Examples

- **1.1 Namespace-default idiom in an IIFE** — `function f() { var ns = ns || { v: 1 }; return ns.v; }`. Original returns `1`; rewritten to `const`/`let` it throws `ReferenceError`. The `ns` reference sits inside the initializer (`ref.node.start < decl.end`) → `used-in-initializer`.
- **1.2 Forward reference within one declaration** — `function f() { var a = b, b = 1; return String(a); }`. Original returns `"undefined"`; rewritten it throws. The `b` reference in `a`'s initializer falls in `declStart..decl.end` → `used-in-initializer`.
- **1.3 Self-reference from an initializer IIFE** — `function f() { var App = (function () { return typeof App; })(); return App; }`. Original returns `"undefined"`; rewritten it throws. The `App` reference lives inside `App`'s initializer IIFE, within `declStart..decl.end` → `used-in-initializer` (the nested-initializer case).
- **1.4 Hoisted function reads a `var` before init** — `function f() { var r = g(); var x = 1; function g() { return x; } return String(r); }`. Original returns `"undefined"`; rewritten it throws. `x` is read inside hoisted `g`, and `g` runs (via `var r = g()`) before `x` is initialized → `hoisted-function-capture`.
- **Edge case (must NOT be flagged) — read-after-init via inner function** — `parser.js` `_tokenizeNumber`: `var number = []; var me = this; function tokenizeNumberInternal() { ... me._chars ... }` then `tokenizeNumberInternal()` is *called after* `number`/`me` are initialized. Here no hoisted function runs before initialization, so the guard must leave the rewrite in place.

### Bug Condition — Blocker 2 (Git option injection)

The bug manifests when a CLI target (or `--path` value) begins with `-` and is not rejected before git runs, so git parses it as a flag.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type CliTargetOrPath
  OUTPUT: boolean

  RETURN startsWith(input, '-')        // flag-looking target/path
         AND NOT rejectedBeforeGit(input)  // current code lets it reach git
END FUNCTION
```

### Examples

- `node resurrect -- "--upload-pack=echo pwned"` — current code runs `git clone --depth 1 --upload-pack=echo pwned <dir>` (no `--` separator); git executes the injected command. Fixed code rejects it in `validateTarget` with exit code 2 and never invokes git.
- `node resurrect --path "--foo"` — `--path` flows into `git sparse-checkout set`; a leading `-` would inject a flag. Fixed `validatePath` rejects it with exit code 2.
- `validateTarget("not-a-url-not-a-path")` — current code returns it unvalidated; fixed code fails with exit code 2 and a "not a git URL or an existing path" message.
- Edge case (must still succeed) — `validateTarget("https://github.com/owner/repo.git")` or an existing local path: accepted and the pipeline runs normally.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- All `var`→`const`/`let` rewrites that are safe today continue to apply, including read-after-init bindings captured by inner functions — specifically `parser.js` `_tokenizeNumber` (`var number` / `var me` read by `tokenizeNumberInternal` after initialization). The hoisted-function guard must NOT over-skip them.
- All existing skip reasons (`global-scope`, `used-outside-block`, `used-before-declaration`, `loop-closure-capture`, `loop-uninitialized`, `redeclared-in-scope`, `shadows-parameter`, `for-loop-init`, `switch-case`, `non-block-position`, `dynamic-scope`, `non-identifier-binding`) keep their exact behavior.
- The loose-equality (`==`/`!=`→`===`/`!==`) and `innerHTML`→`textContent` transforms are not modified at all.
- Valid git URLs (matching `GIT_URL`) and existing local paths are still accepted and run the full pipeline; a valid relative `--path` still sparse-checks out.
- The Gaia calculator fixture run is byte-for-byte identical: 28 `var` + 1 `innerHTML` = 29 legacy patterns removed.
- The currently-green `node:test` suite stays green.

**Scope:**
All inputs that are NOT the bug condition must be completely unaffected. For Blocker 1 this means every `var` that is either already skipped for another reason or genuinely safe to rewrite (read strictly after initialization, including via a function that is only *called* after init). For Blocker 2 this means every target that is a valid git URL or an existing path, every `--path` that does not begin with `-`, and every non-flag-looking value, which flow through exactly as before.

The actual expected *correct* behavior for buggy inputs is specified in the Correctness Properties section below.

## Hypothesized Root Cause

Based on the bug analysis, the causes are well isolated (the fixes are already identified and verified):

1. **Blocker 1 — initializer references not guarded.** `varSkipReason` guards `ref.node.start < declStart` (before the declaration) but has no guard for references in the range `declStart..decl.end` (inside the declaration's own initializers). Self-reference, same-declaration forward reference, and initializer IIFE self-reference all land in this unguarded range.

2. **Blocker 1 — hoisted-function reads not guarded.** A `var` can be read by a hoisted function declaration that executes before the binding is initialized (`var r = g(); var x = 1; function g() { return x; }`). The current loop has a `loop-closure-capture` guard for closures inside loops but nothing for straight-line hoisted-function execution order. The guard must be *narrow*: only when some hoisted function in the scope is actually referenced before the binding's initializer ends (`d.end`). A naive "skip any reference inside a nested FunctionDeclaration" rule would also skip `parser.js` `_tokenizeNumber` (lowering the calculator run from 29 to 27 removed patterns), violating preservation.

3. **Blocker 2 — missing argument separator.** `acquire()` builds `git clone` argv without a `--` separator, so a leading-`-` target is parsed as a git option.

4. **Blocker 2 — missing input validation.** `validateTarget` returns non-URL values unvalidated (contradicting §6 of the design doc), and `validatePath` does not reject a leading `-`, so flag-looking values reach git.

## Correctness Properties

Property 1: Bug Condition — Initializer and forward references skip the rewrite

_For any_ `var` declaration where the bug condition holds because a reference falls within the declaration's initializers (`ref.node.start < decl.end`, covering the namespace-default idiom, same-declaration forward reference, and initializer-IIFE self-reference), the fixed `varSkipReason` SHALL return `used-in-initializer`, the `var` SHALL be left unchanged, and the modernized code SHALL produce exactly the original runtime behavior (no `ReferenceError`).

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Bug Condition — Hoisted-function reads before init skip the rewrite

_For any_ `var` declaration where a reference lives inside a nested function declaration AND some hoisted function in the scope is referenced before the binding's initializer ends (`isInNestedFunctionDeclaration(ref, scopePath) && hoistedFunctionUsedBefore(scopePath, d.end)`), the fixed `varSkipReason` SHALL return `hoisted-function-capture`, the `var` SHALL be left unchanged, and the modernized code SHALL produce exactly the original runtime behavior (no `ReferenceError`).

**Validates: Requirements 2.4**

Property 3: Bug Condition — Flag-looking targets and paths never reach git

_For any_ CLI invocation whose target or `--path` value begins with `-`, the fixed `validateTarget` / `validatePath` SHALL fail with exit code 2 and a message containing `must not start with "-"` before any git invocation, and `acquire()` SHALL pass `--` immediately before `target` in both the plain and sparse `git clone` calls.

**Validates: Requirements 2.5, 2.6**

Property 4: Preservation — Non-buggy transforms and inputs are unchanged

_For any_ input where neither bug condition holds — a `var` that is safe to rewrite (read strictly after initialization, including reads via inner functions called after init, e.g. `parser.js` `_tokenizeNumber`) or already skipped for another reason, the loose-equality and `innerHTML` transforms, a valid git URL or existing path, and a `--path` not beginning with `-` — the fixed code SHALL produce exactly the same result as the original code, preserving the full Gaia calculator run (29 patterns removed) and the currently-green test suite.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming the root-cause analysis is correct (it is verified).

**File: `src/transmute.js`**

**Function: `varSkipReason(path)`** — inside the per-reference loop `for (const ref of referencesWithin(name, scopePath))`, after the existing `used-before-declaration` guard and the existing `used-outside-block` guard (which both stay in place and in their current order), add two new guards:

1. **Initializer-reference guard (covers 2.1, 2.2, 2.3):**
   ```js
   // A reference that falls within the initializers of this same declaration
   // (`var ns = ns || {}`, `var a = b, b = 1`, a self-referential IIFE) is
   // evaluated before the binding is initialized -> TDZ once it is const/let.
   if (ref.node.start < decl.end) return 'used-in-initializer';
   ```
   Rationale: `declStart..decl.end` spans every initializer of the declaration. A reference that already passed `used-before-declaration` has `start >= declStart`; if it is also `< decl.end` it sits inside initializer text. This also captures case 1.3, because the self-reference to `App` lives inside `App`'s initializer IIFE.

2. **Hoisted-function-capture guard (covers 2.4):**
   ```js
   if (isInNestedFunctionDeclaration(ref, scopePath) && hoistedFunctionUsedBefore(scopePath, d.end)) {
     return 'hoisted-function-capture';
   }
   ```

**New module-level helpers** (placed alongside the existing helpers such as `isInNestedFunction`):

```js
function isInNestedFunctionDeclaration(refPath, scopePath) {
  let p = refPath.parent;
  while (p && p !== scopePath) {
    if (p.node.type === 'FunctionDeclaration') return true;
    p = p.parent;
  }
  return false;
}

// True when some function declared in this scope is referenced before `pos`.
// Covers transitive calls: if no hoisted function is touched before the
// binding is initialized, none can run early, so there is no TDZ hazard.
function hoistedFunctionUsedBefore(scopePath, pos) {
  const ids = [];
  j(scopePath)
    .find(j.FunctionDeclaration)
    .forEach((p) => {
      if (p !== scopePath && enclosingFunction(p) === scopePath && p.node.id) ids.push(p.node.id);
    });
  return ids.some((id) =>
    referencesWithin(id.name, scopePath).some((r) => r.node !== id && r.node.start < pos),
  );
}
```

Rationale for `hoistedFunctionUsedBefore` (NOT a naive "skip any reference inside a nested function"): the narrow guard only skips when a hoisted function is actually *referenced* (invoked) before the binding's initializer ends. The naive rule would also skip `parser.js` `_tokenizeNumber`, where `var number`/`var me` are read by an inner function that is only *called after* they are initialized, dropping the calculator run from 29 to 27 removed patterns and breaking preservation (Requirements 3.1, 3.2).

**New skip reasons.** Two new reasons are introduced: `used-in-initializer` and `hoisted-function-capture`. They flow through the existing `skipped.push({ transform: 'var_to_const_let', reason, line })` path unchanged and appear in the report's `files[].skipped` array exactly like every other reason — no schema change. They extend the §9 skip-reason table in `docs/RESURRECT-CLI.md` and the `hazards` coverage in the regression test; both are additive and consistent with the existing reason vocabulary (`used-before-declaration`, `used-outside-block`, etc.).

**File: `src/pipeline.js`**

**Function: `acquire()`** — insert `'--'` immediately before `target` in both `git clone` invocations:
```js
// sparse branch (with subpath)
runGit(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--', target, cloneDir], log);
// plain branch (no subpath)
runGit(['clone', '--depth', '1', '--', target, cloneDir], log);
```
The `git sparse-checkout set` call is unaffected by the clone separator; `--path` is guarded separately in `validatePath` (below).

**File: `resurrect`**

1. **Add the `node:fs` import** at the top (verified absent today — the file imports only `parseArgs` from `node:util` and `run` from `./src/pipeline.js`):
   ```js
   import fs from 'node:fs';
   ```

2. **Function `validateTarget(t)`** — replace the current "return unvalidated" body with real validation (covers 2.5, 2.6):
   ```js
   function validateTarget(t) {
     if (!t || t.trim() === '') fail('missing <repo-url>', 2);
     if (t.startsWith('-')) fail('<repo-url> must not start with "-"', 2);
     if (GIT_URL.test(t) || fs.existsSync(t)) return t;
     fail(`not a git URL or an existing path: ${t}`, 2);
   }
   ```
   This runs in `main()` before `run()`, so a flag-looking target is rejected with exit code 2 before git is ever invoked.

3. **Function `validatePath(p)`** — after the existing null/empty check, add a leading-`-` rejection (covers 3.6's new rejection clause), because `--path` flows into `git sparse-checkout set`:
   ```js
   if (p.startsWith('-')) fail('--path must not start with "-"', 2);
   ```
   All other `validatePath` checks (absolute path, drive letter, `..` segments) are preserved unchanged.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each bug on the unfixed code, then verify the fix works and preserves existing behavior. Blocker 1 is verified through the existing `test/zero-breaking-logic.test.js` harness, which runs original vs. transformed code in a fresh VM and compares observable results (including thrown exceptions). Blocker 2 is verified by input validation that rejects before git runs, via the cheapest check that does not expand scope.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix, confirming the root-cause analysis. If a counterexample does not reproduce, re-hypothesize.

**Test Plan**: For Blocker 1, add the four buggy snippets to the `hazards` table and run the suite on the UNFIXED transmute to observe the behavior divergence (original returns a value; transformed throws `ReferenceError`). For Blocker 2, run `node resurrect -- "--upload-pack=echo"` against the unfixed CLI and observe that git is invoked with the injected flag.

**Test Cases**:
1. **Namespace-default idiom in IIFE** — `function f() { var ns = ns || { v: 1 }; return ns.v; }` (fails on unfixed code: transformed throws, original returns `1`).
2. **Forward reference within one declaration** — `function f() { var a = b, b = 1; return String(a); }` (fails on unfixed code).
3. **Self-reference from initializer IIFE** — `function f() { var App = (function () { return typeof App; })(); return App; }` (fails on unfixed code).
4. **Hoisted function reads var before init** — `function f() { var r = g(); var x = 1; function g() { return x; } return String(r); }` (fails on unfixed code).
5. **Git option injection** — `node resurrect -- "--upload-pack=echo"` (on unfixed code git is invoked with the injected flag).

**Expected Counterexamples**:
- Transformed code throws `ReferenceError: Cannot access '<name>' before initialization` while the original returns a value.
- Possible causes: unguarded initializer-range references; unguarded hoisted-function reads.
- The CLI reaches `git clone` with a leading-`-` target parsed as a flag.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := transmute_fixed(input)
  ASSERT result skips the rewrite with reason IN { 'used-in-initializer', 'hoisted-function-capture' }
  ASSERT behaviorOf(transformed) = behaviorOf(original)   // no ReferenceError
END FOR

FOR ALL input WHERE isBugCondition(input) /* Blocker 2 */ DO
  result := resurrect_fixed(input)
  ASSERT exitCode(result) = 2
  ASSERT git_was_NOT_invoked(result)
  ASSERT message(result) CONTAINS 'must not start with "-"'
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT transmute_original(input) = transmute_fixed(input)   // same transforms, same skips
  ASSERT resurrect_original(input) = resurrect_fixed(input)   // valid URL / existing path still runs
END FOR
```

**Testing Approach**: Property-based-style coverage is achieved concretely by the two strongest preservation anchors available: the Gaia calculator run remaining byte-for-byte identical (29 patterns removed, which exercises `parser.js` `_tokenizeNumber` and proves the hoisted-function guard does not over-skip), and the full existing `node:test` suite staying green. These give strong, deterministic guarantees across the real input domain without adding new infrastructure.

**Test Plan**: Observe behavior on the UNFIXED code first for the safe `var` rewrites and valid inputs, then confirm the fix leaves them identical.

**Test Cases**:
1. **Read-after-init via inner function** — `parser.js` `_tokenizeNumber` continues to rewrite (observed via the unchanged calculator run).
2. **Existing hazards** — every current entry in the `hazards` table still passes unchanged.
3. **Valid target / `--path`** — a valid git URL, an existing path, and a valid relative `--path` still run the pipeline.
4. **Loose-equality and innerHTML transforms** — unchanged (their dedicated tests stay green).

### Unit Tests

- **Blocker 1 regression (in `test/zero-breaking-logic.test.js`).** Add four entries to the existing `hazards` table; they are picked up automatically by the existing loop `for (const [name, [src, inputs]] of Object.entries(hazards))` and run through `assertSameBehavior` (which asserts the transformed output parses AND that observable behavior — including thrown exceptions — matches the original). No new helper is needed.
  ```js
  'namespace default idiom in IIFE': [`function f() { var ns = ns || { v: 1 }; return ns.v; }`, [[]]],
  'forward reference within one declaration': [`function f() { var a = b, b = 1; return String(a); }`, [[]]],
  'self-reference from initializer IIFE': [`function f() { var App = (function () { return typeof App; })(); return App; }`, [[]]],
  'hoisted function reads var before init': [`function f() { var r = g(); var x = 1; function g() { return x; } return String(r); }`, [[]]],
  ```
  Acceptance criterion: after the fix, each snippet is skipped (so the transformed source is behavior-identical to the original) and none throws `ReferenceError`; `assertSameBehavior` passes because the before/after observations are equal.

- **Blocker 2 verification.** The current `test/` suite has no CLI/pipeline test, and the agreed scope is minimal, so the recommended, cheapest verification that does not stand up new infrastructure is a **documented manual check**:
  ```
  node resurrect -- "--upload-pack=echo pwned"
  ```
  Acceptance criterion: process exits with code 2, stderr contains `<repo-url> must not start with "-"`, and git is NOT invoked (no `git clone ...` line on stderr). Equivalently `node resurrect --path "--foo" https://example.com/x.git` must exit 2 with `--path must not start with "-"`. A lightweight `node:test` that imports and calls `validateTarget`/`validatePath` directly MAY be added *only if* it fits without new infrastructure (these functions call `process.exit`, so a direct in-process test would need `process.exit` stubbing); the final choice is deferred to the task phase, but the acceptance criterion above is fixed regardless of mechanism.

### Property-Based Tests

- The existing `hazards`-table harness in `test/zero-breaking-logic.test.js` is the project's property-style mechanism: each case runs original vs. transformed across its input set in a fresh VM and requires identical observable results. The four new snippets extend this coverage to the TDZ hazards. No new PBT framework is introduced (consistent with the minimal scope and pinned-dependency constraint).

### Integration Tests

- **Gaia calculator run.** Running the full pipeline against `ghostrepo-gaia-calculator/legacy` must remain identical: 28 `var` + 1 `innerHTML` = 29 legacy patterns removed, with no change to the resurrected output. This is the primary integration-level proof that Blocker 1's guards are correctly narrow (Requirements 3.1, 3.2).
- **Full suite.** `npm test` must pass with 25 existing + 4 new regression cases, all green (Requirement 3.3).

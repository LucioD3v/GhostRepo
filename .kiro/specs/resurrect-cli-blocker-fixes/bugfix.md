# Bugfix Requirements Document

## Introduction

The `resurrect` CLI (GhostRepo) is a deterministic legacy-JavaScript modernizer whose central guardrail is "Zero Breaking Logic": every AST codemod must be provably behavior-preserving. The code review of PR `feat/resurrect-cli` (HEAD `d148dc4`) identified two blocking defects that violate that guarantee or the CLI's safety contract:

- **Blocker 1 — TDZ (temporal dead zone) on `var`→`const`/`let`:** In `src/transmute.js`, `varSkipReason` guards only against references that appear textually *before* the `var` declaration (`ref.node.start < declStart`). It fails to detect references that appear textually *after* the `var` but are *evaluated before* the binding is initialized (initializer self-reference, same-declaration forward reference, and reads from hoisted functions that run before initialization). For these inputs the transform rewrites `var` to `const`/`let`, and the modernized code throws `ReferenceError: Cannot access 'x' before initialization` — a hard break of business logic, violating Zero Breaking Logic.

- **Blocker 2 — Git option injection on clone:** In `src/pipeline.js`, `acquire()` passes the user-supplied `target` to `git clone` without a `--` argument separator, and in `resurrect`, `validateTarget()` returns any non-URL value unvalidated (contradicting §6 of the design doc). A target beginning with `-` is interpreted by git as a flag (e.g. `--upload-pack=echo ...`), enabling arbitrary command execution.

Scope is minimal and agreed: only these two blockers plus regression tests. Yellow-level findings and nits from the review are explicitly out of scope. All work ships as atomic, reviewable commits on `feat/resurrect-cli` (no new PR). Node >=20, ESM, `node:test`; dependencies pinned to exact versions.

## Bug Analysis

### Current Behavior (Defect)

**Blocker 1 — TDZ in `var`→`const`/`let` (`src/transmute.js`, `varSkipReason`):**

1.1 WHEN a scope contains the namespace-default idiom inside an IIFE, e.g. `function f() { var ns = ns || { v: 1 }; return ns.v; }`, THEN the transform rewrites `var` to `const`/`let` and the modernized code throws `ReferenceError` (original returns `1`).

1.2 WHEN a single `var` declaration forward-references a later binding in the same declaration list, e.g. `function f() { var a = b, b = 1; return String(a); }`, THEN the transform rewrites `var` to `const`/`let` and the modernized code throws `ReferenceError` (original returns `"undefined"`).

1.3 WHEN a `var` initializer self-references the binding via an IIFE, e.g. `function f() { var App = (function () { return typeof App; })(); return App; }`, THEN the transform rewrites `var` to `const`/`let` and the modernized code throws `ReferenceError` (original returns `"undefined"`).

1.4 WHEN a hoisted function declaration reads a `var` binding before it is initialized, e.g. `function f() { var r = g(); var x = 1; function g() { return x; } return String(r); }`, THEN the transform rewrites `var` to `const`/`let` and the modernized code throws `ReferenceError` (original returns `"undefined"`).

**Blocker 2 — Git option injection (`src/pipeline.js` `acquire()`, `resurrect` `validateTarget`/`validatePath`):**

1.5 WHEN a target beginning with `-` is supplied, e.g. `node resurrect -- "--upload-pack=echo"`, THEN `acquire()` invokes `git clone --depth 1 --upload-pack=echo <dir>` (no `--` separator), git treats the target as a flag, and the injected command executes.

1.6 WHEN `validateTarget(t)` receives a value that does not match `GIT_URL`, THEN it returns `t` unvalidated (including values beginning with `-` and non-existent paths), contradicting §6 of the design doc which promises targets are validated.

### Expected Behavior (Correct)

2.1 WHEN a scope contains the namespace-default idiom inside an IIFE (e.g. `var ns = ns || { v: 1 }`), THEN the system SHALL skip the `var`→`const`/`let` rewrite with reason `used-in-initializer` and preserve the original behavior (returns `1`).

2.2 WHEN a single `var` declaration forward-references a later binding in the same declaration list (e.g. `var a = b, b = 1`), THEN the system SHALL skip the rewrite with reason `used-in-initializer` and preserve the original behavior (returns `"undefined"`).

2.3 WHEN a `var` initializer self-references the binding via an IIFE (e.g. `var App = (function () { return typeof App; })()`), THEN the system SHALL skip the rewrite (via `used-in-initializer` / nested-initializer handling) and preserve the original behavior (returns `"undefined"`).

2.4 WHEN a hoisted function declaration reads a `var` binding before it is initialized (e.g. `var r = g(); var x = 1; function g() { return x; }`), THEN the system SHALL skip the rewrite with reason `hoisted-function-capture` and preserve the original behavior (returns `"undefined"`).

2.5 WHEN a target beginning with `-` is supplied, THEN the system SHALL reject it before any git invocation: `validateTarget` SHALL fail with exit code 2 and a message that `<repo-url> must not start with "-"`, and git SHALL NOT be invoked.

2.6 WHEN `validateTarget(t)` receives any value, THEN the system SHALL fail with exit code 2 if it is empty, fail if it begins with `-`, accept it if `GIT_URL.test(t)` or `fs.existsSync(t)` is true, and otherwise fail with a message that it is not a git URL or an existing path; AND `acquire()` SHALL pass `--` before `target` in both the plain and sparse `git clone` invocations.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a scope contains `var` bindings that are only read after initialization — including `parser.js` `_tokenizeNumber` where `var number` / `var me` are read by `tokenizeNumberInternal` which is called after initialization — THEN the system SHALL CONTINUE TO rewrite those `var` declarations to `const`/`let` (the hoisted-function guard SHALL NOT over-skip them).

3.2 WHEN the full pipeline runs against the Gaia calculator fixture, THEN the system SHALL CONTINUE TO produce an identical run: 28 `var` + 1 `innerHTML` = 29 legacy patterns removed, with no change to the resurrected output.

3.3 WHEN the existing `node:test` suite is run, THEN the system SHALL CONTINUE TO pass all currently-green tests (25/25 today, plus the 4 new regression snippets).

3.4 WHEN a valid git URL (matching `GIT_URL`) or an existing local path is supplied as the target, THEN the system SHALL CONTINUE TO accept it and run the pipeline normally.

3.5 WHEN other transforms are exercised (loose-equality `==`/`!=` → `===`/`!==`, and `innerHTML` → `textContent`), THEN the system SHALL CONTINUE TO behave exactly as before (these transforms SHALL NOT be modified).

3.6 WHEN `--path` is supplied with a valid relative subfolder, THEN the system SHALL CONTINUE TO sparse-checkout it, while additionally rejecting a `--path` value beginning with `-` (since `--path` flows into `git sparse-checkout set`).

## Bug Condition Derivation

### Blocker 1 — TDZ in `var`→`const`/`let`

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type VarDeclarationInScope
  OUTPUT: boolean

  // A var is a hazard when it is const/let-eligible by the CURRENT guards
  // (not used-before-declaration, not outside block, etc.) yet some reference
  // is evaluated before the binding is initialized.
  RETURN eligibleByCurrentGuards(X)
     AND ( referenceWithinInitializer(X)          // used-in-initializer
        OR hoistedFunctionReadsBeforeInit(X) )    // hoisted-function-capture
END FUNCTION
```

```pascal
// Property: Fix Checking — modernized code must not enter the TDZ.
FOR ALL X WHERE isBugCondition(X) DO
  result ← transmute'(X)
  ASSERT result skips the rewrite with reason IN
         { 'used-in-initializer', 'hoisted-function-capture' }
  AND    behaviorOf(transformed) = behaviorOf(original)   // no ReferenceError
END FOR
```

Where `referenceWithinInitializer(X)` is detected by `ref.node.start < decl.end`
(covers 1.1, 1.2, and 1.3 via nested initializer), and
`hoistedFunctionReadsBeforeInit(X)` is detected by
`isInNestedFunctionDeclaration(ref, scopePath) && hoistedFunctionUsedBefore(scopePath, d.end)`
(covers 1.4). The hoisted-function check MUST be narrow: a reference inside a
nested function declaration is a hazard only when some hoisted function can run
before the binding is initialized — otherwise `parser.js` `_tokenizeNumber`
would be over-skipped (29 → 27).

### Blocker 2 — Git option injection

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type CliTargetOrPath
  OUTPUT: boolean

  RETURN startsWith(X, '-')          // flag-looking target/path
     AND NOT rejectedBeforeGit(X)    // current code lets it reach git
END FUNCTION
```

```pascal
// Property: Fix Checking — flag-looking targets never reach git.
FOR ALL X WHERE isBugCondition(X) DO
  result ← resurrect'(X)
  ASSERT exitCode(result) = 2
  AND    git_was_NOT_invoked(result)
  AND    message(result) CONTAINS 'must not start with "-"'
END FOR
```

### Preservation (both blockers)

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT transmute(X)  = transmute'(X)    // same transforms, same skips
  ASSERT resurrect(X)  = resurrect'(X)    // valid URL / existing path still runs
END FOR
```

**Key definitions:** `F` = the code at `d148dc4` (before the fix); `F'` = the code after applying the two fixes. Preservation is verified concretely by the Gaia calculator run remaining identical (29 patterns removed) and the existing suite staying green.

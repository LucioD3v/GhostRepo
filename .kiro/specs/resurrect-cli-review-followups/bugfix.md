# Bugfix Requirements Document

## Introduction

PR #2 (`feat/resurrect-cli`, merged to `main` at `8ab3423`) delivered the `resurrect` CLI. Its code review left a set of inexpensive "yellow" findings open. They are not logic bugs in the codemods. They are places where the executable, the report, or the documentation say something the code does not do. That conflicts with the project's stated principle (README, `docs/RESURRECT-CLI.md` §1, §7): **honesty over impressiveness**. The report and the docs may only claim what the code actually does and measures.

This spec closes the four agreed follow-ups. The numbering F1 to F4 follows the agreed scope list; F4 has five sub-items (4a to 4e).

- **F1. `resurrect` is not executable in git.** `git ls-tree origin/main resurrect` shows mode `100644`. The README and `docs/RESURRECT-CLI.md` §1 document `./resurrect <repo-url>`, which fails with `Permission denied` on macOS/Linux. (`core.fileMode` is `false` on the Windows dev machine, so the mode must be set in the git index explicitly.)
- **F2. Stale design status.** The header of `docs/RESURRECT-CLI.md` says "Design (pre-implementation)" and "Once approved, the technology stack and file structure described here are locked", but the CLI is implemented and merged.
- **F3. Dishonest `agent_signature`.** `src/report.js` writes `agent_signature: 'Kiro Multi-Agent Orchestrator'` (and §7 of the doc shows the same). The CLI is deterministic and runs no agent, which contradicts the honesty rules in §7. No test in `test/` asserts on this value (verified by search), so changing it breaks no existing test.
- **F4. Doc-vs-code drift in `docs/RESURRECT-CLI.md`.** Resolution criterion: **correct the doc so it states what the code does; do not add features**, except for 4e, which is a cheap test.
  - 4a. §5 (and the §11 recap) say `.gitignore` is not changed. PR #2 added entries for `.agents/`, `_devpost/`, `resurrection-report.json` and `resurrected/`.
  - 4b. The §7 example skip reason `"var in for-loop init with closure capture"` matches no real code. Real reasons are the codes in §9 (`for-loop-init`, `loop-closure-capture`, and so on). Real skip entries also carry a `line` field that the example omits.
  - 4c. §8 promises a fallback to a full shallow clone when sparse checkout is unsupported. `acquire()` in `src/pipeline.js` does not implement it.
  - 4d. §3 Phase 4 (and the §8 "Diff for `lines_changed`" row) describe `git diff --shortstat` and a git-unavailable warning. The code uses the in-process `lineDiffCount`, a symmetric difference of line multisets with CRLF/LF normalized. It never calls git and cannot fail for that reason.
  - 4e. §10 promises an integration test of `pipeline.js` against the local fixture. No test imports `src/pipeline.js`, so `run`, `processTree`, `acquire` and `lineDiffCount` have no coverage.

Out of scope, and not to be touched here: the receiver-dependent `innerHTML`→`textContent` semantics (review item 5); review nits 6, 7, 8, 9 and 11 (`node_modules` copied into `--out-dir`, `lineDiffCount` being a multiset, a file listed as transformed but not written, `RESURRECTED` status ignoring `files_skipped`, `engines`/Node 20); new features (automatic PR, agents); and any change to codemods or skip rules. `.kiro/hooks/post-analysis.sh` and the README describe the manual, legacy-regex flow and are also not modified, even though the hook contains the same signature string.

Constraints: `src/transmute.js`, `src/exorcise.js` and `src/scan.js` are not modified. The Gaia calculator run (`ghostrepo-gaia-calculator/legacy`) must stay identical at 29 patterns removed (28 `var` + 1 `innerHTML`). The suite today is 29/29 green. Node >=20, ESM, `node:test`, exact-pinned dependencies and no new ones. Existing EOL (CRLF) is preserved when editing. Work ships as atomic, reviewable commits on a new branch from `main`, not on `feat/resurrect-cli`.

## Bug Analysis

### Current Behavior (Defect)

**F1. Entry point mode**

1.1 WHEN the repository is checked out on macOS/Linux and a user runs `./resurrect <repo-url>` as documented in the README and `docs/RESURRECT-CLI.md` §1, THEN the system fails with `Permission denied`, because the `resurrect` file is stored in git with mode `100644`.

**F2. Document status**

1.2 WHEN a teammate reads the header of `docs/RESURRECT-CLI.md`, THEN the system presents "Status: Design (pre-implementation)" and says the stack and file structure are "locked once approved", although the CLI is implemented and merged.

**F3. Report signature**

1.3 WHEN `buildReport` assembles any report (every run, regardless of input), THEN the system writes `agent_signature: "Kiro Multi-Agent Orchestrator"`, which claims an agent orchestrator produced a report that a deterministic CLI generated.

1.4 WHEN a reader consults the §7 example of `docs/RESURRECT-CLI.md`, THEN the system shows `"agent_signature": "Kiro Multi-Agent Orchestrator"`, which contradicts the §7 honesty rules and the §2 statement that v1 has no agent or PR automation.

**F4. Doc-vs-code drift**

1.5 WHEN a reader consults §5 (and the §11 recap) of `docs/RESURRECT-CLI.md`, THEN the system states that `.gitignore` is unchanged, although PR #2 added `.agents/`, `_devpost/`, `resurrection-report.json` and `resurrected/`.

1.6 WHEN a reader consults the §7 `skipped` example, THEN the system shows the reason `"var in for-loop init with closure capture"`, which the code never emits, and omits the `line` field present in real entries (the `parse` skip is the only entry without a line).

1.7 WHEN a reader consults §8 (and the "sparse-checkout fallback" entry in §12, item 8), THEN the system states that an unsupported `git sparse-checkout` falls back to a full shallow clone, but `acquire()` runs `git clone --sparse` and `git sparse-checkout set` and, if either fails, aborts through `runGit` with exit code 1 and no fallback.

1.8 WHEN a reader consults §3 Phase 4 and the §8 row "Diff for `lines_changed`", THEN the system describes `git diff --shortstat` and a "git unavailable / diff fails" recovery path with a stderr warning, but the code computes `lines_changed` with `lineDiffCount` (symmetric difference of line multisets, EOL-normalized), which does not use git and never emits that warning.

1.9 WHEN the test suite runs, THEN no test imports `src/pipeline.js`, so `run`, `processTree`, `acquire` and `lineDiffCount` have no coverage, although §10 states that `pipeline.js` is integration-tested against the local fixture.

### Expected Behavior (Correct)

**F1. Entry point mode**

2.1 WHEN the repository is checked out on macOS/Linux, THEN the system SHALL store `resurrect` in the git index with mode `100755` (set with `git update-index --chmod=+x resurrect`), so that `./resurrect --help` runs without `Permission denied`; the file content SHALL be byte-identical to the current one and, on Windows, only the index mode changes.

**F2. Document status**

2.2 WHEN a teammate reads the header of `docs/RESURRECT-CLI.md`, THEN the system SHALL state that the CLI is implemented in v1 (merged via PR #2), and SHALL NOT use "pre-implementation", "once approved" or "locked" wording. The stack and structure SHALL be described as the current implemented state, and the Scope level and Branch lines SHALL NOT contradict that status.

**F3. Report signature**

2.3 WHEN `buildReport` assembles any report, THEN the system SHALL set `agent_signature` to `"GhostRepo resurrect CLI"`, a value that names only the deterministic tool that generated the report. The string `Kiro Multi-Agent Orchestrator` SHALL NOT appear in `src/report.js`, and no change SHALL be made to any other field of the report.

2.4 WHEN a reader consults the §7 example of `docs/RESURRECT-CLI.md`, THEN the system SHALL show `"agent_signature": "GhostRepo resurrect CLI"`, and §7 SHALL state in one sentence that the value identifies the generating tool and does not imply any agent ran.

**F4. Doc-vs-code drift (the doc is corrected to match the code)**

2.5 WHEN a reader consults §5 and §11 of `docs/RESURRECT-CLI.md`, THEN the system SHALL say that `.gitignore` gained entries for generated and internal artifacts (`.agents/`, `_devpost/`, `resurrection-report.json`, `resurrected/`) and that `.kiro/` remains tracked, with no remaining claim that `.gitignore` is unchanged.

2.6 WHEN a reader consults the §7 `skipped` example, THEN the system SHALL show only reasons the code can emit (for example `for-loop-init` or `loop-closure-capture` for `var_to_const_let`, and `nullish-idiom` for `loose_equality`) in the real entry shape `{ transform, reason, line }`, and SHALL describe the `parse` skip entry (no `line`) as the only entry without a line.

2.7 WHEN a reader consults §8 (and §12, item 8), THEN the system SHALL state that sparse-checkout failure is fatal (`git` error, exit `1`) and that a full-shallow-clone fallback is **not implemented in v1** (listed as future work if kept at all). No sentence SHALL promise the fallback as current behavior, and the §8 row for "`--path` yields no files" SHALL stay as it is.

2.8 WHEN a reader consults §3 Phase 4 and the §8 diff row, THEN the system SHALL describe `lines_changed` as the in-process `lineDiffCount` (symmetric difference of line multisets, CRLF/LF-normalized, equal to insertions plus deletions of that comparison), SHALL state that it does not call git and is not identical to `git diff --shortstat` (for example, a moved line counts as unchanged), and SHALL remove the "git unavailable" recovery row and its warning.

2.9 WHEN the test suite runs, THEN the system SHALL include a `node:test` file (`test/pipeline.test.js`) that, with no network and no new dependency, copies `fixtures/legacy-sample.js` into a temporary directory, calls `processTree` on that directory with a `reportPath` inside the temporary directory, and asserts all of the following:
   - (a) the `resurrection-report.json` file exists and parses as JSON;
   - (b) `scope` is `javascript-web-legacy`, `status` is `RESURRECTED`, `agent_signature` is `GhostRepo resurrect CLI`, `files_scanned` is `1`, and `files_transformed` is `1`;
   - (c) `legacy_patterns_removed` equals the sum of `metrics.breakdown`, each breakdown value equals the clamped `before - after` of the matching `files[0]` category, and the reported-only categories `dead_vendor_api` and `es5_prototype` are `0`;
   - (d) `lines_changed` is a positive integer, and `files[].path` is POSIX-style and relative;
   - (e) the committed fixture `fixtures/legacy-sample.js` is byte-identical before and after the test;
   - (f) for status coherence, a temporary tree whose only file needs no transform yields `NO_CHANGES` with `lines_changed` `0`, and an empty temporary tree yields `SCANNED_ONLY` with all-zero metrics.

   The test SHALL remove its temporary directories when it finishes. It MAY additionally exercise `run` with a local-path target and an explicit `outDir` inside a temporary directory.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `src/transmute.js`, `src/exorcise.js` or `src/scan.js` are used by any input, THEN the system SHALL CONTINUE TO behave exactly as before; those three files SHALL NOT appear in the diff of this work, and no skip rule or skip reason SHALL change.

3.2 WHEN the pipeline runs against `ghostrepo-gaia-calculator/legacy`, THEN the system SHALL CONTINUE TO produce 29 legacy patterns removed (28 `var` + 1 `innerHTML`), with unchanged `files[]`, `before`/`after` counts, `lines_changed` and resurrected output; the only permitted difference in the report is the `agent_signature` value.

3.3 WHEN the existing suite is run with `node --test "test/**/*.test.js"`, THEN the system SHALL CONTINUE TO pass all 29 existing tests, and the new `test/pipeline.test.js` SHALL pass in addition (no existing test is edited to make it pass).

3.4 WHEN `resurrect` is invoked as `node resurrect ...` or via `npx resurrect ...` (including on Windows), THEN the system SHALL CONTINUE TO run with the same argument grammar, the same validation (exit code `2` on invalid input) and the same `--help` output; the content of the `resurrect` file SHALL NOT change.

3.5 WHEN a report is built, THEN the system SHALL CONTINUE TO emit the same schema and honesty rules: only measured numbers, `before - after` clamped at `0`, `null` for an underivable `repository`, and `status` derived from `files_scanned` and `files_transformed`. Only the `agent_signature` string value changes.

3.6 WHEN `package.json` and `package-lock.json` are inspected after this work, THEN the system SHALL CONTINUE TO pin dependencies to exact versions with no added or changed dependency, ESM (`"type": "module"`), and `engines` `node >=20`.

3.7 WHEN the documentation is edited, THEN the system SHALL CONTINUE TO preserve the existing line endings of each edited file (CRLF where the file already uses CRLF), the v1 scope statement (JavaScript/web legacy only, deterministic, no agents, no automatic PR), and every section of `docs/RESURRECT-CLI.md` not named in F2 and F4, including the §9 skip-reason table and the §12/§13 review responses other than the §12 item 8 correction.

3.8 WHEN the work is delivered, THEN the system SHALL CONTINUE TO keep each change in its own atomic commit on a new branch created from `main` (mode change, status header, signature code and tests, doc corrections, integration test), with `feat/resurrect-cli` untouched.

## Bug Condition Derivation

### F1. Entry point mode

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type GitIndexEntry for the file "resurrect"
  OUTPUT: boolean

  RETURN X.path = "resurrect" AND X.mode != 100755
END FUNCTION
```

```pascal
// Property: Fix Checking - entry point is executable in git
FOR ALL X WHERE isBugCondition(X) DO
  X' <- fix(X)
  ASSERT X'.mode = 100755
  AND    blobHash(X') = blobHash(X)          // content unchanged (f4553ee...)
END FOR
```

### F2. Document status

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type DocHeader (docs/RESURRECT-CLI.md, text before the first "---")
  OUTPUT: boolean

  RETURN contains(X, "pre-implementation") OR contains(X, "locked")
END FUNCTION
```

```pascal
// Property: Fix Checking - status reflects the implemented state
FOR ALL X WHERE isBugCondition(X) DO
  X' <- fix(X)
  ASSERT NOT contains(X', "pre-implementation")
  AND    NOT contains(X', "Once approved")
  AND    statesImplemented(X')               // "Implemented (v1)"
END FOR
```

### F3. Report signature

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ReportInput (any input accepted by buildReport)
  OUTPUT: boolean

  // Every report is affected; the claim is false for the whole input space.
  RETURN buildReport(X).agent_signature = "Kiro Multi-Agent Orchestrator"
END FUNCTION
```

```pascal
// Property: Fix Checking - signature names only the generating tool
FOR ALL X WHERE isBugCondition(X) DO
  result <- buildReport'(X)
  ASSERT result.agent_signature = "GhostRepo resurrect CLI"
END FOR
```

### F4. Doc-vs-code drift

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type DocClaim (a statement in docs/RESURRECT-CLI.md about code behavior)
  OUTPUT: boolean

  // A claim is defective when the code at 8ab3423 does not do what it says.
  RETURN NOT holdsInCode(X, "8ab3423")
     OR  NOT testedAsPromised(X)             // 4e: promised test does not exist
END FUNCTION
```

The defective claims are 4a (`.gitignore` unchanged), 4b (skip-reason example), 4c (sparse-checkout fallback), 4d (`git diff --shortstat` for `lines_changed`) and 4e (the promised `pipeline.js` integration test).

```pascal
// Property: Fix Checking - the doc states only what the code does
FOR ALL X WHERE isBugCondition(X) DO
  X' <- fix(X)                               // 4a-4d: rewrite the doc; 4e: add the test
  ASSERT holdsInCode(X', "HEAD") AND testedAsPromised(X')
  AND    noCodeBehaviorChanged()             // src/ diff limited to the F3 string
END FOR
```

### Preservation

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT transmute(X)    = transmute'(X)     // same transforms, same skips
  ASSERT exorcise(X)     = exorcise'(X)
  ASSERT countPatterns(X) = countPatterns'(X)
  ASSERT buildReport(X) EXCEPT agent_signature = buildReport'(X) EXCEPT agent_signature
END FOR
```

**Key definitions:** `F` is the code and docs at `8ab3423` (before the fix). `F'` is the result after this work. Preservation is verified by the existing 29 tests, the new `test/pipeline.test.js`, and an unchanged Gaia calculator run (29 patterns removed: 28 `var` + 1 `innerHTML`).

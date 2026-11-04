# 👻 `resurrect` CLI — Design Document

> The `resurrect` CLI is the executable heart of GhostRepo. It takes a legacy
> JavaScript / web repository, scans it for technical debt, safely modernizes it
> with AST-based codemods, and writes a resurrection report built from **real
> measured metrics only**. This document is the project vision a teammate can
> read before touching the code.

**Status:** Design (pre-implementation). Once approved, the technology stack and
file structure described here are locked.
**Scope level:** Level 2 — scan + SAFE AST transforms (no PR automation yet).
**Branch:** `feat/resurrect-cli`.

---

## 1. Overview

GhostRepo is a Kiro multi-agent orchestrator that "resurrects" abandoned
JavaScript / web codebases. The 4-phase Resurrection Pipeline is already defined
conceptually in [`.kiro/specs/resurrect-pipeline.yaml`](../.kiro/specs/resurrect-pipeline.yaml),
and a manual proof-of-concept (the Firefox OS Gaia calculator) already proved the
idea works by hand. `resurrect` turns that manual flow into a real, runnable Node
CLI.

The CLI is invoked from the repo root:

```bash
./resurrect <repo-url> [--path <subfolder>]
# example:
./resurrect https://github.com/mozilla-b2g/gaia --path apps/calculator
```

It runs all four pipeline phases in sequence against a shallow clone of the
target, applies conservative AST codemods, and emits `resurrection-report.json`.
Every number in that report is derived from an actual measurement of the code
before and after; nothing is hardcoded.

The guiding principle, inherited from the project's existing
[`post-analysis.sh`](../.kiro/hooks/post-analysis.sh) hook and the README, is
**honesty over impressiveness**: if a value cannot be measured, the report emits
`0` or `null` — never an invented figure.

---

## 2. Supported scope (and non-scope)

`resurrect` v1 supports **JavaScript / web legacy code ONLY**. It operates on
`.js` files. This scope is stated explicitly in both the CLI output and this doc
so expectations are honest.

The project's steering guide
([`.kiro/steering/architecture.md`](../.kiro/steering/architecture.md)) aspires
to broader transformations (Python 2→3, COBOL, etc.). **This CLI deliberately
does not implement any of that.** Keeping v1 scoped to JS/web is what makes the
resurrection reliable, reproducible, and safe to run unattended. Any output or
documentation that implied modernizing other languages would be dishonest and is
out of scope.

### What the CLI DOES

- Shallow-clones a target Git repo (optionally sparse-checking out a single
  `--path` subfolder) into a local working directory.
- Scans `.js` files and counts five technical-debt patterns with real counts.
- Applies three SAFE, AST-based codemods (`var`→`const`/`let`, `==`/`!=`→
  `===`/`!==`, unsafe `innerHTML =` → `textContent =`).
- Skips any transform it cannot prove safe, and records why.
- Writes `resurrection-report.json` with real before/after metrics, a real diff
  line count, and a per-file summary.
- Prints usage via `--help`.

### What the CLI DOES NOT do (v1)

- It does **not** modernize languages other than JavaScript.
- It does **not** open pull requests (that is Phase 4's future extension; v1
  stops at the report).
- It does **not** use regex string replacement to rewrite code — all rewrites go
  through an AST so syntax is never corrupted.
- It does **not** attempt aggressive refactors (callback→async, class
  conversion, module bundling). Those are future scope; v1 is intentionally
  conservative.
- It does **not** touch or commit the gitignored working folders `targets/` or
  `ghostrepo-gaia-calculator/`.
- It does **not** modify files in place in the user's original repo — it works
  on a clone inside the tool's own working directory.

---

## 3. The 4-phase flow

The CLI maps directly onto the pipeline phases from the spec. Phase names below
match the README's user-facing vocabulary (Necromancy / Exorcism / Transmutation
/ Resurrection).

### Phase 1 — Necromancy (scan)

**Goal:** acquire the target and measure its debt without changing anything.

1. Shallow-clone the target repo (`git clone --depth 1`). If `--path` is given,
   use sparse checkout so only that subfolder lands on disk — this keeps huge
   upstream repos like Gaia manageable.
2. Walk the clone for `.js` files (skipping `node_modules/`, `.git/`, and
   minified `*.min.js`).
3. Count five technical-debt patterns and record them as the **"before"**
   baseline:
   - `var` declarations
   - loose equality / inequality (`==`, `!=`)
   - unsafe `innerHTML =` assignments
   - dead vendor-prefixed APIs (e.g. `MozTransform`, `webkitTransform`,
     `mozRequestAnimationFrame`)
   - ES5 prototype-assignment patterns (`X.prototype.y = function`)

The counts are gathered by parsing each file into an AST and counting matching
nodes, which is more accurate than text search. Files that fail to parse are
recorded as `skipped` with the parser error — they are **not** silently dropped.

### Phase 2 — Exorcism (banish security smells & dead APIs)

**Goal:** remove dangerous and dead patterns.

- **Unsafe `innerHTML` → `textContent`:** rewrite assignments of the form
  `element.innerHTML = expr` to `element.textContent = expr`. This neutralizes
  the XSS vector of assigning dynamic strings as HTML. The transform only fires
  on *assignments* (`MemberExpression.property.name === 'innerHTML'` on the
  left-hand side of an `AssignmentExpression`), never on reads, and is skipped
  when the right-hand side is a literal that is clearly intended as markup
  (see Edge cases).
- **Dead vendor-prefixed APIs:** these are *reported* and counted in Phase 1 /
  Phase 4. v1 does not auto-rewrite them to their standard equivalents, because a
  safe rewrite requires per-API knowledge and risks changing behavior; instead
  they are surfaced in the report so a human can act. (This is called out
  explicitly so the report's "removed" count for vendor APIs is honest — it will
  be `0` unless a transform actually removed them.)

### Phase 3 — Transmutation (modernize legacy JS)

**Goal:** modernize syntax while preserving behavior.

- **`var` → `const` / `let`:** for each `var` declaration, decide between
  `const` and `let` by analyzing whether the binding is ever reassigned within
  its scope. No reassignment → `const`; otherwise `let`. Declarations that are
  unsafe to convert (see Edge cases) are skipped and recorded.
- **`==` → `===` and `!=` → `!==`:** rewrite loose equality
  `BinaryExpression`s to their strict form. This is a conservative,
  behavior-affecting change only when operands differ in type; it is applied
  because strict equality is the project's stated modernization goal, and the
  Zero-Breaking-Logic test fixture validates it does not change results for the
  sample code. The transform is skipped for comparisons against `null`
  (`x == null`), because `== null` is an intentional idiom that also matches
  `undefined`; converting it to `===` would change behavior.

### Phase 4 — Resurrection (report with REAL metrics)

**Goal:** write `resurrection-report.json` containing only measured values.

After transforms are written back to the working clone, the CLI measures:

- **Lines changed:** from a real diff (`git diff --shortstat`, or a line-level
  diff computed in-process) between the original and transformed trees →
  `insertions + deletions`.
- **Patterns removed per category:** `before - after` AST counts per category,
  clamped at `0` so it is never negative.
- **Per-file summary:** for each file, the counts before/after, which transforms
  applied, and any skips with reasons.

If a measurement cannot be taken (e.g. git unavailable, a file failed to parse),
the corresponding value is `0` or `null` and the reason is recorded. See §7 for
the full schema and the honesty rules.

---

## 4. Technology stack (locked on approval)

| Concern | Choice | Pinned version |
|---------|--------|----------------|
| Runtime | Node.js | v24 (available: v24.19.0) |
| AST parse / transform | **jscodeshift** | `17.4.0` |
| CLI argument parsing | Node built-in `node:util` `parseArgs` | (stdlib, no dep) |
| Git operations | system `git` via `node:child_process` | (no dep) |
| File walking, diff, JSON | Node stdlib (`node:fs`, `node:path`) | (stdlib) |

**Why jscodeshift over raw `@babel/core` + traverse:** both are viable. We
choose **jscodeshift** because it bundles a recast-backed printer that preserves
original formatting and only rewrites the nodes we touch — critical for
reviewable, minimal diffs and for the Zero-Breaking-Logic guardrail. It also
gives a concise collection API (`.find().forEach()`) that keeps each codemod
small and testable. Raw Babel would reprint the whole file and churn formatting,
producing noisy diffs and inflated (if technically real) line-change counts. For
counting in Phase 1 we use jscodeshift's underlying parser (`ast-types` /
`@babel` via recast) so scan and transform share one AST representation.

**Dependency pinning:** `package.json` pins **exact** versions (no `^`/`~`
ranges), per project convention. Only well-known, actively maintained packages
are used; jscodeshift is the de facto standard JS codemod runner (Facebook/React
ecosystem).

---

## 5. File structure (planned)

All new files live at the GhostRepo root. The `.kiro/` directory stays tracked
(hackathon requirement) and `.gitignore` is not changed.

```
GhostRepo/
├── resurrect                 # executable entry point, Node shebang (#!/usr/bin/env node)
├── package.json              # pinned exact deps; "type": "module"; bin + test scripts
├── src/
│   ├── pipeline.js           # orchestrates phases 1→4; owns the working-dir lifecycle
│   ├── scan.js               # Phase 1: clone + AST pattern counting (before/after reusable)
│   ├── exorcise.js           # Phase 2: innerHTML→textContent codemod; dead-API reporting
│   ├── transmute.js          # Phase 3: var→const/let and ==→=== codemods
│   └── report.js             # Phase 4: diff + before/after → resurrection-report.json
├── test/
│   └── transforms.test.js    # node:test unit tests over the fixture (self-test)
├── fixtures/
│   └── legacy-sample.js      # tiny ES5 sample: var, ==, innerHTML to prove transforms
└── docs/
    └── RESURRECT-CLI.md       # this document
```

**Module responsibilities and boundaries:**

- `resurrect` (entry): parses args with `parseArgs`, handles `--help`, delegates
  to `pipeline.run()`. No business logic lives here.
- `pipeline.js`: the only module that creates/cleans the working directory and
  shells out to git. It calls scan → exorcise → transmute → report in order and
  threads the before/after data between them.
- `scan.js`: exports both the file walker and a `countPatterns(source)` function
  reused for both the before and after measurement, guaranteeing symmetric
  counting.
- `exorcise.js` / `transmute.js`: each exports pure `(source) => { code, stats }`
  codemod functions that take source text and return transformed text plus what
  they did/skipped. They do no I/O, which makes them trivially unit-testable.
- `report.js`: pure assembly of the report object from inputs, plus the single
  `fs.writeFile` of `resurrection-report.json`.

Keeping codemods and counting as pure string→result functions (no filesystem,
no git) is the key testability decision: the fixture test feeds them strings and
asserts on returned code and stats, with no cloning required.

---

## 6. Validation of external inputs

The CLI has two external inputs: the positional `<repo-url>` and the optional
`--path`.

| Input | Required | Type / rules | Behavior on failure |
|-------|----------|--------------|---------------------|
| `<repo-url>` | Yes (unless `--help`) | Non-empty string; must match an `https://`, `http://`, `git@`, or `ssh://` Git URL shape, or be an existing local path | Print a usage error to stderr, exit code `2`. No clone attempted. |
| `--path <subfolder>` | No | Relative path, no leading `/`, no `..` segments (prevents escaping the sparse checkout / path traversal) | Print error to stderr, exit code `2`. |
| `--help` / `-h` | No | Flag | Print usage to stdout, exit `0`. |

The repo URL is passed to `git` as a separate `child_process.spawn` argument
(argument array, never string interpolation into a shell), so a malicious URL
cannot inject shell commands. `--path` is validated against `..` and absolute
forms before being handed to `git sparse-checkout`.

---

## 7. `resurrection-report.json` — schema & honesty rules

The report is the contract with the user and the demo. It contains **only
measured values**. The shape is consistent with the existing `post-analysis.sh`
output so the two agree in vocabulary.

```jsonc
{
  "project": "GhostRepo",
  "repository": "gaia" | null,          // basename of the clone URL; null if unknown
  "scope": "javascript-web-legacy",      // fixed; states the honest scope
  "status": "RESURRECTED",
  "timestamp": "2025-...Z",              // ISO-8601 UTC
  "target": { "url": "...", "path": "apps/calculator" | null },
  "metrics": {
    "files_scanned": 12,                 // real count
    "files_transformed": 7,              // files where >=1 transform applied
    "files_skipped": 1,                  // files that failed to parse
    "lines_changed": 341,                // real diff insertions+deletions, else 0
    "legacy_patterns_removed": 63,       // sum of breakdown, clamped >= 0
    "breakdown": {
      "var_to_const_let": 40,
      "loose_equality": 18,
      "insecure_innerHTML": 5,
      "dead_vendor_api": 0,              // reported-only in v1 -> honest 0
      "es5_prototype": 0                 // reported-only in v1 -> honest 0
    }
  },
  "files": [
    {
      "path": "js/calculator.js",
      "before": { "var": 30, "loose_equality": 12, "innerHTML": 3, "vendor_api": 1, "es5_prototype": 2 },
      "after":  { "var": 0,  "loose_equality": 0,  "innerHTML": 0, "vendor_api": 1, "es5_prototype": 2 },
      "transforms_applied": ["var_to_const_let", "loose_equality", "insecure_innerHTML"],
      "skipped": [{ "transform": "var_to_const_let", "reason": "var in for-loop init with closure capture" }]
    }
  ],
  "agent_signature": "Kiro Multi-Agent Orchestrator"
}
```

**Honesty rules (hard requirements):**

1. Every number is computed from the actual before/after ASTs or the actual
   diff. No constant is ever written as a metric.
2. A value that cannot be measured is `0` (counts) or `null` (identifiers such
   as repository name). Never a plausible-looking fake.
3. `*_removed` counts are `before - after`, clamped at `0` — a transform can
   never report removing more than existed.
4. Categories that v1 only reports but does not auto-fix (`dead_vendor_api`,
   `es5_prototype`) show `0` removed unless a transform genuinely removed them.
5. Skips are recorded with reasons, so a low "removed" count is explainable
   rather than hidden.

---

## 8. Error handling (per failure point)

| Operation | Failure condition | Recoverable? | What the caller gets | Logged |
|-----------|-------------------|--------------|----------------------|--------|
| Arg parse | Missing/invalid `<repo-url>` or bad `--path` | Fatal (before any work) | Usage message on stderr, exit `2` | stderr |
| `git clone` | Network error, auth, bad URL, git not installed | Fatal | Error on stderr, exit `1`, no report written | stderr (full git stderr) |
| Sparse checkout (`--path`) | Path not present in repo | Recoverable → fall back to full shallow clone, warn; or Fatal if empty | Warning on stderr; continues | stderr warning |
| File walk | Permission error on a file | Recoverable | File marked skipped with reason; walk continues | per-file entry in report |
| AST parse of a file | Syntax the parser rejects | Recoverable | File counted as `files_skipped`, no transform attempted, reason recorded | report `files[].skipped` |
| Individual codemod on a node | Node fails the safety check | Recoverable | Node left unchanged, skip recorded with reason | report `files[].skipped` |
| Writing transformed file | fs write error | Fatal for that file → abort run (avoid half-written tree) | Error on stderr, exit `1` | stderr |
| Diff for `lines_changed` | git unavailable / diff fails | Recoverable | `lines_changed: 0` (honest zero) | stderr warning |
| Writing report | fs write error | Fatal | Error on stderr, exit `1` | stderr |

Design stance: **parse and per-node transform failures are always recoverable
and never corrupt output** — the conservative rule is "when in doubt, skip and
record." Only I/O that would leave the working tree inconsistent (a failed file
write) aborts the run. The original target repo is never modified in place, so
an aborted run is always safe to rerun.

---

## 9. Edge cases

- **`var` in `for` loop init** (`for (var i = 0; ...)`): converting to `const`
  is wrong (reassigned) and to `let` can change closure-capture semantics. v1
  converts to `let` only when the loop body captures no closures over the
  variable; otherwise skips with a reason.
- **`var` redeclared in the same scope** (hoisting-dependent code): skip — a
  naive `const`/`let` conversion would throw `SyntaxError` on redeclaration.
- **`var` used before its declaration line** (relying on hoisting): skip, since
  `const`/`let` are in the temporal dead zone.
- **`x == null` / `x != null`:** intentional idiom (matches both `null` and
  `undefined`); skip the strict-equality conversion to preserve behavior.
- **`innerHTML = '<b>literal markup</b>'`:** when the right-hand side is a string
  literal containing HTML tags, rewriting to `textContent` would change rendered
  output. v1 skips these (static author-controlled markup is not the XSS vector)
  and records the skip; it rewrites only dynamic/variable assignments.
- **`innerHTML +=`** (append): skip; `textContent +=` is not an equivalent
  operation. Recorded.
- **Reads of `innerHTML`** (`let h = el.innerHTML`): never touched; only
  left-hand-side assignments are in scope.
- **Minified / generated files** (`*.min.js`): excluded from the walk entirely.
- **Non-JS files, binary files:** ignored; only `.js` is processed.
- **Empty target / no JS found:** valid run; report shows `files_scanned: 0` and
  all-zero metrics, with `status` still written honestly.

---

## 10. Testability

- **Unit tested (no clone needed):** the pure codemod functions in `exorcise.js`
  and `transmute.js`, and `scan.js`'s `countPatterns`. `test/transforms.test.js`
  (Node's built-in `node:test`) feeds the `fixtures/legacy-sample.js` ES5 code —
  which contains `var`, `==`, and `el.innerHTML = x` — and asserts the output
  contains `const`/`let`, `===`, and `textContent`, that the chosen edge-case
  idioms are skipped, and that the transformed source still **parses**
  (`node --check` / re-parse) and remains behavior-preserving on the sample.
- **Unit tested:** the report assembler in `report.js`, by passing synthetic
  before/after stats and asserting the schema, the clamp-at-zero rule, and the
  `0`/`null` fallbacks.
- **Integration tested:** `pipeline.js` against the local fixture used as a fake
  "repo" (a local path target), verifying a real `resurrection-report.json` is
  produced end-to-end with only measured values — no network required.
- **Manual / demo:** a real run against `mozilla-b2g/gaia --path apps/calculator`
  reproduces the showcase metrics.

The pure-function boundary (codemods and counting take strings, do no I/O) is
the deliberate choice that makes the transforms verifiable on a tiny fixture
without cloning a large external repo, satisfying the definition of done.

---

## 11. Definition of done (traceability)

This design supports every item in the task's definition of done: `node
resurrect --help` prints usage (§3, §6); AST transforms are verified on a small
fixture (§10); a sample `resurrection-report.json` with only measured values is
produced from a real fixture run (§7, §10); this doc explains the 4-phase flow
(§3), the supported scope (§2), and what the CLI does vs. does not do (§2). The
gitignored `targets/` and `ghostrepo-gaia-calculator/` folders are never touched
(§2), and `.gitignore` / `.kiro/` tracking are left unchanged (§5).

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
# POSIX shells (the shebang makes the file directly executable):
./resurrect <repo-url> [--path <subfolder>]
./resurrect https://github.com/mozilla-b2g/gaia --path apps/calculator

# Windows / PowerShell (this repo's dev environment) — the extension-less
# shebang file is not directly runnable, so invoke via Node or the bin entry:
node resurrect https://github.com/mozilla-b2g/gaia --path apps/calculator
npx resurrect  https://github.com/mozilla-b2g/gaia --path apps/calculator
```

> **Cross-platform note:** `./resurrect` relies on the `#!/usr/bin/env node`
> shebang and works on macOS/Linux. On Windows use `node resurrect …`, or the
> `package.json` `bin` mapping via `npx resurrect …` after `npm install`. The
> argument grammar is identical on every platform.

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
   baseline. Each row below gives the counting unit (one count per matched AST
   node) and the exact `files[].before` / `files[].after` key it maps to in the
   report schema (§7):

   | Scan category | Counting unit (one per node) | `files[]` key |
   |---------------|------------------------------|---------------|
   | `var` declarations | each `VariableDeclaration` with `kind === 'var'` | `var` |
   | loose equality | each `BinaryExpression` whose operator is `==` or `!=` (one per node; `===`/`!==` do not count) | `loose_equality` |
   | unsafe `innerHTML =` | each `AssignmentExpression` (operator `=`) whose LHS member property is `innerHTML` | `innerHTML` |
   | dead vendor-prefixed APIs | each member access to a vendor-prefixed identifier (`MozTransform`, `webkitTransform`, `mozRequestAnimationFrame`, …) | `vendor_api` |
   | ES5 prototype assignment | each `AssignmentExpression` whose LHS matches `X.prototype.y` | `es5_prototype` |

The counts are gathered by parsing each file into an AST and counting matching
nodes, which is more accurate than text search. Files that fail to parse are
recorded as `skipped` with the parser error — they are **not** silently dropped.

> **Note — AST counting is intentionally not identical to `post-analysis.sh`.**
> The existing hook counts with `grep -E` regex (its `innerHTML` pattern counts
> reads, writes, strings, and comments; its `[^=!<>]==[^=]|!=[^=]` pattern is
> line/text based). The CLI counts distinct AST nodes (e.g. `innerHTML` only on
> the LHS of an assignment). The two methods will legitimately produce different
> numbers for the same file. The CLI is the **canonical counter for its own
> report**; the hook is legacy tooling for the manual `legacy/ → src/`
> resurrection and is unrelated to — and not expected to match — the CLI's
> numbers.

### Phase 2 — Exorcism (banish security smells & dead APIs)

**Goal:** remove dangerous and dead patterns.

- **Unsafe `innerHTML` → `textContent`:** rewrite assignments of the form
  `element.innerHTML = expr` to `element.textContent = expr`. This neutralizes
  the XSS vector of assigning dynamic strings as HTML. The transform only fires
  on *assignments* (`MemberExpression.property.name === 'innerHTML'` on the
  left-hand side of an `=` `AssignmentExpression`), never on reads and never on
  compound assignment (`+=`). The skip rule is **syntactic and decidable** — no
  "intent" guessing:

  > For `element.innerHTML = <rhs>`:
  > - If `<rhs>` is a string literal, OR a template literal with **no**
  >   expressions, whose string value contains an HTML tag (matches the regex
  >   `/<[a-zA-Z!/]/`), then **SKIP** and record reason `static-markup-literal`
  >   — converting markup to `textContent` would change what the browser
  >   renders.
  > - Otherwise (a dynamic expression, OR a tag-free literal such as `'0'`),
  >   **CONVERT** to `textContent`.

  Applied to the showcase `calculator.js`, this converts both
  `this.display.innerHTML = '0'` (tag-free literal — safe, desirable) and
  `this.display.innerHTML = outval` (dynamic), and would skip only a literal
  that actually contains tags such as `innerHTML = '<b>x</b>'`.
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
  `BinaryExpression`s (operator `==` or `!=`) to their strict form. This is a
  conservative, behavior-affecting change only when operands differ in type; it
  is applied because strict equality is the project's stated modernization goal,
  and the Zero-Breaking-Logic test fixture validates it does not change results
  for the sample code. The **nullish-idiom skip** is broader than just `null`,
  because the "matches null OR undefined" idiom is written against both
  sentinels and the showcase file uses the `undefined` form:

  > Skip the strict-equality conversion for any `==` / `!=`
  > `BinaryExpression` in which **either** operand is: the `null` literal
  > (`NullLiteral`), the identifier `undefined` (`Identifier` named
  > `undefined`), or the `void 0` expression. Record reason `nullish-idiom`.

  This preserves behavior for the real showcase line
  `if (currentNumber != undefined)` — where `currentNumber` comes from
  `stack.pop()` and can legitimately be `undefined` **or** `null`, so
  converting to `!== undefined` would change the result. Every non-nullish
  comparison is still converted.

### Phase 4 — Resurrection (report with REAL metrics)

**Goal:** write `resurrection-report.json` containing only measured values.

After transforms are written back to the working clone, the CLI measures:

- **Lines changed:** from a real diff (`git diff --shortstat`, or a line-level
  diff computed in-process) between the original and transformed trees →
  `insertions + deletions`.
- **Patterns removed per category:** `before - after` AST counts per category,
  clamped at `0` so it is never negative. Here `after` is a **real re-count of
  the transformed source** using the exact same `countPatterns` function as the
  `before` pass (§5) — it is *not* a derived "assume everything was removed"
  value. Consequently, a pattern that was **skipped** is still physically
  present in the transformed source and therefore **still counted in `after`**
  (e.g. a skipped `var` leaves `after.var >= 1`). Because `removed = before -
  after`, skips naturally reduce the removed count instead of being hidden.
- **Per-file summary:** for each file, the symmetric before/after counts, which
  transforms applied, and any skips with reasons.

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
│   └── legacy-sample.js      # tiny ES5 sample: var, ==, innerHTML (transformed) + .prototype. and MozTransform (reported-only) to cover all 5 scan categories
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
measured values**. Its *vocabulary* (phase/category names) deliberately echoes
the existing `post-analysis.sh` output, but its *numbers* are produced by AST
counting, not the hook's regex, and are the canonical figures for this report.
See the counting note in §3 — the CLI report and the hook's output are not
expected to be numerically identical.

```jsonc
{
  "project": "GhostRepo",
  "repository": "gaia" | null,          // last path segment, .git stripped; null if underivable
  "scope": "javascript-web-legacy",      // fixed; states the honest scope
  "status": "RESURRECTED",               // see status rule below: RESURRECTED | NO_CHANGES | SCANNED_ONLY
  "timestamp": "2025-...Z",              // ISO-8601 UTC
  "target": { "url": "...", "path": "apps/calculator" | null },
  "metrics": {
    // ILLUSTRATIVE v1-codemod numbers only — NOT the README showcase
    // (777/63/20), which came from a broader manual resurrection (see §10).
    // This example has exactly ONE transformed file (the files[] entry below),
    // so metrics.breakdown is the per-category before-after of that single file
    // and legacy_patterns_removed is their sum. Every breakdown value equals the
    // matching removed count in files[0] — no part exceeds the whole.
    "files_scanned": 12,                 // real count
    "files_transformed": 1,              // files where >=1 transform applied
    "files_skipped": 1,                  // files that failed to parse
    "lines_changed": 43,                 // real diff insertions+deletions, else 0
    "legacy_patterns_removed": 43,       // sum of breakdown, clamped >= 0
    "breakdown": {
      "var_to_const_let": 29,            // = files[0]: before.var 30 - after.var 1
      "loose_equality": 11,              // = before 12 - after 1 (one nullish idiom skipped)
      "insecure_innerHTML": 3,           // = before 3 - after 0
      "dead_vendor_api": 0,              // reported-only in v1 -> honest 0 (after == before)
      "es5_prototype": 0                 // reported-only in v1 -> honest 0 (after == before)
    }
  },
  "files": [
    {
      // files[].path is relative to the SCANNED ROOT: the --path subfolder when
      // --path is given, otherwise the clone root. With --path apps/calculator,
      // this file (clone-root apps/calculator/js/calculator.js) is reported as:
      "path": "js/calculator.js",
      // after = real re-count of transformed source. One var was skipped, so
      // after.var is 1 (not 0); one loose_equality was a nullish idiom, so
      // after.loose_equality is 1. removed = before - after accounts for both.
      // vendor_api and es5_prototype are reported-only in v1, so after == before.
      "before": { "var": 30, "loose_equality": 12, "innerHTML": 3, "vendor_api": 1, "es5_prototype": 2 },
      "after":  { "var": 1,  "loose_equality": 1,  "innerHTML": 0, "vendor_api": 1, "es5_prototype": 2 },
      "transforms_applied": ["var_to_const_let", "loose_equality", "insecure_innerHTML"],
      "skipped": [
        { "transform": "var_to_const_let", "reason": "var in for-loop init with closure capture" },
        { "transform": "loose_equality", "reason": "nullish-idiom" }
      ]
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
6. **`repository` derivation (all target shapes):** take the last path segment
   of the target and strip any trailing `.git` suffix. This is defined
   uniformly for `https://`/`http://`, `ssh://`, `git@host:owner/repo.git`, and
   local filesystem paths (POSIX or Windows), e.g.
   `git@github.com:mozilla-b2g/gaia.git` → `gaia`,
   `C:\work\gaia-calculator` → `gaia-calculator`. If no segment can be derived,
   `repository` is `null` — never a guessed name.
7. **`files[].path` is relative to the scanned root** — the `--path` subfolder
   when `--path` is given, otherwise the clone root. In the example above, a
   `--path apps/calculator` run reports the clone-root file
   `apps/calculator/js/calculator.js` as `js/calculator.js`; without `--path`
   the same file would be reported as `apps/calculator/js/calculator.js`. Paths
   are always POSIX-style (`/` separators) and never absolute, so reports diff
   cleanly across machines.
8. **`status` reflects what actually happened:** `"RESURRECTED"` only when
   `files_transformed >= 1` (code was actually changed); `"NO_CHANGES"` when
   files were scanned but no transform applied (`files_scanned >= 1` and
   `files_transformed == 0`); `"SCANNED_ONLY"` when nothing to scan
   (`files_scanned == 0`). Claiming a resurrection on a zero-change run would be
   dishonest.

---

## 8. Error handling (per failure point)

| Operation | Failure condition | Recoverable? | What the caller gets | Logged |
|-----------|-------------------|--------------|----------------------|--------|
| Arg parse | Missing/invalid `<repo-url>` or bad `--path` | Fatal (before any work) | Usage message on stderr, exit `2` | stderr |
| `git clone` | Network error, auth, bad URL, git not installed | Fatal | Error on stderr, exit `1`, no report written | stderr (full git stderr) |
| Sparse checkout — `--path` yields no files | Path not present in repo | **Fatal** — do NOT full-clone (gaia is gigabytes) | `path not found in repo` on stderr, exit `2`, no report | stderr |
| Sparse checkout — unsupported by git version | git too old for `sparse-checkout` | Recoverable → fall back to full shallow clone, warn | Warning on stderr; continues with full clone | stderr warning |
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
- **Nullish idiom (`x == null`, `x != undefined`, `x == void 0`, …):** matches
  both `null` and `undefined`; skip the strict-equality conversion to preserve
  behavior whenever either operand is `null`, the `undefined` identifier, or
  `void 0` (reason `nullish-idiom`). This is the rule that protects the
  showcase's `currentNumber != undefined`.
- **`innerHTML = '<b>literal markup</b>'`:** when the right-hand side is a
  static literal (string, or template with no expressions) whose value matches
  `/<[a-zA-Z!/]/` (contains an HTML tag), rewriting to `textContent` would
  change rendered output. v1 skips these with reason `static-markup-literal`.
- **`innerHTML = '0'` (tag-free literal):** NOT skipped — a literal with no HTML
  tag is converted to `textContent` like any dynamic RHS. The skip boundary is
  the tag regex above, nothing else, so the real showcase assignment is
  modernized rather than understated.
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
  (Node's built-in `node:test`) feeds the `fixtures/legacy-sample.js` ES5 code
  and asserts the output contains `const`/`let`, `===`, and `textContent`, that
  the chosen edge-case idioms are skipped, and that the transformed source still
  **parses** (`node --check` / re-parse) and remains behavior-preserving on the
  sample.
- **Fixture must exercise all five scan categories.** The two
  **reported-only** categories (`es5_prototype`, `vendor_api`) never occur in
  the showcase `calculator.js` (an object literal with no `X.prototype.y =`
  assignments), so without a dedicated fixture they would have zero test
  coverage and could silently miscount. `fixtures/legacy-sample.js` therefore
  deliberately contains, in addition to the three transformed patterns (`var`,
  `==`, `el.innerHTML = x`):
  - at least one ES5 prototype assignment, e.g.
    `Thing.prototype.greet = function () { ... }`, and
  - at least one vendor-prefixed access, e.g. `el.style.MozTransform = '...'`.

  The self-test then asserts a **counted-but-not-transformed** invariant for
  both: Phase 1 counts `es5_prototype >= 1` and `vendor_api >= 1` in `before`,
  and because v1 applies no transform to them, the re-counted `after` values are
  unchanged and their `*_removed` breakdown stays `0`. This guards both the
  scan counter and the honesty rule that reported-only categories never claim
  removals.
- **Unit tested:** the report assembler in `report.js`, by passing synthetic
  before/after stats and asserting the schema, the clamp-at-zero rule, and the
  `0`/`null` fallbacks.
- **Integration tested:** `pipeline.js` against the local fixture used as a fake
  "repo" (a local path target), verifying a real `resurrection-report.json` is
  produced end-to-end with only measured values — no network required.
- **Manual / demo:** a real run against `mozilla-b2g/gaia --path apps/calculator`
  produces a `resurrection-report.json` whose numbers reflect **only the three
  v1 codemods** (`var`, loose equality, `innerHTML`). These numbers will be
  **lower than the README's showcase** (777 lines / 63 patterns / 20-20 tests).
  That showcase came from a broader *manual* resurrection — ES6 modules, `class`
  conversion, `async/await` — measured by the regex `post-analysis.sh` hook over
  a hand-built `legacy/ → src/` tree. The CLI report and the README showcase are
  produced by **different processes and are not expected to match**; the gap is
  honest, not a defect. (The §7 sample's `lines_changed: 43` is likewise a
  v1-codemod figure, not the showcase 777.)

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

---

## 12. Responses to design review (round 1)

Review verdict: CHANGES_REQUESTED (2 HIGH, 4 MEDIUM, 4 NIT). All ten findings
were **addressed** — none backlogged or ignored — because each aligned with the
original requirements (never-corrupt-code guarantee, real-metrics honesty,
implementable rules). Both HIGH findings were verified against the actual
showcase source (`targets/gaia-calculator/apps/calculator/js/calculator.js`
contains `currentNumber != undefined`, `innerHTML = '0'`, and `innerHTML =
outval`).

1. **HIGH — `== null` skip missed `!= undefined`.** Fixed in §3 Phase 3 and §9:
   the nullish-idiom skip now fires when either operand is `null`, the
   `undefined` identifier, or `void 0`, protecting the showcase line.
2. **HIGH — ambiguous `innerHTML` literal-skip.** Fixed in §3 Phase 2 and §9:
   replaced "clearly intended as markup" with a syntactic rule — skip only
   static literals matching `/<[a-zA-Z!/]/` (reason `static-markup-literal`);
   convert all dynamic RHS and all tag-free literals including `'0'`.
3. **MEDIUM — "reproduces the showcase metrics" claim.** Fixed in §10: the CLI
   report reflects only the three v1 codemods, is expected to be lower than the
   README's manual-resurrection showcase, and the two are measured by different
   processes and are not expected to match.
4. **MEDIUM — AST vs regex count divergence.** Fixed with a note in §3 and the
   §7 intro: the CLI is the canonical counter for its own report; its AST counts
   intentionally differ from the legacy regex hook, which is unrelated to the
   CLI numbers.
5. **MEDIUM — inconsistent `after` counts.** Fixed in §4 Phase 4 and the §7
   sample: `after` is a real re-count of transformed source via the same
   `countPatterns`, so skipped patterns remain counted; the sample now shows
   `after.var: 1` / `after.loose_equality: 1` to match the recorded skips.
6. **MEDIUM — `loose_equality` unit + scan→schema mapping.** Fixed in §3 Phase
   1: added a table defining each category's counting unit (one per AST node;
   `loose_equality` = one per `==`/`!=` `BinaryExpression`) and mapping each of
   the five scan categories to its `files[]` key.
7. **NIT — Windows entry-point invocation.** Fixed in §1: documented
   `node resurrect …` / `npx resurrect …` for Windows alongside the POSIX
   `./resurrect` form.
8. **NIT — sparse-checkout fallback.** Fixed in §8: if `--path` yields no files,
   exit `2` with `path not found in repo` (no multi-GB full-clone fallback);
   full-clone fallback happens only when sparse-checkout itself is unsupported.
9. **NIT — `repository` derivation.** Fixed in §7 honesty rule 6: last path
   segment with `.git` stripped, defined for https/http/ssh/`git@`/local paths;
   `null` if underivable.
10. **NIT — `status` always `RESURRECTED`.** Fixed in §7 honesty rule 7:
    `RESURRECTED` only when code changed; `NO_CHANGES` / `SCANNED_ONLY` for
    zero-change and empty runs.

---

## 13. Responses to design review (round 2)

Review verdict: CHANGES_REQUESTED (0 HIGH, 1 MEDIUM, 2 NIT) after all ten
round-1 findings were confirmed closed. All three round-2 findings were
**addressed** — none backlogged or ignored — because each was a clarity defect
in the schema example or a test-coverage gap that directly serves the doc's
purpose (teaching a teammate the report shape) and the real-metrics honesty
requirement.

1. **MEDIUM — the two §7 illustrative JSON blocks contradicted each other (a
   single file removed more patterns than the project-wide total).** Fixed in
   §7: the example now has exactly one transformed file
   (`files_transformed: 1`), and `metrics.breakdown` equals the per-category
   `before - after` of that single `files[]` entry
   (`var_to_const_let: 29`, `loose_equality: 11`, `insecure_innerHTML: 3`,
   `dead_vendor_api: 0`, `es5_prototype: 0`), with `legacy_patterns_removed: 43`
   as their sum and `lines_changed` lowered to `43`. Every breakdown value now
   equals the matching per-file removed count, so no part exceeds the whole. An
   inline comment states the single-file relationship explicitly.
2. **NIT — `files[].path` was unanchored relative to the showcase path used
   elsewhere.** Fixed with new §7 honesty rule 7: `files[].path` is relative to
   the scanned root (the `--path` subfolder when given, otherwise the clone
   root), is POSIX-style, and is never absolute. The §7 sample's
   `js/calculator.js` is now annotated as the `--path apps/calculator`-relative
   form of the clone-root file `apps/calculator/js/calculator.js`.
3. **NIT — `es5_prototype` (and `vendor_api`) had no test coverage because they
   never occur in the showcase file.** Fixed in §10 and the §5 file tree: the
   fixture `fixtures/legacy-sample.js` now explicitly includes at least one
   `X.prototype.y = function(){}` and one vendor-prefixed access
   (`el.style.MozTransform = …`), and the self-test asserts both reported-only
   categories are counted in `before`, unchanged in `after`, and report `0`
   removed — giving the two otherwise-untested scan counters a
   counted-but-not-transformed assertion.

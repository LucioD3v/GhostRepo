# Design Document

## Overview

This spec closes four honesty-gap findings left open after PR #2 merged the `resurrect` CLI. All fixes are documentation corrections and a single string change in `src/report.js`; no codemod logic is modified.

## Approach per finding

### F1 — Entry point executable bit

Set the git index mode for `resurrect` to `100755` using `git update-index --chmod=+x resurrect`. File content is unchanged. This is a one-line index operation; no source file is edited.

### F2 — Document status header

Replace the "Design (pre-implementation)" status and "locked once approved" language in `docs/RESURRECT-CLI.md` with wording that reflects the implemented state ("Implemented in v1, merged via PR #2"). No other section of the document changes.

### F3 — Report signature

Change the `agent_signature` literal in `src/report.js` from `"Kiro Multi-Agent Orchestrator"` to `"GhostRepo resurrect CLI"`. Update the §7 example in `docs/RESURRECT-CLI.md` to match and add one sentence explaining that the value identifies the generating tool.

### F4 — Doc-vs-code drift

Four doc corrections, one new test file:

- **4a** (`.gitignore`): State in §5 and §11 that `.gitignore` gained entries for `.agents/`, `_devpost/`, `resurrection-report.json`, and `resurrected/`.
- **4b** (skip example): Replace the invented reason string with a real example using `for-loop-init` or `loop-closure-capture`, and add the `line` field to the example entry.
- **4c** (sparse-checkout fallback): State that failure is fatal (exit 1) and the full-clone fallback is not implemented in v1.
- **4d** (`lines_changed`): Replace the `git diff --shortstat` description with the actual `lineDiffCount` algorithm (symmetric difference of line multisets, CRLF/LF-normalized); remove the "git unavailable" recovery row.
- **4e** (pipeline test): Add `test/pipeline.test.js` covering `processTree` and `run` against `fixtures/legacy-sample.js` in a temporary directory, asserting all conditions listed in the bugfix spec §2.9.

## Constraints

- `src/transmute.js`, `src/exorcise.js`, and `src/scan.js` are not modified.
- The Gaia calculator run result (29 patterns removed: 28 `var` + 1 `innerHTML`) must remain identical, except `agent_signature`.
- No new dependencies. Node ≥ 20, ESM, `node:test`.
- Each finding ships as its own atomic commit on a branch off `main`.

## Verification

`npm test` passes all existing tests plus the new `test/pipeline.test.js`. The `resurrect` file runs without `Permission denied` on macOS/Linux after a fresh clone.

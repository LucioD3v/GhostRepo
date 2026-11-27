# Implementation Tasks

## Tasks

- [x] **Task 1 — F1: Set executable bit**
  - Run `git update-index --chmod=+x resurrect`
  - Verify `git ls-tree HEAD resurrect` shows `100755`
  - Commit: `fix(cli): set resurrect executable bit in git index`

- [x] **Task 2 — F2: Update document status header**
  - Edit `docs/RESURRECT-CLI.md` header: replace "Design (pre-implementation)" with "Implemented (v1, merged via PR #2)"
  - Remove "Once approved, the technology stack and file structure described here are locked"
  - Commit: `docs(cli): update RESURRECT-CLI.md status to implemented`

- [x] **Task 3 — F3: Fix report signature + doc example**
  - Change `agent_signature` in `src/report.js` from `"Kiro Multi-Agent Orchestrator"` to `"GhostRepo resurrect CLI"`
  - Update §7 example in `docs/RESURRECT-CLI.md` to show `"GhostRepo resurrect CLI"`
  - Add one sentence to §7 explaining the value identifies the generating tool
  - Verify no existing test asserts the old string (search confirms none)
  - Commit: `fix(report): set honest agent_signature in buildReport`

- [x] **Task 4 — F4a–d: Correct doc-vs-code drift**
  - 4a: Update §5 and §11 to list the `.gitignore` entries added by PR #2
  - 4b: Replace invented skip-reason example with real `for-loop-init` / `loop-closure-capture` entry including `line` field
  - 4c: State sparse-checkout failure is fatal; remove fallback promise; note it as future work
  - 4d: Replace `git diff --shortstat` description with `lineDiffCount`; remove "git unavailable" row
  - Commit: `docs(cli): correct doc-vs-code drift (F4a-d)`

- [x] **Task 5 — F4e: Add pipeline integration test**
  - Create `test/pipeline.test.js`
  - Copy `fixtures/legacy-sample.js` to a temp dir, call `processTree`, assert all conditions in bugfix spec §2.9(a–f)
  - Clean up temp dirs after each test
  - Verify `fixtures/legacy-sample.js` is byte-identical before and after
  - Run `npm test` — all tests pass (existing 29 + new pipeline tests)
  - Commit: `test(pipeline): add integration test for processTree and run`

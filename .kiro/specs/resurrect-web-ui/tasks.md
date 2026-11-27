# Implementation Tasks

All tasks are complete. The web UI shipped and is live at https://luciod3v.github.io/GhostRepo/.

## Tasks

- [x] **Task 1 — Engine refactor: split pure logic from disk I/O**
  - Move filesystem access out of `src/engine.js` into `src/pipeline.js`
  - Add `processBytes()` to `src/engine.js` for in-memory callers
  - Confirm CLI behaviour and Gaia calculator result unchanged (29 patterns removed)
  - Requirement 10

- [x] **Task 2 — Build pipeline and browser shims**
  - Set up `scripts/build-web.mjs` with esbuild, content-hash URLs, and a node-import guard
  - Add `web/shims/` stubs for `assert`, `os`, `fs`, `path`, and `flow-parser`
  - Confirm bundle size ≤ 1 MB minified
  - Requirement 10

- [x] **Task 3 — GitHub API client and URL parser**
  - Implement `web/src/github-url.js` and `web/src/github.js`
  - Implement `web/src/assess.js` (file listing → verdict, language detection, suggestions)
  - Requirements 1, 2

- [x] **Task 4 — Web Worker and run orchestration**
  - Implement `web/src/worker.js`, `web/src/run-worker.js`, `web/src/run.js`
  - Requirements 3, 10

- [x] **Task 5 — Result views: diff, download, preview**
  - Implement `web/src/diff.js` (Myers diff, side-by-side, unified patch)
  - Implement `web/src/zip.js` (deterministic store-only ZIP)
  - Implement `web/src/preview.js` (sandboxed iframe, inline assets, error counting)
  - Implement `web/src/views.js`, `web/src/dom.js`, `web/src/result.js`, `web/src/artifacts.js`
  - Requirements 4, 5, 6, 7, 11, 13

- [x] **Task 6 — Pull request kit**
  - Implement `web/src/prkit.js` and `web/src/artifacts.js` PR body generation
  - Requirements 8

- [x] **Task 7 — Open pull request on GitHub (no-token path)**
  - Implement `web/src/pr-link.js` (prefilled GitHub compare URL)
  - Extend `prkit.js` to end the command list with `gh pr create`
  - Detect and surface archived repositories before any work
  - See `.kiro/specs/open-pull-request` for full requirements and design
  - Requirement 9

- [x] **Task 8 — UI controller and state machine**
  - Implement `web/src/main.js` (idle → assessing → assessed → running → result | error)
  - Requirements 1, 3, 4, 13

- [x] **Task 9 — CI/CD and public deployment**
  - Add `.github/workflows/pages.yml` (test + build on PR, deploy on push to main)
  - Requirement 12

- [x] **Task 10 — Tests**
  - Add `test/web-*.test.js` unit tests for every new web module
  - Add `scripts/e2e-web.mjs` (55 checks in real Chrome against real GitHub)
  - Confirm full suite passes: `npm test` (155 pass, 1 skipped) and `npm run e2e:web` (55/55)
  - Requirements 2.11, 5.4, 10.2, 10.3, 11

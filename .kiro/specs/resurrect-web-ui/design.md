# Design Document

## Overview

The web UI is a **static site that runs the real engine in the visitor's browser**. There is no server of ours: GitHub Pages serves the files, the browser reads the target repository from GitHub's anonymous API and `raw.githubusercontent.com`, runs the same `processFile()` the CLI runs, and renders the result.

This design answers the six decisions that the requirements left open. Each answer was checked by running code, not assumed.

## Decisions

### 1. Where the engine runs: in the browser

Checked on 2026-11-08 with a spike, then kept as tests:

- The engine bundles for a browser at **0.65 MB minified** (717 KB with the UI). `jscodeshift` and `recast` name four Node modules (`assert`, `os`, and `fs`/`path` through `flow-parser`) that never execute in a browser. They are replaced by shims in `web/shims/`; Flow is stubbed because the engine only uses the Babel parser. `scripts/build-web.mjs` fails if any `node:` import slips into the bundle.
- Chrome produced **byte-identical output to Node** for `calculator.js` and `parser.js` (code and counts, CRLF included).
- `api.github.com` answers with `Access-Control-Allow-Origin: *`; `raw.githubusercontent.com` too.

Consequence: GitHub Pages alone is enough. No `git`, no host to run, no abuse controls to build. Cost: public GitHub repositories only, and anonymous API limits (60 requests per hour per visitor; one analysis uses 2 API requests, file contents come from the raw host).

### 2. File listing: one request

`GET /repos/{o}/{r}/commits/{ref|HEAD}` pins a commit sha (and gives the last-commit date shown as evidence that a repository is dead). `GET /repos/{o}/{r}/git/trees/{sha}[:{folder}]?recursive=1` returns the listing of the whole repository, or of a folder using the `sha:path` form. The assessment (`web/src/assess.js`) works on that listing only. When GitHub reports `truncated`, the verdict is **Too large**; the suggested folders are then computed from the partial listing and labeled as such.

### 3. Live preview: one inlined document in a sandboxed iframe

`web/src/preview.js` turns the project's files into a single HTML string: stylesheets become `<style>` (with `url()` inlined as data URIs), scripts become inline `<script>` (with `defer`/`async` scripts moved to the end of `<body>` to keep their timing), images become data URIs. The document goes in an `iframe` with `sandbox="allow-scripts"` and no `allow-same-origin`, plus a CSP that blocks the network.

Verified in Chrome from inside the frame that runs repository code: the parent page, `localStorage`, cookies and the network are all **blocked**. Chrome runs such frames out of process.

Known limits, stated in the UI: ES modules are not resolved, the project runs offline, and apps that need platform APIs may not run fully.

### 4. Archive and patch: written here, no dependency

`web/src/zip.js` is a deterministic store-only ZIP writer (~100 lines, checked against `bsdtar` and an independent reader). `web/src/diff.js` is a Myers line diff that feeds both the side-by-side view and a unified patch. The patch is checked against real `git apply` on random LF/CRLF inputs, with and without a final newline.

### 5. One engine, two interfaces

The commit "refactor: split the pure engine from disk access" moved everything that touches the filesystem out of the pure modules:

| Module | Role | Imports from Node |
|---|---|---|
| `src/files.js` | which files are processed | none |
| `src/engine.js` | `processFile()`: one file through scan, exorcise, transmute, re-scan | none |
| `src/scan.js`, `exorcise.js`, `transmute.js`, `report.js` | codemods, counters, report | none |
| `src/walk.js`, `src/pipeline.js` | disk walker, git, output | `fs`, `path`, `os`, `child_process` |

The CLI calls `processFile()` per file on disk; the UI calls it per file from memory. Tests pin that both give the same report and byte-identical files (`test/web-run.test.js`, on a tree with CRLF, minified files, `node_modules/`, a syntax error and subfolders), and that the browser's file rule equals the disk walker's (`test/engine.test.js`). The CLI's report and resurrected tree for the Gaia calculator are byte-identical to before the refactor.

### 6. Report signature in the UI

`buildReport` takes `agentSignature`. The UI passes `"GhostRepo web UI"`; the CLI keeps `"GhostRepo resurrect CLI"`. Neither implies that an agent ran.

## Components

```
web/index.html, style.css        static shell
web/src/main.js                  controller: idle -> assessing -> assessed -> running -> result | error
web/src/views.js, dom.js         views; repository text only ever goes through textContent
web/src/github-url.js            requirement 1.2, 1.3
web/src/github.js                anonymous API client, typed errors (fetch is injected)
web/src/assess.js                requirement 2: verdict from the listing
web/src/run.js                   fetch -> processFile per file -> buildReport
web/src/diff.js, zip.js          side-by-side rows, unified patch, archive
web/src/prkit.js, artifacts.js   requirement 8
web/src/preview.js               requirement 6
scripts/build-web.mjs            esbuild -> dist/
scripts/serve-web.mjs            npm run web
scripts/e2e-web.mjs              real Chrome against real GitHub (not part of npm test)
.github/workflows/pages.yml      tests, build, deploy
```

## Safety

- Repository code is data. It is parsed and transformed, never executed, except inside the sandboxed preview after an explicit click.
- Repository strings are inserted with `textContent` or text nodes only. Nothing in `web/src` assigns to `innerHTML`, `outerHTML` or `insertAdjacentHTML`, and nothing calls `eval`, `new Function` or `document.write`. The only occurrences of those words are labels, a comment, and one read of `outerHTML` that serializes the preview document into the `srcdoc` string.
- Limits: 2,000 files and 25 MB per run (`LIMITS` in `assess.js`); `node_modules/` and `.git/` are never downloaded.
- A file that is not valid UTF-8 is left unchanged and listed as skipped, because decoding it would corrupt it on write-back. A UTF-8 byte order mark is preserved.
- No analytics, no third-party requests: only `api.github.com`, `raw.githubusercontent.com` and the host serving the page.

## Status against the requirements

| Requirement | Status |
|---|---|
| 1 Submit a repository | Done |
| 2 Assess before any work | Done |
| 3 Progress through the four phases | Done |
| 4 Honest result summary | Done |
| 5 Side-by-side code | Done |
| 6 Live run (sandboxed, original vs resurrected, error counts) | Done |
| 7 Download (zip, report, patch) | Done |
| 8 Pull request kit | Done |
| 9 Open the pull request from the UI | **Not built.** A browser-only site would need the user to paste an access token. It is deferred; the kit already covers the flow with no credentials. |
| 10 Same engine as the CLI | Done, with parity tests |
| 11 Safety and limits | Done |
| 12 Public availability | Workflow written and its YAML validated. The site is live only after the branch is merged and *Settings → Pages → Source: GitHub Actions* is set. |
| 13 Clear, accessible interface | Keyboard-operable tabs, labels, visible focus, a live region for status changes, and a 360 px layout (no horizontal scroll) checked in Chrome. All 18 text/background pairs used by the interface measure 7.52:1 or better (WCAG AA needs 4.5:1). A screen reader was not tested. |

## Verification

- `npm test`: unit and parity tests for every web module, run against real `git apply` and `bsdtar` where relevant.
- `npm run e2e:web`: 45 checks in a real Chrome against the real GitHub API, including pressing the calculator keys in both previews, the isolation probe, the PR kit text, the not-supported verdict on a Python project, the error cases and a 360 px viewport.

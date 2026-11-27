# GhostRepo – Project Structure

```
GhostRepo/
├── resurrect              # CLI entry point (Node script with a #!/usr/bin/env node shebang)
├── src/                   # Shared engine — used by both CLI and web worker
│   ├── engine.js          #   processFile() / processBytes(): scan → exorcise → transmute → re-scan (pure, no I/O)
│   ├── scan.js            #   countPatterns(): AST-based legacy pattern counter
│   ├── exorcise.js        #   innerHTML → textContent transform
│   ├── transmute.js       #   var → const/let and == → === transforms
│   ├── pipeline.js        #   CLI orchestration: clone, walk, transform, write, report
│   ├── walk.js            #   Filesystem traversal (CLI only)
│   ├── files.js           #   File-selection rule shared by CLI and web (pure: which .js files are eligible)
│   └── report.js          #   Assembles resurrection-report.json from measured inputs (pure)
├── web/                   # Web app (browser-only code)
│   ├── index.html         #   Single-page shell
│   ├── style.css          #   Styles
│   ├── src/
│   │   ├── main.js        #   UI controller and state machine (idle→assessing→running→result)
│   │   ├── worker.js      #   Web Worker entry point — runs the engine off the main thread
│   │   ├── github-url.js  #   GitHub URL parser
│   │   ├── github.js      #   GitHub API client (raw.githubusercontent / tree API)
│   │   ├── assess.js      #   Pre-download assessment from file listing
│   │   ├── diff.js        #   Myers line diff: side-by-side view and unified .patch
│   │   ├── preview.js     #   Sandboxed iframe runner
│   │   ├── zip.js         #   Zip generation (download)
│   │   ├── prkit.js       #   Pull request kit: branch, commands (ending in gh pr create), title, description
│   │   ├── pr-link.js     #   Prefilled GitHub compare link ("Open pull request on GitHub"), no login
│   │   ├── run.js         #   The resurrection run: fetch files, run the engine, build the report (no DOM)
│   │   ├── run-worker.js  #   Worker communication wrapper
│   │   ├── views.js       #   DOM rendering functions (uses dom.js)
│   │   ├── dom.js         #   h() hyperscript helper, clear()
│   │   ├── result.js      #   Result data helpers
│   │   └── artifacts.js   #   Patch / report artifact builder
│   └── shims/             #   Browser stubs for Node-only modules jscodeshift references
├── scripts/
│   ├── build-web.mjs      #   esbuild bundler → dist/
│   ├── serve-web.mjs      #   Local static server for dist/
│   ├── e2e-web.mjs        #   End-to-end test against real GitHub in Chrome
│   └── guard-legacy.js    #   Kiro Pre Tool Use hook: blocks agent writes to legacy/ and fixtures/
├── test/                  # node:test suites (glob: test/**/*.test.js)
│   ├── engine.test.js
│   ├── transforms.test.js
│   ├── pipeline.test.js
│   ├── cli.test.js
│   ├── guard-legacy.test.js
│   ├── zero-breaking-logic.test.js  # VM sandbox regression guard
│   └── web-*.test.js      #   Web-layer unit tests (assess, diff, github, preview, prkit, …)
├── fixtures/
│   └── legacy-sample.js   # Sample legacy JS used in tests
├── dist/                  # Build output (git-ignored, built in CI for GitHub Pages; do not edit by hand)
├── docs/
│   └── RESURRECT-CLI.md   # CLI design document
├── .github/
│   └── workflows/
│       └── pages.yml      # CI: test + build on PR, deploy to GitHub Pages on push to main
├── .kiro/                 # Kiro configuration
│   ├── steering/          #   product, tech, structure, architecture, zero-breaking-logic, web-security
│   ├── specs/             #   Kiro specs (bugfix and feature specs)
│   └── hooks/             #   Kiro agent hooks (.json)
├── package.json
├── package-lock.json
└── .gitignore
```

## Key architectural boundaries

- **`src/`** is pure logic — no DOM, no network, no filesystem access. Any code here must run in both Node and a browser Web Worker without modification.
- **`web/src/`** is browser-only. Never import Node built-ins here directly; use `web/shims/` for any that jscodeshift pulls in transitively.
- **`scripts/`** is Node-only build/dev tooling. Never imported by src or web.
- **`test/`** runs in Node via `node:test`. Web tests mock browser APIs; they do not run in a browser.
- **`dist/`** is generated — never edit files there manually.

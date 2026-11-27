# 👻 GhostRepo

> **Raise dead JavaScript repositories.** Paste a GitHub link to an abandoned web app. GhostRepo checks whether it can rise, rewrites legacy patterns with codemods that only touch what is provably safe, runs the original and the resurrected app side by side, and hands you a patch and a ready-to-paste pull request.

**▶ Try it: https://luciod3v.github.io/GhostRepo/**

Built with [Kiro](https://kiro.dev) for the **Kiroween Hackathon, category Resurrection**.

---

## 💀 The problem

The internet is a graveyard of abandoned code: apps deleted from their repositories, frameworks that died, projects archived and left read-only. Much of that code still holds working logic, but it is written in syntax and patterns that nobody wants to touch anymore.

Automatic "modernizers" usually promise too much, and nobody merges a rewrite they cannot trust.

**GhostRepo takes the opposite bet:** it changes only what it can prove is safe, lists everything it left alone and why, and measures every number it reports.

---

## 🌐 The web app

Open **https://luciod3v.github.io/GhostRepo/** and paste a public GitHub repository link (optionally a subfolder).

1. **Assessment.** From the file listing alone, before anything is downloaded, GhostRepo tells you whether the repository can be resurrected. A JavaScript web project can. A Python, Java or PHP project cannot, and it says why. An archived repository is named as read-only, because GitHub rejects pull requests to it; it can still be resurrected.
2. **Resurrection.** The files are fetched from GitHub and run through the engine in a background worker, so the page stays responsive and a new run cancels the old one.
3. **Results**, in tabs:
   - **Code:** the modified code next to the original, with every skipped site marked and explained.
   - **Run:** the original and the resurrected app running side by side in sandboxed frames (when the project has an `index.html`).
   - **Download:** the resurrected project as a zip, the JSON report, a `.patch` file and the pull request description.
   - **Pull request:** branch name, the exact commands, commit message, title and description, all generated from the measured report. The commands fork, push and end with `gh pr create`. Without the GitHub CLI, type your username and **Open pull request on GitHub** opens GitHub's own page with the title and description filled in.

Everything runs in your browser; no code is sent to a server of ours, and there is no login or token. GhostRepo never pushes anything or opens a pull request for you: it prepares everything, and you press the button.

**Limits.** Public GitHub repositories only. At most 2,000 files and 25 MB per run (pick a subfolder for bigger repositories). Links to branches whose name contains `/` are not supported yet. The preview frame cannot read the page or your data, and its network requests and navigations are blocked, but WebRTC is not: a server chosen by the previewed project could see your IP address. A very large unminified file (an 11,000-line jQuery, for example) takes a minute or more.

---

## 🔮 What the engine does

The engine ([src/engine.js](src/engine.js)) is the same code in the CLI and in the browser, built on [jscodeshift](https://github.com/facebook/jscodeshift) AST transforms. No regex rewrites.

| Phase | What happens |
|---|---|
| **1. Necromancy** (scan) | Finds the JavaScript files and counts five legacy patterns on the AST: `var`, loose `==`, `innerHTML`, vendor-prefixed APIs (`MozTransform`, …) and ES5 `.prototype` assignments. |
| **2. Exorcism** | `el.innerHTML = 'plain text'` → `el.textContent = 'plain text'`. Assignments with HTML markup or dynamic values are left alone and flagged. |
| **3. Transmutation** | `var` → `const` (never reassigned) or `let`. `==` / `!=` → `===` / `!==` only when both sides are known to have the same type. |
| **4. Resurrection** | Measures the code again with the same counter and writes a report: files scanned, transformed and skipped, lines changed, patterns before and after, and every skipped site with its reason. |

### ✅ Rewritten today

- `var` → `const` / `let`, when the scoping is provably unchanged
- `==` → `===` and `!=` → `!==`, when both operand types are known
- `innerHTML` with a plain-text string → `textContent`

### 🔎 Reported, never rewritten

- Vendor-prefixed and deprecated DOM APIs
- ES5 `.prototype` patterns
- `innerHTML` with markup or dynamic values
- Loose equality whose operand types are unknown

### 🪦 Not done (yet)

- ES modules, `class` conversion, arrow functions, `async`/`await`
- Languages other than JavaScript (detected and explained, not modified)
- Running the repository's own tests: review the diff before you merge

### 🛡️ Zero Breaking Logic

A rewrite is applied only when the syntax proves the behavior stays the same. Anything else is left as it was and listed with its line and reason. [test/zero-breaking-logic.test.js](test/zero-breaking-logic.test.js) runs the original and the transformed code of real legacy patterns in a fresh VM over the same inputs and requires identical results, exceptions included.

Files that are not valid UTF-8, or that the parser rejects, are skipped and listed, never silently dropped or rewritten.

---

## 🪦 Showcase: the Firefox OS Calculator

The Calculator app from Gaia, the HTML5 interface of Mozilla's Firefox OS, is *doubly dead*:

1. It was **deleted** from Gaia on 2012-12-27 (commit `53dd83d7`, *"Bug 822565 - Remove the calculator app"*).
2. The whole [`mozilla-b2g/gaia`](https://github.com/mozilla-b2g/gaia) repository was **archived (read-only) on 2021-11-03** when Mozilla discontinued Firefox OS.

The original source, recovered unchanged from gaia's last living commit [`7378e497d0`](https://github.com/mozilla-b2g/gaia/commit/7378e497d0), lives in the `legacy/` folder of [LucioD3v/ghostrepo-gaia-calculator](https://github.com/LucioD3v/ghostrepo-gaia-calculator). It is the first example on the web app.

Measured by the engine (the web app and the CLI give the same numbers):

| Metric | Value |
|---|---|
| Files scanned | 5 |
| Files transformed | 2 (`calculator.js`, `parser.js`) |
| Files skipped | 2 (test files the parser rejects, listed with the reason) |
| Lines changed | 58 |
| Legacy patterns removed | 29 (28 `var`, 1 `innerHTML`) |

The calculator's loose equalities and vendor-prefixed APIs are reported, not rewritten, because their safety cannot be proven from the syntax.

> The `src/` folder of that repository is an earlier hand-made resurrection, done before the engine existed, that goes further (modules, classes). Its figures are not GhostRepo output.

> **Provenance and license:** the calculator is Mozilla code under the **Apache License 2.0** (Copyright 2012, Mozilla Foundation) and keeps that license in its own repository.

---

## 🔁 The CLI

The same engine runs from the command line against a Git repository URL or a local folder:

```bash
npm ci
node resurrect <repo-url-or-path> [--path <subfolder>]

# The showcase
node resurrect https://github.com/LucioD3v/ghostrepo-gaia-calculator --path legacy
```

On macOS and Linux `./resurrect` works too. The CLI works on a shallow clone (or a copy of the local folder), rewrites its files and writes `resurrection-report.json`. The full design is in [docs/RESURRECT-CLI.md](docs/RESURRECT-CLI.md).

---

## 🧪 Development

```bash
npm ci
npm test             # unit and integration tests (node:test)
npm run web          # builds dist/ and serves http://localhost:8080
npm run e2e:web      # end-to-end check in a real Chrome, against GitHub (needs Chrome and network)
```

**Deploying.** [.github/workflows/pages.yml](.github/workflows/pages.yml) runs the tests and the build on every pull request, and publishes `dist/` to GitHub Pages on every push to `main`. One-time setup: *Settings → Pages → Source: GitHub Actions*.

## 👻 Built with Kiro

The `.kiro/` folder holds how the project is steered, specified and guarded:

- **Steering** ([.kiro/steering/](.kiro/steering/)): `product`, `tech` and `structure` (generated with Kiro's *Generate Steering Docs*, then corrected against the code), `architecture` (always included), `zero-breaking-logic` (included for `src/` and `test/`: the exact skip rules every rewrite must respect) and `web-security` (included for `web/`: text-only DOM insertion, no repository text in shell commands, the preview sandbox).
- **Specs** ([.kiro/specs/](.kiro/specs/)): two bugfix specs for the CLI review findings, the `resurrect-web-ui` feature spec behind the web app, and `open-pull-request` (requirements → design → tasks, committed before its code) for the one-click pull request and archived-repository detection.
- **Hooks** ([.kiro/hooks/](.kiro/hooks/)): `zero-breaking-logic-tests` runs `npm test` when the agent saves engine or test code; `web-build-check` rebuilds the bundles when web code changes; `guard-legacy-sources` blocks any agent write to a `legacy/` folder or `fixtures/` ([scripts/guard-legacy.js](scripts/guard-legacy.js)), because recovered code is the evidence every resurrection is measured against; `transform-safety-review` reviews the session's changes against the steering rules when the agent stops.

## 🏗️ Project structure

```
GhostRepo/
├── resurrect              # CLI entry point
├── src/                   # the engine, shared by the CLI and the web app
│   ├── engine.js          #   one file in, transformed file and metrics out
│   ├── scan.js            #   Necromancy: AST pattern counter
│   ├── exorcise.js        #   Exorcism: innerHTML → textContent
│   ├── transmute.js       #   Transmutation: var → const/let, == → ===
│   ├── pipeline.js        #   CLI pipeline: clone, walk, transform, report
│   └── files.js, walk.js, report.js
├── web/                   # the web app
│   ├── index.html, style.css
│   ├── src/               #   GitHub client, assessment, worker, diff, preview, zip, PR kit and link
│   └── shims/             #   tiny stand-ins for Node modules the bundle never runs
├── scripts/               # build-web, serve-web, e2e-web, guard-legacy (Kiro hook)
├── test/                  # node:test suites
├── fixtures/              # legacy-sample.js
├── docs/RESURRECT-CLI.md  # CLI design document
└── .kiro/                 # Kiro steering, specs and hooks
```

---

## 📜 License

GhostRepo is released under the [MIT License](LICENSE). Resurrected projects keep their **original upstream license**.

---

## 🏆 About

Developed by **Vicente Guzmán** and **Silvestre** for the **Kiroween Hackathon (Resurrection)**.
Scan the dead. Banish the bugs. Bring the code back to life. 👻

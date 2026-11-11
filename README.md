# 👻 GhostRepo

> **Resurrect abandoned codebases.** GhostRepo scans dead repos, banishes legacy bugs with Kiro agents, and automates modern refactoring so your forgotten projects live again.

Built with [Kiro](https://kiro.dev) for the **Kiroween Hackathon — Category: Resurrection**.

---

## 💀 The problem

The internet is a graveyard of abandoned code. Apps that were deleted, frameworks that died, repositories archived and left read-only. That code still holds working logic — it's just trapped in dead syntax, insecure patterns, and APIs that no longer exist.

**GhostRepo brings it back to life.** It's a Kiro multi-agent orchestrator that takes a legacy web project and resurrects it as modern, maintainable, production-ready code — without breaking what the original app actually did.

---

## 🔮 How it works — the Resurrection Pipeline

GhostRepo runs a 4-phase pipeline (defined in [`.kiro/specs/resurrect-pipeline.yaml`](.kiro/specs/resurrect-pipeline.yaml)):

| Phase | Name | What happens |
|-------|------|--------------|
| **1. Necromancy** | Pulse Check & Entropy Scan | Scan the target repo. Locate zombie code, deprecated APIs, and technical debt — reported with **real evidence**, never guesses. |
| **2. Exorcism** | Bug & Vulnerability Banishment | The **Exorcist** agent removes security smells (unsafe `innerHTML`) and dead/deprecated APIs (vendor-prefixed calls like `MozTransform`). |
| **3. Transmutation** | Modern Refactoring | The **Alchemist** agent rewrites legacy patterns into modern ones: ES6+ modules, `class`, `const`/`let`, strict equality, real `Error` handling, modern events. |
| **4. Resurrection** | Report & Pull Request | Generate a **Resurrection Report** with real metrics from the actual `git diff`, then open a clean, reviewable pull request. |

### 🧙 The agents

- **Exorcist** — banishes security vulnerabilities, deprecated DOM/vendor APIs, and dangerous syntax.
- **Alchemist** — transmutes legacy paradigms (callback hell, ES5, global objects) into modern, modular architecture.

### 🛡️ Core guardrail — Zero Breaking Logic

Every automated refactor **must preserve the original business logic**. A resurrected calculator must still calculate exactly the same results. Transformations ship as clean, reviewable, atomic pull requests.

---

## 🌐 Try it in your browser

**Live: https://luciod3v.github.io/GhostRepo/** (served by GitHub Pages from `main`; see "Deploying" below).

Paste the URL of a dead GitHub repository. GhostRepo first **assesses** it from the file listing and tells you whether it can be resurrected (a web project with JavaScript: yes; a Python project: no, and it says why). If it can, you get:

- the **modified code next to the original**, with every skipped site marked and explained;
- a **live run** of the resurrected project in an isolated frame, next to the original, so you can compare them;
- a **download** of the resurrected project, the report and a patch;
- a **pull request kit**: branch name, commands, commit message, title and a description generated only from the measured report.

Everything runs in your browser. It uses the same engine as the CLI, so the numbers are the same (the Firefox OS calculator gives 29 patterns removed in both). It does not run the repository's own tests, and it never pushes anything.

Limits: public GitHub repositories only, JavaScript/web code only, at most 2,000 files and 25 MB per run (select a subfolder for bigger repositories). The live run is offline and sandboxed, and needs an `index.html`.

```bash
npm ci
npm run web          # builds dist/ and serves http://localhost:8080
npm run e2e:web      # end-to-end check in a real Chrome, against GitHub (needs Chrome and network)
```

**Deploying.** `.github/workflows/pages.yml` runs the tests, builds `dist/` and publishes it on every push to `main`. One-time setup: *Settings → Pages → Source: GitHub Actions*.

---

## 🔁 Resurrect your own dead code

GhostRepo is **not hardcoded to one project**. Point it at any legacy web repo:

```bash
# Resurrect any JavaScript / web project
./resurrect <repo-url> [--path <subfolder>]

# The showcase example (see below):
./resurrect https://github.com/mozilla-b2g/gaia --path apps/calculator
```

### v1 scope — JavaScript / Web Legacy

GhostRepo v1 focuses on front-end web code, and it's **honest about its limits**:

- ✅ `var` → `const` / `let`
- ✅ ES5 → ES6+ (modules, `class`, arrow functions)
- ✅ Unsafe `innerHTML` → safe DOM APIs
- ✅ Deprecated DOM / vendor-prefixed APIs
- ✅ Loose equality (`==`) → strict (`===`)
- ✅ Callback hell → `async` / `await`

It does **not** claim to modernize every language. Keeping v1 scoped to web code is what makes the resurrection reliable and reproducible.

---

## 🪦 Showcase: resurrecting the Firefox OS Calculator

The flagship demo revives the **Calculator app from Gaia**, the HTML5 UI of Mozilla's Firefox OS. It's *doubly dead*:

1. The app was **deleted** from Gaia on 2012-12-27 (commit `53dd83d7`, *"Bug 822565 - Remove the calculator app"*).
2. The whole [`mozilla-b2g/gaia`](https://github.com/mozilla-b2g/gaia) repo was **archived (read-only) on 2021-11-03** when Mozilla discontinued Firefox OS.

GhostRepo recovers the original source from the last living commit [`7378e497d0`](https://github.com/mozilla-b2g/gaia/commit/7378e497d0) and resurrects it as a modern web app.

➡️ **See the resurrected result:** [LucioD3v/ghostrepo-gaia-calculator](https://github.com/LucioD3v/ghostrepo-gaia-calculator)

### 📊 Real resurrection metrics

Measured from the actual `legacy/` → `src/` diff and test run (not hardcoded):

| Metric | Value |
|--------|-------|
| Lines modernized | **777** |
| Legacy patterns removed | **63** (`var`→`const`/`let`, unsafe `innerHTML`, dead `MozTransform`, loose `==`) |
| Zero-Breaking-Logic tests | **20 / 20 passing** |

> **Provenance & license:** the original calculator is Mozilla code under the **Apache License 2.0** (Copyright 2012, Mozilla Foundation). GhostRepo preserves attribution and documents every change so the resurrection is fully traceable.

---

## 🏗️ Project structure

```
GhostRepo/
├── README.md                          # you are here
├── LICENSE                            # MIT
└── .kiro/
    ├── specs/
    │   └── resurrect-pipeline.yaml     # the 4-phase pipeline definition
    ├── steering/
    │   └── architecture.md             # agent steering & architecture guide
    └── hooks/
        └── post-analysis.sh            # generates the Resurrection Report (real git-diff metrics)
```

> ⚠️ **Hackathon work in progress.** The pipeline definition, steering guide, and post-analysis hook are in place. The agent execution and the `resurrect` entry-point script are being built as part of the demo.

---

## 📜 License

GhostRepo is released under the [MIT License](LICENSE).

Resurrected projects keep their **original upstream license**. For example, the Firefox OS Calculator showcase remains under the Apache License 2.0 (Copyright 2012, Mozilla Foundation) in its own repository.

---

## 🏆 About

GhostRepo — a Kiro Multi-Agent Orchestrator for the **Kiroween Hackathon (Resurrection)**.
Scan the dead. Banish the bugs. Bring the code back to life. 👻🚀

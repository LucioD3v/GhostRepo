# GhostRepo – Product Summary

GhostRepo is a JavaScript legacy-code resurrection tool built for the **Kiroween Hackathon (Resurrection category)**. It takes an abandoned or legacy JavaScript web repository (via GitHub URL or local path) and safely modernizes it using AST-based codemods — no regex rewrites, no guessing.

## Core value proposition

- Only transforms what can be **proven safe** from the syntax.
- Leaves everything else untouched and **lists every skipped site with its reason**.
- Reports real, measured numbers (files scanned/transformed/skipped, lines changed, patterns before/after).
- Produces a `.patch` file and a ready-to-paste pull request description.
- Runs entirely in the browser (web app) or from the command line (CLI) — no code is sent to any server.

## Two surfaces

1. **Web app** – hosted at https://luciod3v.github.io/GhostRepo/. The user pastes a public GitHub URL; assessment, resurrection, diff, side-by-side preview, download (zip + patch), and PR generation all happen in the browser via a background worker.
2. **CLI** (`node resurrect <repo-url-or-path>`) – same engine, works on a shallow clone or local folder, writes `resurrection-report.json`.

## Supported transforms (today)

- `var` → `const` or `let` (when scoping is provably unchanged)
- `==` / `!=` → `===` / `!==` (when both operand types are known)
- `innerHTML = 'plain text'` → `textContent = 'plain text'`

Vendor-prefixed APIs, ES5 `.prototype` patterns, and unsafe `innerHTML` are **reported, never rewritten**.

## Not in scope

- Non-JavaScript projects (Python, Java, PHP, etc.) are detected and rejected with an explanation.
- ES modules, `class` conversion, arrow functions, `async`/`await` — not implemented; would require proof of safety that is not yet built.
- The tool never pushes to GitHub automatically; it generates the commands and PR text for the user to run.

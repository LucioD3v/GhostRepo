---
inclusion: always
---

# GhostRepo – Tech Stack

## Runtime & language

- **Node.js ≥ 20** required (uses `node:test`, native ESM, `node:vm`)
- All source files use **ES modules** (`"type": "module"` in `package.json`)
- No TypeScript — plain JavaScript throughout

## Key dependencies

| Package | Role |
|---|---|
| `jscodeshift` 17.4.0 | AST transforms (powered by `recast` + `ast-types`) |
| `esbuild` 0.28.2 | Bundles the web app into `dist/` |

No other runtime dependencies. The browser bundle uses tiny shims in `web/shims/` for Node modules that jscodeshift names but never executes in a browser.

## Test framework

- Built-in **`node:test`** runner (no Jest, no Mocha)
- Test files follow the glob `test/**/*.test.js`
- `test/zero-breaking-logic.test.js` runs original and transformed code in a `node:vm` sandbox and asserts identical results — this is the primary safety regression guard

## Common commands

```bash
# Install dependencies (use ci, not install, to match the lockfile)
npm ci

# Run all unit and integration tests
npm test

# Build dist/ and serve the web app at http://localhost:8080
npm run web

# Build dist/ only
npm run build:web

# End-to-end check in real Chrome against GitHub (requires Chrome + network)
npm run e2e:web

# CLI usage
node resurrect <github-url-or-local-path> [--path <subfolder>]
```

## Build output

`scripts/build-web.mjs` uses esbuild to produce two bundles in `dist/`:
- `app.js` — the page controller
- `worker.js` — the resurrection engine running in a Web Worker

The build appends a content hash to the URLs of `style.css`, `app.js` and `worker.js` (`?v=<hash>`) so browsers never mix an old file with a new page. `dist/` is regenerated on every build (the script deletes and recreates it) and is **not** committed: it is in `.gitignore`, and the Pages workflow builds it in CI.

## CI / deployment

`.github/workflows/pages.yml` runs tests and build on every PR, and publishes `dist/` to GitHub Pages on every push to `main`.

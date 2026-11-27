---
inclusion: fileMatch
fileMatchPattern: ["web/**"]
---

# Web App Security Rules

The web app runs entirely in the visitor's browser. Repository-controlled content is data — it is parsed and transformed, never trusted as markup or code, except inside the explicitly sandboxed preview after a user click.

## DOM insertion

Repository-controlled strings (file contents, paths, owner/repo names, commit messages, PR text) are inserted into the page using **`textContent` or text nodes only**. Never use:

- `innerHTML`, `outerHTML`, `insertAdjacentHTML`
- `eval`, `new Function`
- `document.write`, `document.writeln`

The only permitted occurrence of `outerHTML` is reading it to serialize the preview document into an `srcdoc` attribute (not writing it to the live DOM with untrusted content).

## Pull request kit (`web/src/prkit.js`)

The shell commands and PR description shown to the user are assembled from fixed template strings. Repository-controlled values that enter those strings must be validated before use:

- `owner` and `repo` — validated against a safe identifier pattern (no shell metacharacters).
- `commit` — must be a 40-character lowercase hex SHA. Reject anything else.
- Branch name — fixed text plus a date (`ghostrepo/resurrect-js-YYYYMMDD`), never repository-controlled. Any other repository-controlled value (for example a default branch name) must match a conservative safe pattern before it enters a command, or be left out.

Nothing from repository file contents may appear in the shell command strings.

## Preview (`web/src/preview.js`)

The live preview runs in a `<iframe>` with:
- `sandbox="allow-scripts"` and **no** `allow-same-origin` — the frame cannot access the parent page, `localStorage`, or cookies.
- The frame document is set via `srcdoc`; no network request is made to load it.
- A CSP `<meta>` injected into the preview document (`default-src 'none'`, `connect-src 'none'`, only inline scripts and styles and `data:`/`blob:` media) blocks its network requests.
- The outer page keeps `frame-src 'none'` in its own CSP. `srcdoc` is not restricted by `frame-src`, but any attempt by the previewed code to navigate its frame to another site is.

Known limit: WebRTC is not covered by CSP, so a server chosen by the previewed project could see the visitor's IP address. The UI says so.

## Network access

The only external hosts the page contacts are:

- `api.github.com` — repository tree and commit metadata
- `raw.githubusercontent.com` — file contents
- The page host itself (GitHub Pages)

No analytics, no tracking pixels, no third-party scripts. No user tokens or credentials are ever collected or stored.

## Limits and abuse controls

Enforced in `web/src/assess.js` (`LIMITS`):
- At most **2,000 files** per run.
- At most **25 MB** total per run.
- `node_modules/` and `.git/` are never downloaded.
- When GitHub reports `truncated` on a tree listing, the verdict is **Too large** and the run is refused.

Public GitHub repositories only. The anonymous GitHub API rate limit (60 requests/hour/visitor) is a natural ceiling on run frequency; no server-side rate limiting is needed.

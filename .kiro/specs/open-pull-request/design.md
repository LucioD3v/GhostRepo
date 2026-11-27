# Design Document

## Overview

Three small changes to the web app, all browser-only and credential-free:

1. **Repository metadata** is read once per analysis (`GET /repos/{owner}/{repo}`) and carried on the analysis `target` as `archived` and `defaultBranch`.
2. **The kit** (`buildPrKit`) knows whether the repository is archived. It then either stops at `git push` to the fork, or ends with a `gh pr create` command that reads the description from a file.
3. **A compare link** is built by a new pure module, `web/src/pr-link.js`, from the user's GitHub username, which is typed in the "Pull request" tab and used only in that link.

Nothing here touches the engine (`src/`), so the CLI and the Gaia calculator numbers are unchanged.

## Data flow

```
analyze(parsed)                                   web/src/main.js
  client.getRepository({owner, repo})  ──► { archived, defaultBranch }   (new, 1 request)
  client.resolveCommit(...)            ──► commit
  client.listFiles(...)                ──► listing
  target = { ..., archived, defaultBranch }
  renderAssessment({ target, ... })    ──► "Archived on GitHub" detail when archived

showResult → ctx = { ..., archived, defaultBranch }
  renderPrTab(result, ctx)
    buildKit → buildPrKit({ ..., archived, bodyFileName })
    archived?  explanation + commands up to git push
    otherwise  commands + gh pr create, username field → buildCompareLink(...)
  renderDownloadTab → adds ghostrepo-pull-request.md
```

## Components

### `web/src/github.js`: `getRepository({ owner, repo }, opts)`

Returns `{ archived: boolean, defaultBranch: string | null }`. A 404 throws the existing `not-found-or-private` `GitHubError` (same message as `resolveCommit`), so `analyze` stops before requesting the commit (Req 1.4). Rate limits and network errors keep going through `request()`. `defaultBranch` is `null` when the field is missing or not a non-empty string.

The 404 fallback inside `resolveCommit` (which reads `/repos/...` to tell a missing ref from a missing repository) stays: it only runs on the error path, so a successful analysis makes three API requests instead of two (Req 1.5).

### `web/src/prkit.js`: `buildPrKit({ ..., archived = false, bodyFileName })`

- The description, title and commit message do not change.
- `commands` is unchanged up to `git push -u origin {branch}`.
- When `archived` is false, one command is appended:
  `gh pr create --repo {owner}/{repo} --title "{title}" --body-file ../{bodyFileName}`.
  After `git push -u origin {branch}` the branch tracks the fork, so `gh` uses the fork's branch as the head and the repository's default branch as the base. No base branch is named (Req 3.3). `owner` and `repo` are already restricted to `[A-Za-z0-9_.-]` by `parseRepoInput`; the title is built from fixed strings and numbers and is escaped exactly as in the `git commit` command.
- The returned kit gains `archived` and `bodyFileName`.

### `web/src/artifacts.js`

`PR_BODY_FILE_NAME = 'ghostrepo-pull-request.md'`. `buildKit` passes it and `archived` through.

### `web/src/pr-link.js` (new, pure)

```js
export const MAX_LINK_LENGTH = 8000;
export function isValidGitHubUsername(name)   // /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
export function buildCompareLink({ owner, repo, base, user, branch, title, body, maxLength })
  // → { url, shortened } | null   (null when user is invalid or base is missing)
```

- Path: `/{owner}/{repo}/compare/{base}...{user}:{branch}`. `base` and `branch` are encoded per `/`-separated segment with `encodeURIComponent`, so a slash stays a slash (GitHub branch names, and GhostRepo's own `ghostrepo/resurrect-js-…`, contain slashes) and every other character is escaped.
- Query: `quick_pull=1&title=…&body=…`, built with `URLSearchParams`.
- Shortening (Req 4.4): when the URL is longer than `maxLength`, whole lines are dropped from the end of the body and a note is appended: `_The description was shortened to fit in a link. The full text is in GhostRepo's Pull request tab and in ghostrepo-pull-request.md._` The loop keeps the longest prefix of lines that fits; `shortened` is then `true`.

The 8,000-character cap stays under the URL sizes GitHub and browsers accept. The Gaia calculator's description fits without shortening.

### `web/src/views.js`

- `renderAssessment`: when `target.archived`, a detail line: *"Archived on GitHub: the repository is read-only and cannot receive pull requests. You can still resurrect it, download the result, or push it to your fork."*
- `renderPrTab(result, ctx)`:
  - Archived: a notice explaining Req 2.1; the step list ends at pushing to the fork; no `gh pr create`, no username field.
  - Not archived: steps say to download the patch **and** the description file into one empty folder; the last command is `gh pr create`; a "Without the GitHub CLI" block holds a labelled username input and an `<a>` that is `aria-disabled="true"` with no `href` until the username is valid, then gets the compare link (`target="_blank"`, `rel="noopener noreferrer"`). A note says the link only opens GitHub's page, the branch must be pushed first, and GhostRepo does not create the pull request. When the description was shortened, the note says so.
  - A "⬇ Download ghostrepo-pull-request.md" button next to the patch button.
- `renderDownloadTab`: a fourth card, "Pull request description".

All text goes through `h()` (text nodes and attributes), as the rest of `views.js`.

## Error handling

| Case | Behavior |
|---|---|
| Metadata 404 | "not found or private" error card, no further requests |
| Metadata rate-limited / network | existing error cards |
| `default_branch` missing | kit and `gh pr create` as usual; no compare link, with a note |
| Invalid username | link stays disabled; the field is marked `aria-invalid="true"` |

## Testing strategy

- `test/web-github.test.js`: archived, not archived, missing `default_branch`, 404 → `not-found-or-private`.
- `test/web-prkit.test.js`: archived kit ends with `git push`; the non-archived kit ends with the exact `gh pr create` command; the body never appears in a command; hostile owner/repo strings still never reach a command.
- `test/web-pr-link.test.js` (new): username rule (valid, too long, leading/trailing/double hyphen, symbols); compare link path and query; slash-preserving encoding of a hostile branch name; shortening at a line boundary with the note, and `shortened` flag; `null` without a base or with an invalid user.
- `scripts/e2e-web.mjs`: the calculator kit ends with `gh pr create`; typing a valid username yields a compare link to `LucioD3v/ghostrepo-gaia-calculator/compare/main...{user}:ghostrepo/resurrect-js-…` with `quick_pull=1`; an invalid one yields no `href`; four downloads; `mozilla-b2g/gaia` shows the archived line.

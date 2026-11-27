# Implementation Plan

## Overview

Build the feature in `design.md` in small, test-first steps. Only `web/` and `test/` (plus `scripts/e2e-web.mjs`) change; `src/` does not, so the engine and the Gaia calculator numbers stay as they are.

## Task Dependency Graph

```
1 (getRepository)      2 (pr-link.js)      3 (kit: archived + gh pr create)
        │                     │                         │
        ▼                     │                         ▼
4 (analysis carries metadata; archived line in the assessment)
        └──────────────┬──────┴─────────────────────────┘
                       ▼
5 (Pull request and Download tabs)
                       ▼
6 (e2e checks)  ──►  7 (checkpoint and spec status)
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"] },
    { "wave": 2, "tasks": ["4"] },
    { "wave": 3, "tasks": ["5"] },
    { "wave": 4, "tasks": ["6"] },
    { "wave": 5, "tasks": ["7"] }
  ]
}
```

## Tasks

- [x] 1. Read the repository metadata
  - Add `getRepository({ owner, repo }, opts)` to `web/src/github.js`, returning `{ archived, defaultBranch }`; a 404 throws `not-found-or-private`
  - Tests in `test/web-github.test.js`: archived, not archived, missing `default_branch`, 404
  - _Requirements: 1.1, 1.4_

- [x] 2. Build the compare link
  - Create `web/src/pr-link.js` with `isValidGitHubUsername`, `buildCompareLink` and `MAX_LINK_LENGTH`
  - Create `test/web-pr-link.test.js`: the username rule, the path and query, slash-preserving encoding of a hostile branch name, shortening at a line boundary with the note, `null` without a base or with an invalid username
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 5.2_

- [x] 3. Teach the kit about archived repositories and `gh pr create`
  - `buildPrKit` takes `archived` and `bodyFileName`; append `gh pr create --repo {owner}/{repo} --title "…" --body-file ../{bodyFileName}` only when not archived
  - `web/src/artifacts.js`: `PR_BODY_FILE_NAME = 'ghostrepo-pull-request.md'`, passed through `buildKit`
  - Tests in `test/web-prkit.test.js`: the archived kit ends with `git push`; the exact last command; the body is never in a command; hostile names still never reach a command
  - _Requirements: 2.2, 3.1, 3.2, 3.3_

- [x] 4. Carry the metadata through the analysis
  - `web/src/main.js`: call `getRepository` before `resolveCommit`; put `archived` and `defaultBranch` on `target` and on the result context
  - `renderAssessment`: the "Archived on GitHub" detail line; the Resurrect button is unchanged
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 5. Pull request and Download tabs
  - Archived: the read-only notice and the steps up to pushing to the fork
  - Not archived: the steps name both downloads; the username field and the "Open pull request on GitHub" link, disabled until the username is valid; the honesty note; the shortened-description note
  - "Download ghostrepo-pull-request.md" in the Pull request tab, and a fourth card in the Download tab
  - _Requirements: 2.1, 3.4, 3.5, 4.1, 4.6, 4.7, 5.1, 5.3, 5.4_

- [x] 6. End-to-end checks
  - `scripts/e2e-web.mjs`: the kit ends with `gh pr create`; a valid username gives the compare link with `quick_pull=1`; an invalid one gives no `href`; four downloads; `mozilla-b2g/gaia` is reported as archived
  - _Requirements: 6.2_

- [x] 7. Checkpoint
  - `npm test` and `npm run e2e:web` pass; the calculator still gives 29 patterns removed in 2 of 5 files
  - Mark Requirement 9 of `.kiro/specs/resurrect-web-ui/` as done in its design, with a pointer to this spec
  - _Requirements: 6.1, 6.3_

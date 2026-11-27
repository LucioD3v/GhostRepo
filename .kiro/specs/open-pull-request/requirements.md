# Requirements Document

## Introduction

The web app ends a resurrection with a pull request kit (`web/src/prkit.js`, the "Pull request" tab): a branch name, the git commands, a commit message, a title and a description. Today the kit stops at `git push`. The user must then find the right page on GitHub and paste the title and the description by hand.

Requirement 9 of `.kiro/specs/resurrect-web-ui/requirements.md` ("Open the pull request from the UI") is marked **Not built** in that spec's design, because opening a pull request through the API needs an access token, and a browser-only site should not ask for one.

This feature closes the gap **without any login or token**. GitHub can open a pull request in two ways that need no credentials from GhostRepo: the GitHub CLI on the user's machine (`gh pr create`), and GitHub's own compare page, which accepts a title and a body in its URL. It also tells the user, before any work, when a repository is archived: GitHub rejects pull requests to archived repositories, and many dead repositories are archived (`mozilla-b2g/gaia`, for example).

The feature must respect `.kiro/steering/web-security.md` and `.kiro/steering/architecture.md`: repository-controlled text never enters a shell command, nothing is sent anywhere until the user clicks, and the UI never claims that a pull request was created.

**Out of scope:** OAuth or any login; creating pull requests or forks through the API; private repositories; checking that the user's fork or branch exists.

**Reference inputs:**

- `LucioD3v/ghostrepo-gaia-calculator/legacy`, which is not archived and is resurrected with 29 patterns removed.
- `mozilla-b2g/gaia`, which is archived.

## Glossary

- **Repository metadata**: the answer of `GET https://api.github.com/repos/{owner}/{repo}`, of which this feature uses `archived` and `default_branch`.
- **Compare link**: `https://github.com/{owner}/{repo}/compare/{base}...{user}:{branch}?quick_pull=1&title=…&body=…`, the GitHub page that opens a new pull request from `{user}`'s fork with the fields filled in.

## Requirements

### Requirement 1: Archived repositories are named before any work

**User Story:** As a judge or developer, I want to know right away when a repository is archived, so that I do not prepare a pull request GitHub will reject.

#### Acceptance Criteria

1. WHEN the user submits a repository, THE UI SHALL read the repository metadata once per analysis, before the file listing.
2. WHEN the repository is archived, THE assessment SHALL say that it is archived and read-only on GitHub, that it cannot receive pull requests, and that it can still be resurrected, downloaded and pushed to a fork.
3. WHEN the repository is archived, THE resurrection SHALL remain available exactly as for a repository that is not archived.
4. WHEN the repository metadata answers 404, THE UI SHALL show the existing "not found or private" message and SHALL NOT request the commit or the listing.
5. THE number of GitHub API requests for a successful analysis SHALL grow by at most one.

### Requirement 2: Pull request kit for an archived repository

**User Story:** As a developer who resurrected an archived repository, I want the kit to tell me what is possible, so that I am not sent to a pull request that cannot exist.

#### Acceptance Criteria

1. WHEN the repository is archived, THE "Pull request" tab SHALL explain that the original repository is read-only and that the resurrection can be pushed to the user's fork, downloaded as a zip, or applied as a patch.
2. WHEN the repository is archived, THE kit SHALL keep the commands up to `git push` to the fork and SHALL NOT offer the `gh pr create` command or the compare link.

### Requirement 3: One command to open the pull request with the GitHub CLI

**User Story:** As a developer who uses the GitHub CLI, I want the kit to end with the command that opens the pull request, so that the whole flow is copy and paste.

#### Acceptance Criteria

1. WHEN the repository is not archived, THE kit commands SHALL end with one non-interactive `gh pr create` command that targets the original repository (`--repo {owner}/{repo}`) with the generated title and reads the description from a file next to the clone (`--body-file ../ghostrepo-pull-request.md`).
2. THE description SHALL NOT be inlined in any command. THE title SHALL be inlined only because it is built from fixed text and measured numbers.
3. THE command SHALL NOT name a base branch: `gh` targets the repository's default branch by default, and a branch name is repository-controlled.
4. THE "Pull request" tab and the "Download" tab SHALL offer the description file `ghostrepo-pull-request.md`, whose content is exactly the description shown in the kit.
5. THE step list SHALL tell the user to download the patch and the description file into the same empty folder before running the commands.

### Requirement 4: One click to open the pull request on GitHub, without the CLI

**User Story:** As a developer without the GitHub CLI, I want a button that opens GitHub's new pull request page with the title and description filled in, so that I only have to press "Create pull request".

#### Acceptance Criteria

1. WHEN the repository is not archived, THE "Pull request" tab SHALL show a GitHub username field and an "Open pull request on GitHub" link.
2. THE link SHALL be unavailable until the field holds a valid GitHub username: 1 to 39 characters, letters, digits and single hyphens, not starting or ending with a hyphen.
3. WHEN the username is valid, THE link SHALL be the compare link from the repository's default branch to `{username}:{branch}`, with `quick_pull=1` and the title and description URL-encoded, and SHALL open in a new tab with `rel="noopener noreferrer"`.
4. WHEN the encoded link would be longer than 8,000 characters, THE description in the link SHALL be shortened at a line boundary and end with a note that the full description is in the kit, while the copy field and the description file keep the full text.
5. WHEN the default branch is unknown, THE link SHALL NOT be offered.
6. THE UI SHALL state that the link only opens GitHub's page, that the branch must be pushed to the user's fork first, and that GhostRepo does not create the pull request.
7. THE username SHALL NOT be stored, sent to any host, or used anywhere but in the link.

### Requirement 5: Safety and honesty

**User Story:** As the maintainer, I want the new feature to keep the web app's guarantees, so that it adds no new risk.

#### Acceptance Criteria

1. THE feature SHALL NOT add a network host, a token, a login or any storage.
2. Repository-controlled text (the default branch name, file paths, commit messages) SHALL NOT enter a shell command. In the compare link it SHALL be URL-encoded.
3. THE feature SHALL insert text with text nodes and attributes only, never `innerHTML` or similar.
4. THE UI SHALL NOT state or imply that a pull request was created, opened or accepted.

### Requirement 6: Verification

#### Acceptance Criteria

1. `npm test` SHALL cover: the archived and not-archived metadata, the 404 path, the archived kit, the `gh pr create` command, the username rule, the compare link (encoding, the shortening and its note, no link without a default branch).
2. `npm run e2e:web` SHALL check, in a real Chrome against GitHub, that the calculator's kit ends with `gh pr create`, that a valid username produces a compare link to `LucioD3v/ghostrepo-gaia-calculator`, that an invalid one produces none, and that `mozilla-b2g/gaia` is reported as archived.
3. The Gaia calculator result SHALL stay at 29 patterns removed in 2 of 5 files.

# Requirements Document

## Introduction

GhostRepo's `resurrect` CLI works, but only someone with Node, git and a terminal can use it. The goal of this feature is a **public web interface** where any judge (or any developer) pastes the URL of a deprecated or dead repository, is told right away whether GhostRepo can resurrect it, and, when it can, sees it come back to life: the modified code next to the original, the project actually running, a download of the resurrected project, and everything needed to send the result back to the original repository as a pull request.

The interface must stay faithful to the original idea of the project (`.kiro/steering/architecture.md`, `docs/RESURRECT-CLI.md` §1, §2, §7, §9):

- **Zero Breaking Logic.** The web UI uses the same codemods as the CLI. It never rewrites code that cannot be proven safe, and it reports every skip with its reason.
- **Honesty over impressiveness.** Every number on screen comes from a real measurement. The UI never shows a "resurrected" state when nothing changed, never claims that an agent ran, and never claims that the target repository's own tests passed (they are not run). When a repository cannot be resurrected, the UI says so before doing any work.
- **Scope v1.** JavaScript/web legacy code only. A repository in another language is told, up front, that this version cannot modernize it.
- **Incremental, reviewable pull requests.** The UI prepares a clean, atomic change with a description of what was resurrected and what was skipped. It never pushes anything without an explicit user action.
- **Vocabulary.** The four phases keep the project's names: Necromancy, Exorcism, Transmutation, Resurrection. Report statuses keep the CLI's values: `RESURRECTED`, `NO_CHANGES`, `SCANNED_ONLY`.

**Out of scope for this feature:** modernizing languages other than JavaScript; running the target repository's own tests; executing server-side (Node) applications; private repositories; user accounts or server-side storage of results; automatic merging; agent orchestration; changes to the codemods or their skip rules.

**Reference inputs for every acceptance check:**

- The Firefox OS Gaia calculator (`ghostrepo-gaia-calculator/legacy`), a web app with an `index.html` and JavaScript. The CLI resurrects it with 29 legacy patterns removed (28 `var` + 1 `innerHTML`), 2 of 5 files transformed and 2 files skipped because of SpiderMonkey `yield`.
- A repository with no JavaScript (for example a Python project), which must be reported as not supported.

Decisions deliberately left to the design phase are listed at the end of this document.

## Requirements

### Requirement 1: Submit a repository

**User Story:** As a judge, I want to paste a repository URL and press one button, so that I can find out what GhostRepo can do with it without installing anything.

#### Acceptance Criteria

1. WHEN the page loads, THEN the UI SHALL show a repository URL input, an optional subfolder field, a primary "Analyze" button, and at least one clickable example (the Gaia calculator) that fills the input and can be analyzed without typing.
2. WHEN the user submits, THEN the UI SHALL accept only `https://github.com/<owner>/<repo>` URLs, optionally with `/tree/<ref>/<path>`, and SHALL derive the repository, ref and subfolder from them.
3. WHEN the input is empty, is not a GitHub repository URL, or contains a subfolder that is absolute, contains `..` segments, or starts with `-`, THEN the UI SHALL NOT start an analysis and SHALL show a message that names what is wrong and shows an accepted example.
4. WHEN the repository does not exist, is private, or the host rate limit is exhausted, THEN the UI SHALL show a distinct message for each case and SHALL NOT show a partial result.
5. WHEN the user submits while an analysis or run is active, THEN the UI SHALL cancel the active one and discard its output.
6. THE UI SHALL NOT require login, installation or any configuration to complete Requirements 1 to 8.

### Requirement 2: Assess the repository before doing any work

**User Story:** As a judge, I want to be told first whether the repository I entered can be resurrected, so that I do not wait for a run that cannot work, and so that I understand why when it cannot.

#### Acceptance Criteria

1. WHEN a valid repository is submitted, THEN the UI SHALL run an assessment automatically, before any transformation, and SHALL show its verdict before offering the "Resurrect" button.
2. THE assessment SHALL use the repository's file listing (names, paths and sizes) and SHALL NOT download or execute file contents to reach its verdict.
3. THE assessment SHALL apply the same file-selection rule as the engine: `.js` files only, excluding `node_modules/`, `.git/` and `*.min.js`, within the selected subfolder.
4. WHEN at least one eligible `.js` file exists and a web entry point (`index.html`) exists in the scanned root, THEN the verdict SHALL be **Can be resurrected** and the UI SHALL state that the live run will be available.
5. WHEN at least one eligible `.js` file exists but no web entry point exists, THEN the verdict SHALL be **Can be resurrected, without live run**, and the UI SHALL state that the diff, download and pull request kit will be available but the live run will not.
6. WHEN no eligible `.js` file exists, THEN the verdict SHALL be **Not supported by this version**, the "Resurrect" button SHALL be disabled, and the UI SHALL explain that GhostRepo v1 modernizes only JavaScript/web code. Where file extensions allow it, the message SHALL name what the repository appears to be (for example "mostly Python: 214 `.py` files, 0 eligible `.js` files"), labeled as detected from file extensions.
7. WHEN eligible `.js` files are a minority of a repository that contains other languages, THEN the verdict SHALL still follow criteria 4 or 5, and the UI SHALL state that files in other languages will be left untouched.
8. WHEN the repository exceeds the limits of Requirement 11.2, THEN the verdict SHALL be **Too large to analyze as a whole**, the "Resurrect" button SHALL be disabled, and the UI SHALL ask for a subfolder. WHERE the file listing allows it, the UI SHOULD suggest the folders that contain the most eligible `.js` files.
9. THE assessment SHALL show the numbers behind the verdict: eligible `.js` files, excluded files by reason, detected languages by file count, whether a web entry point was found and where, and the size relative to the limits.
10. THE assessment SHALL NOT promise an outcome. It SHALL state that the verdict means the repository can be analyzed, and that the run may still end in `NO_CHANGES` if nothing can be changed provably safely.
11. WHEN a run on an assessed repository finishes, THEN `files_scanned` in the report SHALL equal the number of eligible `.js` files shown by the assessment.
12. WHEN the assessment finishes, THEN the UI SHALL offer to assess another repository, and SHALL list the examples again for a "Not supported" verdict.

### Requirement 3: Visible progress through the four phases

**User Story:** As a judge, I want to see what the tool is doing, so that I trust the result and know it has not frozen.

#### Acceptance Criteria

1. WHEN the user presses "Resurrect", THEN the UI SHALL show Necromancy (acquire and scan), Exorcism, Transmutation and Resurrection (report) with a state for each: pending, running, done or failed.
2. WHEN a phase takes longer than one second, THEN the UI SHALL show concrete progress for it (for example files fetched out of files total, or files processed out of files total).
3. WHEN a phase fails, THEN the UI SHALL mark that phase as failed, show the cause in plain language, and offer to retry. It SHALL NOT present any result from the failed run.
4. WHEN the run finishes, THEN the UI SHALL move to the result view without a page reload.

### Requirement 4: Honest result summary

**User Story:** As a judge, I want an accurate summary of what changed and what did not, so that the revival is believable and not just impressive.

#### Acceptance Criteria

1. WHEN a run finishes, THEN the UI SHALL show the report status (`RESURRECTED`, `NO_CHANGES` or `SCANNED_ONLY`) and the report metrics: files scanned, files transformed, files skipped, lines changed, legacy patterns removed, and the breakdown by category.
2. THE UI SHALL take every displayed number from the report produced by the engine and SHALL NOT compute, estimate or hardcode metrics in the view layer.
3. WHEN the status is `NO_CHANGES`, THEN the UI SHALL say that scanned files needed no safe transform, and SHALL NOT use revival wording or styling.
4. WHEN the status is `SCANNED_ONLY`, THEN the UI SHALL say that GhostRepo v1 modernizes only JavaScript/web code, SHALL NOT offer the live run, the download or the pull request kit as if something had been resurrected, and SHALL still allow starting another analysis.
5. WHEN the report contains skipped sites, THEN the UI SHALL list them grouped by file and reason, with the line number, in the same vocabulary as the CLI (`docs/RESURRECT-CLI.md` §9).
6. WHEN a file could not be parsed, THEN the UI SHALL list it with the parser error and SHALL state that the file was left unchanged.
7. THE UI SHALL state, in the result view, that the target repository's own tests were not run.

### Requirement 5: Modified code side by side with the original

**User Story:** As a judge, I want to see the modified code next to the original, so that I can judge the changes myself.

#### Acceptance Criteria

1. WHEN the result view opens, THEN the UI SHALL list the changed files, each with its status (transformed, skipped, unparsable) and the number of patterns removed in it.
2. WHEN the user selects a file, THEN the UI SHALL show the original on the left and the resurrected version on the right, with changed lines highlighted and line numbers on both sides.
3. WHEN a skipped site exists in the selected file, THEN the UI SHALL mark its line and show its reason on hover or focus.
4. THE UI SHALL render repository content as plain text and SHALL escape it, so that markup in a repository cannot execute in the UI page.
5. WHEN a file is too large to render responsively, THEN the UI SHALL show the changed regions with surrounding context and a way to download the full file.
6. THE UI SHALL let the user filter between changed files and all scanned files.

### Requirement 6: See the resurrected project running

**User Story:** As a judge, I want to press a button and see the resurrected project running, so that I can confirm it still works.

#### Acceptance Criteria

1. WHEN the assessment found a web entry point (`index.html`) and the status is `RESURRECTED`, THEN the UI SHALL show a "Run" button for the resurrected project.
2. WHEN the user presses "Run", THEN the UI SHALL load the resurrected project in a sandboxed frame that has no access to the UI page, its storage, or any credential the user entered. Repository code SHALL NOT run before the user presses the button.
3. WHEN the preview is running, THEN the UI SHALL let the user switch to the original project, so that both can be compared.
4. WHEN no web entry point exists, THEN the UI SHALL say so and SHALL keep the diff, download and pull request kit available.
5. THE UI SHALL state next to the preview that it runs the project in a plain browser, so applications that depend on platform APIs (for example Firefox OS) may not run fully in either version.
6. WHERE it can be done without weakening the sandbox, the UI SHOULD report uncaught runtime errors from the preview for both versions, so that an error present only in the resurrected version is visible.

### Requirement 7: Download the resurrected project

**User Story:** As a judge, I want to download what was produced, so that I can inspect or run it locally.

#### Acceptance Criteria

1. WHEN the status is `RESURRECTED`, THEN the UI SHALL offer a download of the resurrected project as a single archive that contains every file of the scanned root, transformed or not.
2. THE UI SHALL offer a separate download of the report as `resurrection-report.json`, with the same schema as the CLI report.
3. THE UI SHALL offer a download of the changes as a unified patch that `git apply` accepts on a checkout of the target repository at the same ref.
4. WHEN the original files use CRLF line endings, THEN the archive and the patch SHALL preserve them.
5. THE archive SHALL NOT contain the report or any file that was not part of the scanned root.

### Requirement 8: Pull request kit

**User Story:** As a developer who submitted a repository, I want everything needed to open a pull request, so that I can send the result back to the repository with one copy and paste.

#### Acceptance Criteria

1. WHEN the status is `RESURRECTED`, THEN the UI SHALL offer a "Prepare pull request" action that works with no credentials.
2. WHEN the user opens it, THEN the UI SHALL show, each with a copy button: a branch name, a commit message, a pull request title, a pull request description, the patch, and the ordered git commands to apply it and push the branch.
3. THE pull request description SHALL be generated from the report and SHALL state: what was resurrected (counts by category), what was skipped and why (reasons and lines), which files could not be parsed, that the changes are AST-based codemods that skip anything not provably safe, and that the repository's own tests were not run by GhostRepo.
4. THE pull request description SHALL NOT claim test results, performance gains, security fixes or behavior verification that the engine did not measure, and SHALL NOT state or imply that an agent produced the change.
5. THE kit SHALL contain only the changed files, in one atomic change.
6. WHEN the target repository publishes a contribution guide, THEN the UI SHOULD link to it from the kit.

### Requirement 9: Open the pull request from the UI (optional)

**User Story:** As a developer, I want to open the pull request directly from the UI, so that I do not have to use the command line.

#### Acceptance Criteria

1. WHERE the user provides a GitHub access token, THE UI SHALL offer "Open pull request on GitHub". The kit from Requirement 8 SHALL remain available whether or not a token is provided.
2. WHEN the user presses it, THEN the UI SHALL first show a confirmation with the target repository, the branch that will be created, the number of changed files and whether a fork will be created, and SHALL act only after the user confirms.
3. WHEN the user has no write access to the target repository, THEN the UI SHALL create or reuse a fork, create the branch there, and open the pull request from the fork. WHEN the user has write access, THEN it SHALL still use a new branch and SHALL NOT commit to the default branch.
4. THE UI SHALL keep the token in memory only: never persisted, logged, put in a URL, or sent to any host other than `api.github.com`. The preview frame SHALL have no access to it.
5. WHEN any step fails, THEN the UI SHALL show which step failed and what was already created (for example the fork or the branch), and SHALL leave the kit available.
6. WHEN the pull request is created, THEN the UI SHALL show its link.

### Requirement 10: Same engine as the CLI

**User Story:** As the maintainer, I want one engine behind both interfaces, so that the web results can be trusted exactly as much as the CLI results.

#### Acceptance Criteria

1. THE web UI SHALL use the same codemods, scan counters and report assembly as the CLI. A second copy or reimplementation SHALL NOT exist.
2. WHEN the same file tree is processed by the UI and by the CLI, THEN the report metrics, `files[].before`, `files[].after`, `transforms_applied` and `skipped` SHALL be equal. Only `timestamp`, `target` and `agent_signature` MAY differ.
3. WHEN the Gaia calculator is processed by the UI, THEN the result SHALL be 29 legacy patterns removed (28 `var` + 1 `innerHTML`), 2 files transformed and 2 files skipped as unparsable.
4. WHEN the report is produced by the UI, THEN `agent_signature` SHALL name the tool that generated it and SHALL NOT state or imply that an agent ran.
5. THE existing CLI behavior, its test suite and the Gaia calculator CLI result SHALL remain unchanged.

### Requirement 11: Safety and limits

**User Story:** As the maintainer of a public page, I want repository content treated as untrusted, so that submitting a hostile repository cannot harm the visitor or the service.

#### Acceptance Criteria

1. THE UI SHALL parse and transform repository code as data and SHALL NOT execute it, except inside the sandboxed preview of Requirement 6 after an explicit click.
2. THE UI SHALL enforce documented limits on the number of files and total bytes fetched per run. WHEN a limit is exceeded, THEN the UI SHALL stop before processing and tell the user to select a subfolder.
3. THE UI SHALL process only `.js` files with the engine and SHALL exclude `node_modules/`, `.git/` and `*.min.js`, as the CLI does.
4. THE UI SHALL NOT send repository content or the repository URL to any service other than GitHub and the host that serves the UI.
5. THE UI SHALL NOT include third-party trackers or analytics.
6. WHEN the engine throws on a file, THEN the UI SHALL record that file as skipped with the error, keep processing the others, and leave the file unchanged.

### Requirement 12: Public availability

**User Story:** As a judge, I want to open a link and use the tool, so that evaluating the project takes seconds.

#### Acceptance Criteria

1. THE UI SHALL be served from a public HTTPS URL that anyone can open without installing software or signing in.
2. THE deployment SHALL be reproducible from this repository by an automated GitHub workflow, with no manual steps beyond repository settings.
3. THE repository README SHALL link to the public URL and describe how to run the UI locally.
4. WHEN the hosting platform or GitHub is unreachable, THEN the UI SHALL show that the service is unavailable and SHALL NOT show an empty or partial result.

### Requirement 13: Clear, accessible interface

**User Story:** As a judge on any device, I want a clear interface, so that I can complete the flow without instructions.

#### Acceptance Criteria

1. THE UI SHALL show one state at a time: idle, assessing, assessed (with its verdict), running, result, no-changes, not-supported or error, each with a distinct title and a next action.
2. THE UI SHALL be usable by keyboard alone, with visible focus, labels on every control, and text contrast that meets WCAG 2.1 AA.
3. THE UI SHALL be usable at a 360 px viewport width, where the side-by-side diff MAY become a stacked view.
4. THE UI SHALL present the revival visually (for example a dead-to-alive state change), but only in the `RESURRECTED` state.

## Traceability to the original idea

| Principle | Where it is enforced |
|---|---|
| Zero Breaking Logic | Requirements 4.3, 4.4, 10.1, 10.2, 10.3 |
| Honesty over impressiveness | Requirements 2.6, 2.10, 4.2, 4.7, 8.4, 10.4, 13.4 |
| Scope v1 (JavaScript/web only) | Requirements 2.3, 2.6, 4.4 |
| Incremental, reviewable pull requests | Requirements 8.5, 9.2, 9.3 |
| Four-phase vocabulary | Requirement 3.1 |

## Decisions left to the design phase

1. **Where the engine runs.** In the visitor's browser (GitHub Pages alone, no server, but only GitHub repositories and the API rate limits) or on a server (needs a host with `git`, plus abuse controls). This decides how Requirements 1.4, 11.2 and 12.2 are met. Open question for the browser option: whether `jscodeshift` and its parser bundle and run in a browser.
2. **How the assessment gets the file listing** with the fewest requests (for example one recursive tree request), what that source reports when a listing is truncated for very large repositories, and whether a language breakdown comes from the same listing or from a separate request (Requirement 2.2, 2.6, 2.8).
3. **How the preview loads project files** from memory into the sandboxed frame while keeping relative paths working (Requirement 6).
4. **How the archive and patch are built** in the chosen environment, and which pinned dependencies that needs (project convention: exact versions).
5. **How the engine is shared** between the CLI and the UI without duplicating code (Requirement 10.1), including what must change in `src/pipeline.js` so that file access is not tied to the Node filesystem, and how the assessment reuses the file-selection rule of `walkJsFiles` (Requirement 2.3).
6. **How the token for Requirement 9 is obtained** without a server (for example a fine-grained token pasted by the user), and whether Requirement 9 is delivered in the first version or after Requirements 1 to 8.
7. **The `agent_signature` value** for reports produced by the UI.

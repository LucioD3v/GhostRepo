// Parse and validate what the user typed into the web UI (requirement 1.2, 1.3).
//
// Pure. Only https://github.com/<owner>/<repo> and /tree/<ref>[/<folder>] links
// are accepted. The subfolder rules mirror the CLI's validatePath: never
// absolute, never `..`, never a leading `-`.

import { t } from './lang.js';

const NAME = /^[A-Za-z0-9_.-]+$/;
const EXAMPLE = 'https://github.com/owner/repo';

// `message` is an English template (see lang.js); {example} is always available.
function fail(code, message, vars = {}) {
  return { ok: false, error: { code, message: t(message, { example: EXAMPLE, ...vars }) } };
}

/**
 * Validate a subfolder (from the form field or from a /tree/ link).
 * @param {string} raw
 * @returns {{ok:true, value:string}|{ok:false, error:{code:string, message:string}}}
 */
export function validateSubfolder(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: true, value: '' };
  if (text.startsWith('-')) return fail('bad-subfolder', 'The subfolder must not start with "-".');
  if (text.startsWith('/') || /^[a-zA-Z]:/.test(text)) {
    return fail('bad-subfolder', 'The subfolder must be relative, for example "apps/calculator".');
  }
  if (text.includes('\\')) {
    return fail('bad-subfolder', 'Use forward slashes in the subfolder, for example "apps/calculator".');
  }
  const segments = text.split('/').filter((s) => s !== '');
  if (segments.some((s) => s === '..' || s === '.')) {
    return fail('bad-subfolder', 'The subfolder must not contain "." or ".." segments.');
  }
  return { ok: true, value: segments.join('/') };
}

/**
 * @param {string} input          the URL field
 * @param {string} [subfolderField] the optional subfolder field (wins over a /tree/ link path)
 * @returns {{ok:true, owner:string, repo:string, ref:string|null, subfolder:string, canonicalUrl:string}
 *          |{ok:false, error:{code:string, message:string}}}
 */
export function parseRepoInput(input, subfolderField = '') {
  const text = String(input ?? '').trim();
  if (text === '') {
    return fail('empty', 'Paste the URL of a GitHub repository, for example {example}.');
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return fail('not-a-url', 'That is not a URL. Use the full address, for example {example}.');
  }
  if (url.protocol !== 'https:') {
    return fail('not-https', 'Only https:// links are accepted, for example {example}.');
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return fail('not-github', 'Only GitHub repositories are supported, for example {example}.');
  }
  if (url.username || url.password || url.port) {
    return fail('not-github', 'Remove credentials or ports from the link, for example {example}.');
  }

  let segments;
  try {
    segments = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    return fail('not-a-url', 'The link contains an invalid percent-encoded character.');
  }
  if (segments.length < 2) {
    return fail('no-repo', 'The link must point to a repository, for example {example}.');
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  if (!NAME.test(owner) || !NAME.test(repo) || repo === '.' || repo === '..') {
    return fail('no-repo', '"{name}" is not a valid owner/repository name.', { name: `${segments[0]}/${segments[1]}` });
  }

  let ref = null;
  let linkPath = '';
  const rest = segments.slice(2);
  if (rest.length > 0) {
    if (rest[0] !== 'tree' || rest.length < 2) {
      return fail(
        'unsupported-link',
        'Only repository links and /tree/<branch>/<folder> links are supported, not files or other pages.',
      );
    }
    ref = rest[1];
    if (ref.startsWith('-')) return fail('bad-ref', 'The branch name must not start with "-".');
    linkPath = rest.slice(2).join('/');
  }

  const chosen = String(subfolderField ?? '').trim() !== '' ? subfolderField : linkPath;
  const sub = validateSubfolder(chosen);
  if (!sub.ok) return sub;

  return {
    ok: true,
    owner,
    repo,
    ref,
    subfolder: sub.value,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };
}

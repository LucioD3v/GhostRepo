// "Open pull request on GitHub" without a login: GitHub's compare page opens a new
// pull request from the user's fork with the title and description filled in.
// Pure: strings in, a URL out. The username is used here and nowhere else.
// .kiro/specs/open-pull-request (requirement 4).

/** GitHub and browsers accept longer URLs, but this keeps a wide margin. */
export const MAX_LINK_LENGTH = 8000;

const SHORTENED_NOTE =
  "_The description was shortened to fit in a link. The full text is in GhostRepo's Pull request tab and in ghostrepo-pull-request.md._";

/** 1 to 39 letters, digits or single hyphens, not starting or ending with a hyphen. */
export function isValidGitHubUsername(name) {
  return typeof name === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(name);
}

// Branch names contain "/", which the compare path keeps as a separator; every
// other character is escaped.
const encodeRef = (ref) => String(ref).split('/').map(encodeURIComponent).join('/');

function linkFor({ owner, repo, base, user, branch, title, body }) {
  const query = new URLSearchParams({ quick_pull: '1', title, body });
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeRef(base)}...${user}:${encodeRef(branch)}?${query}`;
}

/**
 * @returns {{url:string, shortened:boolean} | null}  null when the username is
 *   invalid or the base branch is unknown.
 */
export function buildCompareLink({ owner, repo, base, user, branch, title, body, maxLength = MAX_LINK_LENGTH }) {
  if (!isValidGitHubUsername(user) || typeof base !== 'string' || !base) return null;
  const full = linkFor({ owner, repo, base, user, branch, title, body });
  if (full.length <= maxLength) return { url: full, shortened: false };

  // Keep the longest prefix of whole lines that fits together with the note.
  const lines = String(body).split('\n');
  let lo = 0;
  let hi = lines.length - 1;
  let best = linkFor({ owner, repo, base, user, branch, title, body: SHORTENED_NOTE });
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = linkFor({ owner, repo, base, user, branch, title, body: `${lines.slice(0, mid + 1).join('\n')}\n\n${SHORTENED_NOTE}` });
    if (candidate.length <= maxLength) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { url: best, shortened: true };
}

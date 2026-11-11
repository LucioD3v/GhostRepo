// Read-only GitHub access for the web UI: the REST API for the commit and the file
// listing, raw.githubusercontent.com for file contents. Anonymous, public repos
// only. `fetch` is injected so the client is testable without a network.

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export class GitHubError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

function formatReset(epochSeconds) {
  if (!epochSeconds) return '';
  const d = new Date(Number(epochSeconds) * 1000);
  return Number.isNaN(d.getTime()) ? '' : ` Try again after ${d.toLocaleTimeString()}.`;
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.api]
 * @param {string} [options.raw]
 */
export function createGitHubClient({ fetch: fetchImpl = globalThis.fetch, api = API, raw = RAW } = {}) {
  async function request(url, { signal, accept } = {}) {
    let res;
    try {
      res = await fetchImpl(url, { signal, headers: accept ? { Accept: accept } : undefined });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new GitHubError('network', 'Could not reach GitHub. Check your connection and try again.');
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0' || res.status === 429) {
        throw new GitHubError(
          'rate-limited',
          `GitHub's limit for anonymous requests was reached.${formatReset(res.headers.get('x-ratelimit-reset'))}`,
        );
      }
    }
    return res;
  }

  async function getJson(url, opts) {
    const res = await request(url, { ...opts, accept: 'application/vnd.github+json' });
    return { status: res.status, ok: res.ok, json: res.ok ? await res.json() : null, res };
  }

  return {
    /**
     * Resolve a branch/tag (or the default branch when `ref` is null) to a commit.
     * @returns {{sha:string, date:string|null, message:string}}
     */
    async resolveCommit({ owner, repo, ref }, opts = {}) {
      const target = ref ? encodeURIComponent(ref) : 'HEAD';
      const r = await getJson(`${api}/repos/${owner}/${repo}/commits/${target}`, opts);
      if (r.ok) {
        const c = r.json;
        return {
          sha: c.sha,
          date: (c.commit && c.commit.committer && c.commit.committer.date) || null,
          message: ((c.commit && c.commit.message) || '').split('\n')[0],
        };
      }
      if (r.status === 409) {
        throw new GitHubError('empty-repo', 'That repository is empty: it has no commits.');
      }
      if (r.status === 404 || r.status === 422) {
        if (ref) {
          // A missing ref and a missing/private repository both answer 404: tell them apart.
          const repoRes = await getJson(`${api}/repos/${owner}/${repo}`, opts);
          if (repoRes.ok) {
            throw new GitHubError('ref-not-found', `The branch or tag "${ref}" does not exist in ${owner}/${repo}.`);
          }
        }
        throw new GitHubError(
          'not-found-or-private',
          `${owner}/${repo} was not found. It may not exist or it may be private (GitHub does not distinguish the two without a login, and only public repositories are supported).`,
        );
      }
      throw new GitHubError('http', `GitHub answered with an unexpected status ${r.status}.`);
    },

    /**
     * List the files (blobs) under `subfolder` at a commit, recursively.
     * Paths are relative to `subfolder`. Symlinks and submodules are not files.
     * @returns {{entries:Array<{path:string,size:number}>, truncated:boolean}}
     */
    async listFiles({ owner, repo, sha, subfolder }, opts = {}) {
      const treeish = subfolder ? `${sha}:${encodePath(subfolder)}` : sha;
      const r = await getJson(`${api}/repos/${owner}/${repo}/git/trees/${treeish}?recursive=1`, opts);
      if (r.ok) {
        const entries = (r.json.tree || [])
          .filter((t) => t.type === 'blob' && t.mode !== '120000')
          .map((t) => ({ path: t.path, size: t.size || 0 }));
        return { entries, truncated: Boolean(r.json.truncated) };
      }
      if (r.status === 404 || r.status === 422) {
        throw new GitHubError(
          'path-not-found',
          subfolder
            ? `The folder "${subfolder}" was not found in ${owner}/${repo} at that branch.`
            : `The file listing of ${owner}/${repo} was not found.`,
        );
      }
      throw new GitHubError('http', `GitHub answered with an unexpected status ${r.status}.`);
    },

    /** Download one file as bytes. `path` is relative to `subfolder`. */
    async fetchFile({ owner, repo, sha, subfolder, path }, opts = {}) {
      const full = subfolder ? `${subfolder}/${path}` : path;
      const res = await request(`${raw}/${owner}/${repo}/${sha}/${encodePath(full)}`, opts);
      if (!res.ok) {
        throw new GitHubError('file-failed', `Could not download ${full} (status ${res.status}).`, { path: full });
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

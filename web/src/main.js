// GhostRepo web UI: the controller. One state at a time (requirement 13.1):
// idle -> assessing -> assessed -> running -> result | error.

import { h, clear } from './dom.js';
import { parseRepoInput } from './github-url.js';
import { createGitHubClient, GitHubError } from './github.js';
import { assessListing } from './assess.js';
import { runResurrection } from './run.js';
import {
  renderAssessment,
  renderProgress,
  updateProgress,
  markProgressFailed,
  renderSummary,
  renderTabs,
  renderCodeTab,
  renderRunTab,
  renderDownloadTab,
  renderPrTab,
} from './views.js';

const TOOL_URL = 'https://github.com/LucioD3v/GhostRepo';

const EXAMPLES = [
  {
    label: '☠ Firefox OS calculator (dead web app)',
    url: 'https://github.com/LucioD3v/ghostrepo-gaia-calculator/tree/main/legacy',
  },
  {
    label: '🐍 A Python project (not supported)',
    url: 'https://github.com/psf/requests',
  },
];

const els = {
  form: document.getElementById('repo-form'),
  url: document.getElementById('repo-url'),
  folder: document.getElementById('repo-folder'),
  analyze: document.getElementById('analyze-btn'),
  message: document.getElementById('form-message'),
  examples: document.getElementById('examples'),
  out: document.getElementById('out'),
  live: document.getElementById('live'),
};

let controller = null; // cancels the active assessment or run
let disposers = [];
const client = createGitHubClient();

function announce(text) {
  els.live.textContent = '';
  // A change of text is what triggers the screen reader; clear first.
  setTimeout(() => (els.live.textContent = text), 30);
}

function reset() {
  if (controller) controller.abort();
  controller = new AbortController();
  disposers.forEach((fn) => fn());
  disposers = [];
  clear(els.out);
  return controller.signal;
}

function show(node, { focus = true } = {}) {
  clear(els.out);
  els.out.append(node);
  if (focus) {
    const target = node.matches('section') ? node : node.querySelector('section');
    if (target) target.focus({ preventScroll: false });
  }
}

function formError(text) {
  els.message.textContent = text;
  els.message.hidden = !text;
  els.url.setAttribute('aria-invalid', text ? 'true' : 'false');
}

function errorCard(title, message, { retry } = {}) {
  return h(
    'section',
    { class: 'card error-card', tabindex: '-1', role: 'alert' },
    h('h2', { text: title }),
    h('p', { text: message }),
    retry ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: retry }, 'Try again')) : null,
  );
}

function describeError(e) {
  if (e instanceof GitHubError) {
    const titles = {
      'rate-limited': 'GitHub rate limit reached',
      'not-found-or-private': 'Repository not found',
      'ref-not-found': 'Branch not found',
      'path-not-found': 'Folder not found',
      'empty-repo': 'Empty repository',
      network: 'Cannot reach GitHub',
      'file-failed': 'A file could not be downloaded',
      http: 'Unexpected answer from GitHub',
    };
    return { title: titles[e.code] || 'Something went wrong', message: e.message };
  }
  return { title: 'Something went wrong', message: e && e.message ? e.message : String(e) };
}

// --- Flow ---------------------------------------------------------------------------

async function analyze(parsed) {
  const signal = reset();
  const { owner, repo, ref, subfolder } = parsed;
  updateUrl(parsed);
  els.analyze.disabled = true;
  show(h('section', { class: 'card busy', tabindex: '-1', 'aria-busy': 'true' }, h('h2', { text: 'Assessing the repository…' }), h('p', { class: 'muted', text: 'Reading the file listing from GitHub. No code is downloaded or run yet.' })));
  announce('Assessing the repository');

  try {
    const commit = await client.resolveCommit({ owner, repo, ref }, { signal });
    const listing = await client.listFiles({ owner, repo, sha: commit.sha, subfolder }, { signal });
    const assessment = assessListing({ entries: listing.entries, truncated: listing.truncated });
    const target = { owner, repo, ref, subfolder, sha: commit.sha, canonicalUrl: parsed.canonicalUrl };

    show(
      renderAssessment({
        assessment,
        commit,
        target,
        examples: EXAMPLES,
        onResurrect: () => resurrect({ target, assessment, listing }),
        onPickFolder: (folder) => {
          els.folder.value = folder;
          els.form.requestSubmit();
        },
        onExample: (ex) => useExample(ex),
      }),
    );
    announce(`${assessment.headline}.`);
  } catch (e) {
    if (e.name === 'AbortError') return;
    const { title, message } = describeError(e);
    show(errorCard(title, message, { retry: () => analyze(parsed) }));
    announce(title);
  } finally {
    if (!signal.aborted) els.analyze.disabled = false;
  }
}

async function resurrect({ target, assessment, listing }) {
  const signal = reset();
  const progress = renderProgress();
  show(progress);
  announce('Resurrecting');
  let phase = 'necromancy';

  try {
    const result = await runResurrection({
      client,
      target,
      entries: listing.entries,
      signal,
      onProgress: (ev) => {
        phase = ev.phase;
        updateProgress(progress, ev);
      },
    });
    showResult({ result, target, assessment });
  } catch (e) {
    if (e.name === 'AbortError') return;
    markProgressFailed(progress, phase);
    const { title, message } = describeError(e);
    const phaseName = { necromancy: 'Necromancy', exorcism: 'Exorcism', transmutation: 'Transmutation', resurrection: 'Resurrection' }[phase];
    show(h('div', {}, errorCard(`${title} (during ${phaseName})`, message, { retry: () => resurrect({ target, assessment, listing }) })));
    announce(`${title} during ${phaseName}`);
  }
}

function showResult({ result, target, assessment }) {
  const { report } = result;
  const ctx = { owner: target.owner, repo: target.repo, ref: target.ref, subfolder: target.subfolder, toolUrl: TOOL_URL };
  const parts = [renderSummary(report)];

  if (report.status === 'RESURRECTED') {
    const tabs = [{ id: 'code', label: 'Code', render: () => renderCodeTab(result) }];
    if (assessment.entryPoint) tabs.push({ id: 'run', label: 'Run', render: () => renderRunTab(result, { onDispose: (fn) => disposers.push(fn) }) });
    tabs.push(
      { id: 'download', label: 'Download', render: () => renderDownloadTab(result, ctx) },
      { id: 'pr', label: 'Pull request', render: () => renderPrTab(result, ctx) },
    );
    parts.push(renderTabs(tabs, 'code'));
  } else if (report.status === 'NO_CHANGES') {
    parts.push(renderTabs([{ id: 'code', label: 'Code', render: () => renderCodeTab(result) }], 'code'));
  }

  parts.push(h('div', { class: 'actions again' }, h('button', { type: 'button', onclick: () => { clear(els.out); els.url.focus(); } }, 'Analyze another repository')));
  show(h('div', { class: 'stack' }, parts), { focus: true });
  announce(`Finished: ${report.status}`);
}

// --- Form and deep links ----------------------------------------------------------------

function updateUrl({ canonicalUrl, ref, subfolder }) {
  const link = ref || subfolder ? `${canonicalUrl}/tree/${ref || 'HEAD'}${subfolder ? '/' + subfolder : ''}` : canonicalUrl;
  const params = new URLSearchParams({ repo: link });
  try {
    history.replaceState(null, '', `${location.pathname}?${params}`);
  } catch {
    /* file:// or sandboxed contexts */
  }
}

function useExample(ex) {
  els.url.value = ex.url;
  els.folder.value = '';
  els.form.requestSubmit();
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const parsed = parseRepoInput(els.url.value, els.folder.value);
  if (!parsed.ok) {
    formError(parsed.error.message);
    els.url.focus();
    return;
  }
  formError('');
  analyze(parsed);
});

els.url.addEventListener('input', () => formError(''));

for (const ex of EXAMPLES) {
  els.examples.append(h('button', { type: 'button', class: 'chip', onclick: () => useExample(ex) }, ex.label));
}

// A shared link (?repo=...) fills the form and runs the assessment, never the resurrection.
const initial = new URLSearchParams(location.search).get('repo');
if (initial) {
  els.url.value = initial;
  els.form.requestSubmit();
}

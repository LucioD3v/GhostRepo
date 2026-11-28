// GhostRepo web UI: the controller. One state at a time (requirement 13.1):
// idle -> assessing -> assessed -> running -> result | error.

import { h, clear } from './dom.js';
import { parseRepoInput } from './github-url.js';
import { createGitHubClient, GitHubError } from './github.js';
import { assessListing } from './assess.js';
import { runInWorker } from './run-worker.js';
import { applyLang } from './i18n.js';
import { t, onLangChange } from './lang.js';
import {
  phaseName,
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
    label: '🎮 Mozilla game template (archived 2012)',
    url: 'https://github.com/mozilla/mortar-game-stub',
  },
  {
    label: '📱 Mozilla app template (archived)',
    url: 'https://github.com/mozilla/mortar-app-stub',
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
// Redraws the card on screen (assessment, result or error) in the current language.
// Null while nothing is shown or while a run is in progress.
let redraw = null;
const client = createGitHubClient();

const BASE_TITLE = 'GhostRepo · Raise dead JavaScript repositories';

function setTitle(text) {
  document.title = text ? `${text} · GhostRepo` : t(BASE_TITLE);
}

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
  redraw = null;
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
    retry ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: retry }, t('Try again'))) : null,
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
    return { title: t(titles[e.code] || 'Something went wrong'), message: e.message };
  }
  return { title: t('Something went wrong'), message: e && e.message ? e.message : String(e) };
}

// --- Flow ---------------------------------------------------------------------------

async function analyze(parsed) {
  const signal = reset();
  const { owner, repo, ref, subfolder } = parsed;
  updateUrl(parsed);
  els.analyze.disabled = true;
  setTitle(t('Assessing {name}…', { name: `${owner}/${repo}` }));
  show(h('section', { class: 'card busy', tabindex: '-1', 'aria-busy': 'true' }, h('h2', { text: t('Assessing the repository…') }), h('p', { class: 'muted', text: t('Reading the file listing from GitHub. No code is downloaded or run yet.') })));
  announce(t('Assessing the repository'));

  try {
    // Metadata first: a missing repository stops here, and an archived one is
    // named before any work (it cannot receive pull requests).
    const meta = await client.getRepository({ owner, repo }, { signal });
    const commit = await client.resolveCommit({ owner, repo, ref }, { signal });
    const listing = await client.listFiles({ owner, repo, sha: commit.sha, subfolder }, { signal });
    const target = { owner, repo, ref, subfolder, sha: commit.sha, canonicalUrl: parsed.canonicalUrl, archived: meta.archived, defaultBranch: meta.defaultBranch };

    // The assessment text is built in the current language, so a redraw assesses
    // again, from the listing already fetched (no new request).
    const showAssessment = ({ focus }) => {
      const assessment = assessListing({ entries: listing.entries, truncated: listing.truncated });
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
        { focus },
      );
      return assessment;
    };
    const assessment = showAssessment({ focus: true });
    redraw = () => showAssessment({ focus: false });
    setTitle(`${owner}/${repo}`);
    announce(`${assessment.headline}.`);
  } catch (e) {
    if (e.name === 'AbortError') return;
    const { title, message } = describeError(e);
    setTitle(null);
    show(errorCard(title, message, { retry: () => analyze(parsed) }));
    redraw = () => {
      const again = describeError(e);
      show(errorCard(again.title, again.message, { retry: () => analyze(parsed) }), { focus: false });
    };
    announce(title);
  } finally {
    if (!signal.aborted) els.analyze.disabled = false;
  }
}

async function resurrect({ target, assessment, listing }) {
  const signal = reset();
  const progress = renderProgress();
  show(progress);
  setTitle(t('Resurrecting {name}…', { name: `${target.owner}/${target.repo}` }));
  announce(t('Resurrecting'));
  let phase = 'necromancy';

  try {
    const result = await runInWorker({
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
    // Keep the progress card (with the failed phase marked) under the error card;
    // the error card comes first, so it still gets the focus.
    show(h('div', { class: 'stack' }, errorCard(t('{title} (during {phase})', { title, phase: phaseName(phase) }), message, { retry: () => resurrect({ target, assessment, listing }) }), progress));
    announce(t('{title} during {phase}', { title, phase: phaseName(phase) }));
  }
}

function showResult({ result, target, assessment }, { focus = true, tab = 'code' } = {}) {
  const { report } = result;
  const ctx = {
    owner: target.owner,
    repo: target.repo,
    sha: target.sha,
    subfolder: target.subfolder,
    archived: target.archived,
    defaultBranch: target.defaultBranch,
    toolUrl: TOOL_URL,
  };
  const parts = [renderSummary(report)];

  if (report.status === 'RESURRECTED') {
    const tabs = [{ id: 'code', label: t('Code'), render: () => renderCodeTab(result) }];
    if (assessment.entryPoint) tabs.push({ id: 'run', label: t('Run'), render: () => renderRunTab(result, { onDispose: (fn) => disposers.push(fn) }) });
    tabs.push(
      { id: 'download', label: t('Download'), render: () => renderDownloadTab(result, ctx) },
      { id: 'pr', label: t('Pull request'), render: () => renderPrTab(result, ctx) },
    );
    parts.push(renderTabs(tabs, tab));
  } else if (report.status === 'NO_CHANGES') {
    parts.push(renderTabs([{ id: 'code', label: t('Code'), render: () => renderCodeTab(result) }], 'code'));
  }

  parts.push(h('div', { class: 'actions again' }, h('button', { type: 'button', onclick: () => { redraw = null; setTitle(null); clear(els.out); els.url.focus(); } }, t('Analyze another repository'))));
  show(h('div', { class: 'stack' }, parts), { focus });
  // A redraw keeps the open tab. The Run tab starts over: its frames are rebuilt.
  redraw = () => {
    const open = els.out.querySelector('[role="tab"][aria-selected="true"]');
    disposers.forEach((fn) => fn());
    disposers = [];
    showResult({ result, target, assessment }, { focus: false, tab: open ? open.dataset.tab : 'code' });
  };
  const name = `${target.owner}/${target.repo}`;
  const statusLabel = { RESURRECTED: t('👻 Resurrected {name}', { name }), NO_CHANGES: t('No changes — {name}', { name }), SCANNED_ONLY: t('Scanned — {name}', { name }) }[report.status] || name;
  setTitle(statusLabel);
  if (focus) announce(t('Finished: {status}', { status: report.status }));
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

function renderExampleChips() {
  clear(els.examples);
  for (const ex of EXAMPLES) {
    els.examples.append(h('button', { type: 'button', class: 'chip', onclick: () => useExample(ex) }, t(ex.label)));
  }
}
renderExampleChips();

// --- Language toggle ----------------------------------------------------------------

for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => {
    const lang = btn.id === 'btn-es' ? 'es' : 'en';
    applyLang(lang);
  });
}

// applyLang translates the static page; this redraws what main.js built.
onLangChange(() => {
  renderExampleChips();
  if (redraw) redraw();
  if (!els.message.hidden) {
    const parsed = parseRepoInput(els.url.value, els.folder.value);
    if (!parsed.ok) formError(parsed.error.message);
  }
  if (!els.out.firstChild) setTitle(null);
});

// --- Theme toggle -------------------------------------------------------------------

const themeBtn = document.getElementById('theme-toggle');

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    themeBtn.textContent = '☀️';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeBtn.textContent = '🌙';
  }
  localStorage.setItem('theme', theme);
}

// Restore saved theme on load.
applyTheme(localStorage.getItem('theme') || 'dark');

themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
});

// A shared link (?repo=...) fills the form and runs the assessment, never the resurrection.
const initial = new URLSearchParams(location.search).get('repo');
if (initial) {
  els.url.value = initial;
  els.form.requestSubmit();
}

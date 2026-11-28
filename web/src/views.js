// Views. Each function returns DOM nodes built with h(); nothing here fetches or
// transforms code. Strings that come from a repository are only ever text.

import { h, clear, copyText, saveFile, formatNumber, formatBytes, relativeAge } from './dom.js';
import { diffLines, sideBySide } from './diff.js';
import { summarizeSkips } from './prkit.js';
import { buildPreviewDocument } from './preview.js';
import { resurrectedFiles } from './result.js';
import { buildArchive, buildReportJson, buildKit, buildPatch, PATCH_FILE_NAME, PR_BODY_FILE_NAME } from './artifacts.js';
import { buildCompareLink, isValidGitHubUsername } from './pr-link.js';
import { t, tn } from './lang.js';

// Names and labels are English keys; t() translates them when rendered.
export const PHASES = [
  { id: 'necromancy', name: 'Necromancy', what: 'Acquire the files' },
  { id: 'exorcism', name: 'Exorcism', what: 'Banish unsafe innerHTML' },
  { id: 'transmutation', name: 'Transmutation', what: 'Modernize var and equality' },
  { id: 'resurrection', name: 'Resurrection', what: 'Write the report' },
];

/** Translated name of a phase id (for messages outside the progress card). */
export function phaseName(id) {
  const p = PHASES.find((x) => x.id === id);
  return p ? t(p.name) : id;
}

const PHASE_STATES = { pending: 'pending', running: 'running', done: 'done', failed: 'failed' };

const CATEGORY_LABELS = {
  var_to_const_let: '`var` → `const` / `let`',
  loose_equality: '`==` / `!=` → `===` / `!==`',
  insecure_innerHTML: '`innerHTML = text` → `textContent`',
};

const SKIP_LABELS = {
  'global-scope': 'Top-level var (becomes a global property)',
  'for-loop-init': 'var in a for-loop initializer',
  'loop-closure-capture': 'var captured by a closure in a loop',
  'loop-uninitialized': 'Uninitialized var inside a loop',
  'switch-case': 'var declared in a switch case',
  'used-outside-block': 'var used outside its block',
  'used-before-declaration': 'var used before its declaration',
  'used-in-initializer': 'var read inside its own initializer',
  'hoisted-function-capture': 'var read by a hoisted function before it is set',
  'redeclared-in-scope': 'var declared more than once',
  'shadows-parameter': 'var with the same name as a parameter',
  'non-block-position': 'var not directly inside a block',
  'dynamic-scope': 'Function uses eval or with',
  'non-identifier-binding': 'Destructuring declaration',
  'nullish-idiom': 'Comparison with null / undefined',
  'operand-types-unknown': 'Operand types not known statically',
  'dynamic-value-needs-review': 'innerHTML with a dynamic value (needs review)',
  'markup-or-entity-literal': 'innerHTML with markup or an entity',
  'compound-assignment': 'innerHTML +=',
};

const code = (text) => h('code', { text });

// --- Assessment ------------------------------------------------------------------

const VERDICT_CLASS = {
  READY: 'ok',
  READY_NO_PREVIEW: 'ok',
  NOT_SUPPORTED: 'no',
  TOO_LARGE: 'warn',
};

export function renderAssessment({ assessment: a, commit, target, onResurrect, onPickFolder, onExample, examples }) {
  const canRun = a.verdict === 'READY' || a.verdict === 'READY_NO_PREVIEW';
  const stats = [
    [t('Eligible .js files'), formatNumber(a.eligible.length)],
    [t('Files to fetch'), `${formatNumber(a.totalFiles)} (${formatBytes(a.totalBytes)})`],
    [t('Live run'), a.entryPoint ? t('Available (index.html found)') : t('Not available')],
  ];
  const excluded = [];
  if (a.excluded.minified) excluded.push(t('{n} minified', { n: a.excluded.minified }));
  if (a.excluded.vendored) excluded.push(t('{n} in node_modules/.git', { n: a.excluded.vendored }));
  if (excluded.length) stats.push([t('Excluded .js'), excluded.join(', ')]);

  return h(
    'section',
    { class: `card verdict ${VERDICT_CLASS[a.verdict]}`, 'aria-labelledby': 'verdict-title', tabindex: '-1', id: 'assessment' },
    h('p', { class: 'eyebrow' }, t('Assessment of '), code(`${target.owner}/${target.repo}${target.subfolder ? '/' + target.subfolder : ''}`)),
    h('h2', { id: 'verdict-title' }, h('span', { class: 'badge', 'aria-hidden': 'true' }, canRun ? '✔' : a.verdict === 'TOO_LARGE' ? '!' : '✖'), a.headline),
    commit.date
      ? h('p', { class: 'muted' }, t('Last commit {date} ({age}): ', { date: commit.date.slice(0, 10), age: relativeAge(commit.date) }), commit.message || t('(no message)'))
      : null,
    h('ul', { class: 'details' }, a.details.map((d) => h('li', { text: d }))),
    target.archived
      ? h(
          'p',
          { class: 'archived-note', id: 'archived-note' },
          h('strong', { text: t('Archived on GitHub. ') }),
          t('The repository is read-only and cannot receive pull requests. You can still resurrect it, download the result, or push it to your fork.'),
        )
      : null,
    h('dl', { class: 'stats' }, stats.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))),
    a.languages.length
      ? h(
          'p',
          { class: 'muted' },
          t('Detected from file extensions: '),
          a.languages.slice(0, 6).map((l, i) => [i ? ', ' : '', `${l.name} ${formatNumber(l.files)}`]),
        )
      : null,
    a.suggestions.length
      ? h(
          'div',
          { class: 'suggest' },
          h('p', {}, t('Folders with the most .js files (from the listing GitHub returned):')),
          h(
            'div',
            { class: 'chips' },
            a.suggestions.map((s) =>
              h('button', { type: 'button', class: 'chip', onclick: () => onPickFolder(s.folder) }, `${s.folder}/ · ${formatNumber(s.jsFiles)} .js`),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'primary', id: 'resurrect-btn', disabled: !canRun, onclick: onResurrect }, t('👻 Resurrect')),
      !canRun ? h('span', { class: 'muted' }, t('This repository cannot be resurrected by this version.')) : null,
    ),
    a.verdict === 'NOT_SUPPORTED'
      ? h(
          'div',
          { class: 'suggest' },
          h('p', {}, t('Try one that works:')),
          h('div', { class: 'chips' }, examples.map((ex) => h('button', { type: 'button', class: 'chip', onclick: () => onExample(ex) }, t(ex.label)))),
        )
      : null,
  );
}

// --- Progress ----------------------------------------------------------------------

export function renderProgress() {
  return h(
    'section',
    { class: 'card', id: 'progress', 'aria-labelledby': 'progress-title', tabindex: '-1' },
    h('h2', { id: 'progress-title' }, t('Resurrecting…')),
    h(
      'ol',
      { class: 'phases' },
      PHASES.map((p) =>
        h(
          'li',
          { class: 'phase pending', 'data-phase': p.id },
          h('div', { class: 'phase-head' }, h('strong', { text: t(p.name) }), h('span', { class: 'phase-what muted', text: t(p.what) }), h('span', { class: 'phase-state', text: t('pending') })),
          h('div', { class: 'bar', role: 'progressbar', 'aria-label': t('{phase} progress', { phase: t(p.name) }), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('div', { class: 'bar-fill' })),
          h('div', { class: 'phase-note muted' }),
        ),
      ),
    ),
  );
}

export function updateProgress(root, ev) {
  const li = root.querySelector(`[data-phase="${ev.phase}"]`);
  if (!li) return;
  li.classList.remove('pending', 'running', 'done', 'failed');
  li.classList.add(ev.state);
  li.querySelector('.phase-state').textContent = PHASE_STATES[ev.state] ? t(PHASE_STATES[ev.state]) : ev.state;
  const bar = li.querySelector('.bar');
  const pct = ev.state === 'done' ? 100 : ev.total ? Math.round((ev.done / ev.total) * 100) : 0;
  bar.setAttribute('aria-valuenow', String(pct));
  li.querySelector('.bar-fill').style.width = `${pct}%`;
  li.querySelector('.phase-note').textContent = ev.total ? t('{done} of {total} files', { done: formatNumber(ev.done || 0), total: formatNumber(ev.total) }) : '';
}

export function markProgressFailed(root, phaseId) {
  const li = root.querySelector(`[data-phase="${phaseId}"]`);
  if (!li) return;
  li.classList.remove('pending', 'running', 'done');
  li.classList.add('failed');
  li.querySelector('.phase-state').textContent = t('failed');
}

// --- Result ------------------------------------------------------------------------

function metric(label, value, hint) {
  return h('div', { class: 'metric' }, h('dt', { text: label }), h('dd', { text: String(value) }), hint ? h('small', { class: 'muted', text: hint }) : null);
}

function breakdownList(report) {
  const rows = Object.entries(CATEGORY_LABELS).map(([key, label]) =>
    h('li', {}, h('span', { text: label.replace(/`/g, '') }), h('strong', { text: formatNumber(report.metrics.breakdown[key]) })),
  );
  const found = (key) => report.files.reduce((s, f) => s + ((f.before && f.before[key]) || 0), 0);
  const reported = [
    [t('Vendor-prefixed APIs'), found('vendor_api')],
    [t('ES5 prototype assignments'), found('es5_prototype')],
  ];
  return h(
    'div',
    { class: 'breakdown' },
    h('h3', {}, t('Patterns removed')),
    h('ul', {}, rows),
    h('h3', {}, t('Found, reported only (this version does not rewrite them)')),
    h('ul', {}, reported.map(([label, n]) => h('li', {}, h('span', { text: label }), h('strong', { text: formatNumber(n) })))),
  );
}

export function skipsPanel(report) {
  const groups = summarizeSkips(report);
  const unparsable = report.files.filter((f) => f.skipped.some((s) => s.transform === 'parse'));
  return h(
    'div',
    { class: 'skips' },
    h('h3', {}, t('Left unchanged, and why')),
    groups.length === 0 ? h('p', { class: 'muted' }, t('Nothing was skipped.')) : h('p', { class: 'muted' }, t('Each of these was detected and deliberately not changed because the rewrite could not be proven to keep the same behavior.')),
    groups.map((g) =>
      h(
        'details',
        {},
        h('summary', {}, h('strong', { text: SKIP_LABELS[g.reason] ? t(SKIP_LABELS[g.reason]) : g.reason }), ' ', h('span', { class: 'muted' }, tn('({reason}) · {n} site', '({reason}) · {n} sites', g.sites.length, { reason: g.reason }))),
        h('ul', { class: 'sites' }, g.sites.map((s) => h('li', {}, code(s.line ? `${s.path}:${s.line}` : s.path)))),
      ),
    ),
    unparsable.length
      ? h(
          'details',
          {},
          h('summary', {}, h('strong', { text: t('Files that could not be parsed') }), ' ', h('span', { class: 'muted' }, t('· {n} (left exactly as they were)', { n: unparsable.length }))),
          h('ul', { class: 'sites' }, unparsable.map((f) => h('li', {}, code(f.path), ': ', f.skipped.find((s) => s.transform === 'parse').reason))),
        )
      : null,
  );
}

export function renderSummary(report) {
  const m = report.metrics;
  const status = report.status;
  // NO_CHANGES covers two cases: patterns were found but every rewrite was
  // skipped, or the code had no var, ==/!= or innerHTML = to begin with.
  const found = report.files.some((f) => f.before && (f.before.var || f.before.loose_equality || f.before.innerHTML));
  const title = t({
    RESURRECTED: 'Resurrected',
    NO_CHANGES: found ? 'Nothing could be changed safely' : 'Nothing needed changing',
    SCANNED_ONLY: 'Nothing to modernize',
  }[status]);
  const lead = {
    RESURRECTED: t('{removed} legacy patterns removed in {transformed} of {scanned} files.', {
      removed: formatNumber(m.legacy_patterns_removed),
      transformed: formatNumber(m.files_transformed),
      scanned: formatNumber(m.files_scanned),
    }),
    NO_CHANGES: found
      ? t('The files were scanned, but no change could be proven to keep the same behavior, so none was made.')
      : t('No var, == / != or innerHTML = pattern was found in the files that could be parsed, so nothing was changed.'),
    SCANNED_ONLY: t('GhostRepo v1 modernizes only JavaScript/web code, and none was found.'),
  }[status];
  return h(
    'section',
    { class: `card result ${status.toLowerCase()}`, id: 'result', 'aria-labelledby': 'result-title', tabindex: '-1' },
    status === 'RESURRECTED'
      ? h('div', { class: 'revival dead', 'aria-hidden': 'true' }, h('span', { class: 'ghost-dead', text: '💀' }), h('span', { class: 'ghost-alive', text: '👻' }))
      : null,
    h('p', { class: 'eyebrow' }, t('Status '), code(status)),
    h('h2', { id: 'result-title', text: title }),
    h('p', { class: 'lead', text: lead }),
    h(
      'dl',
      { class: 'metrics' },
      metric(t('Files scanned'), formatNumber(m.files_scanned)),
      metric(t('Files transformed'), formatNumber(m.files_transformed)),
      metric(t('Files skipped'), formatNumber(m.files_skipped), t('could not be parsed')),
      metric(t('Lines changed'), formatNumber(m.lines_changed)),
      metric(t('Patterns removed'), formatNumber(m.legacy_patterns_removed)),
    ),
    breakdownList(report),
    skipsPanel(report),
    h('p', { class: 'note' }, t("GhostRepo did not run this repository's tests. Every number above comes from the report the engine produced.")),
  );
}

// --- Code tab (side-by-side diff) --------------------------------------------------

const COLLAPSE_OVER = 10;
const KEEP_EDGE = 3;

function diffTable(path, original, output, skipped) {
  const { ops, identical } = diffLines(original, output ?? original);
  const rows = sideBySide(ops);
  const skipByLine = new Map();
  for (const s of skipped) if (s.line) skipByLine.set(s.line, s.reason);

  const table = h('table', { class: 'diff', 'aria-label': t('Changes in {path}', { path }) }, h('colgroup', {}, h('col', { class: 'c-ln' }), h('col', { class: 'c-code' }), h('col', { class: 'c-ln' }), h('col', { class: 'c-code' })));
  const body = h('tbody');
  table.append(body);

  const makeRow = (r) => {
    const skip = r.left && skipByLine.get(r.left.no);
    const tr = h(
      'tr',
      { class: r.changed ? 'changed' : skip ? 'skipped' : '' },
      h('td', { class: 'ln', 'data-ln': r.left ? r.left.no : '', title: skip ? t('Left unchanged: {reason}', { reason: skip }) : null }, r.left ? String(r.left.no) : '', skip ? h('span', { class: 'skip-mark', 'aria-label': t('left unchanged: {reason}', { reason: skip }), text: '⚠' }) : null),
      h('td', { class: `code ${r.left && r.changed ? 'del' : ''}` }, r.left ? r.left.text : ''),
      h('td', { class: 'ln', 'data-ln': r.right ? r.right.no : '' }, r.right ? String(r.right.no) : ''),
      h('td', { class: `code ${r.right && r.changed ? 'add' : ''}` }, r.right ? r.right.text : ''),
    );
    return tr;
  };

  let i = 0;
  while (i < rows.length) {
    if (rows[i].changed) {
      body.append(makeRow(rows[i]));
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && !rows[j].changed) j++;
    const run = rows.slice(i, j);
    if (run.length > COLLAPSE_OVER) {
      const head = run.slice(0, KEEP_EDGE);
      const mid = run.slice(KEEP_EDGE, run.length - KEEP_EDGE);
      const tail = run.slice(run.length - KEEP_EDGE);
      head.forEach((r) => body.append(makeRow(r)));
      const hidden = mid.map((r) => {
        const tr = makeRow(r);
        tr.hidden = true;
        return tr;
      });
      const toggle = h('tr', { class: 'fold' }, h('td', { colspan: '4' }, h('button', { type: 'button', class: 'linkish', onclick: () => { hidden.forEach((t) => (t.hidden = false)); toggle.remove(); } }, t('⋯ {n} unchanged lines · show', { n: formatNumber(mid.length) }))));
      body.append(toggle);
      hidden.forEach((t) => body.append(t));
      tail.forEach((r) => body.append(makeRow(r)));
    } else {
      run.forEach((r) => body.append(makeRow(r)));
    }
    i = j;
  }
  return { table, identical };
}

export function renderCodeTab(result) {
  const { report, sources, outputs } = result;
  const files = report.files;
  const state = { showAll: false, selected: null };
  const list = h('ul', { class: 'filelist' });
  const view = h('div', { class: 'diffview' });
  const filter = h('label', { class: 'switch' }, h('input', { type: 'checkbox', onchange: (e) => { state.showAll = e.target.checked; renderList(); } }), t(' Show all scanned files'));

  const statusOf = (f) => {
    if (f.skipped.some((s) => s.transform === 'parse')) return { label: t('unparsable'), cls: 'bad' };
    if (outputs.has(f.path)) {
      const removed = Object.keys(f.before || {}).reduce((s, k) => s + Math.max(0, (f.before[k] || 0) - (f.after[k] || 0)), 0);
      return { label: t('{n} removed', { n: removed }), cls: 'good' };
    }
    return { label: f.skipped.length ? t('{n} skipped', { n: f.skipped.length }) : t('unchanged'), cls: 'mute' };
  };

  function select(path) {
    state.selected = path;
    renderList();
    clear(view);
    const f = files.find((x) => x.path === path);
    if (!f) return;
    const original = sources.get(path);
    const out = outputs.get(path);
    view.append(h('div', { class: 'diff-head' }, h('strong', { text: path }), h('span', { class: out ? 'diff-label-legacy' : 'muted', text: out ? t('⬛ LEGACY') : t('no changes made') }), out ? h('span', { class: 'diff-label-resurrected', text: t('👻 RESURRECTED') }) : null));
    if (original === undefined) {
      view.append(h('p', { class: 'muted' }, f.skipped.length ? f.skipped[0].reason : t('This file was not read.')));
      return;
    }
    if (!out) view.append(h('p', { class: 'muted' }, t('This file was left exactly as it was.')));
    const { table } = diffTable(path, original, out, f.skipped);
    view.append(h('div', { class: 'diff-scroll', tabindex: '0', role: 'region', 'aria-label': t('Diff of {path}', { path }) }, table));
    view.append(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => saveFile(path.split('/').pop(), out ?? original, 'text/javascript') }, t('Download this file'))));
  }

  function renderList() {
    clear(list);
    const shown = files.filter((f) => state.showAll || outputs.has(f.path) || f.skipped.length);
    if (shown.length === 0) list.append(h('li', { class: 'muted' }, t('No file was changed.')));
    for (const f of shown) {
      const st = statusOf(f);
      list.append(
        h('li', {}, h('button', { type: 'button', class: `file ${state.selected === f.path ? 'active' : ''}`, 'aria-current': state.selected === f.path ? 'true' : null, onclick: () => select(f.path) }, h('span', { class: 'file-name', text: f.path }), h('span', { class: `pill ${st.cls}`, text: st.label }))),
      );
    }
  }

  renderList();
  const firstChanged = files.find((f) => outputs.has(f.path)) || files[0];
  if (firstChanged) select(firstChanged.path);
  return h('div', { class: 'code-tab' }, h('div', { class: 'files' }, filter, list), view);
}

// --- Run tab (sandboxed live preview) ------------------------------------------------

export function renderRunTab(result, { onDispose }) {
  const resurrected = resurrectedFiles(result);
  const original = new Map(result.files);
  const state = { mode: 'resurrected', errors: { resurrected: [], original: [] }, frames: [] };
  const stage = h('div', { class: 'preview-stage' });
  const errorsBox = h('div', { class: 'preview-errors', 'aria-live': 'polite' });
  const warningsBox = h('ul', { class: 'muted' });
  const modes = [
    ['resurrected', t('Resurrected')],
    ['original', t('Original')],
    ['both', t('Side by side')],
  ];
  const modeButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': t('Which version to run') });
  const versionName = (which) => (which === 'resurrected' ? t('Resurrected') : t('Original'));

  function makeFrame(which) {
    const files = which === 'resurrected' ? resurrected : original;
    let built;
    try {
      built = buildPreviewDocument(files);
    } catch (e) {
      return h('p', { class: 'error' }, t('The preview could not be built: {message}', { message: e.message }));
    }
    built.warnings.forEach((w) => warningsBox.append(h('li', { text: `${versionName(which)}: ${w}` })));
    // sandbox without allow-same-origin: opaque origin, no access to this page.
    const frame = h('iframe', { class: 'preview-frame', name: which, title: which === 'resurrected' ? t('resurrected version, running') : t('original version, running'), sandbox: 'allow-scripts', referrerpolicy: 'no-referrer' });
    frame.dataset.which = which;
    frame.srcdoc = built.html;
    state.frames.push(frame);
    return h('figure', {}, h('figcaption', { text: versionName(which) }), frame);
  }

  function onMessage(e) {
    const d = e.data;
    if (!d || d.ghostrepo !== 'preview-error') return;
    const frame = state.frames.find((f) => f.contentWindow === e.source);
    if (!frame) return;
    state.errors[frame.dataset.which].push(String(d.message).slice(0, 300));
    renderErrors();
  }

  function renderErrors() {
    clear(errorsBox);
    const r = state.errors.resurrected.length;
    const o = state.errors.original.length;
    errorsBox.append(h('p', { class: r > o ? 'error' : 'muted' }, t('Uncaught errors — resurrected: {r} · original: {o}', { r, o })));
    if (r > o) errorsBox.append(h('p', { class: 'error' }, t('The resurrected version raised errors the original did not. Review the diff before using it.')));
    for (const [which, list] of Object.entries(state.errors)) for (const m of list.slice(0, 5)) errorsBox.append(h('p', { class: 'muted' }, h('strong', { text: `${t(which)}: ` }), m));
  }

  function mount() {
    state.frames = [];
    state.errors = { resurrected: [], original: [] };
    clear(stage);
    clear(warningsBox);
    stage.className = `preview-stage ${state.mode === 'both' ? 'two' : 'one'}`;
    if (state.mode !== 'original') stage.append(makeFrame('resurrected'));
    if (state.mode !== 'resurrected') stage.append(makeFrame('original'));
    renderErrors();
    [...modeButtons.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  }

  for (const [mode, label] of modes) {
    modeButtons.append(h('button', { type: 'button', 'data-mode': mode, 'aria-pressed': 'false', onclick: () => { state.mode = mode; mount(); } }, label));
  }

  const runBtn = h('button', { type: 'button', class: 'primary', id: 'run-btn', onclick: () => {
    window.addEventListener('message', onMessage);
    onDispose(() => window.removeEventListener('message', onMessage));
    runBtn.hidden = true;
    intro.hidden = true;
    controls.hidden = false;
    mount();
  } }, t('▶ Run'));
  const intro = h('p', { class: 'muted' }, t('Nothing from the repository runs until you press Run. The project then runs inside an isolated frame that cannot read this page or your data. Its requests and navigations are blocked, but WebRTC connections are not, so a server chosen by the project can still see your IP address.'));
  const controls = h('div', { class: 'preview-controls', hidden: true }, modeButtons, errorsBox, stage, warningsBox);
  return h(
    'div',
    { class: 'run-tab' },
    intro,
    runBtn,
    controls,
    h('p', { class: 'note' }, t('The preview runs the project in a plain browser, with its requests blocked. Applications that depend on platform APIs (for example Firefox OS) may not run fully in either version.')),
  );
}

// --- Download tab ----------------------------------------------------------------------

export function renderDownloadTab(result, ctx) {
  const { repo, subfolder } = ctx;
  const card = (title, text, label, onclick) => h('div', { class: 'dl-card' }, h('h3', { text: title }), h('p', { class: 'muted', text }), h('button', { type: 'button', onclick }, label));
  return h(
    'div',
    { class: 'download-tab' },
    card(t('Resurrected project'), t('Every file of the analyzed folder, with the changed files rewritten. node_modules/ and .git/ are not included.'), t('⬇ Download .zip'), () => saveFile(`${repo}-resurrected.zip`, buildArchive(result), 'application/zip')),
    card(t('Report'), t('resurrection-report.json: the measured metrics and every skipped site.'), t('⬇ Download report'), () => saveFile('resurrection-report.json', buildReportJson(result), 'application/json')),
    card(t('Patch'), t('Only the changes, as a unified diff that git apply accepts.'), t('⬇ Download .patch'), () => saveFile(PATCH_FILE_NAME, buildPatch(result, subfolder), 'text/x-diff')),
    card(t('Pull request description'), t('{file}: the description generated from the report, for gh pr create --body-file or to paste on GitHub.', { file: PR_BODY_FILE_NAME }), t('⬇ Download description'), () => saveFile(PR_BODY_FILE_NAME, buildKit(result, ctx).body, 'text/markdown')),
  );
}

// --- Pull request tab ----------------------------------------------------------------------

function copyBlock(label, text, { multiline = true, rows = 6 } = {}) {
  const status = h('span', { class: 'copied', 'aria-live': 'polite' });
  const area = multiline ? h('textarea', { readonly: true, rows: String(rows), 'aria-label': label }) : h('input', { readonly: true, type: 'text', 'aria-label': label });
  area.value = text;
  return h(
    'div',
    { class: 'copy-block' },
    h('div', { class: 'copy-head' }, h('strong', { text: label }), h('span', {}, status, h('button', { type: 'button', onclick: async () => { const ok = await copyText(text); status.textContent = ok ? t('Copied') : t('Copy failed'); setTimeout(() => (status.textContent = ''), 2000); } }, t('Copy')))),
    area,
  );
}

// "Open pull request on GitHub" without a login (.kiro/specs/open-pull-request, requirement 4).
// The username is only ever read into the link below: never stored or sent.
function renderOpenPrLink(kit, ctx) {
  const help = h('p', { class: 'muted', id: 'open-pr-help' });
  const input = h('input', {
    id: 'gh-user',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: t('your-github-username'),
    'aria-describedby': 'open-pr-help',
    'aria-invalid': 'false',
  });
  const link = h('a', { class: 'btn primary', id: 'open-pr-link', target: '_blank', rel: 'noopener noreferrer', 'aria-disabled': 'true' }, t('Open pull request on GitHub ↗'));
  const baseHelp = t('Push the branch to your fork first (the commands above do it). The link only opens GitHub\'s "Open a pull request" page with the title and description filled in; GhostRepo does not create the pull request, you do.');

  function update() {
    const user = input.value.trim();
    const valid = isValidGitHubUsername(user);
    input.setAttribute('aria-invalid', user && !valid ? 'true' : 'false');
    const built = valid ? buildCompareLink({ owner: ctx.owner, repo: ctx.repo, base: ctx.defaultBranch, user, branch: kit.branch, title: kit.title, body: kit.body }) : null;
    if (built) {
      link.setAttribute('href', built.url);
      link.setAttribute('aria-disabled', 'false');
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
    }
    help.textContent =
      user && !valid
        ? t('That is not a valid GitHub username: 1 to 39 letters, digits or single hyphens, not starting or ending with a hyphen.')
        : built && built.shortened
          ? `${baseHelp} ${t('The description was too long for a link and is shortened there; paste the full text from the field below.')}`
          : baseHelp;
  }
  input.addEventListener('input', update);
  update();

  return h(
    'div',
    { class: 'open-pr' },
    h('h3', { text: t('Without the GitHub CLI') }),
    h('label', { for: 'gh-user', text: t('Your GitHub username (the owner of your fork)') }),
    h('div', { class: 'row' }, input, link),
    help,
  );
}

export function renderPrTab(result, ctx) {
  const kit = buildKit(result, ctx);
  const repoUrl = `https://github.com/${ctx.owner}/${ctx.repo}`;
  // The kit itself (commands, commit message, title, description) stays in English:
  // it is written into someone else's repository.
  const files = tn('{n} changed file', '{n} changed files', kit.changedPaths.length);
  const forkHelp = t('"gh repo fork --remote" (GitHub CLI) creates your fork and makes it origin; without the GitHub CLI, fork on GitHub, run git remote add fork https://github.com/<you>/{repo}.git and push to fork instead.', { repo: ctx.repo });
  const steps = kit.archived
    ? [
        t('Download the patch into an empty folder and open a shell there: the commands clone the repository into that folder and read the patch from it.'),
        `${t('Run the commands below. They branch from the exact commit that was analyzed and push the result to your fork.')} ${forkHelp}`,
        t('Your fork now holds the resurrection. Share it, keep developing it there, or download the resurrected project as a zip from the Download tab.'),
      ]
    : [
        t('Download the patch and the description ({file}) into the same empty folder and open a shell there: the commands clone the repository into that folder and read both files from it.', { file: PR_BODY_FILE_NAME }),
        `${t('Run the commands below. They branch from the exact commit that was analyzed.')} ${forkHelp}`,
        t('The last command, gh pr create, opens the pull request with the title and description. Without the GitHub CLI, use the button below instead.'),
      ];
  return h(
    'div',
    { class: 'pr-tab' },
    kit.archived
      ? h(
          'p',
          { class: 'archived-note', id: 'pr-archived-note' },
          h('strong', { text: t('This repository is archived. ') }),
          t('It is read-only on GitHub, so it cannot receive a pull request. The commands below push the resurrection to your fork instead.'),
        )
      : null,
    h('p', {}, t('This kit contains only the {files}, as one atomic change. Nothing is sent anywhere: you decide when to push.', { files })),
    h('ol', { class: 'steps' }, steps.map((s) => h('li', { text: s }))),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'primary', onclick: () => saveFile(PATCH_FILE_NAME, kit.patch, 'text/x-diff') }, t('⬇ Download {file}', { file: PATCH_FILE_NAME })),
      kit.archived ? null : h('button', { type: 'button', onclick: () => saveFile(PR_BODY_FILE_NAME, kit.body, 'text/markdown') }, t('⬇ Download {file}', { file: PR_BODY_FILE_NAME })),
      h('a', { class: 'btn', href: repoUrl, target: '_blank', rel: 'noopener noreferrer' }, t('Open the repository on GitHub')),
    ),
    kit.archived
      ? null
      : ctx.defaultBranch
        ? renderOpenPrLink(kit, ctx)
        : h('p', { class: 'muted', text: t('GitHub did not report a default branch for this repository, so the one-click link is not offered. The gh pr create command still works.') }),
    copyBlock(t('Branch name'), kit.branch, { multiline: false }),
    copyBlock(t('Commands'), kit.commands.join('\n'), { rows: Math.min(kit.commands.length + 1, 10) }),
    copyBlock(t('Commit message'), kit.commitMessage, { rows: 5 }),
    copyBlock(t('Pull request title'), kit.title, { multiline: false }),
    copyBlock(t('Pull request description'), kit.body, { rows: 18 }),
  );
}

// --- Tabs ----------------------------------------------------------------------------------

export function renderTabs(tabs, initial) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const panels = h('div', { class: 'panels' });
  const buttons = [];
  const nodes = new Map();
  let active = null;

  function activate(id) {
    active = id;
    buttons.forEach((b) => {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    clear(panels);
    if (!nodes.has(id)) nodes.set(id, tabs.find((t) => t.id === id).render());
    const panel = h('div', { role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, tabindex: '0' }, nodes.get(id));
    panels.append(panel);
  }

  for (const t of tabs) {
    const b = h('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'data-tab': t.id, 'aria-controls': `panel-${t.id}`, 'aria-selected': 'false', onclick: () => activate(t.id), onkeydown: (e) => {
      const i = buttons.indexOf(b);
      const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!move) return;
      const next = buttons[(i + move + buttons.length) % buttons.length];
      next.focus();
      activate(next.dataset.tab);
    } }, t.label);
    buttons.push(b);
    bar.append(b);
  }
  activate(tabs.some((t) => t.id === initial) ? initial : tabs[0].id);
  return h('section', { class: 'card tabs-card' }, bar, panels);
}

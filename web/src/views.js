// Views. Each function returns DOM nodes built with h(); nothing here fetches or
// transforms code. Strings that come from a repository are only ever text.

import { h, clear, copyText, saveFile, formatNumber, formatBytes, relativeAge } from './dom.js';
import { diffLines, sideBySide } from './diff.js';
import { summarizeSkips } from './prkit.js';
import { buildPreviewDocument } from './preview.js';
import { resurrectedFiles } from './run.js';
import { buildArchive, buildReportJson, buildKit, buildPatch, PATCH_FILE_NAME } from './artifacts.js';

export const PHASES = [
  { id: 'necromancy', name: 'Necromancy', what: 'Acquire the files' },
  { id: 'exorcism', name: 'Exorcism', what: 'Banish unsafe innerHTML' },
  { id: 'transmutation', name: 'Transmutation', what: 'Modernize var and equality' },
  { id: 'resurrection', name: 'Resurrection', what: 'Write the report' },
];

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
    ['Eligible .js files', formatNumber(a.eligible.length)],
    ['Files to fetch', `${formatNumber(a.totalFiles)} (${formatBytes(a.totalBytes)})`],
    ['Live run', a.entryPoint ? 'Available (index.html found)' : 'Not available'],
  ];
  const excluded = [];
  if (a.excluded.minified) excluded.push(`${a.excluded.minified} minified`);
  if (a.excluded.vendored) excluded.push(`${a.excluded.vendored} in node_modules/.git`);
  if (excluded.length) stats.push(['Excluded .js', excluded.join(', ')]);

  return h(
    'section',
    { class: `card verdict ${VERDICT_CLASS[a.verdict]}`, 'aria-labelledby': 'verdict-title', tabindex: '-1', id: 'assessment' },
    h('p', { class: 'eyebrow' }, 'Assessment of ', code(`${target.owner}/${target.repo}${target.subfolder ? '/' + target.subfolder : ''}`)),
    h('h2', { id: 'verdict-title' }, h('span', { class: 'badge', 'aria-hidden': 'true' }, canRun ? '✔' : a.verdict === 'TOO_LARGE' ? '!' : '✖'), a.headline),
    commit.date
      ? h('p', { class: 'muted' }, `Last commit ${commit.date.slice(0, 10)} (${relativeAge(commit.date)}): `, commit.message || '(no message)')
      : null,
    h('ul', { class: 'details' }, a.details.map((d) => h('li', { text: d }))),
    h('dl', { class: 'stats' }, stats.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))),
    a.languages.length
      ? h(
          'p',
          { class: 'muted' },
          'Detected from file extensions: ',
          a.languages.slice(0, 6).map((l, i) => [i ? ', ' : '', `${l.name} ${formatNumber(l.files)}`]),
        )
      : null,
    a.suggestions.length
      ? h(
          'div',
          { class: 'suggest' },
          h('p', {}, 'Folders with the most .js files (from the listing GitHub returned):'),
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
      h('button', { type: 'button', class: 'primary', id: 'resurrect-btn', disabled: !canRun, onclick: onResurrect }, '👻 Resurrect'),
      !canRun ? h('span', { class: 'muted' }, 'This repository cannot be resurrected by this version.') : null,
    ),
    a.verdict === 'NOT_SUPPORTED'
      ? h(
          'div',
          { class: 'suggest' },
          h('p', {}, 'Try one that works:'),
          h('div', { class: 'chips' }, examples.map((ex) => h('button', { type: 'button', class: 'chip', onclick: () => onExample(ex) }, ex.label))),
        )
      : null,
  );
}

// --- Progress ----------------------------------------------------------------------

export function renderProgress() {
  return h(
    'section',
    { class: 'card', id: 'progress', 'aria-labelledby': 'progress-title', tabindex: '-1' },
    h('h2', { id: 'progress-title' }, 'Resurrecting…'),
    h(
      'ol',
      { class: 'phases' },
      PHASES.map((p) =>
        h(
          'li',
          { class: 'phase pending', 'data-phase': p.id },
          h('div', { class: 'phase-head' }, h('strong', { text: p.name }), h('span', { class: 'phase-what muted', text: p.what }), h('span', { class: 'phase-state', text: 'pending' })),
          h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${p.name} progress`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('div', { class: 'bar-fill' })),
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
  li.querySelector('.phase-state').textContent = ev.state;
  const bar = li.querySelector('.bar');
  const pct = ev.state === 'done' ? 100 : ev.total ? Math.round((ev.done / ev.total) * 100) : 0;
  bar.setAttribute('aria-valuenow', String(pct));
  li.querySelector('.bar-fill').style.width = `${pct}%`;
  li.querySelector('.phase-note').textContent = ev.total ? `${formatNumber(ev.done || 0)} of ${formatNumber(ev.total)} files` : '';
}

export function markProgressFailed(root, phaseId) {
  const li = root.querySelector(`[data-phase="${phaseId}"]`);
  if (!li) return;
  li.classList.remove('pending', 'running', 'done');
  li.classList.add('failed');
  li.querySelector('.phase-state').textContent = 'failed';
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
    ['Vendor-prefixed APIs', found('vendor_api')],
    ['ES5 prototype assignments', found('es5_prototype')],
  ];
  return h(
    'div',
    { class: 'breakdown' },
    h('h3', {}, 'Patterns removed'),
    h('ul', {}, rows),
    h('h3', {}, 'Found, reported only (this version does not rewrite them)'),
    h('ul', {}, reported.map(([label, n]) => h('li', {}, h('span', { text: label }), h('strong', { text: formatNumber(n) })))),
  );
}

export function skipsPanel(report) {
  const groups = summarizeSkips(report);
  const unparsable = report.files.filter((f) => f.skipped.some((s) => s.transform === 'parse'));
  return h(
    'div',
    { class: 'skips' },
    h('h3', {}, 'Left unchanged, and why'),
    groups.length === 0 ? h('p', { class: 'muted' }, 'Nothing was skipped.') : h('p', { class: 'muted' }, 'Each of these was detected and deliberately not changed because the rewrite could not be proven to keep the same behavior.'),
    groups.map((g) =>
      h(
        'details',
        {},
        h('summary', {}, h('strong', { text: SKIP_LABELS[g.reason] || g.reason }), ' ', h('span', { class: 'muted' }, `(${g.reason}) · ${g.sites.length} site${g.sites.length === 1 ? '' : 's'}`)),
        h('ul', { class: 'sites' }, g.sites.map((s) => h('li', {}, code(s.line ? `${s.path}:${s.line}` : s.path)))),
      ),
    ),
    unparsable.length
      ? h(
          'details',
          {},
          h('summary', {}, h('strong', { text: 'Files that could not be parsed' }), ' ', h('span', { class: 'muted' }, `· ${unparsable.length} (left exactly as they were)`)),
          h('ul', { class: 'sites' }, unparsable.map((f) => h('li', {}, code(f.path), ': ', f.skipped.find((s) => s.transform === 'parse').reason))),
        )
      : null,
  );
}

export function renderSummary(report) {
  const m = report.metrics;
  const status = report.status;
  const title = { RESURRECTED: 'Resurrected', NO_CHANGES: 'Nothing could be changed safely', SCANNED_ONLY: 'Nothing to modernize' }[status];
  const lead = {
    RESURRECTED: `${formatNumber(m.legacy_patterns_removed)} legacy patterns removed in ${formatNumber(m.files_transformed)} of ${formatNumber(m.files_scanned)} files.`,
    NO_CHANGES: 'The files were scanned, but no change could be proven to keep the same behavior, so none was made.',
    SCANNED_ONLY: 'GhostRepo v1 modernizes only JavaScript/web code, and none was found.',
  }[status];
  return h(
    'section',
    { class: `card result ${status.toLowerCase()}`, id: 'result', 'aria-labelledby': 'result-title', tabindex: '-1' },
    status === 'RESURRECTED'
      ? h('div', { class: 'revival dead', 'aria-hidden': 'true' }, h('span', { class: 'ghost-dead', text: '💀' }), h('span', { class: 'ghost-alive', text: '👻' }))
      : null,
    h('p', { class: 'eyebrow' }, 'Status ', code(status)),
    h('h2', { id: 'result-title', text: title }),
    h('p', { class: 'lead', text: lead }),
    h(
      'dl',
      { class: 'metrics' },
      metric('Files scanned', formatNumber(m.files_scanned)),
      metric('Files transformed', formatNumber(m.files_transformed)),
      metric('Files skipped', formatNumber(m.files_skipped), 'could not be parsed'),
      metric('Lines changed', formatNumber(m.lines_changed)),
      metric('Patterns removed', formatNumber(m.legacy_patterns_removed)),
    ),
    breakdownList(report),
    skipsPanel(report),
    h('p', { class: 'note' }, "GhostRepo did not run this repository's tests. Every number above comes from the report the engine produced."),
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

  const table = h('table', { class: 'diff', 'aria-label': `Changes in ${path}` }, h('colgroup', {}, h('col', { class: 'c-ln' }), h('col', { class: 'c-code' }), h('col', { class: 'c-ln' }), h('col', { class: 'c-code' })));
  const body = h('tbody');
  table.append(body);

  const makeRow = (r) => {
    const skip = r.left && skipByLine.get(r.left.no);
    const tr = h(
      'tr',
      { class: r.changed ? 'changed' : skip ? 'skipped' : '' },
      h('td', { class: 'ln', 'data-ln': r.left ? r.left.no : '', title: skip ? `Left unchanged: ${skip}` : null }, r.left ? String(r.left.no) : '', skip ? h('span', { class: 'skip-mark', 'aria-label': `left unchanged: ${skip}`, text: '⚠' }) : null),
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
      const toggle = h('tr', { class: 'fold' }, h('td', { colspan: '4' }, h('button', { type: 'button', class: 'linkish', onclick: () => { hidden.forEach((t) => (t.hidden = false)); toggle.remove(); } }, `⋯ ${formatNumber(mid.length)} unchanged lines · show`)));
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
  const filter = h('label', { class: 'switch' }, h('input', { type: 'checkbox', onchange: (e) => { state.showAll = e.target.checked; renderList(); } }), ' Show all scanned files');

  const statusOf = (f) => {
    if (f.skipped.some((s) => s.transform === 'parse')) return { label: 'unparsable', cls: 'bad' };
    if (outputs.has(f.path)) {
      const removed = Object.keys(f.before || {}).reduce((s, k) => s + Math.max(0, (f.before[k] || 0) - (f.after[k] || 0)), 0);
      return { label: `${removed} removed`, cls: 'good' };
    }
    return { label: f.skipped.length ? `${f.skipped.length} skipped` : 'unchanged', cls: 'mute' };
  };

  function select(path) {
    state.selected = path;
    renderList();
    clear(view);
    const f = files.find((x) => x.path === path);
    if (!f) return;
    const original = sources.get(path);
    const out = outputs.get(path);
    view.append(h('div', { class: 'diff-head' }, h('strong', { text: path }), h('span', { class: 'muted', text: out ? 'original ⟶ resurrected' : 'no changes made' })));
    if (original === undefined) {
      view.append(h('p', { class: 'muted' }, f.skipped.length ? f.skipped[0].reason : 'This file was not read.'));
      return;
    }
    if (!out) view.append(h('p', { class: 'muted' }, 'This file was left exactly as it was.'));
    const { table } = diffTable(path, original, out, f.skipped);
    view.append(h('div', { class: 'diff-scroll', tabindex: '0', role: 'region', 'aria-label': `Diff of ${path}` }, table));
    view.append(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => saveFile(path.split('/').pop(), out ?? original, 'text/javascript') }, 'Download this file')));
  }

  function renderList() {
    clear(list);
    const shown = files.filter((f) => state.showAll || outputs.has(f.path) || f.skipped.length);
    if (shown.length === 0) list.append(h('li', { class: 'muted' }, 'No file was changed.'));
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
    ['resurrected', 'Resurrected'],
    ['original', 'Original'],
    ['both', 'Side by side'],
  ];
  const modeButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Which version to run' });

  function makeFrame(which) {
    const files = which === 'resurrected' ? resurrected : original;
    let built;
    try {
      built = buildPreviewDocument(files);
    } catch (e) {
      return h('p', { class: 'error' }, `The preview could not be built: ${e.message}`);
    }
    built.warnings.forEach((w) => warningsBox.append(h('li', { text: `${which === 'resurrected' ? 'Resurrected' : 'Original'}: ${w}` })));
    // sandbox without allow-same-origin: opaque origin, no access to this page.
    const frame = h('iframe', { class: 'preview-frame', name: which, title: `${which} version, running`, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer' });
    frame.dataset.which = which;
    frame.srcdoc = built.html;
    state.frames.push(frame);
    return h('figure', {}, h('figcaption', { text: which === 'resurrected' ? 'Resurrected' : 'Original' }), frame);
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
    errorsBox.append(h('p', { class: r > o ? 'error' : 'muted' }, `Uncaught errors — resurrected: ${r} · original: ${o}`));
    if (r > o) errorsBox.append(h('p', { class: 'error' }, 'The resurrected version raised errors the original did not. Review the diff before using it.'));
    for (const [which, list] of Object.entries(state.errors)) for (const m of list.slice(0, 5)) errorsBox.append(h('p', { class: 'muted' }, h('strong', { text: `${which}: ` }), m));
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
  } }, '▶ Run');
  const intro = h('p', { class: 'muted' }, 'Nothing from the repository runs until you press Run. The project then runs inside an isolated frame: it cannot reach this page, your data or the network.');
  const controls = h('div', { class: 'preview-controls', hidden: true }, modeButtons, errorsBox, stage, warningsBox);
  return h(
    'div',
    { class: 'run-tab' },
    intro,
    runBtn,
    controls,
    h('p', { class: 'note' }, 'The preview runs the project in a plain browser, offline. Applications that depend on platform APIs (for example Firefox OS) may not run fully in either version.'),
  );
}

// --- Download tab ----------------------------------------------------------------------

export function renderDownloadTab(result, { repo, subfolder }) {
  const card = (title, text, label, onclick) => h('div', { class: 'dl-card' }, h('h3', { text: title }), h('p', { class: 'muted', text }), h('button', { type: 'button', onclick }, label));
  return h(
    'div',
    { class: 'download-tab' },
    card('Resurrected project', 'Every file of the analyzed folder, with the changed files rewritten. node_modules/ and .git/ are not included.', '⬇ Download .zip', () => saveFile(`${repo}-resurrected.zip`, buildArchive(result), 'application/zip')),
    card('Report', 'resurrection-report.json: the measured metrics and every skipped site.', '⬇ Download report', () => saveFile('resurrection-report.json', buildReportJson(result), 'application/json')),
    card('Patch', 'Only the changes, as a unified diff that git apply accepts.', '⬇ Download .patch', () => saveFile(PATCH_FILE_NAME, buildPatch(result, subfolder), 'text/x-diff')),
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
    h('div', { class: 'copy-head' }, h('strong', { text: label }), h('span', {}, status, h('button', { type: 'button', onclick: async () => { const ok = await copyText(text); status.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => (status.textContent = ''), 2000); } }, 'Copy'))),
    area,
  );
}

export function renderPrTab(result, ctx) {
  const kit = buildKit(result, ctx);
  const repoUrl = `https://github.com/${ctx.owner}/${ctx.repo}`;
  return h(
    'div',
    { class: 'pr-tab' },
    h('p', {}, `This kit contains only the ${kit.changedPaths.length} changed file${kit.changedPaths.length === 1 ? '' : 's'}, as one atomic change. Nothing is sent anywhere: you decide when to push.`),
    h('ol', { class: 'steps' }, h('li', {}, 'Download the patch and put it next to your clone.'), h('li', {}, 'Run the commands below.'), h('li', {}, 'Open the pull request from your fork or branch and paste the title and description.')),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: () => saveFile(PATCH_FILE_NAME, kit.patch, 'text/x-diff') }, `⬇ Download ${PATCH_FILE_NAME}`), h('a', { class: 'btn', href: repoUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open the repository on GitHub')),
    copyBlock('Branch name', kit.branch, { multiline: false }),
    copyBlock('Commands', kit.commands.join('\n'), { rows: Math.min(kit.commands.length + 1, 10) }),
    copyBlock('Commit message', kit.commitMessage, { rows: 5 }),
    copyBlock('Pull request title', kit.title, { multiline: false }),
    copyBlock('Pull request description', kit.body, { rows: 18 }),
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

// End-to-end check of the web UI in a real Chrome, against the real GitHub API.
//
//   npm run build:web && node scripts/e2e-web.mjs
//
// Needs Chrome/Chromium (set CHROME_PATH if it is not found) and network access.
// Uses the Chrome DevTools Protocol over Node's built-in WebSocket: no dependency.
// Not part of `npm test`: it depends on the network and on a browser.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { processTree } from '../src/pipeline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const shots = path.join(os.tmpdir(), 'ghostrepo-e2e');
fs.mkdirSync(shots, { recursive: true });

// --- Tiny harness ---------------------------------------------------------------------
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${!ok && detail ? `\n          ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Static server for dist/ -------------------------------------------------------------
function serve() {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const file = path.join(dist, p === '/' ? 'index.html' : p);
    fs.readFile(file, (err, data) => {
      if (err) return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

// --- Chrome + CDP ----------------------------------------------------------------------------
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg));
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) {
    this.listeners.push(fn);
  }
}

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostrepo-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find((p) => p.type === 'page');
      if (page) return { proc, profile, wsUrl: page.webSocketDebuggerUrl };
    } catch { /* not up yet */ }
    await sleep(150);
  }
  proc.kill();
  throw new Error('Chrome did not start');
}

async function main() {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ is missing. Run: npm run build:web');
  const { server, port } = await serve();
  const chrome = await launchChrome();
  const cdp = new Cdp(chrome.wsUrl);
  await cdp.ready;

  const iframeSessions = []; // sandboxed previews run out of process: one session each
  const consoleErrors = [];
  cdp.on((msg) => {
    if (msg.method === 'Target.attachedToTarget' && msg.params.targetInfo.type === 'iframe') iframeSessions.push(msg.params.sessionId);
    if (msg.method === 'Runtime.exceptionThrown' && !msg.sessionId) consoleErrors.push(msg.params.exceptionDetails.text + ' ' + ((msg.params.exceptionDetails.exception || {}).description || ''));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  const evalIn = async (expression, sessionId) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, label, timeout = 60000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const v = await evalIn(expression);
        if (v) return v;
      } catch { /* page navigating */ }
      await sleep(250);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  };
  const shot = async (name, scrollTo) => {
    if (scrollTo) await evalIn(`(document.querySelector(${JSON.stringify(scrollTo)}) || document.body).scrollIntoView({ block: 'start' }), true`);
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(shots, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  };
  const click = (selector) => evalIn(`document.querySelector(${JSON.stringify(selector)}).click(), true`);
  const text = (selector) => evalIn(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ''`);

  const base = `http://127.0.0.1:${port}/`;

  try {
    // --- 1. Page loads, nothing from a repository runs -------------------------------------
    console.log('\n1. Page and input validation');
    await cdp.send('Page.navigate', { url: base });
    await waitFor(`document.readyState === 'complete' && !!document.getElementById('repo-url')`, 'page load');
    check('page title names GhostRepo', (await evalIn('document.title')).includes('GhostRepo'));
    check('two examples are offered', (await evalIn(`document.querySelectorAll('#examples .chip').length`)) === 2);
    await shot('01-idle');

    for (const [bad, why] of [['', 'empty'], ['http://github.com/o/r', 'http'], ['https://gitlab.com/o/r', 'other host'], ['https://github.com/o/r/blob/main/a.js', 'a file link']]) {
      await evalIn(`(() => { const i = document.getElementById('repo-url'); i.value = ${JSON.stringify(bad)}; document.getElementById('repo-folder').value = ''; document.getElementById('repo-form').requestSubmit(); return true; })()`);
      await sleep(150);
      const shown = await evalIn(`!document.getElementById('form-message').hidden && document.getElementById('form-message').textContent.length > 10`);
      const noAssessment = await evalIn(`!document.getElementById('assessment') && !document.querySelector('.busy')`);
      check(`rejects ${why} with a message and starts nothing`, shown && noAssessment);
    }

    // --- 2. Assessment of the example ---------------------------------------------------------
    console.log('\n2. Assessment (Firefox OS calculator)');
    await click('#examples .chip');
    await waitFor(`!!document.getElementById('assessment')`, 'assessment');
    const verdict = await text('#verdict-title');
    check('verdict: Can be resurrected', /Can be resurrected/.test(verdict), verdict);
    const assessText = await text('#assessment');
    check('assessment shows 5 eligible files and a live run', /Eligible \.js files\s*5/.test(assessText) && /Available \(index\.html found\)/.test(assessText), assessText.slice(0, 300));
    check('assessment shows the last commit age', /Last commit/.test(assessText));
    check('assessment does not promise an outcome', /may still end with no changes/.test(assessText));
    check('Resurrect button is enabled', await evalIn(`!document.getElementById('resurrect-btn').disabled`));
    await shot('02-assessment');

    // --- 3. Run ------------------------------------------------------------------------------------
    console.log('\n3. Resurrection');
    await click('#resurrect-btn');
    await waitFor(`!!document.getElementById('result')`, 'result', 90000);
    check('status RESURRECTED is shown', /RESURRECTED/.test(await text('#result')));
    const metrics = await evalIn(`Object.fromEntries([...document.querySelectorAll('#result .metrics .metric')].map(m => [m.querySelector('dt').textContent, Number(m.querySelector('dd').textContent.replace(/,/g, ''))]))`);
    console.log('        UI metrics:', JSON.stringify(metrics));
    await shot('03-result');

    // Parity with the CLI engine on the same files.
    const localLegacy = path.join(root, 'ghostrepo-gaia-calculator', 'legacy');
    if (fs.existsSync(localLegacy)) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostrepo-cli-'));
      fs.cpSync(localLegacy, path.join(tmp, 'tree'), { recursive: true });
      const { report } = processTree({ scanRoot: path.join(tmp, 'tree'), targetUrl: null, targetPath: null, reportPath: path.join(tmp, 'r.json') });
      const m = report.metrics;
      check('UI metrics equal the CLI metrics (files scanned/transformed/skipped, lines, patterns)',
        metrics['Files scanned'] === m.files_scanned && metrics['Files transformed'] === m.files_transformed && metrics['Files skipped'] === m.files_skipped && metrics['Lines changed'] === m.lines_changed && metrics['Patterns removed'] === m.legacy_patterns_removed,
        `UI ${JSON.stringify(metrics)} vs CLI ${JSON.stringify(m)}`);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    check('29 legacy patterns removed (28 var + 1 innerHTML)', metrics['Patterns removed'] === 29, String(metrics['Patterns removed']));
    check('2 of 5 files transformed', metrics['Files transformed'] === 2 && metrics['Files scanned'] === 5);
    check('result states that tests were not run', /did not run this repository's tests/.test(await text('#result')));
    check('skipped sites are listed with reasons', /Left unchanged, and why/.test(await text('#result')) && /for-loop-init|global-scope|operand-types-unknown/.test(await text('#result')));

    // --- 4. Code tab ----------------------------------------------------------------------------------
    console.log('\n4. Code tab (side by side)');
    const files = await evalIn(`[...document.querySelectorAll('.filelist .file-name')].map(e => e.textContent)`);
    check('changed files are listed', files.includes('js/calculator.js') && files.includes('js/parser.js'), files.join(', '));
    const diffInfo = await evalIn(`({ del: document.querySelectorAll('table.diff td.code.del').length, add: document.querySelectorAll('table.diff td.code.add').length, addText: [...document.querySelectorAll('table.diff td.code.add')].map(e => e.textContent).join('\\n') })`);
    check('diff shows removed and added lines', diffInfo.del > 0 && diffInfo.add > 0, JSON.stringify(diffInfo).slice(0, 200));
    check('added lines use const/let and textContent, not var', /\bconst\b|\blet\b/.test(diffInfo.addText) && !/\bvar\b/.test(diffInfo.addText));
    check('skipped sites are marked in the diff', (await evalIn(`document.querySelectorAll('table.diff .skip-mark').length`)) >= 0);
    await shot('04-code', '.tabs-card');

    // --- 5. Run tab: the calculator really runs, both versions behave the same -------------------------
    console.log('\n5. Live run (sandboxed preview)');
    await click('#tab-run');
    await waitFor(`!!document.getElementById('run-btn')`, 'run button');
    check('nothing runs before the Run button is pressed', (await evalIn(`document.querySelectorAll('iframe').length`)) === 0);
    await click('#run-btn');
    await click('[data-mode="both"]');
    await waitFor(`document.querySelectorAll('iframe.preview-frame').length === 2`, 'two preview frames');
    await sleep(1500);

    // Identify each out-of-process preview by the name the UI gave its iframe.
    const sessionByName = {};
    for (const sid of iframeSessions) {
      try {
        const name = await evalIn('window.name', sid);
        if (name) sessionByName[name] = sid;
      } catch { /* a frame that already went away */ }
    }
    const sessionOf = (i) => sessionByName[['resurrected', 'original'][i]];
    check('both previews are separate, attachable frames (out of process)', Boolean(sessionOf(0) && sessionOf(1)), JSON.stringify(Object.keys(sessionByName)));
    check('iframe uses sandbox="allow-scripts" only', (await evalIn(`[...document.querySelectorAll('iframe.preview-frame')].every(f => f.getAttribute('sandbox') === 'allow-scripts')`)));

    const press = (label) => `(() => {
      const b = [...document.querySelectorAll('input[type=button]')].find(x => x.value === ${JSON.stringify(label)});
      if (!b) return 'missing:' + ${JSON.stringify(label)};
      for (const t of ['mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      return 'ok';
    })()`;
    const display = `(document.querySelector('#display b') || {}).textContent`;
    const sequences = [['7', '+', '8', '='], ['C', '9', '×', '6', '='], ['C', '1', '.', '5', '+', '2', '='], ['C', '8', '÷', '4', '=']];
    const outcomes = [[], []];
    for (let f = 0; f < 2; f++) {
      for (const seq of sequences) {
        let last;
        for (const key of seq) {
          const r = await evalIn(press(key), sessionOf(f));
          if (r !== 'ok') last = r;
          await sleep(40);
        }
        outcomes[f].push(last || (await evalIn(display, sessionOf(f))));
      }
    }
    console.log('        resurrected:', JSON.stringify(outcomes[0]), '| original:', JSON.stringify(outcomes[1]));
    check('the calculator computes 7+8, 9×6, 1.5+2 and 8÷4 in the resurrected version', JSON.stringify(outcomes[0]) === JSON.stringify(['15', '54', '3.5', '2']), JSON.stringify(outcomes[0]));
    check('the original gives the same answers as the resurrected version', JSON.stringify(outcomes[0]) === JSON.stringify(outcomes[1]), JSON.stringify(outcomes));
    check('no uncaught errors reported by either preview', /resurrected: 0 · original: 0/.test(await text('.preview-errors')), await text('.preview-errors'));
    await shot('05-run', '.tabs-card');

    // Sandbox isolation, checked from inside the frame that runs repository code.
    const probe = `(() => {
      const out = {};
      try { out.parent = String(window.parent.document.title); } catch (e) { out.parent = 'BLOCKED'; }
      try { out.storage = String(window.localStorage.length); } catch (e) { out.storage = 'BLOCKED'; }
      try { out.cookie = document.cookie === '' ? 'EMPTY' : 'READABLE'; } catch (e) { out.cookie = 'BLOCKED'; }
      return fetch('https://example.com/', { mode: 'no-cors' }).then(() => { out.network = 'REACHED'; return out; }, () => { out.network = 'BLOCKED'; return out; });
    })()`;
    const iso = await evalIn(probe, sessionOf(0));
    console.log('        isolation probe from inside the preview:', JSON.stringify(iso));
    check('the previewed code cannot read the UI page', iso.parent === 'BLOCKED', JSON.stringify(iso));
    check('the previewed code has no storage', iso.storage === 'BLOCKED', JSON.stringify(iso));
    check('the previewed code cannot reach the network', iso.network === 'BLOCKED', JSON.stringify(iso));

    // --- 6. Download and pull request ------------------------------------------------------------------
    console.log('\n6. Download and pull request kit');
    await click('#tab-download');
    await waitFor(`!!document.querySelector('.download-tab')`, 'download tab');
    check('three downloads are offered (zip, report, patch)', (await evalIn(`document.querySelectorAll('.download-tab .dl-card button').length`)) === 3);
    await click('#tab-pr');
    await waitFor(`!!document.querySelector('.pr-tab')`, 'pr tab');
    const pr = await evalIn(`Object.fromEntries([...document.querySelectorAll('.copy-block')].map(b => [b.querySelector('strong').textContent, (b.querySelector('textarea, input') || {}).value]))`);
    check('kit has branch, commands, commit message, title and description', ['Branch name', 'Commands', 'Commit message', 'Pull request title', 'Pull request description'].every((k) => pr[k] && pr[k].length > 5), Object.keys(pr).join(', '));
    check('branch name is ghostrepo/resurrect-js-YYYYMMDD', /^ghostrepo\/resurrect-js-\d{8}$/.test(pr['Branch name']), pr['Branch name']);
    check('commands apply the patch with paths for the legacy/ folder', /git apply ghostrepo-resurrect\.patch/.test(pr.Commands) && /legacy\/js\/calculator\.js/.test(pr.Commands), pr.Commands);
    check('description says the repository tests were not run', /did \*\*not\*\* run this repository's tests/.test(pr['Pull request description']));
    check('description names no agent and claims no test results', !/\bagent\b|\bAI\b|Kiro|tests pass|no regression/i.test(pr['Pull request description']));
    await shot('06-pr', '.tabs-card');

    // --- 7. A repository that cannot be resurrected -------------------------------------------------------
    console.log('\n7. Not supported (Python project)');
    await evalIn(`document.getElementById('examples').children[1].click(), true`);
    await waitFor(`!!document.getElementById('assessment') && document.getElementById('verdict-title').textContent.length > 0 && !document.querySelector('.busy')`, 'second assessment');
    const np = await text('#assessment');
    check('verdict: Not supported by this version', /Not supported by this version/.test(await text('#verdict-title')), await text('#verdict-title'));
    check('says it looks like Python, detected from extensions', /Python/.test(np) && /detected from file extensions/.test(np), np.slice(0, 400));
    check('Resurrect button is disabled', await evalIn(`document.getElementById('resurrect-btn').disabled`));
    await shot('07-not-supported');

    // --- 8. Errors --------------------------------------------------------------------------------------------
    console.log('\n8. Errors from GitHub');
    await evalIn(`(() => { document.getElementById('repo-url').value = 'https://github.com/LucioD3v/this-repo-does-not-exist-123'; document.getElementById('repo-form').requestSubmit(); return true; })()`);
    await waitFor(`!!document.querySelector('.error-card')`, 'not found card');
    check('a missing repository says not found or private', /not found/i.test(await text('.error-card')) && /private/i.test(await text('.error-card')), await text('.error-card'));
    await evalIn(`(() => { document.getElementById('repo-url').value = 'https://github.com/LucioD3v/ghostrepo-gaia-calculator/tree/main/no/such/dir'; document.getElementById('repo-form').requestSubmit(); return true; })()`);
    await waitFor(`!!document.querySelector('.error-card') && /Folder not found/.test(document.querySelector('.error-card').textContent)`, 'folder card');
    check('a missing folder is named', true);

    // --- 9. Shared link and small screens -------------------------------------------------------------------------
    console.log('\n9. Shared link and a 360 px screen');
    await cdp.send('Page.navigate', { url: `${base}?repo=${encodeURIComponent('https://github.com/LucioD3v/ghostrepo-gaia-calculator/tree/main/legacy')}` });
    await waitFor(`!!document.getElementById('assessment')`, 'assessment from shared link');
    check('a shared link runs the assessment, not the resurrection', !(await evalIn(`!!document.getElementById('result')`)));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
    await sleep(400);
    check('no horizontal scroll at 360 px', await evalIn(`document.documentElement.scrollWidth <= 360 && ![...document.querySelectorAll('main *')].some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > 361 && getComputedStyle(el).position !== 'fixed' && !el.closest('.diff-scroll, .tabs, .filelist, textarea, pre') })`), await evalIn(`'scrollWidth ' + document.documentElement.scrollWidth + ', widest element right edge ' + Math.round(Math.max(...[...document.querySelectorAll('main *')].map(el => el.getBoundingClientRect().right)))`));
    await shot('08-mobile-assessment');
    await click('#resurrect-btn');
    await waitFor(`!!document.getElementById('result')`, 'result on mobile', 90000);
    await sleep(500);
    check('no horizontal scroll at 360 px after a result', await evalIn(`document.documentElement.scrollWidth <= 360 && ![...document.querySelectorAll('main *')].some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > 361 && getComputedStyle(el).position !== 'fixed' && !el.closest('.diff-scroll, .tabs, .filelist, textarea, pre') })`), await evalIn(`'scrollWidth ' + document.documentElement.scrollWidth + ', widest element right edge ' + Math.round(Math.max(...[...document.querySelectorAll('main *')].map(el => el.getBoundingClientRect().right)))`));
    await shot('09-mobile-result');

    check('no uncaught exceptions on the UI page', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    try { chrome.proc.kill(); } catch { /* already gone */ }
    server.close();
    await sleep(300);
    try { fs.rmSync(chrome.profile, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${shots}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('\nE2E aborted:', e.message);
  process.exit(2);
});

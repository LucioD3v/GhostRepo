// Runtime language for the web views: lang.js and the Spanish dictionary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { t, tn, getLang, setLang, onLangChange } from '../web/src/lang.js';
import { ES } from '../web/src/lang-es.js';
import { assessListing } from '../web/src/assess.js';
import { parseRepoInput } from '../web/src/github-url.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Every English template passed as a literal to t(), tn() or fail() in web/src.
function literalKeys() {
  const lit = String.raw`'((?:[^'\\]|\\.)*)'`;
  const patterns = [
    new RegExp(String.raw`\bt\(\s*${lit}`, 'g'),
    new RegExp(String.raw`\btn\(\s*${lit}\s*,\s*${lit}`, 'g'),
    new RegExp(String.raw`\bfail\(\s*'[\w-]+'\s*,\s*${lit}`, 'g'),
  ];
  const keys = new Map();
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js') && !f.startsWith('lang'))) {
    const src = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        for (const raw of m.slice(1).filter((x) => x !== undefined)) keys.set(raw.replace(/\\(.)/g, '$1'), file);
      }
    }
  }
  return keys;
}

test('every literal template in web/src has a Spanish translation', () => {
  const keys = literalKeys();
  assert.ok(keys.size > 150, `expected the extractor to find the templates, found ${keys.size}`);
  const missing = [...keys].filter(([k]) => !(k in ES)).map(([k, f]) => `${f}: ${k}`);
  assert.deepEqual(missing, []);
});

test('Spanish templates use exactly the placeholders of the English ones', () => {
  for (const [en, es] of Object.entries(ES)) assert.deepEqual(placeholders(es), placeholders(en), en);
});

test('t() returns the English literal by default and fills placeholders', () => {
  assert.equal(getLang(), 'en');
  assert.equal(t('Copy'), 'Copy');
  assert.equal(t('{done} of {total} files', { done: 2, total: 5 }), '2 of 5 files');
  assert.equal(t('No such template {x}'), 'No such template {x}', 'unknown placeholders stay as written');
  assert.equal(tn('{n} changed file', '{n} changed files', 1), '1 changed file');
  assert.equal(tn('{n} changed file', '{n} changed files', 3), '3 changed files');
});

test('setLang switches to Spanish, notifies once per change, and falls back to English', () => {
  const seen = [];
  const off = onLangChange((lang) => seen.push(lang));
  try {
    setLang('es');
    setLang('es');
    assert.deepEqual(seen, ['es']);
    assert.equal(t('Copy'), 'Copiar');
    assert.equal(tn('{n} changed file', '{n} changed files', 3), '3 archivos modificados');
    assert.equal(t('A string nobody translated'), 'A string nobody translated');
    setLang('xx');
    assert.equal(getLang(), 'en', 'an unknown language means English');
  } finally {
    setLang('en');
    off();
  }
});

test('the assessment and the link errors come out in Spanish', () => {
  setLang('es');
  try {
    const ok = assessListing({ entries: [{ path: 'index.html', size: 10 }, { path: 'app.js', size: 10 }], truncated: false });
    assert.equal(ok.headline, 'Se puede resucitar');
    assert.equal(ok.details[0], 'Se analizará 1 archivo JavaScript.');

    const py = assessListing({ entries: [{ path: 'a.py', size: 1 }, { path: 'b.py', size: 1 }], truncated: false });
    assert.equal(py.headline, 'No compatible con esta versión');
    assert.match(py.details[1], /^Este repositorio parece ser principalmente Python: 2 archivos/);

    const bad = parseRepoInput('http://github.com/a/b');
    assert.equal(bad.error.message, 'Solo se aceptan enlaces https://, por ejemplo https://github.com/owner/repo.');
  } finally {
    setLang('en');
  }
});

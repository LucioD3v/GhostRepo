// GhostRepo · runtime language for the dynamic views (EN / ES).
// Pure module, no DOM: the views, the assessment and the GitHub client use it,
// and so do the node:test suites. The English text is the key, so English output
// is exactly the literal in the code; Spanish comes from lang-es.js and falls back
// to English for any string it does not have.

import { ES } from './lang-es.js';

let current = 'en';
const listeners = new Set();

export function getLang() {
  return current;
}

/** Switch language and notify listeners (only when it actually changes). */
export function setLang(lang) {
  const next = lang === 'es' ? 'es' : 'en';
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn(current);
}

/** @returns {() => void} unsubscribe */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Translate an English template and fill its {placeholders}.
 * @param {string} template English text, the lookup key
 * @param {Record<string, unknown>} [vars]
 */
export function t(template, vars = {}) {
  const src = current === 'es' && ES[template] != null ? ES[template] : template;
  return src.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

/** Singular or plural template by count; {n} is the count unless vars sets it. */
export function tn(one, other, count, vars = {}) {
  return t(count === 1 ? one : other, { n: count, ...vars });
}

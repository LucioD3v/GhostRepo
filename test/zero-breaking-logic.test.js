// Zero Breaking Logic regression suite.
//
// Every case below is a real legacy-JS pattern that a naive codemod breaks.
// For each one we run the ORIGINAL and the TRANSFORMED code in a fresh VM
// context over the same inputs and require identical observable results.
// A transform that changes behavior fails this suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { exorcise } from '../src/exorcise.js';
import { transmute } from '../src/transmute.js';

const resurrect = (src) => transmute(exorcise(src).code).code;

// Run `src` (which must define function `f`) and call f(...args) for every
// input. Exceptions are captured as values so they are compared too.
function observe(src, inputs) {
  return inputs.map((args) => {
    const ctx = vm.createContext({});
    try {
      vm.runInContext(src, ctx);
      return { ok: ctx.f(...args) };
    } catch (e) {
      return { threw: e.constructor.name };
    }
  });
}

function assertSameBehavior(name, src, inputs) {
  const out = resurrect(src);
  assert.doesNotThrow(() => new vm.Script(out), `${name}: output must parse`);
  assert.deepEqual(
    observe(out, inputs),
    observe(src, inputs),
    `${name}: behavior changed\n--- before\n${src}\n--- after\n${out}`,
  );
  return out;
}

// --- Patterns that MUST be left alone (or proven equivalent) -----------------

const hazards = {
  // Gaia calculator, js/calculator.js:33 — numeric-string check via coercion.
  // Naively strictened to `===` it is always false and the calculator dies.
  'coercion idiom (Firefox OS calculator isNumeric)': [
    `function f(value) { return (value - 0) == value && value.length > 0; }`,
    [['7'], ['3.5'], ['abc'], ['']],
  ],
  'DOM string compared to number': [
    `function f(v) { return v == 0; }`,
    [['0'], [0], [''], ['1']],
  ],
  'var used outside its block': [
    `function f(a) { if (a) { var x = 1; } return x; }`,
    [[true], [false]],
  ],
  'var used before declaration (hoisting)': [
    `function f() { y = 5; var y; return y; }`,
    [[]],
  ],
  'outer var reassigned by for-in': [
    `function f(o) { var k = null; for (k in o) {} return k; }`,
    [[{ a: 1, b: 2 }], [{}]],
  ],
  'var reassigned by destructuring': [
    `function f() { var a = 1, b = 2; [a, b] = [b, a]; return a; }`,
    [[]],
  ],
  'loop closure capture': [
    `function f() { var fns = []; for (var i = 0; i < 3; i++) { var v = i; fns.push(function () { return v; }); } return fns.map(function (g) { return g(); }).join(','); }`,
    [[]],
  ],
  'uninitialized var inside loop keeps value': [
    `function f() { var out = []; for (var i = 0; i < 3; i++) { var seen; if (i === 0) seen = 'x'; out.push(seen); } return out.join(','); }`,
    [[]],
  ],
  'var in switch case used by another case': [
    `function f(n) { switch (n) { case 1: var s = 'one'; case 2: return s; } }`,
    [[1], [2]],
  ],
  'var redeclared as parameter': [
    `function f(p) { var p = p || 'default'; return p; }`,
    [['given'], [undefined]],
  ],
  'top-level var is a global property': [
    `var counter = 1; function f() { return typeof globalThis.counter; }`,
    [[]],
  ],
  // --- TDZ hazards: var read before its binding is initialized (Blocker 1) ---
  'namespace default idiom in IIFE': [
    `function f() { var ns = ns || { v: 1 }; return ns.v; }`,
    [[]],
  ],
  'forward reference within one declaration': [
    `function f() { var a = b, b = 1; return String(a); }`,
    [[]],
  ],
  'self-reference from initializer IIFE': [
    `function f() { var App = (function () { return typeof App; })(); return App; }`,
    [[]],
  ],
  'hoisted function reads var before init': [
    `function f() { var r = g(); var x = 1; function g() { return x; } return String(r); }`,
    [[]],
  ],
};

for (const [name, [src, inputs]] of Object.entries(hazards)) {
  test(`zero breaking logic: ${name}`, () => {
    assertSameBehavior(name, src, inputs);
  });
}

test('the calculator coercion idiom is left untouched', () => {
  const src = hazards['coercion idiom (Firefox OS calculator isNumeric)'][0];
  assert.equal(resurrect(src), src);
});

// --- innerHTML: rendering cannot be checked in a VM, so assert the source ----

test('innerHTML with concatenated markup is not rewritten', () => {
  const src = `function f(el, n) { el.innerHTML = '<li>' + n + '</li>'; }`;
  assert.equal(resurrect(src), src);
});

test('innerHTML with an HTML entity is not rewritten', () => {
  const src = `function f(el) { el.innerHTML = '&times;'; }`;
  assert.equal(resurrect(src), src);
});

test('innerHTML with a dynamic value is flagged for review, not rewritten', () => {
  const src = `function f(el, v) { el.innerHTML = v; }`;
  const { code, stats } = exorcise(src);
  assert.equal(code, src);
  assert.deepEqual(stats.skipped.map((s) => s.reason), ['dynamic-value-needs-review']);
});

test('innerHTML with plain text is rewritten to textContent', () => {
  const src = `function f(el) { el.innerHTML = 'Hello'; el.innerHTML = 0; }`;
  const out = resurrect(src);
  assert.ok(out.includes("el.textContent = 'Hello'"));
  assert.ok(out.includes('el.textContent = 0'));
});

// --- Safe rewrites MUST still happen (the tool is not a no-op) ---------------

test('safe rewrites are applied and behave identically', () => {
  const src = `function f(x) {
  var kind = typeof x;
  var n = 0;
  if (kind == 'string') { n = n + 1; }
  if (typeof x != 'number') { n = n + 10; }
  return n;
}`;
  const out = assertSameBehavior('safe rewrites', src, [['s'], [1], [null], [{}]]);
  assert.ok(out.includes("const kind = typeof x"), 'kind -> const');
  assert.ok(out.includes('let n = 0'), 'n -> let');
  assert.ok(out.includes("typeof x !== 'number'"), 'typeof != -> !==');
  // `kind == 'string'` is NOT provable (kind is an identifier) and stays loose.
  assert.ok(out.includes("kind == 'string'"));
});

test('CRLF line endings are preserved', () => {
  const src = 'function f() {\r\n  var a = 1;\r\n  return a;\r\n}\r\n';
  const out = resurrect(src);
  assert.ok(out.includes('const a = 1'));
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF introduced');
});

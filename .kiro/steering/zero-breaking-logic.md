---
inclusion: fileMatch
fileMatchPattern: ["src/**/*.js", "test/**/*.js"]
---

# Zero-Breaking-Logic Rules

A rewrite is applied **only when it is provably behavior-preserving from the syntax**. When it is not provable, the site is skipped and the reason is recorded in `files[].skipped` with a `{ transform, reason, line }` entry. Nothing is ever silently skipped.

## `==` / `!=` → `===` / `!==`

Loose and strict equality give identical results only when both operands have the same type. The rewrite is applied only when both types are **statically known and equal**: string, number, or boolean literals; expression-free template literals; `typeof x` (always a string); `!x` (always a boolean).

Skip reasons:
- `nullish-idiom` — either operand is `null`, `undefined`, or `void 0` (protects intentional loose-null checks).
- `operand-types-unknown` — one or both operand types cannot be determined from the syntax.

## `var` → `const` / `let`

A `var` declaration is rewritten only when the resulting block-scoped binding provably behaves the same. Within that, a declarator becomes `const` if it is initialized and never reassigned (no assignment, destructuring, `++`/`--`, `for-in`/`for-of` target); otherwise `let`. A false positive on reassignment detection only downgrades `const` to `let`, which is always safe.

Skip reasons (the declaration is left as `var`):

| Reason | Why |
|---|---|
| `global-scope` | Top-level `var` creates a global-object property; `let`/`const` do not. |
| `used-outside-block` | The binding is read outside its declaring block → `ReferenceError` with `let`. |
| `used-before-declaration` | Temporal dead zone: `let`/`const` are not hoisted. |
| `used-in-initializer` | A reference in the declaration's own initializer evaluates before the binding exists. |
| `hoisted-function-capture` | A hoisted function that runs before the declaration would read an uninitialized binding. |
| `redeclared-in-scope` | `var a; … var a;` is legal; `let a; … let a;` is a `SyntaxError`. |
| `shadows-parameter` | Redeclaring a parameter is a `SyntaxError`. |
| `for-loop-init` | `for (var i = …)` has different per-iteration closure semantics. |
| `loop-closure-capture` | A closure inside a loop captures the binding; `let` gives each iteration its own. |
| `loop-uninitialized` | An uninitialized `var` inside a loop persists across iterations; `let` resets. |
| `switch-case` | Lexical bindings in a `case` share the whole switch body, creating a TDZ for other cases. |
| `non-block-position` | `if (a) var x = 1;` — `let`/`const` cannot appear as a single-statement body. |
| `dynamic-scope` | The function uses `eval` or `with`; references cannot be resolved statically. |
| `non-identifier-binding` | Destructuring patterns (`var { a } = o`) are out of scope for v1. |

## `innerHTML` → `textContent`

`element.innerHTML = rhs` is rewritten to `element.textContent = rhs` **only** when `rhs` is a plain-text string literal or expression-free template literal containing no `<` and no `&`, or a numeric/boolean literal.

Skip reasons:
- `markup-or-entity-literal` — the literal contains `<` or `&` (the two are not equivalent for markup or HTML entities).
- `dynamic-value-needs-review` — `rhs` is any non-literal expression (variable, call, concatenation). Flagged as an XSS risk; not rewritten because the value could be intentional markup.
- `compound-assignment` — `innerHTML +=` is never touched. Reads of `innerHTML` are never touched.

## Parse failures

A file that is not valid UTF-8 or that the parser rejects is skipped entirely and listed in `files[].skipped` with `{ transform: "parse", reason: "<parser error message>" }`. It is never silently dropped and never partially transformed.

## Test requirement

Every new transform must have a case in `test/zero-breaking-logic.test.js` that:
1. Runs the **original** code in a `node:vm` sandbox over a fixed set of inputs.
2. Runs the **transformed** code in a fresh sandbox over the same inputs.
3. Asserts identical results — including identical exceptions.

This covers the correctness of the transform itself, not just that the transform ran. Add the edge cases from the skip-reason table above as separate sub-tests.

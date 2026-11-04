// Phase 3 — Transmutation (modernize legacy JS)
//
// Pure codemod: takes source text, returns { code, stats }. Does no I/O.
//
// Every rewrite here must be PROVABLY behavior-preserving from the syntax alone.
// When that cannot be proven, the site is skipped and the reason is recorded.
// This is the Zero Breaking Logic guardrail (docs/RESURRECT-CLI.md §9).
//
// Transforms implemented:
//   * == -> ===  and  != -> !==   only when both operands provably have the
//     same type (e.g. `typeof x == 'string'`, or two literals of one type).
//     `(value - 0) == value` style coercion idioms are left untouched.
//   * var -> const / let          only when the binding's every reference sits
//     after the declaration, inside the declaring block, in a non-global scope,
//     with no loop-closure or dynamic-scope (eval / with) hazards.

import jscodeshift from 'jscodeshift';

const j = jscodeshift.withParser('babel');

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

const LOOP_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

/**
 * @param {string} source
 * @returns {{code:string, stats:{applied:number, transforms:string[], skipped:Array<{transform:string,reason:string,line?:number}>}}}
 */
export function transmute(source) {
  const root = j(source);
  const skipped = [];
  const transformsApplied = new Set();
  let applied = 0;

  // --- == / != -> === / !== -------------------------------------------------
  root.find(j.BinaryExpression).forEach((p) => {
    const op = p.node.operator;
    if (op !== '==' && op !== '!=') return;

    const reason = looseEqualitySkipReason(p.node);
    if (reason) {
      skipped.push({ transform: 'loose_equality', reason, line: lineOf(p.node) });
      return;
    }

    p.node.operator = op === '==' ? '===' : '!==';
    transformsApplied.add('loose_equality');
    applied += 1;
  });

  // --- var -> const / let ---------------------------------------------------
  root.find(j.VariableDeclaration, { kind: 'var' }).forEach((p) => {
    const reason = varSkipReason(p);
    if (reason) {
      skipped.push({ transform: 'var_to_const_let', reason, line: lineOf(p.node) });
      return;
    }

    const decl = p.node;
    const scope = enclosingFunction(p);
    const names = decl.declarations.map((d) => d.id.name);
    const allInitialized = decl.declarations.every((d) => d.init != null);
    const reassigned = names.some((name) => isReassignedWithin(name, scope));

    decl.kind = allInitialized && !reassigned ? 'const' : 'let';
    transformsApplied.add('var_to_const_let');
    applied += 1;
  });

  const code = applied > 0 ? root.toSource({ lineTerminator: detectEol(source) }) : source;
  return {
    code,
    stats: {
      applied,
      transforms: [...transformsApplied],
      skipped,
    },
  };
}

// --- Loose equality ----------------------------------------------------------

// Returns null when `a == b` is provably identical to `a === b`, else a reason.
// Loose and strict equality agree exactly when both operands have the same
// type, so we only convert when both static types are known and equal.
function looseEqualitySkipReason(node) {
  if (isNullish(node.left) || isNullish(node.right)) return 'nullish-idiom';

  const lt = staticType(node.left);
  const rt = staticType(node.right);
  if (lt && rt && lt === rt) return null;
  return 'operand-types-unknown';
}

// Statically known primitive type of an expression, or null when unknown.
function staticType(node) {
  if (!node) return null;
  switch (node.type) {
    case 'StringLiteral':
      return 'string';
    case 'NumericLiteral':
      return 'number';
    case 'BooleanLiteral':
      return 'boolean';
    case 'TemplateLiteral':
      return 'string';
    case 'Literal':
      if (typeof node.value === 'string') return 'string';
      if (typeof node.value === 'number') return 'number';
      if (typeof node.value === 'boolean') return 'boolean';
      return null;
    case 'UnaryExpression':
      if (node.operator === 'typeof') return 'string';
      if (node.operator === '!') return 'boolean';
      return null;
    default:
      return null;
  }
}

function isNullish(node) {
  if (!node) return false;
  if (node.type === 'NullLiteral') return true;
  if (node.type === 'Literal' && node.value === null && node.raw === 'null') return true;
  if (node.type === 'Identifier' && node.name === 'undefined') return true;
  if (node.type === 'UnaryExpression' && node.operator === 'void') return true;
  return false;
}

// --- var -> const / let ------------------------------------------------------

// Conservative skip rules. Returns a reason string, or null when safe.
function varSkipReason(path) {
  const decl = path.node;

  for (const d of decl.declarations) {
    if (!d.id || d.id.type !== 'Identifier') return 'non-identifier-binding';
  }

  const parent = path.parent && path.parent.node;
  if (!parent) return 'non-block-position';
  if (parent.type === 'ForStatement' || parent.type === 'ForInStatement' || parent.type === 'ForOfStatement') {
    return 'for-loop-init';
  }
  // `let`/`const` are only legal as statements of a block. `if (a) var x;` and
  // `case 1: var x;` either fail to parse or change scoping across cases.
  if (parent.type === 'SwitchCase') return 'switch-case';
  if (parent.type !== 'BlockStatement' && parent.type !== 'Program') return 'non-block-position';

  const scopePath = enclosingFunction(path);
  // Top-level `var` creates a property on the global object and is shared by
  // every classic <script>; `let`/`const` do not. Never touch it.
  if (scopePath.node.type === 'Program') return 'global-scope';

  if (usesDynamicScope(scopePath)) return 'dynamic-scope';

  const block = parent;
  const declStart = decl.start;
  const insideLoop = hasLoopBetween(path, scopePath);

  for (const d of decl.declarations) {
    const name = d.id.name;

    if (isParamName(scopePath.node, name)) return 'shadows-parameter';
    if (countBindings(name, scopePath) > 1) return 'redeclared-in-scope';

    for (const ref of referencesWithin(name, scopePath)) {
      if (ref.node === d.id) continue;
      // `let`/`const` are block-scoped: any use outside the declaring block
      // would become a ReferenceError (or silently hit an outer binding).
      if (!isInside(ref.node, block)) return 'used-outside-block';
      // Uses before the declaration would hit the temporal dead zone.
      if (ref.node.start < declStart) return 'used-before-declaration';
      // Inside a loop, `let` creates a fresh binding per iteration: closures
      // would capture different values than they did with `var`.
      if (insideLoop && ref.node.start > d.end && isInNestedFunction(ref, scopePath)) {
        return 'loop-closure-capture';
      }
    }

    // Inside a loop, an uninitialized `var x;` keeps its value across
    // iterations; `let x;` resets it to undefined every iteration.
    if (insideLoop && d.init == null) return 'loop-uninitialized';
  }

  return null;
}

function enclosingFunction(path) {
  let p = path.parent;
  while (p) {
    if (FUNCTION_TYPES.has(p.node.type) || p.node.type === 'Program') return p;
    p = p.parent;
  }
  return path;
}

function hasLoopBetween(path, scopePath) {
  let p = path.parent;
  while (p && p !== scopePath) {
    if (LOOP_TYPES.has(p.node.type)) return true;
    p = p.parent;
  }
  return false;
}

function isInNestedFunction(refPath, scopePath) {
  let p = refPath.parent;
  while (p && p !== scopePath) {
    if (FUNCTION_TYPES.has(p.node.type)) return true;
    p = p.parent;
  }
  return false;
}

function isInside(node, container) {
  return node.start >= container.start && node.end <= container.end;
}

function usesDynamicScope(scopePath) {
  let dynamic = false;
  j(scopePath).find(j.WithStatement).forEach(() => {
    dynamic = true;
  });
  j(scopePath)
    .find(j.CallExpression, { callee: { type: 'Identifier', name: 'eval' } })
    .forEach(() => {
      dynamic = true;
    });
  return dynamic;
}

function isParamName(fn, name) {
  return (fn.params || []).some((param) => patternNames(param).includes(name));
}

// Number of var / function declarations of `name` in this function scope
// (excluding nested functions, which have their own scope).
function countBindings(name, scopePath) {
  let count = 0;
  j(scopePath)
    .find(j.VariableDeclarator)
    .forEach((p) => {
      if (enclosingFunction(p.parent) !== scopePath) return;
      if (patternNames(p.node.id).includes(name)) count += 1;
    });
  j(scopePath)
    .find(j.FunctionDeclaration)
    .forEach((p) => {
      if (p === scopePath) return;
      if (enclosingFunction(p) !== scopePath) return;
      if (p.node.id && p.node.id.name === name) count += 1;
    });
  return count;
}

// Every Identifier path in the function that is a real reference to `name`
// (not a property key or member name). Nested functions are included on
// purpose: conservative, since a shadowing inner binding only causes a skip.
function referencesWithin(name, scopePath) {
  const refs = [];
  j(scopePath)
    .find(j.Identifier, { name })
    .forEach((p) => {
      if (isNonReferenceIdentifier(p)) return;
      refs.push(p);
    });
  return refs;
}

function isNonReferenceIdentifier(p) {
  const parent = p.parent && p.parent.node;
  if (!parent) return false;
  if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') &&
      parent.property === p.node && !parent.computed) return true;
  if ((parent.type === 'ObjectProperty' || parent.type === 'Property' ||
       parent.type === 'ObjectMethod' || parent.type === 'ClassMethod' ||
       parent.type === 'ClassProperty') &&
      parent.key === p.node && !parent.computed && !parent.shorthand) return true;
  if ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' ||
       parent.type === 'ContinueStatement') && parent.label === p.node) return true;
  return false;
}

// Is `name` written to (assignment, destructuring, ++/--, for-in/of target)
// anywhere in the function? A false positive only downgrades const -> let.
function isReassignedWithin(name, scopePath) {
  let reassigned = false;
  const scope = j(scopePath);

  scope.find(j.AssignmentExpression).forEach((p) => {
    if (patternNames(p.node.left).includes(name)) reassigned = true;
  });
  scope.find(j.UpdateExpression).forEach((p) => {
    if (p.node.argument && p.node.argument.type === 'Identifier' && p.node.argument.name === name) {
      reassigned = true;
    }
  });
  for (const type of [j.ForInStatement, j.ForOfStatement]) {
    scope.find(type).forEach((p) => {
      if (p.node.left.type !== 'VariableDeclaration' && patternNames(p.node.left).includes(name)) {
        reassigned = true;
      }
    });
  }
  return reassigned;
}

// Identifier names bound by a pattern (Identifier, array/object destructuring,
// defaults, rest). Member-expression targets bind nothing.
function patternNames(node) {
  if (!node) return [];
  switch (node.type) {
    case 'Identifier':
      return [node.name];
    case 'ArrayPattern':
      return node.elements.flatMap((e) => patternNames(e));
    case 'ObjectPattern':
      return node.properties.flatMap((prop) =>
        prop.type === 'RestElement' ? patternNames(prop.argument) : patternNames(prop.value),
      );
    case 'AssignmentPattern':
      return patternNames(node.left);
    case 'RestElement':
      return patternNames(node.argument);
    default:
      return [];
  }
}

function lineOf(node) {
  return node && node.loc ? node.loc.start.line : undefined;
}

export function detectEol(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

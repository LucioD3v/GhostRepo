// Phase 3 — Transmutation (modernize legacy JS)
//
// Pure codemod: takes source text, returns { code, stats }. Does no I/O.
//
// Transforms implemented (conservative; see docs/RESURRECT-CLI.md §3, §9):
//   * var -> const / let  (const when never reassigned, else let; several
//     hoisting / closure edge cases are skipped with a recorded reason).
//   * == -> ===  and  != -> !==  (skipped for the nullish idiom: when either
//     operand is the null literal, the `undefined` identifier, or `void 0`).

import jscodeshift from 'jscodeshift';

const j = jscodeshift.withParser('babel');

/**
 * @param {string} source
 * @returns {{code:string, stats:{applied:number, transforms:string[], skipped:Array<{transform:string,reason:string}>}}}
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

    if (isNullishOperand(p.node.left) || isNullishOperand(p.node.right)) {
      skipped.push({ transform: 'loose_equality', reason: 'nullish-idiom' });
      return;
    }

    p.node.operator = op === '==' ? '===' : '!==';
    transformsApplied.add('loose_equality');
    applied += 1;
  });

  // --- var -> const / let ---------------------------------------------------
  root.find(j.VariableDeclaration, { kind: 'var' }).forEach((p) => {
    const decl = p.node;

    const skipReason = varSkipReason(p, root);
    if (skipReason) {
      skipped.push({ transform: 'var_to_const_let', reason: skipReason });
      return;
    }

    // Decide const vs let: const only when every declarator is initialized and
    // none of the declared bindings are ever reassigned.
    const names = collectDeclaredNames(decl);
    const allInitialized = decl.declarations.every((d) => d.init != null);
    const reassigned = names.some((name) => isReassigned(name, root));

    decl.kind = allInitialized && !reassigned ? 'const' : 'let';
    transformsApplied.add('var_to_const_let');
    applied += 1;
  });

  const code = applied > 0 ? root.toSource() : source;
  return {
    code,
    stats: {
      applied,
      transforms: [...transformsApplied],
      skipped,
    },
  };
}

// An operand is part of the nullish idiom when it is the null literal, the
// identifier `undefined`, or the `void 0` expression.
function isNullishOperand(node) {
  if (!node) return false;
  if (node.type === 'NullLiteral') return true;
  if (node.type === 'Literal' && node.value === null && node.raw === 'null') return true;
  if (node.type === 'Identifier' && node.name === 'undefined') return true;
  if (node.type === 'UnaryExpression' && node.operator === 'void') return true;
  return false;
}

function collectDeclaredNames(decl) {
  const names = [];
  for (const d of decl.declarations) {
    if (d.id && d.id.type === 'Identifier') names.push(d.id.name);
    // Destructuring patterns are conservatively not handled for reassignment
    // analysis; varSkipReason skips them below.
  }
  return names;
}

// Conservative skip rules. Returns a reason string, or null when safe.
function varSkipReason(path, root) {
  const decl = path.node;

  // Destructuring / non-simple identifiers: skip (reassignment analysis of a
  // pattern is out of v1 scope).
  for (const d of decl.declarations) {
    if (!d.id || d.id.type !== 'Identifier') {
      return 'non-identifier-binding';
    }
  }

  // var used as a for/for-in/for-of loop init: closure-capture semantics can
  // change. Skip conservatively (docs §9).
  const parent = path.parent && path.parent.node;
  if (
    parent &&
    (parent.type === 'ForStatement' ||
      parent.type === 'ForInStatement' ||
      parent.type === 'ForOfStatement')
  ) {
    return 'for-loop-init';
  }

  // Redeclaration in the same scope: a naive const/let would throw SyntaxError.
  const names = collectDeclaredNames(decl);
  for (const name of names) {
    if (countVarDeclarationsOfName(name, root) > 1) {
      return 'redeclared-in-scope';
    }
  }

  return null;
}

function countVarDeclarationsOfName(name, root) {
  let count = 0;
  root.find(j.VariableDeclaration, { kind: 'var' }).forEach((p) => {
    for (const d of p.node.declarations) {
      if (d.id && d.id.type === 'Identifier' && d.id.name === name) count += 1;
    }
  });
  return count;
}

// Is `name` ever the target of an assignment or ++/-- anywhere in the tree?
// Conservative (whole-program, not scope-aware): a false positive only
// downgrades const->let, which is always safe.
function isReassigned(name, root) {
  let reassigned = false;

  root.find(j.AssignmentExpression).forEach((p) => {
    const left = p.node.left;
    if (left && left.type === 'Identifier' && left.name === name) {
      reassigned = true;
    }
  });

  root.find(j.UpdateExpression).forEach((p) => {
    const arg = p.node.argument;
    if (arg && arg.type === 'Identifier' && arg.name === name) {
      reassigned = true;
    }
  });

  return reassigned;
}

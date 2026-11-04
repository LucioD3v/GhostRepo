// Phase 1 — Necromancy (scan)
//
// Walks a working directory for .js files and counts five technical-debt
// patterns by inspecting the AST (not regex). The same countPatterns() function
// is used for both the "before" and "after" measurements so the two passes are
// always symmetric. See docs/RESURRECT-CLI.md §3 and §7.

import fs from 'node:fs';
import path from 'node:path';
import jscodeshift from 'jscodeshift';

// jscodeshift's default export is a babel-flavoured runner; its .js parser
// handles modern + legacy JavaScript.
const j = jscodeshift.withParser('babel');

// Vendor-prefixed identifiers that signal dead / deprecated browser APIs.
// These are reported-only in v1 (never auto-rewritten) — see docs §2.
const VENDOR_PREFIXED = /^(?:Moz|moz|webkit|Webkit|ms|o|O)[A-Z]/;
const VENDOR_KNOWN = new Set([
  'MozTransform',
  'webkitTransform',
  'mozRequestAnimationFrame',
  'webkitRequestAnimationFrame',
  'msRequestAnimationFrame',
  'webkitTransition',
  'MozTransition',
]);

/**
 * Count the five technical-debt categories in a JavaScript source string.
 * Returns an object keyed exactly as the report schema's files[].before/after.
 *
 * Throws if the source cannot be parsed — callers decide whether to treat the
 * file as skipped. This mirrors the "never silently drop" rule in docs §3.
 *
 * @param {string} source
 * @returns {{var:number, loose_equality:number, innerHTML:number, vendor_api:number, es5_prototype:number}}
 */
export function countPatterns(source) {
  const root = j(source);
  const counts = {
    var: 0,
    loose_equality: 0,
    innerHTML: 0,
    vendor_api: 0,
    es5_prototype: 0,
  };

  // var declarations: one per VariableDeclaration with kind === 'var'.
  root
    .find(j.VariableDeclaration, { kind: 'var' })
    .forEach(() => {
      counts.var += 1;
    });

  // loose equality: one per BinaryExpression with == or != operator.
  root.find(j.BinaryExpression).forEach((p) => {
    const op = p.node.operator;
    if (op === '==' || op === '!=') {
      counts.loose_equality += 1;
    }
  });

  // unsafe innerHTML assignment: AssignmentExpression (operator '=') whose LHS
  // member property is innerHTML.
  root.find(j.AssignmentExpression, { operator: '=' }).forEach((p) => {
    const left = p.node.left;
    if (
      left &&
      left.type === 'MemberExpression' &&
      isPropertyNamed(left, 'innerHTML')
    ) {
      counts.innerHTML += 1;
    }
  });

  // dead vendor-prefixed APIs: member access to a vendor-prefixed identifier.
  root.find(j.MemberExpression).forEach((p) => {
    const prop = p.node.property;
    if (prop && prop.type === 'Identifier' && !p.node.computed) {
      if (VENDOR_KNOWN.has(prop.name) || VENDOR_PREFIXED.test(prop.name)) {
        counts.vendor_api += 1;
      }
    }
  });

  // ES5 prototype assignment: AssignmentExpression whose LHS matches X.prototype.y
  root.find(j.AssignmentExpression).forEach((p) => {
    if (isPrototypeAssignment(p.node.left)) {
      counts.es5_prototype += 1;
    }
  });

  return counts;
}

function isPropertyNamed(memberExpr, name) {
  const prop = memberExpr.property;
  if (!prop) return false;
  if (!memberExpr.computed && prop.type === 'Identifier') {
    return prop.name === name;
  }
  // Handle computed string access el['innerHTML'] = x too.
  if (memberExpr.computed && prop.type === 'StringLiteral') {
    return prop.value === name;
  }
  if (memberExpr.computed && prop.type === 'Literal') {
    return prop.value === name;
  }
  return false;
}

// Matches X.prototype.y  (MemberExpression whose object is X.prototype).
function isPrototypeAssignment(left) {
  if (!left || left.type !== 'MemberExpression') return false;
  const obj = left.object;
  return (
    obj &&
    obj.type === 'MemberExpression' &&
    !obj.computed &&
    obj.property &&
    obj.property.type === 'Identifier' &&
    obj.property.name === 'prototype'
  );
}

/**
 * Recursively collect .js files under `dir`, skipping node_modules/, .git/, and
 * minified *.min.js files. Returns absolute paths.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function walkJsFiles(dir) {
  const results = [];
  const SKIP_DIRS = new Set(['node_modules', '.git']);

  function recurse(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      // Permission / IO error on a directory — skip it, keep walking the rest.
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        recurse(full);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.min.js')) continue;
        if (entry.name.endsWith('.js')) results.push(full);
      }
    }
  }

  recurse(dir);
  results.sort();
  return results;
}

export { j as parser };

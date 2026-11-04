// Phase 2 — Exorcism (banish security smells & dead APIs)
//
// Pure codemod: takes source text, returns { code, stats }. Does no I/O.
//
// Transform implemented:
//   element.innerHTML = <plain text>  ->  element.textContent = <plain text>
//
// Zero Breaking Logic (docs/RESURRECT-CLI.md §2, §9): `innerHTML` parses markup
// and decodes entities, `textContent` does not. The rewrite is only applied when
// the right-hand side is PROVABLY plain text:
//   * a string / template literal (no expressions) with no '<' and no '&', or
//   * a numeric or boolean literal.
// Everything else is skipped with a recorded reason:
//   * 'compound-assignment'        innerHTML += ...
//   * 'markup-or-entity-literal'   innerHTML = '<b>!</b>' or '&times;'
//   * 'dynamic-value-needs-review' innerHTML = someVariable (possible XSS sink;
//                                  flagged for review, never auto-rewritten)
//   * reads of innerHTML are never touched (only the LHS of `=`).
//
// Dead vendor-prefixed APIs are reported-only in v1 — no rewrite happens here.

import jscodeshift from 'jscodeshift';

import { detectEol } from './transmute.js';

const j = jscodeshift.withParser('babel');

// Any '<' or '&' may be interpreted by the HTML parser (tags, comments, entities).
const HTML_SIGNIFICANT = /[<&]/;

/**
 * @param {string} source
 * @returns {{code:string, stats:{applied:number, transform:string, skipped:Array<{transform:string,reason:string}>}}}
 */
export function exorcise(source) {
  const root = j(source);
  const skipped = [];
  let applied = 0;

  root.find(j.AssignmentExpression).forEach((p) => {
    const node = p.node;
    const left = node.left;

    if (!left || left.type !== 'MemberExpression') return;
    if (!isInnerHtml(left)) return;

    // Only plain `=` assignments. innerHTML += is not equivalent to textContent +=.
    if (node.operator !== '=') {
      skipped.push({
        transform: 'insecure_innerHTML',
        reason: 'compound-assignment',
        line: node.loc ? node.loc.start.line : undefined,
      });
      return;
    }

    const reason = plainTextSkipReason(node.right);
    if (reason) {
      skipped.push({
        transform: 'insecure_innerHTML',
        reason,
        line: node.loc ? node.loc.start.line : undefined,
      });
      return;
    }

    // Convert: rewrite the property identifier to textContent.
    rewriteInnerHtmlProperty(left);
    applied += 1;
  });

  const code = applied > 0 ? root.toSource({ lineTerminator: detectEol(source) }) : source;
  return {
    code,
    stats: { applied, transform: 'insecure_innerHTML', skipped },
  };
}

function isInnerHtml(memberExpr) {
  const prop = memberExpr.property;
  if (!prop) return false;
  if (!memberExpr.computed && prop.type === 'Identifier') {
    return prop.name === 'innerHTML';
  }
  if (memberExpr.computed && (prop.type === 'StringLiteral' || prop.type === 'Literal')) {
    return prop.value === 'innerHTML';
  }
  return false;
}

function rewriteInnerHtmlProperty(memberExpr) {
  const prop = memberExpr.property;
  if (!memberExpr.computed && prop.type === 'Identifier') {
    prop.name = 'textContent';
  } else if (memberExpr.computed) {
    if (prop.type === 'StringLiteral') prop.value = 'textContent';
    else if (prop.type === 'Literal') prop.value = 'textContent';
  }
}

// Returns null when `rhs` is provably plain text (identical rendering through
// innerHTML and textContent), otherwise the skip reason.
function plainTextSkipReason(rhs) {
  if (!rhs) return 'dynamic-value-needs-review';

  const text = literalText(rhs);
  if (text === null) return 'dynamic-value-needs-review';
  if (HTML_SIGNIFICANT.test(text)) return 'markup-or-entity-literal';
  return null;
}

// The exact text of a literal RHS, or null if the RHS is not a literal.
function literalText(rhs) {
  switch (rhs.type) {
    case 'StringLiteral':
      return rhs.value;
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return String(rhs.value);
    case 'Literal':
      return ['string', 'number', 'boolean'].includes(typeof rhs.value) ? String(rhs.value) : null;
    case 'TemplateLiteral':
      if (rhs.expressions.length > 0) return null;
      return rhs.quasis.map((q) => q.value.cooked ?? q.value.raw ?? '').join('');
    default:
      return null;
  }
}

// Phase 2 — Exorcism (banish security smells & dead APIs)
//
// Pure codemod: takes source text, returns { code, stats }. Does no I/O.
//
// Transform implemented:
//   element.innerHTML = <rhs>  ->  element.textContent = <rhs>
//
// Skip rules (syntactic and decidable — see docs/RESURRECT-CLI.md §2, §9):
//   * compound assignment (innerHTML +=) is skipped (reason 'compound-assignment').
//   * static markup literal whose value contains an HTML tag (/<[a-zA-Z!/]/) is
//     skipped (reason 'static-markup-literal').
//   * reads of innerHTML are never touched (only LHS of `=`).
//
// Dead vendor-prefixed APIs are reported-only in v1 — no rewrite happens here.

import jscodeshift from 'jscodeshift';

const j = jscodeshift.withParser('babel');

const HTML_TAG = /<[a-zA-Z!/]/;

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
      });
      return;
    }

    const rhs = node.right;
    if (isStaticMarkupLiteral(rhs)) {
      skipped.push({
        transform: 'insecure_innerHTML',
        reason: 'static-markup-literal',
      });
      return;
    }

    // Convert: rewrite the property identifier to textContent.
    rewriteInnerHtmlProperty(left);
    applied += 1;
  });

  const code = applied > 0 ? root.toSource() : source;
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

// A static markup literal is: a string literal, or a template literal with no
// expressions, whose string value contains an HTML tag.
function isStaticMarkupLiteral(rhs) {
  if (!rhs) return false;

  if (rhs.type === 'StringLiteral') {
    return HTML_TAG.test(rhs.value);
  }
  // Babel represents plain string literals as StringLiteral; recast/ast-types
  // may surface Literal with a string value.
  if (rhs.type === 'Literal' && typeof rhs.value === 'string') {
    return HTML_TAG.test(rhs.value);
  }
  if (rhs.type === 'TemplateLiteral' && rhs.expressions.length === 0) {
    const raw = rhs.quasis.map((q) => q.value.cooked ?? q.value.raw ?? '').join('');
    return HTML_TAG.test(raw);
  }
  return false;
}

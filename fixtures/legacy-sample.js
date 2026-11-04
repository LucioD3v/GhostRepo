// Tiny ES5 fixture exercising all FIVE scan categories so the AST codemods and
// counters can be verified without cloning a large external repo.
//
//   transformed  : var, loose equality (==/!=), unsafe innerHTML assignment
//   reported-only : ES5 prototype assignment, vendor-prefixed API (MozTransform)
//
// Edge cases deliberately present so the self-test can assert both outcomes:
//   * `typeof el.pop == 'function'` -> both operands are strings -> ===
//   * `count != undefined`  -> nullish idiom, loose-equality conversion SKIPPED
//   * `total == 0`          -> operand type unknown, conversion SKIPPED
//   * `label` never reassigned -> const ; `total` reassigned -> let
//   * `innerHTML = '0'`     -> plain-text literal -> textContent
//   * `innerHTML = String(total)` -> dynamic value, flagged for review, SKIPPED
//   * `innerHTML = '<b>!</b>'`    -> markup literal, SKIPPED

function Thing(el) {
  var label = 'ready';          // never reassigned -> const
  var total = 0;                // reassigned below -> let
  var count = el.pop();         // may be undefined

  if (typeof el.pop == 'function') { // provably same type -> ===
    label.toString();
  }

  if (count != undefined) {     // nullish idiom -> loose-equality SKIPPED
    total = total + count;
  }

  if (total == 0) {             // operand type unknown -> SKIPPED
    el.innerHTML = '0';         // plain-text literal -> textContent
  } else {
    el.innerHTML = String(total); // dynamic -> SKIPPED (needs review)
  }

  el.innerHTML = '<b>!</b>';    // markup literal -> SKIPPED

  el.style.MozTransform = 'rotate(0deg)'; // vendor-prefixed -> reported only
  return label;
}

// ES5 prototype assignment -> reported only (not transformed).
Thing.prototype.greet = function () {
  return 'hello';
};

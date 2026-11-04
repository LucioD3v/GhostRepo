// Tiny ES5 fixture exercising all FIVE scan categories so the AST codemods and
// counters can be verified without cloning a large external repo.
//
//   transformed  : var, loose equality (==/!=), unsafe innerHTML assignment
//   reported-only : ES5 prototype assignment, vendor-prefixed API (MozTransform)
//
// Edge cases deliberately present so the self-test can assert skips:
//   * `count != undefined`  -> nullish idiom, loose-equality conversion SKIPPED
//   * `total` is reassigned -> var -> let (not const)
//   * `innerHTML = '<b>!</b>'` static markup literal -> innerHTML conversion SKIPPED
//   * `innerHTML = '0'` tag-free literal -> CONVERTED
//   * `total` reassigned, `label` never reassigned -> const/let split

function Thing(el) {
  var label = 'ready';          // never reassigned -> const
  var total = 0;                // reassigned below -> let
  var count = el.pop();         // may be undefined

  if (count != undefined) {     // nullish idiom -> loose-equality SKIPPED
    total = total + count;
  }

  if (total == 0) {             // normal loose equality -> ===
    el.innerHTML = '0';         // tag-free literal -> textContent
  } else {
    el.innerHTML = String(total); // dynamic -> textContent
  }

  el.innerHTML = '<b>!</b>';    // static markup literal -> SKIPPED

  el.style.MozTransform = 'rotate(0deg)'; // vendor-prefixed -> reported only
  return label;
}

// ES5 prototype assignment -> reported only (not transformed).
Thing.prototype.greet = function () {
  return 'hello';
};

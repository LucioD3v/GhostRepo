// Browser stand-in for Node's `assert`. jscodeshift only calls assert.ok(cond, message).
function ok(value, message) {
  if (!value) throw new Error(message || 'Assertion failed');
}
module.exports = Object.assign(ok, { ok });

// Requirement 8: everything needed to open a pull request, with no credentials.
//
// Pure. The text is generated from the report only, so it can state nothing the
// engine did not measure: no test results, no performance claims, no security
// claims, and no agent. The one thing it says about verification is that
// GhostRepo did NOT run the repository's tests.

const CATEGORY_LABELS = {
  var_to_const_let: '`var` → `const`/`let`',
  loose_equality: '`==`/`!=` → `===`/`!==`',
  insecure_innerHTML: '`innerHTML = <plain text>` → `textContent`',
};

const REASON_TEXT = {
  'global-scope': 'top-level `var` (creates a global property)',
  'for-loop-init': '`var` in a `for` loop initializer',
  'loop-closure-capture': '`var` captured by a closure inside a loop',
  'loop-uninitialized': 'uninitialized `var` inside a loop',
  'switch-case': '`var` declared in a `switch` case',
  'used-outside-block': '`var` used outside its block',
  'used-before-declaration': '`var` used before its declaration',
  'used-in-initializer': '`var` referenced inside its own initializer',
  'hoisted-function-capture': '`var` read by a hoisted function before it is initialized',
  'redeclared-in-scope': '`var` declared more than once in the same scope',
  'shadows-parameter': '`var` with the same name as a parameter',
  'non-block-position': '`var` not directly inside a block',
  'dynamic-scope': 'function uses `eval` or `with`',
  'non-identifier-binding': 'destructuring declaration',
  'nullish-idiom': 'comparison with `null`/`undefined` (`== null` idiom)',
  'operand-types-unknown': 'operand types are not known statically',
  'dynamic-value-needs-review': '`innerHTML` assigned a dynamic value (needs human review)',
  'markup-or-entity-literal': '`innerHTML` assigned markup or an entity',
  'compound-assignment': '`innerHTML +=`',
};

const MAX_LINES_LISTED = 8;

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Group every skip of the report by transform and reason. */
export function summarizeSkips(report) {
  const groups = new Map();
  for (const file of report.files) {
    for (const skip of file.skipped) {
      if (skip.transform === 'parse') continue;
      const key = `${skip.transform}\u0000${skip.reason}`;
      if (!groups.has(key)) groups.set(key, { transform: skip.transform, reason: skip.reason, sites: [] });
      groups.get(key).sites.push({ path: file.path, line: skip.line });
    }
  }
  return [...groups.values()].sort((a, b) => b.sites.length - a.sites.length || a.reason.localeCompare(b.reason));
}

function title(report) {
  const parts = [];
  const b = report.metrics.breakdown;
  if (b.var_to_const_let > 0) parts.push('`var` → `const`/`let`');
  if (b.loose_equality > 0) parts.push('strict equality');
  if (b.insecure_innerHTML > 0) parts.push('`innerHTML` → `textContent`');
  return `Modernize legacy JavaScript${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

function plainTitle(report) {
  return title(report).replace(/`/g, '');
}

function prefixed(prefix, p) {
  return prefix ? `${prefix}/${p}` : p;
}

/**
 * @param {object} input
 * @param {object} input.report      the resurrection report
 * @param {string} input.owner
 * @param {string} input.repo
 * @param {string|null} input.ref
 * @param {string} input.subfolder   '' when the repository root was analyzed
 * @param {string[]} input.changedPaths  paths relative to the scanned root
 * @param {string} input.patchFileName
 * @param {string} input.toolUrl     where GhostRepo lives
 * @param {Date} [input.date]
 */
export function buildPrKit({ report, owner, repo, ref, subfolder, changedPaths, patchFileName, toolUrl, date = new Date() }) {
  const m = report.metrics;
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const branch = `ghostrepo/resurrect-js-${stamp}`;
  const prTitle = plainTitle(report);
  const repoPaths = changedPaths.map((p) => prefixed(subfolder, p));

  // --- Description -------------------------------------------------------------
  const lines = [];
  lines.push('## Summary', '');
  lines.push(
    `This pull request modernizes legacy JavaScript in ${subfolder ? `\`${subfolder}/\`` : 'this repository'}: ` +
      `${plural(m.legacy_patterns_removed, 'pattern', 'patterns')} removed in ${plural(m.files_transformed, 'file', 'files')}, ` +
      `${plural(m.lines_changed, 'line', 'lines')} changed.`,
    '',
  );

  lines.push('## What changed', '', '| Change | Occurrences |', '|---|---|');
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    if (m.breakdown[key] > 0) lines.push(`| ${label} | ${m.breakdown[key]} |`);
  }
  lines.push('', 'Changed files:', '');
  for (const p of repoPaths) lines.push(`- \`${p}\``);
  lines.push('');

  const skips = summarizeSkips(report);
  lines.push('## What was left unchanged, and why', '');
  if (skips.length === 0) {
    lines.push('Nothing was skipped.', '');
  } else {
    lines.push(
      'Each of these was detected and deliberately not changed, because the rewrite could not be proven to keep the same behavior.',
      '',
    );
    for (const g of skips) {
      const where = g.sites
        .slice(0, MAX_LINES_LISTED)
        .map((s) => (s.line ? `${prefixed(subfolder, s.path)}:${s.line}` : prefixed(subfolder, s.path)))
        .join(', ');
      const more = g.sites.length > MAX_LINES_LISTED ? `, and ${g.sites.length - MAX_LINES_LISTED} more` : '';
      lines.push(`- **${REASON_TEXT[g.reason] || g.reason}** (\`${g.reason}\`): ${plural(g.sites.length, 'site', 'sites')} — ${where}${more}`);
    }
    lines.push('');
  }

  const unparsable = report.files.filter((f) => f.skipped.some((s) => s.transform === 'parse'));
  if (unparsable.length > 0) {
    lines.push('## Files that could not be parsed', '', 'These files were left exactly as they were:', '');
    for (const f of unparsable) {
      const reason = f.skipped.find((s) => s.transform === 'parse').reason;
      lines.push(`- \`${prefixed(subfolder, f.path)}\`: ${reason}`);
    }
    lines.push('');
  }

  lines.push(
    '## How it was made',
    '',
    'The changes come from deterministic AST-based codemods (no regular-expression rewriting). A rewrite is applied only when it is provably behavior-preserving; anything else is skipped and listed above.',
    '',
    '## Not verified',
    '',
    "GhostRepo did **not** run this repository's tests or build. Please run your test suite and review the diff before merging.",
    '',
    '---',
    `Generated with [GhostRepo](${toolUrl}).`,
  );
  const body = lines.join('\n');

  // --- Commit and commands -----------------------------------------------------
  const commitMessage =
    `${prTitle}\n\n` +
    `Removes ${plural(m.legacy_patterns_removed, 'legacy pattern', 'legacy patterns')} ` +
    `in ${plural(m.files_transformed, 'file', 'files')} with AST-based codemods that skip anything ` +
    'not provably behavior-preserving.';

  const commands = [
    `git clone https://github.com/${owner}/${repo}.git`,
    `cd ${repo}`,
    ...(ref ? [`git checkout ${ref}`] : []),
    `git checkout -b ${branch}`,
    `git apply ${patchFileName}`,
    `git add ${repoPaths.map((p) => `"${p}"`).join(' ')}`,
    `git commit -m "${prTitle.replace(/"/g, '\\"')}"`,
    `git push -u origin ${branch}`,
  ];

  return { branch, title: prTitle, commitMessage, body, commands, changedPaths: repoPaths };
}

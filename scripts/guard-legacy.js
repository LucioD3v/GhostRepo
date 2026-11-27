#!/usr/bin/env node
// Kiro Pre Tool Use hook (.kiro/hooks/guard-legacy-sources.json).
//
// Recovered dead code (any "legacy/" folder) and the test fixtures are
// evidence: the resurrection is measured against them, so an agent must never
// edit them. Kiro passes the tool call as JSON on stdin:
//   { "hook_event_name": "PreToolUse", "tool_name": "...", "tool_input": { ... } }
// A non-zero exit blocks the tool and sends stderr to the agent.
//
// Input that is not JSON, or that names no path, is allowed: this hook only
// guards paths it can see.

import { fileURLToPath } from 'node:url';

const PATH_KEY = /path|file|target|dest/i;

/** Every string under a path-like key, at any depth of tool_input. */
export function pathsIn(value, key = '') {
  if (typeof value === 'string') return PATH_KEY.test(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((v) => pathsIn(v, key));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => pathsIn(v, k));
  return [];
}

/** The reason a path is protected, or null. */
export function protectedReason(p) {
  const segments = String(p).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (segments.includes('legacy')) return `"${p}" is inside a legacy/ folder: recovered dead code is evidence and is never edited.`;
  if (segments.includes('fixtures')) return `"${p}" is a test fixture: fixtures are evidence and are never edited.`;
  return null;
}

/** @returns {{block: boolean, reason?: string}} */
export function check(input) {
  let ctx;
  try {
    ctx = JSON.parse(input);
  } catch {
    return { block: false };
  }
  for (const p of pathsIn(ctx && ctx.tool_input)) {
    const reason = protectedReason(p);
    if (reason) return { block: true, reason };
  }
  return { block: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    const r = check(input);
    if (r.block) {
      process.stderr.write(`Blocked by guard-legacy-sources: ${r.reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}

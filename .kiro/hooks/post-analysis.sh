#!/usr/bin/env bash
# GhostRepo Post-Analysis Hook
#
# Generates the Resurrection Report from REAL measurements only.
# Nothing in this report is hardcoded: every number is computed from the
# actual source (legacy/ vs src/), the git diff, and the test run. If a value
# cannot be measured, it is reported as null/0 — never faked.
#
# Usage (run from the resurrected repo root, where legacy/ and src/ live):
#   bash post-analysis.sh
#
# Optional env:
#   LEGACY_DIR (default: legacy)
#   SRC_DIR    (default: src)
#   OUT_FILE   (default: resurrection-report.json)

set -euo pipefail

LEGACY_DIR="${LEGACY_DIR:-legacy}"
SRC_DIR="${SRC_DIR:-src}"
OUT_FILE="${OUT_FILE:-resurrection-report.json}"

echo "👻 [GhostRepo] Post-Analysis: measuring the resurrection (real metrics only)..."

# --- Repository name (best effort; null if unavailable) -----------------------
REPO_NAME="null"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  url="$(git config --get remote.origin.url 2>/dev/null || true)"
  if [ -n "${url}" ]; then
    name="$(basename "${url}" .git)"
    REPO_NAME="\"${name}\""
  fi
fi

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# --- Helper: count regex occurrences across a directory's JS files ------------
# Prints 0 if the directory does not exist (honest zero, not a guess).
count_pattern() {
  local dir="$1" pattern="$2"
  if [ -d "${dir}" ]; then
    grep -rohE "${pattern}" "${dir}" --include='*.js' 2>/dev/null | wc -l | tr -d ' '
  else
    echo 0
  fi
}

# --- Legacy anti-patterns measured in the ORIGINAL source ---------------------
VAR_BEFORE=$(count_pattern "${LEGACY_DIR}" '\bvar\b')
INNERHTML_BEFORE=$(count_pattern "${LEGACY_DIR}" 'innerHTML')
MOZTRANSFORM_BEFORE=$(count_pattern "${LEGACY_DIR}" 'MozTransform')
LOOSE_EQ_BEFORE=$(count_pattern "${LEGACY_DIR}" '[^=!<>]==[^=]|!=[^=]')

# --- Same anti-patterns measured in the RESURRECTED source --------------------
VAR_AFTER=$(count_pattern "${SRC_DIR}" '\bvar\b')
INNERHTML_AFTER=$(count_pattern "${SRC_DIR}" 'innerHTML')
MOZTRANSFORM_AFTER=$(count_pattern "${SRC_DIR}" 'MozTransform')
LOOSE_EQ_AFTER=$(count_pattern "${SRC_DIR}" '[^=!<>]==[^=]|!=[^=]')

# Legacy patterns actually removed (never negative).
removed() {
  local before="${1:-0}"
  local after="${2:-0}"
  local diff=$(( before - after ))
  if [ "${diff}" -lt 0 ]; then
    diff=0
  fi
  echo "${diff}"
}
VAR_REMOVED=$(removed "${VAR_BEFORE}" "${VAR_AFTER}")
INNERHTML_REMOVED=$(removed "${INNERHTML_BEFORE}" "${INNERHTML_AFTER}")
MOZTRANSFORM_REMOVED=$(removed "${MOZTRANSFORM_BEFORE}" "${MOZTRANSFORM_AFTER}")
LOOSE_EQ_REMOVED=$(removed "${LOOSE_EQ_BEFORE}" "${LOOSE_EQ_AFTER}")
LEGACY_PATTERNS_REMOVED=$(( VAR_REMOVED + INNERHTML_REMOVED + MOZTRANSFORM_REMOVED + LOOSE_EQ_REMOVED ))

# --- Lines modernized: real diff between legacy/ and src/ ---------------------
# Uses git's no-index diff so it works even before the repo is initialized.
LINES_MODERNIZED=0
if [ -d "${LEGACY_DIR}" ] && [ -d "${SRC_DIR}" ]; then
  shortstat="$(git diff --no-index --shortstat "${LEGACY_DIR}" "${SRC_DIR}" 2>/dev/null || true)"
  ins="$(echo "${shortstat}" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)"
  del="$(echo "${shortstat}" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo 0)"
  LINES_MODERNIZED=$(( ${ins:-0} + ${del:-0} ))
fi

# --- Tests: run them and report the REAL outcome ------------------------------
TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_STATUS="not_run"
if [ -d "test" ] && command -v node >/dev/null 2>&1; then
  # Only run the project's own tests, never the recovered legacy/ tests.
  if test_output="$(node --test "test/**/*.test.js" 2>&1)"; then
    TESTS_STATUS="passed"
  else
    TESTS_STATUS="failed"
  fi
  TESTS_TOTAL="$(echo "${test_output}" | grep -oE '# tests [0-9]+|tests [0-9]+' | grep -oE '[0-9]+' | head -n1 || echo 0)"
  TESTS_PASSED="$(echo "${test_output}" | grep -oE '# pass [0-9]+|pass [0-9]+' | grep -oE '[0-9]+' | head -n1 || echo 0)"
fi

# --- Emit the report (all values computed above) ------------------------------
cat > "${OUT_FILE}" <<EOF
{
  "project": "GhostRepo",
  "repository": ${REPO_NAME},
  "status": "RESURRECTED",
  "timestamp": "${TIMESTAMP}",
  "scope": "javascript-web-legacy",
  "metrics": {
    "lines_modernized": ${LINES_MODERNIZED},
    "legacy_patterns_removed": ${LEGACY_PATTERNS_REMOVED},
    "breakdown": {
      "var_to_const_let": ${VAR_REMOVED},
      "insecure_innerHTML": ${INNERHTML_REMOVED},
      "dead_MozTransform": ${MOZTRANSFORM_REMOVED},
      "loose_equality": ${LOOSE_EQ_REMOVED}
    },
    "tests": {
      "status": "${TESTS_STATUS}",
      "passed": ${TESTS_PASSED:-0},
      "total": ${TESTS_TOTAL:-0}
    }
  },
  "agent_signature": "Kiro Multi-Agent Orchestrator"
}
EOF

echo "✨ [GhostRepo] Resurrection report written to ${OUT_FILE}"
echo "   lines_modernized=${LINES_MODERNIZED}  legacy_patterns_removed=${LEGACY_PATTERNS_REMOVED}  tests=${TESTS_PASSED:-0}/${TESTS_TOTAL:-0} (${TESTS_STATUS})"

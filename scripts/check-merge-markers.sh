#!/usr/bin/env bash
# Scan the repo for leftover git merge-conflict markers.
#
# Why this exists: AGENTS.md and docs/BRIDGE_RENDERING_PLAN.md were
# committed with unresolved `<<<<<<<`/`=======`/`>>>>>>>` markers still
# in them after a bad merge, and it went unnoticed until an unrelated
# task turned it up. Run this before committing, or wire it into a
# pre-commit hook.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

matches=$(git grep -n -E '^(<{7}|={7}|>{7})( |$)' -- . ':!node_modules' 2>/dev/null || true)

if [[ -n "$matches" ]]; then
  echo "Unresolved merge conflict markers found:" >&2
  echo "$matches" >&2
  exit 1
fi

echo "No merge conflict markers found."

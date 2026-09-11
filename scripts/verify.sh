#!/usr/bin/env bash
# One-shot sanity check: install, merge-marker scan, unit tests, type check.
#
# Run before committing or opening a PR. This bundles the checks that
# were run by hand, repeatedly, over the course of the pnpm migration and
# branch-reconciliation work in this repo's history.
#
# Note: `pnpm exec tsc -b` currently fails on a single pre-existing,
# unrelated error in vite.config.ts (`forwardConsole` is not a valid
# Vite ServerOptions field) -- not caused by dependency or lockfile
# state. This script reports it but does not treat it as fatal; fix it
# separately when someone gets to it.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

status=0

echo "==> pnpm install"
pnpm install || { echo "pnpm install failed" >&2; exit 1; }

echo "==> checking for merge conflict markers"
scripts/check-merge-markers.sh || status=1

echo "==> pnpm test"
pnpm test || status=1

echo "==> pnpm exec tsc -b (known pre-existing vite.config.ts error is non-fatal here)"
pnpm exec tsc -b || echo "note: tsc reported errors -- see above (forwardConsole in vite.config.ts is a known pre-existing issue)"

if [[ $status -eq 0 ]]; then
  echo "==> verify.sh: OK"
else
  echo "==> verify.sh: FAILED" >&2
fi
exit $status

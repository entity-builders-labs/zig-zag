#!/usr/bin/env bash
# Reproduces the G-P7-U.A live-code characterizations at their evidence commit.
#
# `characterization/current-code.characterization.spec.ts` and the interpreter block of
# `characterization/provenance-rule.characterization.spec.ts` characterize production code as it
# was at commit 9673571e (since removed by task 25.4). Their frozen input is that commit's source,
# so they run in a temporary detached worktree of it, never against the current tree. The
# regenerated runs/ are diffed against the recorded runs/ of the current checkout; the current
# checkout is never written.
#
# Usage (from the repository root, dependencies installed): bash spikes/planner-comparison-2026-10-12/g-p7-u-a/scripts/reproduce-live-characterization.sh
set -euo pipefail

EVIDENCE_COMMIT=9673571e
SPIKE=spikes/planner-comparison-2026-10-12/g-p7-u-a
ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
WT="$TMP/g-p7-u-a-$EVIDENCE_COMMIT"

cleanup() {
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

git -C "$ROOT" worktree add --detach "$WT" "$EVIDENCE_COMMIT" >/dev/null
ln -s "$ROOT/node_modules" "$WT/node_modules"
ln -s "$ROOT/be/node_modules" "$WT/be/node_modules"

(cd "$WT/be" && npx jest -c "../$SPIKE/characterization/jest.config.json")

diff -r "$ROOT/$SPIKE/runs" "$WT/$SPIKE/runs"
echo "G-P7-U.A live-code characterization reproduced at $EVIDENCE_COMMIT; runs/ identical."

#!/usr/bin/env bash
set -Eeuo pipefail
MODE=${1:-fast}
[[ $MODE == fast || $MODE == full ]] || exit 64
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Run this test recipe on GitHub Actions, not a live VPS'; exit 1; }
[[ $(node -p 'process.versions.node') == 24.21.0 && $(pnpm --version) == 10.18.0 ]]
pnpm run check:foundation
pnpm run check:contracts
pnpm --filter @gobadminton/contracts run test:unit
for scope in @gobadminton/api @gobadminton/web @gobadminton/admin; do
  pnpm --filter "$scope" run typecheck
  pnpm --filter "$scope" run lint
  pnpm --filter "$scope" run test:unit
 done
# A first push, or changed SQL/security/API code, is not a fast-only release.
if [[ $MODE == fast ]]; then
  if [[ ! ${BASE_SHA:-} =~ ^[0-9a-f]{40}$ || $BASE_SHA == 0000000000000000000000000000000000000000 ]]; then
    MODE=full
  else
    git cat-file -e "$BASE_SHA^{commit}"
    changed=$(git diff --name-only "$BASE_SHA" HEAD -- apps/api packages/contracts)
    [[ -z $changed ]] || MODE=full
  fi
fi
if [[ $MODE == full ]]; then bash scripts/chatops/db-ci.sh; fi

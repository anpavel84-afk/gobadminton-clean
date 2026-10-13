#!/usr/bin/env bash
# Resolve only a successful DEV workflow artifact for the exact released commit.
set -Eeuo pipefail
: "${GITHUB_REPOSITORY:?}" "${GH_TOKEN:?}"
REPO=$GITHUB_REPOSITORY
TAG=$(jq -er '.release.tag_name' "$GITHUB_EVENT_PATH")
[[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$ ]] || { echo 'Invalid release tag'; exit 1; }
jq -e '.release.prerelease == false and .release.draft == false' "$GITHUB_EVENT_PATH" >/dev/null
SHA=$(git rev-parse HEAD)
git fetch --no-tags origin main
git merge-base --is-ancestor "$SHA" refs/remotes/origin/main
RUN=$(gh api --method GET "repos/$REPO/actions/workflows/dev-deploy.yml/runs" \
  -f head_sha="$SHA" -f branch=dev -f status=success -f event=push -f per_page=100 \
  --jq '.workflow_runs | map(select(.head_branch=="dev" and .conclusion=="success")) | .[0].id // empty')
[[ $RUN =~ ^[0-9]+$ ]] || { echo 'No successful DEV run at the release SHA. Do not rebuild or promote latest.'; exit 1; }
gh api "repos/$REPO/actions/runs/$RUN/jobs" --jq '.jobs[] | select(.name=="deploy") | .conclusion' | grep -qx success
mkdir -p _out
gh run download "$RUN" --repo "$REPO" --name dev-release --dir _out
jq -e --arg s "$SHA" --argjson r "$RUN" '.schema==1 and .source_sha==$s and .dev_run_id==$r and
  (.api_digest|test("^sha256:[0-9a-f]{64}$")) and (.web_digest|test("^sha256:[0-9a-f]{64}$"))' _out/release.json >/dev/null
PREVIOUS_RUN=$(gh api --method GET "repos/$REPO/actions/workflows/prod-deploy.yml/runs" \
  -f status=success -f event=release -f per_page=100 --jq '.workflow_runs[0].id // empty')
BASE=${INITIAL_PROD_SHA:-}
if [[ -n $PREVIOUS_RUN ]]; then
  mkdir -p _out/previous
  gh run download "$PREVIOUS_RUN" --repo "$REPO" --name prod-release --dir _out/previous
  BASE=$(jq -er .source_sha _out/previous/release.json)
fi
[[ $BASE =~ ^[0-9a-f]{40}$ ]] || { echo 'Enroll the actual initial PROD SHA once before the first production release'; exit 1; }
git cat-file -e "$BASE^{commit}"
jq --arg base "$BASE" '. + {expected_previous_sha:$base}' _out/release.json >_out/release.next.json
mv _out/release.next.json _out/release.json
echo "base_sha=$BASE" >>"$GITHUB_OUTPUT"
echo "source_sha=$SHA" >>"$GITHUB_OUTPUT"

#!/usr/bin/env bash
set -Eeuo pipefail
: "${GITHUB_SHA:?}" "${GITHUB_REPOSITORY:?}" "${GH_TOKEN:?}" "${GITHUB_ACTOR:?}"
[[ $GITHUB_REPOSITORY == anpavel84-afk/gobadminton-clean ]]
mkdir -p _out
PREFIX=ghcr.io/anpavel84-afk/gobadminton-clean
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
build() {
  local app=$1
  docker buildx build --platform linux/amd64 --push --provenance=mode=min \
    --label "org.opencontainers.image.revision=$GITHUB_SHA" \
    --label "org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY" \
    --cache-from "type=registry,ref=$PREFIX-$app:buildcache-dev" \
    --cache-to "type=registry,ref=$PREFIX-$app:buildcache-dev,mode=max" \
    --metadata-file "_out/$app.meta.json" \
    -f "apps/$app/Dockerfile" -t "$PREFIX-$app:$GITHUB_SHA" .
}
build api & pa=$!; build web & pw=$!
rc=0; wait "$pa" || rc=1; wait "$pw" || rc=1; [[ $rc == 0 ]]
API=$(jq -er '.["containerimage.digest"]' _out/api.meta.json)
WEB=$(jq -er '.["containerimage.digest"]' _out/web.meta.json)
[[ $API =~ ^sha256:[0-9a-f]{64}$ && $WEB =~ ^sha256:[0-9a-f]{64}$ ]]
jq -n --arg s "$GITHUB_SHA" --arg a "$API" --arg w "$WEB" --argjson run "$GITHUB_RUN_ID" \
 '{schema:1,source_sha:$s,api_digest:$a,web_digest:$w,dev_run_id:$run}' >_out/release.json

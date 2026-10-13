#!/bin/bash
# ONE-TIME ADMINISTRATIVE READ of running containers; no deploy. PROD only.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 && $# == 0 ]] || exit 77
CONFIG=/etc/gobadminton/deploy/prod.conf
[[ -f $CONFIG && ! -L $CONFIG && $(stat -c %u "$CONFIG") == 0 ]] || exit 77
(( (8#$(stat -c %a "$CONFIG") & 0022) == 0 )) || exit 77
# shellcheck disable=SC1090
source "$CONFIG"
STATE=/var/lib/gobadminton-deploy/prod
mkdir -p "$STATE"; chmod 700 "$STATE"
exec 9>"$STATE/lock"; flock -n 9
[[ ! -e $STATE/accepted.json && ! -e $STATE/pending.json ]] || { echo 'Already enrolled/active'; exit 1; }
C=(/usr/bin/docker compose --project-name "$PROJECT" --env-file "$ENV_FILE")
for p in "${COMPOSE_FILES[@]}"; do C+=(-f "$p"); done
SHA=''
for s in "${SERVICES[@]}"; do
  cid=$("${C[@]}" ps -q "$s"); [[ -n $cid && $cid != *$'\n'* ]]
  source=$(/usr/bin/docker inspect "$cid" | jq -r '.[0].Config.Env//[] | map(select(startswith("GIT_SHA="))|ltrimstr("GIT_SHA=")) | .[0]//""')
  if [[ ! $source =~ ^[0-9a-f]{40}$ ]]; then
    image=$(/usr/bin/docker inspect "$cid" --format '{{.Image}}')
    source=$(/usr/bin/docker image inspect "$image" | jq -r '.[0].Config.Labels["org.opencontainers.image.revision"]//""')
  fi
  [[ $source =~ ^[0-9a-f]{40}$ ]] || { echo 'Actual source SHA unavailable; establish provenance before enrollment'; exit 1; }
  [[ -z $SHA || $SHA == "$source" ]] || { echo 'Running API/Web versions differ'; exit 1; }
  SHA=$source
done
jq -n --arg sha "$SHA" '{status:"ACCEPTED",release_id:"bootstrap",sequence:0,source_sha:$sha}' >"$STATE/accepted.json"
printf 'Set INITIAL_PROD_SHA to verified actual version: %s\n' "$SHA"

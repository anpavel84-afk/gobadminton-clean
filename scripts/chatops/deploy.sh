#!/usr/bin/env bash
# CI client. Secrets exist ONLY in the matching GitHub Environment job.
set -Eeuo pipefail
ENVIRONMENT=${1:?dev or prod}; FILE=${2:?release.json}
[[ $ENVIRONMENT == dev || $ENVIRONMENT == prod ]] || exit 64
: "${DEPLOY_HOST:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}" "${PUBLIC_URL:?}"
PORT=${DEPLOY_PORT:-22}; [[ $PORT =~ ^[0-9]{1,5}$ ]] && ((10#$PORT>0 && 10#$PORT<65536))
HOSTS=("$DEPLOY_HOST")
[[ -z ${DEPLOY_WEB_HOST:-} || $DEPLOY_WEB_HOST == "$DEPLOY_HOST" ]] || HOSTS+=("$DEPLOY_WEB_HOST")
for h in "${HOSTS[@]}"; do [[ $h =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || exit 64; done
DIR=$(mktemp -d "${RUNNER_TEMP:-/tmp}/gb-ssh.XXXXXX"); chmod 700 "$DIR"
printf '%s\n' "$DEPLOY_SSH_KEY" >"$DIR/key"; chmod 600 "$DIR/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$DIR/known_hosts"; chmod 600 "$DIR/known_hosts"
unset DEPLOY_SSH_KEY
ID="r${GITHUB_RUN_ID:?}-a${GITHUB_RUN_ATTEMPT:?}"
SEQUENCE=$(( ${GITHUB_RUN_NUMBER:?} * 1000 + GITHUB_RUN_ATTEMPT ))
SHA=$(jq -er .source_sha "$FILE")
[[ $SHA =~ ^[0-9a-f]{40}$ ]]
ssh_request() {
  local host=$1 payload=$2
  ssh -F /dev/null -T -i "$DIR/key" -p "$PORT" \
    -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$DIR/known_hosts" -o ConnectTimeout=15 \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=6 \
    "gb-deploy-$ENVIRONMENT@$host" <"$payload"
}
TOUCHED=(); ACCEPTED=0
cleanup() {
  local rc=$?
  trap - EXIT
  if (( ! ACCEPTED )); then
    jq -n --arg id "$ID" '{action:"rollback",release_id:$id}' >"$DIR/rollback.json"
    for host in "${TOUCHED[@]}"; do
      ssh_request "$host" "$DIR/rollback.json" >&2 || echo "ROLLBACK_UNCONFIRMED host=$host; watchdog/ChatOps reconciliation required" >&2
    done
  fi
  rm -rf -- "$DIR"
  exit "$rc"
}
trap cleanup EXIT
jq --arg id "$ID" --argjson seq "$SEQUENCE" \
  '{action:"deploy",release_id:$id,sequence:$seq,source_sha,api_digest,web_digest,
    expected_previous_sha:(.expected_previous_sha // "")}' "$FILE" >"$DIR/request.json"
# In split production this is API first, then Web. Not a distributed atomic transaction.
for host in "${HOSTS[@]}"; do
  TOUCHED+=("$host")
  ssh_request "$host" "$DIR/request.json" >"$DIR/result.json"
  jq -e --arg id "$ID" '(.pending.release_id==$id and .pending.status=="PENDING_SMOKE") or
    (.accepted.release_id==$id and .accepted.status=="ACCEPTED")' "$DIR/result.json" >/dev/null
 done
# All browser execution is on the ephemeral GitHub runner, not on the VPS.
PLAY="$DIR/playwright"
npm install --prefix "$PLAY" --ignore-scripts --no-audit --no-fund playwright@1.56.1 >&2
"$PLAY/node_modules/.bin/playwright" install --with-deps chromium >&2
export PLAYWRIGHT_MODULE="$PLAY/node_modules/playwright" EXPECTED_SHA="$SHA"
node scripts/chatops/smoke.mjs
jq -n --arg id "$ID" '{action:"accept",release_id:$id}' >"$DIR/accept.json"
for host in "${HOSTS[@]}"; do
  ssh_request "$host" "$DIR/accept.json" >"$DIR/result.json"
  jq -e --arg id "$ID" '.accepted.release_id==$id and .accepted.status=="ACCEPTED"' "$DIR/result.json" >/dev/null
 done
ACCEPTED=1
printf 'ACCEPTED %s %s %s\n' "$ENVIRONMENT" "$ID" "$SHA"

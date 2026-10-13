#!/bin/bash
# Fixed-environment Docker Compose receiver. Installed root:root 0755.
# SSH calls: sudo -n /usr/local/sbin/gb-deploy-helper.sh dev|prod < request.json
# Watchdog: root invokes ... --watchdog dev|prod from the provided timer.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8
unset BASH_ENV ENV CDPATH DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG COMPOSE_FILE COMPOSE_PROJECT_NAME
CONFIG_ROOT=/etc/gobadminton/deploy
STATE_ROOT=/var/lib/gobadminton-deploy
DOCKER=/usr/bin/docker
# Every Docker invocation has a hard deadline so watchdog can acquire the lock.
docker_bounded() { /usr/bin/timeout --kill-after=15s 300 "$DOCKER" "$@"; }
CURL=/usr/bin/curl
WATCHDOG=0
if [[ ${1-} == --watchdog ]]; then WATCHDOG=1; shift; fi
[[ $# == 1 && ($1 == dev || $1 == prod) ]] || { echo 'invalid fixed environment' >&2; exit 64; }
ENVIRONMENT=$1
[[ $EUID == 0 ]] || { echo 'must enter through the narrow sudo rule' >&2; exit 77; }
if [[ -n ${SUDO_USER-} && $SUDO_USER != "gb-deploy-$ENVIRONMENT" ]]; then
  echo 'credential/environment mismatch' >&2; exit 77
fi
[[ $WATCHDOG == 0 || -z ${SUDO_USER-} ]] || exit 77

fail() { echo "GB_DEPLOY_ERROR: $*" >&2; exit 1; }
# Trusted scripts, Compose, env and their parents must not be agent-writable.
trusted() {
  local p=$1 mode uid
  [[ $p == /* && $p != *'/../'* && ! -L $p && -e $p ]] || fail "unsafe path: $p"
  while :; do
    [[ ! -L $p ]] || fail "symlink: $p"
    read -r uid mode < <(stat -c '%u %a' -- "$p")
    [[ $uid == 0 ]] && (( (8#$mode & 0022) == 0 )) || fail "writable/unowned path: $p"
    [[ $p == / ]] && break
    p=$(dirname -- "$p")
  done
}
trusted "$CONFIG_ROOT/$ENVIRONMENT.conf"
# This is root-provisioned code, never downloaded from a job or supplied over SSH.
# shellcheck disable=SC1090
source "$CONFIG_ROOT/$ENVIRONMENT.conf"
: "${PROJECT:?}" "${ENV_FILE:?}" "${DB_USER:?}" "${DB_NAME:?}" "${REGISTRY_PREFIX:?}"
: "${READINESS_SECONDS:=120}" "${ACCEPT_SECONDS:=300}" "${OPERATION_SECONDS:=900}"
declare -p COMPOSE_FILES SERVICES >/dev/null 2>&1 || fail 'missing fixed arrays'
[[ $PROJECT =~ ^[a-z][a-z0-9_-]+$ && $DB_USER =~ ^[a-zA-Z0-9_]+$ && $DB_NAME =~ ^[a-zA-Z0-9_]+$ ]] || fail 'invalid profile'
[[ $REGISTRY_PREFIX == ghcr.io/anpavel84-afk/gobadminton-clean ]] || fail 'unexpected registry'
[[ ${#SERVICES[@]} -ge 1 && ${#SERVICES[@]} -le 2 ]] || fail 'invalid service scope'
for s in "${SERVICES[@]}"; do [[ $s == api || $s == web ]] || fail 'service outside api/web'; done
for p in "${COMPOSE_FILES[@]}" "$ENV_FILE"; do trusted "$p"; [[ -f $p ]] || fail 'not a file'; done
trusted "$STATE_ROOT"
STATE="$STATE_ROOT/$ENVIRONMENT"
mkdir -p "$STATE"; chmod 700 "$STATE"; trusted "$STATE"
exec 9>"$STATE/lock"
flock -w 30 9 || fail 'deployment lock busy'
export HOME=/root DOCKER_CONFIG="$CONFIG_ROOT/registry-$ENVIRONMENT"
[[ ! -e $DOCKER_CONFIG ]] || trusted "$DOCKER_CONFIG"
BASE=(docker_bounded compose --project-name "$PROJECT" --env-file "$ENV_FILE")
for p in "${COMPOSE_FILES[@]}"; do BASE+=(-f "$p"); done
compose() { local o=$1; shift; "${BASE[@]}" -f "$o" "$@"; }
write_json() { local dst=$1 tmp; tmp=$(mktemp "$STATE/.json.XXXXXX"); cat >"$tmp"; jq -e . "$tmp" >/dev/null; chmod 600 "$tmp"; mv -f -- "$tmp" "$dst"; }
status() {
  jq -n --slurpfile good <(cat "$STATE/accepted.json" 2>/dev/null || printf 'null') \
    --slurpfile pending <(cat "$STATE/pending.json" 2>/dev/null || printf 'null') \
    --slurpfile last <(cat "$STATE/last-result.json" 2>/dev/null || printf 'null') \
    '{accepted:$good[0],pending:$pending[0],last_result:$last[0]}'
}
healthy() {
  local o=$1 s cid item
  for s in "${SERVICES[@]}"; do
    cid=$(compose "$o" ps -q "$s")
    [[ -n $cid && $cid != *$'\n'* ]] || return 1
    item=$(docker_bounded inspect "$cid")
    jq -e '.[0].State.Running == true and .[0].State.Health.Status == "healthy"' <<<"$item" >/dev/null || return 1
  done
}
verify_version() {
  local sha=$1
  if [[ -n ${API_META_URL-} ]]; then
    "$CURL" --fail --silent --show-error --max-time 10 "$API_META_URL" | jq -e --arg s "$sha" '.gitSha == $s' >/dev/null
  fi
}
# Only image rollback. Never restore a historical DB dump or reverse schema automatically.
rollback() {
  local pending id
  [[ -f $STATE/pending.json ]] || return 0
  pending=$(cat "$STATE/pending.json"); id=$(jq -r .release_id <<<"$pending")
  compose "$STATE/$id/previous.json" up -d --no-deps --no-build --pull never \
    --wait --wait-timeout "$READINESS_SECONDS" "${SERVICES[@]}" >&2 || return 1
  healthy "$STATE/$id/previous.json" || return 1
  jq '. + {status:"ROLLED_BACK",finished_at:(now|floor)}' <<<"$pending" | write_json "$STATE/last-result.json"
  if [[ -f $STATE/$id/previous-accepted.json ]]; then
    cp -- "$STATE/$id/previous-accepted.json" "$STATE/accepted.json"
  else
    rm -f -- "$STATE/accepted.json"
  fi
  rm -f -- "$STATE/pending.json"
}
if (( WATCHDOG )); then
  if [[ -f $STATE/pending.json ]] && (( $(date +%s) >= $(jq -r .deadline "$STATE/pending.json") )); then
    rollback || fail 'watchdog rollback failed; inspect server logs'
  fi
  exit 0
fi
# Bounded input, finite read time; no eval, no shell commands supplied by CI.
REQUEST=$(timeout 10 head -c 8193) || fail 'request read timeout'
(( ${#REQUEST} <= 8192 )) || fail 'oversize request'
jq -e 'type=="object" and (.action|type=="string")' <<<"$REQUEST" >/dev/null || fail 'invalid JSON'
ACTION=$(jq -r .action <<<"$REQUEST")
if [[ $ACTION == status ]]; then
  jq -e 'keys==["action"]' <<<"$REQUEST" >/dev/null || fail 'unknown status fields'
  status; exit 0
fi
ID=$(jq -r '.release_id // ""' <<<"$REQUEST")
[[ $ID =~ ^r[0-9]{1,18}-a[0-9]{1,4}$ ]] || fail 'invalid release ID'
if [[ $ACTION == accept || $ACTION == rollback ]]; then
  jq -e 'keys==["action","release_id"]' <<<"$REQUEST" >/dev/null || fail 'unknown completion fields'
  if [[ ! -f $STATE/pending.json ]]; then
    if [[ $ACTION == accept && -f $STATE/accepted.json ]] && [[ $(jq -r .release_id "$STATE/accepted.json") == "$ID" ]]; then status; exit 0; fi
    if [[ $ACTION == rollback && -f $STATE/accepted.json && -d $STATE/$ID ]] && [[ $(jq -r .release_id "$STATE/accepted.json") == "$ID" ]]; then
      cp -- "$STATE/accepted.json" "$STATE/pending.json"
      rollback || fail 'compensating rollback failed'
      status; exit 0
    fi
    if [[ $ACTION == rollback && -f $STATE/last-result.json ]] && [[ $(jq -r '.release_id+":"+.status' "$STATE/last-result.json") == "$ID:ROLLED_BACK" ]]; then status; exit 0; fi
    fail 'no matching pending operation'
  fi
  [[ $(jq -r .release_id "$STATE/pending.json") == "$ID" ]] || fail 'stale completion ID'
  if [[ $ACTION == rollback ]]; then rollback || fail 'rollback failed'; status; exit 0; fi
  (( $(date +%s) < $(jq -r .deadline "$STATE/pending.json") )) || { rollback; fail 'acceptance expired'; }
  healthy "$STATE/$ID/candidate.json" || fail 'unhealthy candidate'
  verify_version "$(jq -r .source_sha "$STATE/pending.json")" || fail 'wrong application version'
  jq '. + {status:"ACCEPTED",finished_at:(now|floor)}' "$STATE/pending.json" | write_json "$STATE/accepted.json"
  cp -- "$STATE/accepted.json" "$STATE/last-result.json"; rm -- "$STATE/pending.json"
  status; exit 0
fi
[[ $ACTION == deploy ]] || fail 'unsupported action'
jq -e 'keys==["action","api_digest","expected_previous_sha","release_id","sequence","source_sha","web_digest"] and
  (.sequence|type=="number" and floor==. and .>0 and .<1000000000000) and
  (.source_sha|test("^[0-9a-f]{40}$")) and
  (.expected_previous_sha|test("^$|^[0-9a-f]{40}$")) and
  (.api_digest|test("^sha256:[0-9a-f]{64}$")) and (.web_digest|test("^sha256:[0-9a-f]{64}$"))' \
  <<<"$REQUEST" >/dev/null || fail 'invalid deployment fields'
SHA=$(jq -r .source_sha <<<"$REQUEST"); SEQUENCE=$(jq -r .sequence <<<"$REQUEST")
API_IMAGE="$REGISTRY_PREFIX-api@$(jq -r .api_digest <<<"$REQUEST")"
WEB_IMAGE="$REGISTRY_PREFIX-web@$(jq -r .web_digest <<<"$REQUEST")"
if [[ -f $STATE/accepted.json ]] && [[ $(jq -r .release_id "$STATE/accepted.json") == "$ID" ]]; then
  [[ $(jq -cS '{release_id,source_sha,api_digest,web_digest,sequence}' "$STATE/accepted.json") == $(jq -cS '{release_id,source_sha,api_digest,web_digest,sequence}' <<<"$REQUEST") ]] || fail 'reused release ID'
  status; exit 0
fi
if [[ -f $STATE/pending.json ]]; then
  if [[ $(jq -r .release_id "$STATE/pending.json") == "$ID" ]]; then
    [[ $(jq -cS '{release_id,source_sha,api_digest,web_digest,sequence}' "$STATE/pending.json") == $(jq -cS '{release_id,source_sha,api_digest,web_digest,sequence}' <<<"$REQUEST") ]] || fail 'pending release ID rebound'
    status; exit 0
  fi
  fail 'another release awaits acceptance/recovery'
fi
[[ ! -e $STATE/$ID ]] || fail 'attempt ID already used; use a new CI run attempt'
if [[ -f $STATE/max-sequence ]]; then (( SEQUENCE > $(cat "$STATE/max-sequence") )) || fail 'stale/out-of-order workflow'; fi
EXPECTED=$(jq -r .expected_previous_sha <<<"$REQUEST")
if [[ $ENVIRONMENT == prod ]]; then
  [[ $EXPECTED =~ ^[0-9a-f]{40}$ ]] || fail 'PROD requires exact previous release SHA'
  [[ -f $STATE/accepted.json ]] || fail 'PROD baseline not enrolled; one-time bootstrap needed'
  [[ $(jq -r .source_sha "$STATE/accepted.json") == "$EXPECTED" ]] || fail 'PROD changed since QA baseline'
fi
mkdir -m 700 "$STATE/$ID"
DIR="$STATE/$ID"
[[ ! -f $STATE/accepted.json ]] || cp -- "$STATE/accepted.json" "$DIR/previous-accepted.json"
printf '%s\n' "$SEQUENCE" >"$STATE/max-sequence"
# Build a fixed overlay. Caller cannot change networks, mounts, commands or env other than GIT_SHA.
jq -n --arg a "$API_IMAGE" --arg w "$WEB_IMAGE" --arg sha "$SHA" \
  '{services:{api:{image:$a,environment:{GIT_SHA:$sha}},web:{image:$w,environment:{GIT_SHA:$sha}},migrate:{image:$a,environment:{GIT_SHA:$sha}}}}' >"$DIR/candidate.json"
printf '{"services":{}}\n' >"$DIR/previous.json"
# Snapshot actual container image IDs (not mutable tags) and version env.
for s in "${SERVICES[@]}"; do
  CID=$("${BASE[@]}" ps -q "$s")
  [[ -n $CID && $CID != *$'\n'* ]] || fail "bootstrap requires one existing $s container"
  INFO=$(docker_bounded inspect "$CID")
  jq -e --arg p "$PROJECT" --arg s "$s" '.[0].Config.Labels["com.docker.compose.project"]==$p and .[0].Config.Labels["com.docker.compose.service"]==$s' <<<"$INFO" >/dev/null || fail 'wrong container identity'
  OLD_IMAGE=$(jq -r '.[0].Image' <<<"$INFO")
  [[ $OLD_IMAGE =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid old image ID'
  OLD_SHA=$(jq -r '.[0].Config.Env // [] | map(select(startswith("GIT_SHA="))|ltrimstr("GIT_SHA=")) | .[0] // ""' <<<"$INFO")
  if [[ $ENVIRONMENT == prod && -n $OLD_SHA ]]; then [[ $OLD_SHA == "$EXPECTED" ]] || fail 'running PROD differs from enrolled baseline'; fi
  jq --arg s "$s" --arg image "$OLD_IMAGE" --arg sha "$OLD_SHA" \
    '.services[$s]={image:$image} | if $sha!="" then .services[$s].environment={GIT_SHA:$sha} else . end' \
    "$DIR/previous.json" >"$DIR/previous.next.json"
  mv "$DIR/previous.next.json" "$DIR/previous.json"
done
# Pull can fail safely before any running service has been changed.
for s in "${SERVICES[@]}"; do
  if [[ $s == api ]]; then image=$API_IMAGE; else image=$WEB_IMAGE; fi
  timeout --kill-after=15s 300 "$DOCKER" pull "$image" >&2
  docker_bounded image inspect "$image" | jq -e --arg sha "$SHA" '.[0].Config.Labels["org.opencontainers.image.revision"]==$sha' >/dev/null || fail 'image/source label mismatch'
done
PENDING=$(jq --argjson deadline "$(( $(date +%s) + OPERATION_SECONDS ))" '. + {status:"DEPLOYING",deadline:$deadline}' <<<"$REQUEST")
printf '%s\n' "$PENDING" | write_json "$STATE/pending.json"
MUTATING=1
trap 'rc=$?; if (( MUTATING )); then trap - EXIT HUP INT TERM; rollback || echo GB_ROLLBACK_FAILED >&2; fi; exit "$rc"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# Fixed migration service uses the SAME candidate API image and private per-env DATABASE_URL.
# This permits only reviewed backward-compatible releases; CI is responsible for SQL review.
if [[ " ${SERVICES[*]} " == *' api '* && ${MIGRATE:-0} == 1 ]]; then
  DB_CID=$("${BASE[@]}" ps -q db); [[ -n $DB_CID ]] || fail 'database is not running'
  timeout --kill-after=15s 180 "$DOCKER" exec "$DB_CID" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --no-acl >"$DIR/pre-migration.dump"
  [[ $(head -c5 "$DIR/pre-migration.dump") == PGDMP ]] || fail 'invalid database backup'
  "${BASE[@]}" -f "$DIR/candidate.json" run --rm --no-deps -T migrate >&2
fi
compose "$DIR/candidate.json" up -d --no-deps --no-build --pull never \
  --wait --wait-timeout "$READINESS_SECONDS" "${SERVICES[@]}" >&2
healthy "$DIR/candidate.json"
verify_version "$SHA"
jq --argjson d "$(( $(date +%s) + ACCEPT_SECONDS ))" '. + {status:"PENDING_SMOKE",deadline:$d}' "$STATE/pending.json" | write_json "$STATE/pending.json"
MUTATING=0
trap - EXIT ERR HUP INT TERM
status

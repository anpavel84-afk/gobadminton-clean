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
EVIDENCE_ROOT=/var/lib/gobadminton-deploy-evidence
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
unset DEV_ADMIN_COMMISSIONED ADMIN_ENV_FILE ADMIN_RESPONSE_URL ADMIN_META_URL
source "$CONFIG_ROOT/$ENVIRONMENT.conf"
: "${PROJECT:?}" "${ENV_FILE:?}" "${DB_USER:?}" "${DB_NAME:?}" "${REGISTRY_PREFIX:?}"
: "${READINESS_SECONDS:=120}" "${ACCEPT_SECONDS:=300}" "${OPERATION_SECONDS:=900}"
declare -p COMPOSE_FILES SERVICES >/dev/null 2>&1 || fail 'missing fixed arrays'
[[ $PROJECT =~ ^[a-z][a-z0-9_-]+$ && $DB_USER =~ ^[a-zA-Z0-9_]+$ && $DB_NAME =~ ^[a-zA-Z0-9_]+$ ]] || fail 'invalid profile'
[[ $REGISTRY_PREFIX == ghcr.io/anpavel84-afk/gobadminton-clean ]] || fail 'unexpected registry'
ADMIN_ENABLED=${DEV_ADMIN_COMMISSIONED:-false}
[[ $ADMIN_ENABLED == true || $ADMIN_ENABLED == false ]] || fail 'invalid Admin opt-in'
if [[ $ADMIN_ENABLED == true ]]; then
  [[ $ENVIRONMENT == dev && ${SERVICES[*]} == 'api web admin' &&
     ${ADMIN_RESPONSE_URL:-} == https://dev.gobadminton.ru/admin/ &&
     ${ADMIN_META_URL:-} == https://dev.gobadminton.ru/v1/meta ]] || fail 'invalid DEV Admin profile'
  : "${ADMIN_ENV_FILE:?}"
  trusted "$ADMIN_ENV_FILE"; (( (8#$(stat -c %a -- "$ADMIN_ENV_FILE") & 0077) == 0 )) || fail 'Admin env must be private'
  [[ -f $ADMIN_ENV_FILE ]] || fail 'missing private Admin env'
else
  [[ -z ${ADMIN_ENV_FILE:-} && -z ${ADMIN_RESPONSE_URL:-} && -z ${ADMIN_META_URL:-} ]] || fail 'partial Admin profile'
fi
[[ ${#SERVICES[@]} -ge 1 && (${#SERVICES[@]} -le 2 || $ADMIN_ENABLED == true) ]] || fail 'invalid service scope'
for s in "${SERVICES[@]}"; do [[ $s == api || $s == web || ($s == admin && $ADMIN_ENABLED == true) ]] || fail 'service outside api/web'; done
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
# DEV-only filtered public projection. Private state permissions remain unchanged.
publish_evidence() {
  [[ $ENVIRONMENT == dev ]] || return 0
  local tmp
  trusted "$(dirname -- "$EVIDENCE_ROOT")"
  if [[ ! -e $EVIDENCE_ROOT && ! -L $EVIDENCE_ROOT ]]; then
    mkdir -m 755 -- "$EVIDENCE_ROOT"
  fi
  trusted "$EVIDENCE_ROOT"
  [[ -d $EVIDENCE_ROOT ]] || fail 'evidence directory required'
  chmod 755 "$EVIDENCE_ROOT"
  tmp=$(mktemp "$EVIDENCE_ROOT/.dev.XXXXXX")
  jq -n --slurpfile good <(cat "$STATE/accepted.json" 2>/dev/null || printf 'null') \
    --argjson pending "$(if [[ -e $STATE/pending.json ]]; then printf true; else printf false; fi)" \
    '{schema:1,environment:"dev",observed_at:(now|floor),pending:$pending,
      accepted:($good[0] | if . == null then null else
        {release_id,source_sha,api_digest,web_digest,status,finished_at} +
        (if has("admin_digest") then {admin_digest} else {} end) end)}' >"$tmp"
  chown root:root "$tmp"; chmod 644 "$tmp"
  mv -fT -- "$tmp" "$EVIDENCE_ROOT/dev.json"
}
MUTATING=0
finish() {
  local rc=$?
  trap - EXIT HUP INT TERM
  if (( MUTATING )); then rollback || { echo GB_ROLLBACK_FAILED >&2; rc=1; }; fi
  publish_evidence || rc=1
  exit "$rc"
}
trap finish EXIT
write_json() { local dst=$1 tmp; tmp=$(mktemp "$STATE/.json.XXXXXX"); cat >"$tmp"; jq -e . "$tmp" >/dev/null; chmod 600 "$tmp"; mv -f -- "$tmp" "$dst"; publish_evidence; }
status() {
  publish_evidence
  jq -n --slurpfile good <(cat "$STATE/accepted.json" 2>/dev/null || printf 'null') \
    --slurpfile pending <(cat "$STATE/pending.json" 2>/dev/null || printf 'null') \
    --slurpfile last <(cat "$STATE/last-result.json" 2>/dev/null || printf 'null') \
    '{accepted:$good[0],pending:$pending[0],last_result:$last[0]}'
}
healthy() {
  local o=$1 s cid item
  local -a checks=("${SERVICES[@]}")
  if [[ -f ${o%/*}/admin-absent && $o == */previous.json ]]; then checks=(api web); fi
  for s in "${checks[@]}"; do
    cid=$(compose "$o" ps -q "$s")
    [[ -n $cid && $cid != *$'\n'* ]] || return 1
    item=$(docker_bounded inspect "$cid")
    if [[ $ADMIN_ENABLED == true && $o == */candidate.json ]]; then
      jq -e --arg image "$(jq -r --arg s "$s" '.services[$s].image' "$o")"         '.[0].Config.Image == $image' <<<"$item" >/dev/null || return 1
    fi
    jq -e '.[0].State.Running == true and .[0].State.Health.Status == "healthy"' <<<"$item" >/dev/null || return 1
  done
}
verify_version() {
  local sha=$1
  if [[ -n ${API_META_URL-} ]]; then
    "$CURL" --fail --silent --show-error --max-time 10 "$API_META_URL" | jq -e --arg s "$sha" '.gitSha == $s' >/dev/null || return 1
  fi
  if [[ $ADMIN_ENABLED == true ]]; then
    "$CURL" --fail --silent --show-error --max-time 10 "$ADMIN_META_URL" | jq -e --arg s "$sha" '.gitSha == $s' >/dev/null || return 1
    local body
    body=$("$CURL" --fail --silent --show-error --max-time 10 --max-filesize 1048576 "$ADMIN_RESPONSE_URL") || return 1
    [[ $body == *'Вход для команды'* && $body == *'GoBadminton · Администрирование'* && $body == *'/admin/_next/'* && $body != *'Администрирование недоступно'* ]] || return 1
  fi
}
# Only image rollback. Never restore a historical DB dump or reverse schema automatically.
rollback() {
  local pending id
  [[ -f $STATE/pending.json ]] || return 0
  pending=$(cat "$STATE/pending.json"); id=$(jq -r .release_id <<<"$pending")
  local -a restore=("${SERVICES[@]}")
  if [[ -f $STATE/$id/admin-absent ]]; then
    compose "$STATE/$id/candidate.json" rm -s -f admin >&2 || return 1
    restore=(api web)
  fi
  compose "$STATE/$id/previous.json" up -d --no-deps --no-build --pull never \
    --wait --wait-timeout "$READINESS_SECONDS" "${restore[@]}" >&2 || return 1
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
  # Verification can consume the remaining deadline while the watchdog waits on our lock.
  (( $(date +%s) < $(jq -r .deadline "$STATE/pending.json") )) || { rollback; fail 'acceptance expired'; }
  jq '. + {status:"ACCEPTED",finished_at:(now|floor)}' "$STATE/pending.json" | write_json "$STATE/accepted.json"
  cp -- "$STATE/accepted.json" "$STATE/last-result.json"; rm -- "$STATE/pending.json"
  status; exit 0
fi
[[ $ACTION == deploy ]] || fail 'unsupported action'
jq -e --argjson admin "$ADMIN_ENABLED" '(if $admin then has("admin_digest") and (.admin_digest|type=="string" and test("^sha256:[0-9a-f]{64}$")) else (has("admin_digest")|not) end) and
  (del(.admin_digest)|keys)==["action","api_digest","expected_previous_sha","release_id","sequence","source_sha","web_digest"] and
  (.sequence|type=="number" and floor==. and .>0 and .<1000000000000) and
  (.source_sha|test("^[0-9a-f]{40}$")) and
  (.expected_previous_sha|test("^$|^[0-9a-f]{40}$")) and
  (.api_digest|test("^sha256:[0-9a-f]{64}$")) and (.web_digest|test("^sha256:[0-9a-f]{64}$"))' \
  <<<"$REQUEST" >/dev/null || fail 'invalid deployment fields'
SHA=$(jq -r .source_sha <<<"$REQUEST"); SEQUENCE=$(jq -r .sequence <<<"$REQUEST")
API_IMAGE="$REGISTRY_PREFIX-api@$(jq -r .api_digest <<<"$REQUEST")"
WEB_IMAGE="$REGISTRY_PREFIX-web@$(jq -r .web_digest <<<"$REQUEST")"
ADMIN_IMAGE="$REGISTRY_PREFIX-admin@$(jq -r '.admin_digest // ""' <<<"$REQUEST")"
if [[ -f $STATE/accepted.json ]] && [[ $(jq -r .release_id "$STATE/accepted.json") == "$ID" ]]; then
  [[ $(jq -cS '{release_id,source_sha,api_digest,web_digest,sequence} + (if has("admin_digest") then {admin_digest} else {} end)' "$STATE/accepted.json") == $(jq -cS '{release_id,source_sha,api_digest,web_digest,sequence} + (if has("admin_digest") then {admin_digest} else {} end)' <<<"$REQUEST") ]] || fail 'reused release ID'
  status; exit 0
fi
if [[ -f $STATE/pending.json ]]; then
  if [[ $(jq -r .release_id "$STATE/pending.json") == "$ID" ]]; then
    [[ $(jq -cS '{release_id,source_sha,api_digest,web_digest,sequence} + (if has("admin_digest") then {admin_digest} else {} end)' "$STATE/pending.json") == $(jq -cS '{release_id,source_sha,api_digest,web_digest,sequence} + (if has("admin_digest") then {admin_digest} else {} end)' <<<"$REQUEST") ]] || fail 'pending release ID rebound'
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
  # Separate, root-owned approval exists only after an explicit Owner GO in chat.
  # Neither repository writes nor the restricted SSH key can create this record.
  APPROVAL="$CONFIG_ROOT/prod-owner-go.json"
  trusted "$APPROVAL"
  jq -e --argjson req "$REQUEST" --argjson now "$(date +%s)" '
    keys==["api_digest","expected_previous_sha","expires_at","owner_go_id","release_id","source_sha","web_digest"] and
    (.owner_go_id|type=="string" and test("^owner-go-[a-zA-Z0-9_-]{1,100}$")) and
    (.expires_at|type=="number" and floor==. and .>$now and .<=($now+86400)) and
    .release_id==$req.release_id and .source_sha==$req.source_sha and
    .api_digest==$req.api_digest and .web_digest==$req.web_digest and
    .expected_previous_sha==$req.expected_previous_sha
  ' "$APPROVAL" >/dev/null || fail 'missing, expired or mismatched Owner release GO'
fi
mkdir -m 700 "$STATE/$ID"
DIR="$STATE/$ID"
[[ ! -f $STATE/accepted.json ]] || cp -- "$STATE/accepted.json" "$DIR/previous-accepted.json"
printf '%s\n' "$SEQUENCE" >"$STATE/max-sequence"
# Build a fixed overlay. Caller cannot change networks, mounts, commands or env other than GIT_SHA.
jq -n --arg a "$API_IMAGE" --arg w "$WEB_IMAGE" --arg sha "$SHA" \
  '{services:{api:{image:$a,environment:{GIT_SHA:$sha}},web:{image:$w,environment:{GIT_SHA:$sha}},migrate:{image:$a,environment:{GIT_SHA:$sha}}}}' >"$DIR/candidate.json"
if [[ $ADMIN_ENABLED == true ]]; then
  jq --arg a "$ADMIN_IMAGE" --arg sha "$SHA" '.services.admin={image:$a,environment:{GIT_SHA:$sha}}' "$DIR/candidate.json" > "$DIR/candidate.next.json"
  mv "$DIR/candidate.next.json" "$DIR/candidate.json"
fi
printf '{"services":{}}\n' >"$DIR/previous.json"
# Snapshot actual container image IDs (not mutable tags) and version env.
for s in "${SERVICES[@]}"; do
  CID=$("${BASE[@]}" ps -q "$s")
  if [[ -z $CID && $s == admin ]]; then touch "$DIR/admin-absent"; continue; fi
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
  case $s in api) image=$API_IMAGE;; web) image=$WEB_IMAGE;; admin) image=$ADMIN_IMAGE;; esac
  timeout --kill-after=15s 300 "$DOCKER" pull "$image" >&2
  docker_bounded image inspect "$image" | jq -e --arg sha "$SHA" --argjson admin "$ADMIN_ENABLED" '.[0] | .Config.Labels["org.opencontainers.image.revision"]==$sha and (if $admin then .Config.Labels["org.opencontainers.image.source"]=="https://github.com/anpavel84-afk/gobadminton-clean" and .Architecture=="amd64" and .Os=="linux" else true end)' >/dev/null || fail 'image/source label mismatch'
done
if [[ $ADMIN_ENABLED == true ]]; then printf '%s\n' "$REQUEST" > "$DIR/release.json"; fi
PENDING=$(jq --argjson deadline "$(( $(date +%s) + OPERATION_SECONDS ))" '. + {status:"DEPLOYING",deadline:$deadline}' <<<"$REQUEST")
printf '%s\n' "$PENDING" | write_json "$STATE/pending.json"
MUTATING=1
trap finish EXIT
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
trap - ERR HUP INT TERM
status

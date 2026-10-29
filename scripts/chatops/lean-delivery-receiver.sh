#!/bin/bash
# Lean Mode B DEV Actions dispatch snippet (OD-017).
# Addressed by installer into /usr/local/sbin/gb-deploy-helper.sh when the
# ENV=dev ACTION=lean branch is applied. Standalone reference for PMA review.
# Resolves root-owned regular-file current pointer → releases/<SHA>/host.py
# (no symlink ancestors — trusted() contract). Preserves train/dev/prod.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8

fail() { echo "GB_LEAN_RECEIVER_ERROR: $*" >&2; exit 1; }

[[ ${1-} == dev ]] || fail 'lean receiver is DEV-only'
ENVIRONMENT=dev
[[ ${EUID} == 0 ]] || fail 'must enter through narrow sudo/helper'

# Bounded input; no eval; no shell/source paths from request.
REQUEST=$(timeout 10 head -c 8193) || fail 'request read timeout'
(( ${#REQUEST} <= 8192 )) || fail 'oversize request'
jq -e 'type=="object" and (.action|type=="string")' <<<"$REQUEST" >/dev/null || fail 'invalid JSON'
ACTION=$(jq -r .action <<<"$REQUEST")
[[ $ACTION == lean ]] || fail 'action must be lean'

LEAN_PTR=/usr/local/lib/gobadminton-lean/current
[[ -f $LEAN_PTR && ! -L $LEAN_PTR ]] || fail "lean current pointer missing: $LEAN_PTR"
LEAN_SHA=$(tr -d '[:space:]' <"$LEAN_PTR")
[[ $LEAN_SHA =~ ^[0-9a-f]{40}$ ]] || fail "lean current pointer invalid: $LEAN_SHA"
HOST=/usr/local/lib/gobadminton-lean/releases/$LEAN_SHA/tools/train/host.py
[[ -f $HOST && ! -L $HOST ]] || fail "missing fixed host entry: $HOST"
# trusted parents: root-owned, not group/world writable, no symlink ancestors
p=$HOST
while :; do
  [[ ! -L $p ]] || fail "symlink: $p"
  read -r uid mode < <(stat -c '%u %a' -- "$p")
  [[ $uid == 0 ]] && (( (8#$mode & 0022) == 0 )) || fail "writable/unowned path: $p"
  [[ $p == / ]] && break
  p=$(dirname -- "$p")
done

exec /usr/bin/python3 -I -B "$HOST" <<<"$REQUEST"

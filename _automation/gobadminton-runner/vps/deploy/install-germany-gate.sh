#!/bin/bash
# One-shot root installer for the Germany restricted deploy gate.
# Run on vmi3510488 as root (Desktop Commander / console), not as agentagency-dev.
set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ]; then
  HERE="$(cd "$(dirname "$0")" && pwd)"
  SRC="$HERE/gobadminton-deploy-germany"
fi

[ "$(id -u)" -eq 0 ] || { echo "ERROR: must run as root" >&2; exit 1; }
[ -f "$SRC" ] || { echo "ERROR: missing source script: $SRC" >&2; exit 1; }

# Refuse to install the known-broken combined-local pattern.
if grep -nE 'local sha="\$1" wt=' "$SRC" >/dev/null; then
  echo "ERROR: source still has combined local sha/wt assignment; refusing install" >&2
  exit 1
fi
grep -q 'local sha="\$1"' "$SRC"
grep -q 'local wt=' "$SRC"

install -o root -g root -m 750 "$SRC" /usr/local/sbin/gobadminton-deploy-germany
echo "installed /usr/local/sbin/gobadminton-deploy-germany from $SRC"
# Smoke: status must still work via forced-command key from agentagency-dev.
echo "Next (as agentagency-dev): ssh gobadminton-runtime-deploy status"
echo "Then retry: ssh gobadminton-runtime-deploy \"api-deploy 020e4eb12bca6f044c952d6575c0076c29aa1d4d\""

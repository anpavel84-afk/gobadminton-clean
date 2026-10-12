#!/usr/bin/env bash
# Build immutable GoBadminton MVP images for an exact Git SHA.
# Intended to run on Germany (stronger host) or another build host — not on Moscow by default.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHA="${1:-}"
if [[ -z "${SHA}" ]]; then
  echo "usage: $0 <exact-git-sha>" >&2
  exit 2
fi

cd "${ROOT}"
CURRENT="$(git rev-parse HEAD)"
if [[ "${CURRENT}" != "${SHA}"* && "${CURRENT}" != "${SHA}" ]]; then
  # Allow short or full SHA match.
  FULL="$(git rev-parse "${SHA}")"
  if [[ "${CURRENT}" != "${FULL}" ]]; then
    echo "working tree HEAD ${CURRENT} != requested ${SHA} (${FULL})" >&2
    exit 1
  fi
  SHA="${FULL}"
else
  SHA="$(git rev-parse HEAD)"
fi

export DOCKER_BUILDKIT=1
docker build -f apps/api/Dockerfile -t "gobadminton-mvp-api:${SHA}" .
docker build -f apps/web/Dockerfile -t "gobadminton-mvp-web:${SHA}" .

echo "built gobadminton-mvp-api:${SHA}"
echo "built gobadminton-mvp-web:${SHA}"

#!/usr/bin/env bash
# Disposable PostgreSQL/PostGIS only. Never accepts an external DATABASE_URL.
set -Eeuo pipefail
[[ ${GITHUB_ACTIONS:-} == true ]] || exit 77
ROOT=$(git rev-parse --show-toplevel)
NAME="gb-ci-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}-${RANDOM}"
IMAGE='postgis/postgis:18-3.6@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677'
PASSWORD=$(openssl rand -hex 18)
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Ephemeral port; credentials are synthetic and confined to this job's container.
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_USER=gobadminton \
  -e POSTGRES_DB=gobadminton -p 127.0.0.1::5432 "$IMAGE" >/dev/null
ready=0
for _ in {1..60}; do
  if docker exec "$NAME" psql -h 127.0.0.1 -U gobadminton -d gobadminton -Atc 'select PostGIS_Version()' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ $ready == 1 ]] || { echo 'PostGIS not ready'; exit 1; }
PORT=$(docker port "$NAME" 5432/tcp | awk -F: '{print $NF}')
[[ $PORT =~ ^[0-9]+$ ]]
export NODE_ENV=test APP_ENV=local RUN_DB_INTEGRATION=1
export CONTENT_MODERATION_PROVIDER=fake CONTENT_MODERATION_FINGERPRINT_SECRET=ci-synthetic-only-fingerprint-000000000000
export PUBLIC_API_ORIGIN=http://127.0.0.1:3000 PUBLIC_WEB_ORIGIN=http://127.0.0.1:3001
export AUTH_PEPPER=ci-synthetic-only-pepper-not-a-live-secret
export PG_CONTAINER="$NAME" CI_DB_PORT="$PORT" CI_DB_PASSWORD="$PASSWORD"
# Fresh install + N-1 -> N upgrade + immutable previously applied SQL.
python3 scripts/chatops/migration-ci.py
mkdir -p _out/test-results
shopt -s nullglob
files=(apps/api/test/integration/*.test.ts)
(( ${#files[@]} > 0 )) || { echo 'No integration suites'; exit 1; }
for file in "${files[@]}"; do
  # Existing Friends suite explicitly requires this name and an empty app DB.
  db=gobadminton
  [[ $(basename "$file") != friends-s1.disposable.test.ts ]] || db=gobadminton_friends_s1_disposable
  docker exec "$NAME" dropdb -U gobadminton --if-exists --force "$db"
  docker exec "$NAME" createdb -U gobadminton "$db"
  export DATABASE_URL="postgres://gobadminton:$PASSWORD@127.0.0.1:$PORT/$db"
  report="$ROOT/_out/test-results/$(basename "$file").json"
  pnpm --filter @gobadminton/api exec vitest run --project integration "test/integration/$(basename "$file")" \
    --reporter=default --reporter=json --outputFile="$report"
  # Fail on silently skipped mandatory tests; fix the explicit suite contract, not this exit code.
  jq -e '.success == true and .numPassedTests > 0 and .numFailedTests == 0 and .numPendingTests == 0' "$report" >/dev/null
 done

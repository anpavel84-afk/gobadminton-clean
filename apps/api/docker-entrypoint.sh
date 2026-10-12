#!/bin/sh
set -eu
if [ "${RUN_MIGRATIONS_ON_START:-1}" = "1" ]; then
  node dist/database/migrate.js
fi
exec node dist/main.js

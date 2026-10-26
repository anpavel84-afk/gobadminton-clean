#!/bin/bash
# Собирает однофайловый установщик монитора (v4) из исходников этой папки.
# В репозитории имена пользователей ОС заменены плейсхолдерами (__EXEC_USER__, __OPS_USER__, __MON_USER__, __VPS_HOSTNAME__).
# Перед сборкой для сервера подставьте реальные значения: ../render.sh <dir> (берёт их из окружения GB_*).
# Результат: ./dist/monitor-installer.sh и его sha256. Ничего не устанавливает.
set -euo pipefail
cd "$(dirname "$0")"
SRC=${1:-.}
mkdir -p dist
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cp -r "$SRC"/opsmon "$SRC"/web "$SRC"/deploy "$SRC"/INSTALL.md "$T"/
find "$T" -name __pycache__ -prune -exec rm -rf {} +
if grep -rIl -E '__(EXEC|OPS|MON)_USER__|__VPS_HOST(NAME)?__' "$T" >/dev/null && [ "${ALLOW_PLACEHOLDERS:-0}" != 1 ]; then
  echo "В исходниках остались плейсхолдеры. Сначала ../render.sh, или ALLOW_PLACEHOLDERS=1 для тестовой сборки." >&2; exit 2
fi
{ cat installer_header.sh; echo "__ARCHIVE__"; tar -C "$T" --sort=name --owner=0 --group=0 --numeric-owner --mtime='2026-01-01' -cz . | base64 -w 76; } > dist/monitor-installer.sh
sha256sum dist/monitor-installer.sh

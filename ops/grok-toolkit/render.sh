#!/bin/bash
# Подставляет реальные значения вместо плейсхолдеров в КОПИЮ папки (оригинал в репозитории не меняется).
# Значения берутся только из окружения и никогда не коммитятся:
#   GB_VPS_HOST GB_VPS_HOSTNAME GB_OPS_USER GB_EXEC_USER GB_MON_USER GB_OPS_SSH_KEY GB_KNOWN_HOSTS
# Использование: ./render.sh <папка-источник> <папка-назначения>
set -euo pipefail
SRC=${1:?источник}; DST=${2:?назначение}
for v in GB_VPS_HOST GB_VPS_HOSTNAME GB_OPS_USER GB_EXEC_USER GB_MON_USER GB_OPS_SSH_KEY GB_KNOWN_HOSTS; do
  [ -n "${!v:-}" ] || { echo "не задано: $v" >&2; exit 2; }
done
rm -rf "$DST"; cp -r "$SRC" "$DST"
grep -rIl -E '__(VPS_HOST|VPS_HOSTNAME|OPS_USER|EXEC_USER|MON_USER|OPS_SSH_KEY|KNOWN_HOSTS)__' "$DST" | while read -r f; do
  python3 - "$f" <<'PY'
import os, sys
p = sys.argv[1]; t = open(p, encoding='utf-8').read()
for k in ('VPS_HOSTNAME', 'VPS_HOST', 'OPS_SSH_KEY', 'KNOWN_HOSTS', 'OPS_USER', 'EXEC_USER', 'MON_USER'):
    t = t.replace('__%s__' % k, os.environ['GB_' + k])
open(p, 'w', encoding='utf-8').write(t)
PY
done
echo "готово: $DST"

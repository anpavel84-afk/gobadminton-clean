#!/bin/bash
# GoBadminton OPS monitor installer. MUST run as root. Idempotent. DRY=1 only prints actions.
# Usage: sudo ./install.sh            (asks for PIN, hidden, only if config does not exist yet)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
LIB=/usr/local/lib/gb-ops-monitor; CFG=/etc/gb-ops-monitor; DATA=/var/lib/gb-ops-monitor
SITE=/etc/nginx/sites-available/dev.gobadminton.ru; SNIP=/etc/nginx/snippets/gobadminton-ops-monitor.conf
INC='    include /etc/nginx/snippets/gobadminton-ops-monitor.conf;'
BK=/root/gb-ops-monitor-backup-$(date +%Y%m%d-%H%M%S)
DRY=${DRY:-0}
run() { if [ "$DRY" = 1 ]; then echo "[dry] $*"; else "$@"; fi; }
[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "Нужен root (sudo)."; exit 1; }
echo "== 1/7 проверки"
[ "$DRY" = 1 ] || getent passwd __EXEC_USER__ >/dev/null || { echo "нет пользователя __EXEC_USER__"; exit 1; }
if [ "$DRY" != 1 ]; then
  ss -ltn | grep -q '127.0.0.1:18090 ' && ! systemctl is-active --quiet gb-ops-monitor-web && { echo "порт 18090 занят чужим процессом"; exit 1; } || true
  [ -f "$SITE" ] || { echo "нет $SITE"; exit 1; }
  nginx -t
fi
run mkdir -p "$BK"; [ "$DRY" = 1 ] || { cp -a "$SITE" "$BK/dev.gobadminton.ru.site"; echo "$BK" > /root/.gb-ops-monitor-last-backup; }
# v4: also keep the previous code and units (rollback = copy back, or reinstall the previous installer)
if [ "$DRY" != 1 ]; then
  [ -d "$LIB" ] && cp -a "$LIB" "$BK/lib-gb-ops-monitor"
  for u in gb-ops-monitor-web.service gb-ops-monitor-writer.service gb-ops-monitor-writer.timer; do [ -f /etc/systemd/system/$u ] && cp -a /etc/systemd/system/$u "$BK/"; done
  true
fi
echo "== 2/7 пользователь и каталоги"
getent passwd __MON_USER__ >/dev/null || run useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin __MON_USER__
run install -d -m 0755 -o root -g root "$LIB" "$LIB/opsmon" "$LIB/web"
run install -d -m 0755 -o __EXEC_USER__ -g __EXEC_USER__ "$DATA"
run install -d -m 0750 -o root -g __MON_USER__ "$CFG"
# titles data dir: owned by __OPS_USER__ (updated without root), read-only data, validated strictly by the writer
if getent passwd __OPS_USER__ >/dev/null || [ "$DRY" = 1 ]; then run install -d -m 0755 -o __OPS_USER__ -g __OPS_USER__ /var/lib/gb-ops-titles; fi
echo "== 3/7 код (принадлежит root: исполнитель не может его изменить)"
run install -m 0644 -o root -g root "$SRC"/opsmon/__init__.py "$SRC"/opsmon/server.py "$SRC"/opsmon/writer.py "$SRC"/opsmon/make_config.py "$SRC"/opsmon/titles_ru.json "$LIB/opsmon/"
run install -m 0644 -o root -g root "$SRC"/web/* "$LIB/web/"
echo "== 4/7 конфиг с PIN (хеш, не сам PIN)"
if [ ! -f "$CFG/config.json" ]; then
  if [ "$DRY" = 1 ]; then echo "[dry] python3 make_config.py $CFG/config.json (PIN вводится скрыто)"; else
    /usr/bin/python3 -I "$LIB/opsmon/make_config.py" "$CFG/config.json"
    chown root:__MON_USER__ "$CFG/config.json"; chmod 0640 "$CFG/config.json"
  fi
else echo "конфиг уже есть, не трогаю (смена PIN: uninstall --purge-config или удалить файл и запустить снова)"; fi
echo "== 5/7 systemd"
run install -m 0644 "$SRC"/deploy/gb-ops-monitor-web.service "$SRC"/deploy/gb-ops-monitor-writer.service "$SRC"/deploy/gb-ops-monitor-writer.timer /etc/systemd/system/
run systemctl daemon-reload
run systemctl enable --now gb-ops-monitor-writer.timer
run systemctl start gb-ops-monitor-writer.service
run systemctl enable --now gb-ops-monitor-web.service
# the web service caches web/* in memory at start: restart so new pages are actually served
run systemctl restart gb-ops-monitor-web.service
echo "== 6/7 nginx (одна строка include в dev.gobadminton.ru, проверка nginx -t, откат при ошибке)"
run install -m 0644 -o root -g root "$SRC"/deploy/nginx-ops-monitor.conf "$SNIP"
if [ "$DRY" = 1 ]; then echo "[dry] вставить '$INC' перед 'location / {' в 443-блоке $SITE"; else
  if ! grep -qF 'gobadminton-ops-monitor.conf' "$SITE"; then
    python3 - "$SITE" "$INC" <<'PY'
import re, sys
p, inc = sys.argv[1], sys.argv[2]
s = open(p).read()
i = s.rfind('\n    location / {')           # catch-all of the 443 block is the last one
assert i != -1, 'location / not found'
open(p, 'w').write(s[:i] + '\n' + inc + s[i:])
PY
  fi
  if nginx -t; then systemctl reload nginx; else
    echo "nginx -t не прошёл, откатываю"; cp -a "$BK/dev.gobadminton.ru.site" "$SITE"; rm -f "$SNIP"; nginx -t; exit 1; fi
fi
echo "== 7/7 проверка"
if [ "$DRY" != 1 ]; then
  sleep 3
  curl -fsS http://127.0.0.1:18090/ops-monitor/healthz && echo
  c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18090/ops-monitor/api/snapshot); echo "аноним без cookie → HTTP $c (ожидается 401)"
  a=$(sha256sum "$LIB/web/app.js" | cut -d' ' -f1); b=$(curl -fsS http://127.0.0.1:18090/ops-monitor/app.js | sha256sum | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "app.js отдаётся новый ($(echo "$a" | cut -c1-12))" || echo "ВНИМАНИЕ: app.js отдаётся старый ($b != $a)"
  [ -f /var/lib/gb-ops-titles/titles_ru.json ] && echo "описания задач на месте: /var/lib/gb-ops-titles/titles_ru.json" || echo "описаний задач нет (будет встроенная копия)"
  python3 -c "import json;b=json.load(open('$DATA/snapshot.json')).get('backlog') or {};print('бэклог в снимке:', 'есть, задач '+str(len(b.get('items',[]))) if b.get('available') else 'НЕДОСТУПЕН ('+str(b.get('note'))+')')" || true
  ls -l "$DATA"
  echo "Готово: https://dev.gobadminton.ru/ops-monitor/   Бэкап: $BK"
fi

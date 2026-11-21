#!/bin/bash
# Полный откат монитора. Только root. DRY=1 — только показать. --purge-config удаляет и конфиг с хешем PIN, --purge-data снимки.
set -uo pipefail
DRY=${DRY:-0}; run() { if [ "$DRY" = 1 ]; then echo "[dry] $*"; else "$@"; fi; }
[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "Нужен root (sudo)."; exit 1; }
SITE=/etc/nginx/sites-available/dev.gobadminton.ru; SNIP=/etc/nginx/snippets/gobadminton-ops-monitor.conf
run systemctl disable --now gb-ops-monitor-writer.timer
run systemctl stop gb-ops-monitor-writer.service
run systemctl disable --now gb-ops-monitor-web.service
run rm -f /etc/systemd/system/gb-ops-monitor-web.service /etc/systemd/system/gb-ops-monitor-writer.service /etc/systemd/system/gb-ops-monitor-writer.timer
run systemctl daemon-reload
if [ "$DRY" = 1 ]; then echo "[dry] убрать строку include gobadminton-ops-monitor.conf из $SITE; nginx -t; reload"; else
  if grep -qF gobadminton-ops-monitor.conf "$SITE"; then
    cp -a "$SITE" "$SITE.pre-uninstall"; grep -vF gobadminton-ops-monitor.conf "$SITE.pre-uninstall" > "$SITE"
    if nginx -t; then systemctl reload nginx; else echo "nginx -t не прошёл — восстанавливаю"; cp -a "$SITE.pre-uninstall" "$SITE"; nginx -t; fi
  fi
fi
run rm -f "$SNIP"
run rm -rf /usr/local/lib/gb-ops-monitor
for a in "$@"; do
  [ "$a" = --purge-config ] && run rm -rf /etc/gb-ops-monitor
  [ "$a" = --purge-data ] && run rm -rf /var/lib/gb-ops-monitor
done
echo "Готово. Пользователь __MON_USER__ оставлен (userdel __MON_USER__ — вручную). Затронуто только то, что создавал install.sh."

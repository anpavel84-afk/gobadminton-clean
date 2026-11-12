#!/bin/bash
# GoBadminton OPS monitor: one-file installer (v4: секция «Бэклог»). Run: sudo bash gb-ops-monitor-install.sh
# DRY=1 sudo bash gb-ops-monitor-install.sh  -> only prints actions, changes nothing.
# Uninstall: sudo bash gb-ops-monitor-install.sh uninstall   (add --purge-config --purge-data to wipe)
set -euo pipefail
DRY=${DRY:-0}; export DRY
if [ "$DRY" != 1 ] && [ "$(id -u)" != 0 ]; then echo "Нужен root: sudo bash $0"; exit 1; fi
T=$(mktemp -d /tmp/gb-ops-mon.XXXXXX); trap 'rm -rf "$T"' EXIT
sed -n '/^__ARCHIVE__$/,$p' "$0" | tail -n +2 | base64 -d | tar -xz -C "$T"
chmod +x "$T"/deploy/*.sh
if [ "${1:-}" = uninstall ]; then shift; exec "$T/deploy/uninstall.sh" "$@"; fi
echo "=== GoBadminton OPS · Монитор: установка ==="
if [ ! -f /etc/gb-ops-monitor/config.json ]; then
  echo ">>> Сейчас спросит PIN (ввод скрыт, на экране ничего не видно). Введите PIN монитора и Enter."
fi
"$T/deploy/install.sh"
echo
echo "=== Готово ==="
echo "Адрес: https://dev.gobadminton.ru/ops-monitor/"
if [ "$DRY" != 1 ]; then
  echo "--- проверки ---"
  echo -n "служба web: "; systemctl is-active gb-ops-monitor-web || true
  echo -n "таймер:     "; systemctl is-active gb-ops-monitor-writer.timer || true
  echo -n "healthz:    "; curl -fsS http://127.0.0.1:18090/ops-monitor/healthz || echo FAIL; echo
  echo -n "публично, без PIN (ждём 401): "; curl -s -o /dev/null -w '%{http_code}\n' https://dev.gobadminton.ru/ops-monitor/api/snapshot || true
  echo -n "страница входа (ждём 200): "; curl -s -o /dev/null -w '%{http_code}\n' https://dev.gobadminton.ru/ops-monitor/ || true
fi
exit 0

#!/usr/bin/env bash
# GoBadminton Germany new DEV hostname rollback only. Does not touch PROD, DB, volumes or other vhosts.
set -Eeuo pipefail
ROOT=/root/gb-dev-germany-20261013
SITES=/etc/nginx/sites-available
[ "$(id -u)" = 0 ] || { echo 'STOP: administrative original host only'; exit 2; }
[[ "$(hostname -s)" == vmi3510488* ]] || { echo 'STOP: wrong host'; exit 2; }
exec 9>/run/lock/gobadminton-germany-dev-web.lock
flock -n 9 || { echo 'STOP: release lock busy'; exit 2; }
sha() { sha256sum "$1" | cut -d ' ' -f1; }
replace() {
  local input="$1" dest="$2" temp
  temp=$(mktemp /etc/nginx/sites-available/.gb-dev-rollback.XXXXXX)
  cat -- "$input" > "$temp"
  chown --reference="$dest" "$temp"
  chmod --reference="$dest" "$temp"
  mv -f "$temp" "$dest"
}
for n in dev.gobadminton.ru api.gobadminton.ru; do
    [ -f "$ROOT/$n.nginx.before" ] || { echo "STOP missing backup for $n"; exit 2; }
done
if [ "$(sha "$SITES/dev.gobadminton.ru")" != 4a919b4de38c4779ccf438f9aa692ac85c4f3d76fd61e572b41aee9f90ef48f2 ]; then
    echo 'STOP: DEV vhost changed independently'; exit 2
fi
if [ "$(sha "$SITES/api.gobadminton.ru")" != 2e26c23eecd1b386c5720b51200bab6cde57bb075b8fa527aa2c7775fe795cc3 ]; then
    echo 'STOP: PROD API alias vhost changed independently'; exit 2
fi
for n in dev.gobadminton.ru api.gobadminton.ru; do
  replace "$ROOT/$n.nginx.before" "$SITES/$n"
done
nginx -t -q && systemctl reload nginx
echo 'GERMANY_DEV_HTTPS_VHOSTS_ROLLBACK_PASS; existing DEV containers and PROD backend untouched'

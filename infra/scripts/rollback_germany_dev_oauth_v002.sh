#!/usr/bin/env bash
# Roll back only Germany DEV OAuth binding to its original unauthenticated DEV setup.
# Does not change PROD, databases, nginx, other projects, or Runner.
set -Eeuo pipefail
umask 077
[ "$(id -u)" = 0 ] && [[ "$(hostname -s)" == vmi3510488* ]] || { echo STOP_WRONG_HOST; exit 2; }
root=/srv/gobadminton-dev-preview
exec 9>/run/lock/gobadminton-germany-dev-web.lock
flock -n 9 || { echo STOP_ANOTHER_DEV_RELEASE; exit 2; }
python3 - <<'PY'
from pathlib import Path
import hashlib,os,re,stat,subprocess,json
root=Path('/srv/gobadminton-dev-preview')
old=root/'.env.before-oauth-20261013'
live=root/'.env'
orig=old.read_text()
now=live.read_text()
prefix=orig.rstrip('\n')+'\n\n# Shared provider applications, DEV-only OAuth callback URIs; PROD remains untouched\n'
assert now.startswith(prefix), 'STOP DEV .env drift'
extra=now[len(prefix):].splitlines()
expected={'DEV_VK_CLIENT_ID','DEV_VK_CLIENT_SECRET','DEV_YANDEX_CLIENT_ID','DEV_YANDEX_CLIENT_SECRET'}
assert len(extra)==4 and {s.split('=',1)[0] for s in extra}==expected,'STOP unexpected DEV .env modifications'
assert hashlib.sha256((root/'compose.full-germany-oauth-v002.yml').read_bytes()).hexdigest()=='ccf00cabfddadd933c2074f6649314e4ab8bf0733dc1c056c1226c93d4595c46'
assert hashlib.sha256((root/'compose.full-germany-v001.yml').read_bytes()).hexdigest()=='901a1e93573273bbcedb3b7fb5cc66e152a5dfc5295f6667028f01f9bd2885a7'
assert stat.S_IMODE(live.stat().st_mode)==0o600
c=json.loads(subprocess.check_output(['docker','inspect','gobadminton-dev-preview-api'],text=True))[0]
env={k:v for s in c['Config']['Env'] if '=' in s for k,v in [s.split('=',1)]}
assert env.get('GIT_SHA')=='16b97821cccec15d9b26f4e8e2b3073dd0bb3ee3'
assert env.get('PUBLIC_WEB_ORIGIN')=='https://dev.gobadminton.ru'
print('DEV_OAUTH_ROLLBACK_PRECHECK_PASS')
PY
cd "$root"
docker compose --env-file .env -f docker-compose.yml -f compose.full-germany-v001.yml up -d --no-deps --no-build api
for i in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(docker inspect gobadminton-dev-preview-api --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
  sleep 2
done
[ "$(docker inspect gobadminton-dev-preview-api --format '{{.State.Health.Status}}')" = healthy ] || { echo STOP_DEV_API_NOT_HEALTHY; exit 3; }
temp=$(mktemp "$root/.env.rollback.XXXXXX")
cat "$root/.env.before-oauth-20261013" > "$temp"
chmod 0600 "$temp"
mv -f "$temp" "$root/.env"
python3 - <<'PY'
import json,urllib.request
with urllib.request.urlopen('https://dev.gobadminton.ru/v1/auth/methods',timeout=10) as r:
 d=json.load(r)
statuses={i['method']:i['available'] for i in d.get('items',[])}
assert statuses.get('vk') is False and statuses.get('yandex') is False
print('DEV_OAUTH_ROLLBACK_PASS; ONLY_DEV; PROD_UNTOUCHED')
PY

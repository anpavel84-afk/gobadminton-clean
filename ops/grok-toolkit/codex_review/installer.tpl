#!/bin/bash
# =============================================================================
# codex-review-install: one-time ROOT setup of the read-only Codex prompt reviewer.  Host: __VPS_HOSTNAME__
#
#   bash codex-review-install.sh            install / upgrade
#   DRY=1 bash codex-review-install.sh      show what would happen, change nothing
#   bash codex-review-install.sh --remove   roll everything back (user, auth copy, wrapper, sudoers line)
#
# Creates : system user gobadminton-clean-prompt-review (no shell, no password)
#           /var/lib/gobadminton-clean-prompt-reviewer/{.codex,work} (0700, owned by that user)
#           .codex/auth.json = COPY of /home/__EXEC_USER__/.codex/auth.json (0600; nothing else copied, never printed)
#           /usr/local/sbin/gb-ops/codex-review (root:root 0755)
#           /var/lib/gb-ops-stage/reviews (0700 __OPS_USER__)
#           a marked block in /etc/sudoers.d/gb-__OPS_USER__-ops: __OPS_USER__ -> codex-review "" (visudo -cf first)
# Never touches: executor, its login (read only), DEV/PROD services, nginx, docker, other gb-ops wrappers.
# Backups: /root/gb-__OPS_USER__-ops.<stamp>.bak, /root/codex-review.<stamp>.bak.   Log: /var/log/gb-ops.log
# =============================================================================
# shellcheck disable=SC2016  # single-quoted sh -c scripts are intentional
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8
umask 022
DRY=${DRY:-0}
D=/usr/local/sbin/gb-ops
W=$D/codex-review
SUDOERS=/etc/sudoers.d/gb-__OPS_USER__-ops
RV_USER=gobadminton-clean-prompt-review
RV_HOME=/var/lib/gobadminton-clean-prompt-reviewer
RV_CODEX_HOME=$RV_HOME/.codex
EXEC_AUTH=/home/__EXEC_USER__/.codex/auth.json
CODEX=/opt/gobadminton-clean-qa/bin/codex
CODEX_RT=/opt/gobadminton-clean-qa
REVIEWS=/var/lib/gb-ops-stage/reviews
LOG=/var/log/gb-ops.log
STAMP=$(date +%Y%m%d-%H%M%S)
WRAPPER_SHA=@@WRAPPER_SHA@@
MODE=install
case "${1:-}" in "") ;; --remove) MODE=remove ;; *) echo "usage: $0 [--remove]   (DRY=1 for a dry run)"; exit 64 ;; esac

say() { echo "[codex-review] $*"; }
run() { if [ "$DRY" = 1 ]; then echo "[dry] $*"; else "$@"; fi; }
bad() { echo "[codex-review] ОШИБКА: $*" >&2; logl "install FAILED: $*"; exit 1; }
logl() { [ "$DRY" = 1 ] || printf '%s root codex-review-install[%s] %s\n' "$(date -Is)" "$$" "$*" >>"$LOG" 2>/dev/null || true; }
chk() { if [ "$DRY" = 1 ]; then echo "[dry] предупреждение: $*"; else bad "$*"; fi; }
as_u() { local u=$1; shift; setpriv --reuid="$u" --regid="$u" --clear-groups -- /usr/bin/env -i PATH=/usr/bin:/bin HOME="$RV_HOME" "$@"; }

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || bad "нужен root: sudo bash $0"
[ "$(hostname)" = __VPS_HOSTNAME__ ] || chk "это не __VPS_HOSTNAME__"
[ "$DRY" != 1 ] || say "DRY=1: ничего не меняю"
if [ "$DRY" != 1 ]; then exec 8>/run/gb-ops.lock; flock -w 120 8 || bad "занята другая операция gb-ops"; fi

TMP=$(mktemp -d /tmp/codex-review-install.XXXXXX); trap 'rm -rf "$TMP"' EXIT
BEGIN_MARK='# BEGIN gb-codex-review (managed by codex-review-install; remove with --remove)'
END_MARK='# END gb-codex-review'

sudoers_apply() { # sudoers_apply add|del
  if [ "$DRY" = 1 ] && [ "$(id -u)" != 0 ]; then echo "[dry] без root: $1 блока gb-codex-review в $SUDOERS: $W \"\" для __OPS_USER__"; return 0; fi
  [ -f "$SUDOERS" ] && [ ! -L "$SUDOERS" ] || chk "нет $SUDOERS (сначала нужен gb-ops-bootstrap)"
  [ -f "$SUDOERS" ] || return 0
  sed "/^# BEGIN gb-codex-review/,/^# END gb-codex-review/d" "$SUDOERS" >"$TMP/sud"
  if [ "$1" = add ]; then
    cat >>"$TMP/sud" <<SUD
$BEGIN_MARK
Cmnd_Alias GBOPS_REVIEW = $W ""
Defaults!GBOPS_REVIEW env_reset, !setenv, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"
__OPS_USER__ ALL=(root) NOPASSWD: GBOPS_REVIEW
$END_MARK
SUD
  fi
  if cmp -s "$TMP/sud" "$SUDOERS"; then say "sudoers: без изменений"; return 0; fi
  visudo -cf "$TMP/sud" >/dev/null || bad "visudo отверг новый $SUDOERS, ничего не изменено"
  if [ "$DRY" = 1 ]; then echo "[dry] новый блок в $SUDOERS:"; diff "$SUDOERS" "$TMP/sud" | sed 's/^/    /' || true; return 0; fi
  cp -a "$SUDOERS" "/root/gb-__OPS_USER__-ops.$STAMP.bak"
  install -m 0440 -o root -g root "$TMP/sud" "$SUDOERS.new"     # имя с точкой: sudo его игнорирует
  visudo -cf "$SUDOERS.new" >/dev/null || { rm -f "$SUDOERS.new"; bad "visudo отверг установленный файл"; }
  mv -f "$SUDOERS.new" "$SUDOERS"
  visudo -c >/dev/null || { cp -a "/root/gb-__OPS_USER__-ops.$STAMP.bak" "$SUDOERS"; bad "visudo -c не прошёл, вернул прежний $SUDOERS"; }
  say "sudoers обновлён (копия: /root/gb-__OPS_USER__-ops.$STAMP.bak)"
}

# ============================================================== remove
if [ "$MODE" = remove ]; then
  say "== откат"
  sudoers_apply del
  if [ -e "$W" ]; then run cp -a "$W" "/root/codex-review.$STAMP.bak"; run rm -f "$W"; say "обёртка удалена"; else say "обёртки уже нет"; fi
  if getent passwd "$RV_USER" >/dev/null; then
    run pkill -KILL -u "$RV_USER" || true
    run userdel "$RV_USER"; say "пользователь $RV_USER удалён"
  fi
  getent group "$RV_USER" >/dev/null && run groupdel "$RV_USER" || true
  if [ -d "$RV_HOME" ] && [ ! -L "$RV_HOME" ]; then run rm -rf --one-file-system -- "$RV_HOME"; say "$RV_HOME удалён (вместе с копией входа)"; fi
  say "оставлены: $REVIEWS (отзывы, принадлежат __OPS_USER__), $LOG"
  logl "removed"
  exit 0
fi

# ============================================================== install
say "== 1/7 проверки"
for c in visudo flock setpriv useradd sha256sum install git timeout pkill iconv; do command -v "$c" >/dev/null || chk "нет команды $c"; done
[ -f "$D/lib.sh" ] || chk "нет $D/lib.sh (сначала gb-ops-bootstrap)"
for p in "$D" "$D/lib.sh" "$CODEX" "$CODEX_RT" "$CODEX_RT/codex-path"; do
  [ -e "$p" ] || { chk "нет $p"; continue; }
  [ ! -L "$p" ] && [ "$(stat -c %u "$p")" = 0 ] && [ $(( 8#$(stat -c %a "$p") & 0022 )) = 0 ] || chk "$p не root-owned или доступен на запись"
done
[ -x "$CODEX" ] && say "codex: $("$CODEX" --version 2>/dev/null | head -n1)"
getent passwd __OPS_USER__ >/dev/null || chk "нет пользователя __OPS_USER__"
getent passwd __EXEC_USER__ >/dev/null || chk "нет пользователя __EXEC_USER__"
if [ "$(id -u)" = 0 ]; then
  if [ -f "$EXEC_AUTH" ] && [ ! -L "$EXEC_AUTH" ]; then say "файл входа исполнителя найден (содержимое не читаю и не печатаю)"
  else chk "нет обычного файла $EXEC_AUTH (вход исполнителя хранится иначе?)"; fi
else say "[dry] без root не проверяю файл входа исполнителя"; fi

say "== 2/7 распаковываю обёртку"
base64 -d >"$TMP/codex-review" <<'B64'
@@WRAPPER_B64@@
B64
[ "$(sha256sum "$TMP/codex-review" | cut -d' ' -f1)" = "$WRAPPER_SHA" ] || bad "встроенная обёртка повреждена"
bash -n "$TMP/codex-review" || bad "синтаксис обёртки"

say "== 3/7 служебный пользователь $RV_USER и каталоги"
if getent passwd "$RV_USER" >/dev/null; then say "пользователь уже есть"
else run useradd --system --user-group --no-create-home --home-dir "$RV_HOME" --shell /usr/sbin/nologin \
       --comment "GoBadminton read-only prompt reviewer (gb-ops codex-review)" "$RV_USER"; fi
[ ! -L "$RV_HOME" ] || bad "$RV_HOME — символическая ссылка"
run install -d -m 0700 -o "$RV_USER" -g "$RV_USER" "$RV_HOME" "$RV_CODEX_HOME" "$RV_HOME/work"
[ ! -L /var/lib/gb-ops-stage ] && [ ! -L "$REVIEWS" ] || bad "символическая ссылка в $REVIEWS"
run install -d -m 0700 -o __OPS_USER__ -g __OPS_USER__ "$REVIEWS"

say "== 4/7 копия входа Codex (только auth.json, 0600, владелец $RV_USER; содержимое не печатается)"
if [ "$DRY" = 1 ]; then echo "[dry] скопировал бы $EXEC_AUTH -> $RV_CODEX_HOME/auth.json"
else
  exec 4<"$EXEC_AUTH" || bad "не открыть $EXEC_AUTH"
  [ "$(readlink -f /proc/self/fd/4)" = "$EXEC_AUTH" ] && [ -f /proc/self/fd/4 ] || bad "$EXEC_AUTH не обычный файл"
  [ "$(stat -L -c '%U %h' /proc/self/fd/4)" = "__EXEC_USER__ 1" ] || bad "$EXEC_AUTH: неожиданный владелец или жёсткие ссылки"
  [ "$(stat -L -c %s /proc/self/fd/4)" -le 65536 ] || bad "$EXEC_AUTH слишком большой"
  as_u "$RV_USER" /bin/sh -c 'umask 077; t="$1/auth.json.part.$$"; cat >"$t" && mv -f -- "$t" "$1/auth.json"' _ "$RV_CODEX_HOME" <&4 \
    || bad "не удалось записать копию входа"
  exec 4<&-
  [ "$(stat -c '%U %a' "$RV_CODEX_HOME/auth.json")" = "$RV_USER 600" ] || bad "права копии входа не 0600 $RV_USER"
  say "копия входа на месте"
fi

say "== 5/7 обёртка $W (root:root 0755)"
[ -e "$W" ] && run cp -a "$W" "/root/codex-review.$STAMP.bak"
run install -m 0755 -o root -g root "$TMP/codex-review" "$W.new"
run mv -f "$W.new" "$W"

say "== 6/7 самопроверка (до включения sudo)"
if [ "$DRY" != 1 ]; then
  [ "$(sha256sum "$W" | cut -d' ' -f1)" = "$WRAPPER_SHA" ] || bad "хэш установленной обёртки"
  for u in __OPS_USER__ __EXEC_USER__ "$RV_USER"; do
    for p in "$D" "$W"; do if as_u "$u" test -w "$p" 2>/dev/null; then bad "$u может писать в $p"; fi; done
  done
  say "ок: права"
  # sandbox smoke as the service user with the SAME permission profile the wrapper uses (no model call, no auth needed)
  R=$(as_u "$RV_USER" /usr/bin/mktemp -d "$RV_HOME/work/run.XXXXXX")
  as_u "$RV_USER" /bin/sh -c 'mkdir -m700 "$1/repo" "$1/tmp" && echo probe >"$1/repo/probe.txt"' _ "$R"
  PERM="permissions.gb-review={\"extends\"=\":read-only\",\"network\"={\"enabled\"=false},\"filesystem\"={\":root\"=\"deny\",\":minimal\"=\"read\",\":slash_tmp\"=\"deny\",\":tmpdir\"=\"write\",\"$CODEX_RT\"=\"read\",\"$R/repo\"=\"read\",\"$R/tmp\"=\"write\",\"$RV_CODEX_HOME\"=\"deny\",\"/var/lib/gb-ops-stage\"=\"deny\",\"/home\"=\"deny\",\"/root\"=\"deny\"}}"
  sbx() { setpriv --reuid="$RV_USER" --regid="$RV_USER" --clear-groups -- /usr/bin/env -i HOME="$RV_HOME" \
    CODEX_HOME="$RV_CODEX_HOME" TMPDIR="$R/tmp" PATH="$CODEX_RT/codex-path:/usr/bin:/bin" LANG=C.UTF-8 \
    /usr/bin/timeout 60 "$CODEX" sandbox -c 'default_permissions="gb-review"' -c "$PERM" -- "$@" </dev/null 2>&1; }
  cd "$R/repo"
  sfail() { cd /; as_u "$RV_USER" rm -rf "$R"; bad "песочница: $1"; }
  if ! sbx cat "$R/repo/probe.txt" | grep -qx probe; then sfail "не читает checkout (Codex sandbox не работает для $RV_USER)"; fi
  if sbx /bin/sh -c "echo x >'$R/repo/w' && echo WROTE" | grep -q WROTE; then sfail "позволяет писать в checkout"; fi
  if sbx /bin/bash -c 'exec 3<>/dev/tcp/1.1.1.1/443 && echo NET_OPEN' | grep -q NET_OPEN; then sfail "пускает в сеть"; fi
  if sbx /bin/sh -c "test -r '$RV_CODEX_HOME/auth.json' && echo AUTH_VISIBLE" | grep -q AUTH_VISIBLE; then sfail "видит копию входа"; fi
  if sbx /bin/sh -c "ls /var/lib/gb-ops-stage/files /home/__EXEC_USER__ >/dev/null 2>&1 && echo LEAK" | grep -q LEAK; then sfail "видит чужие каталоги"; fi
  cd /; as_u "$RV_USER" rm -rf "$R"
  say "ок: песочница Codex для $RV_USER: чтение checkout да, запись нет, сеть нет, вход и чужие каталоги не видны"
else echo "[dry] проверил бы права и песочницу Codex для $RV_USER"; fi

say "== 7/7 sudoers"
sudoers_apply add
if [ "$DRY" != 1 ]; then
  sudo -l -U __OPS_USER__ 2>/dev/null | grep -q "$W" || bad "sudo -l не показывает codex-review для __OPS_USER__"
  say "ок: __OPS_USER__ может запускать: sudo $W   (запрос одной строкой на stdin: \"<файл тела> <sha>\")"
fi
logl "installed wrapper sha ${WRAPPER_SHA:0:12}"
say "Готово. Откат: sudo bash /root/codex-review-install.sh --remove"

#!/bin/bash
# =============================================================================
# parallel-slots-install: one-time ROOT install of PARALLEL_SLOTS_V1 (PR #100) on vmi3510488.
#
#   DRY=1 bash parallel-slots-install.sh     preflight + idle check + plan, change nothing
#   bash parallel-slots-install.sh           install (ONLY while the legacy executor is idle)
#   bash parallel-slots-install.sh --remove  roll back to the legacy single executor (slot1 must be idle)
#
# Installs : /usr/local/lib/gobadminton-slots/{autonomous_issues.py,slots.py} (root 0644, sha256-checked, from PR head @@HEAD_SHA@@)
#            users gb-supervisor, gb-slot2 (system, nologin, NO keys, NO Codex login); group gb-slots
#            /var/lib/gobadminton-autonomy/{slots,outbox,assign,locks}, /srv/gb-slots/{base.git,slot1,slot2}
#            /etc/gobadminton-slots/{budgets.json,supervisor.json,known_hosts}
#            gobadminton-slot@.service (+ slot1 drop-in: User=agentagency-dev), gobadminton-supervisor.service
# Starts   : ONLY gobadminton-slot@slot1 + supervisor, max_parallel=1. slot2 is NOT started and has no credentials.
# Migrates : legacy state -> slots/slot1 byte-identical (sha256), no counter/history reset; legacy gets RETIRED_TO_SLOT.json
# Legacy   : gobadminton-autonomy.service (user unit of agentagency-dev) is stopped + disabled, its files are NOT changed.
# Never    : touches DEV/PROD services, the deploy helper, nginx, docker, sudoers, the codex-review user, any token.
# Backups  : /root/gb-parallel-slots.<stamp>/ (legacy state tar + sha256, unit text).  Log: /var/log/gb-ops.log
# =============================================================================
# shellcheck disable=SC2016
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8
umask 022
DRY=${DRY:-0}
MODE=install
case "${1:-}" in "") ;; --remove) MODE=remove ;; *) echo "usage: $0 [--remove]   (DRY=1 for a dry run)"; exit 64 ;; esac

LU=agentagency-dev
LUNIT=gobadminton-autonomy.service
LIB=/usr/local/lib/gobadminton-slots
VAR=/var/lib/gobadminton-autonomy
SRV=/srv/gb-slots
ETC=/etc/gobadminton-slots
UNITDIR=/etc/systemd/system
SUP=gb-supervisor
S2=gb-slot2
GRP=gb-slots
LOG=/var/log/gb-ops.log
STAMP=$(date +%Y%m%d-%H%M%S)
BK=/root/gb-parallel-slots.$STAMP
HEAD_SHA=@@HEAD_SHA@@
SHA_EXEC=@@SHA_EXEC@@
SHA_SLOTS=@@SHA_SLOTS@@
SHA_T1=@@SHA_T1@@
SHA_T2=@@SHA_T2@@
BASE_SHA=@@BASE_SHA@@
SHA_BASE_EXEC=@@SHA_BASE_EXEC@@
DONE_STARTED=0
LEGACY_STOPPED=0

say() { echo "[parallel-slots] $*"; }
logl() { [ "$DRY" = 1 ] || printf '%s root parallel-slots-install[%s] %s\n' "$(date -Is)" "$$" "$*" >>"$LOG" 2>/dev/null || true; }
bad() { echo "[parallel-slots] ОШИБКА: $*" >&2; logl "FAILED: $*"; exit 1; }
chk() { if [ "$DRY" = 1 ]; then echo "[dry] предупреждение: $*"; else bad "$*"; fi; }
run() { if [ "$DRY" = 1 ]; then echo "[dry] $*"; else "$@"; fi; }
lu_uid() { id -u "$LU"; }
as() { local u=$1; shift; local g; g=$(id -g "$u"); setpriv --reuid="$u" --regid="$g" --init-groups -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 "$@"; }
as_slots() { local u=$1; shift; setpriv --reuid="$u" --regid="$(id -g "$u")" --groups="$(getent group "$GRP" | cut -d: -f3)" -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 "$@"; }
luctl() { local uid; uid=$(lu_uid); setpriv --reuid="$LU" --regid="$(id -g "$LU")" --init-groups -- /usr/bin/env -i PATH=/usr/bin:/bin HOME="/home/$LU" XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user "$@"; }
must_fail() { local what=$1; shift; if "$@" >/dev/null 2>&1; then bad "изоляция: $what УДАЛОСЬ (ожидался отказ)"; fi; say "изоляция ok: $what -> отказ"; }

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || bad "нужен root: sudo bash $0"
[ "$(id -u)" = 0 ] || [ "$DRY" = 1 ] || exit 1
[ "$(hostname)" = vmi3510488 ] || chk "это не vmi3510488"
if [ "$DRY" != 1 ]; then exec 8>/run/gb-ops.lock; flock -w 120 8 || bad "занята другая операция gb-ops"; fi
TMP=$(mktemp -d /tmp/parallel-slots-install.XXXXXX); trap 'rm -rf "$TMP"' EXIT

# ------------------------------------------------------------------ embedded files (sha256-checked)
unpack() { # unpack NAME SHA  (payload follows the marker line @@NAME@@)
  awk -v m="__PAYLOAD_$1__" '$0==m{f=1;next} /^__PAYLOAD_/{f=0} f' "$0" | base64 -d >"$TMP/$1" || bad "распаковка $1"
  echo "$2  $TMP/$1" | sha256sum -c --status - || bad "sha256 $1 не совпал"
}
unpack autonomous_issues.py "$SHA_EXEC"; unpack slots.py "$SHA_SLOTS"
unpack test_autonomous_issues.py "$SHA_T1"; unpack test_slots.py "$SHA_T2"
say "файлы PR @${HEAD_SHA:0:12}: sha256 ok"

# ------------------------------------------------------------------ legacy discovery (read-only)
id -u "$LU" >/dev/null 2>&1 || chk "нет пользователя $LU"
UNIT_TEXT=$(luctl cat "$LUNIT" 2>/dev/null || true)
[ -n "$UNIT_TEXT" ] || chk "не найден user-unit $LUNIT у $LU"
EXEC=$(printf '%s\n' "$UNIT_TEXT" | sed -n 's/^ExecStart=//p' | tail -n1)
arg() { printf '%s\n' "$EXEC" | tr ' ' '\n' | awk -v k="$1" 'p{print;exit} $0==k{p=1}'; }
L_REPO=$(arg --repo); L_STATE=$(arg --state-dir); L_KH=$(arg --known-hosts); L_SINCE=$(arg --approved-since)
L_CODEX=$(arg --codex); L_POLL=$(arg --poll); L_WAIT=$(arg --wait-timeout); L_MT=$(arg --model-timeout)
[ "$MODE" = remove ] || { [ -n "$L_REPO" ] && [ -n "$L_STATE" ] && [ -n "$L_KH" ] && [ -n "$L_SINCE" ] || chk "не разобран ExecStart legacy: $EXEC"; }
EXTRA=""
[ -z "$L_CODEX" ] || EXTRA="$EXTRA --codex $L_CODEX"
[ -z "$L_POLL" ] || EXTRA="$EXTRA --poll $L_POLL"
[ -z "$L_WAIT" ] || EXTRA="$EXTRA --wait-timeout $L_WAIT"
[ -z "$L_MT" ] || EXTRA="$EXTRA --model-timeout $L_MT"
for v in "$L_REPO" "$L_STATE" "$L_KH" "$L_SINCE" $EXTRA; do [[ $v =~ ^[A-Za-z0-9_./:+-]*$ ]] || bad "небезопасный аргумент legacy: $v"; done
say "legacy: repo=$L_REPO state=$L_STATE since=$L_SINCE"
if [ "$MODE" = install ]; then
# preflight A: no flag of the legacy ExecStart may be silently dropped
for tok in $EXEC; do case "$tok" in --*) case "$tok" in --repo|--state-dir|--worktrees-root|--known-hosts|--approved-since|--codex|--poll|--wait-timeout|--model-timeout) ;; *) chk "неизвестный флаг legacy ExecStart: $tok (не переносится в slot1)";; esac;; esac; done
# preflight B: carry the legacy Environment*= over to slot1 VERBATIM (same systemd quoting) via a root-only 0600 drop-in.
# Names only are ever printed, never values. Credentials and user-manager-only specifiers are refused.
ENV_LINES=$(printf '%s\n' "$UNIT_TEXT" | grep -E '^(Environment|EnvironmentFile|UnsetEnvironment|PassEnvironment)=' || true)
ENVN=$(printf '%s\n' "$ENV_LINES" | sed -n 's/^Environment=//p' | grep -oE '(^|[[:space:]]|")[A-Za-z_][A-Za-z0-9_]*=' | tr -d ' "=' | sort -u | tr '\n' ' ' || true)
ENVF=$(printf '%s\n' "$ENV_LINES" | grep -c '^EnvironmentFile=' || true)
printf '%s\n' "$UNIT_TEXT" | grep -qE '^(LoadCredential|LoadCredentialEncrypted|SetCredential|SetCredentialEncrypted)=' && chk "legacy unit использует *Credential*= - перенос не предусмотрен"
printf '%s\n' "$ENV_LINES" | grep -qE '%[tSCLE]' && chk "Environment legacy содержит user-manager спецификаторы (%t/%S/%C/%L/%E) - перенос не предусмотрен"
say "legacy Environment: ключи [${ENVN:-нет}], EnvironmentFile строк: ${ENVF:-0} (значения не печатаются) -> slot1 drop-in 0600"
MGRN=$(luctl show-environment 2>/dev/null | cut -d= -f1 | grep -vE '^(HOME|LANG|LOGNAME|PATH|SHELL|USER|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS|INVOCATION_ID|MANAGERPID|SYSTEMD_EXEC_PID|JOURNAL_STREAM|MANAGERPIDFDID|LC_[A-Z]+|LANGUAGE|TERM)$' | sort -u | tr '\n' ' ' || true)
[ -z "$MGRN" ] || say "предупреждение: в окружении user-manager есть ключи [${MGRN}] - executor строит env подпроцессов сам (clean_env), python их не читает; не переносятся"
# preflight C: the running legacy code must be exactly the PR base (PARK_V1.1 @ ${BASE_SHA:0:8}); otherwise slot1 would change behaviour beyond PR #100
L_PY=$(printf '%s\n' $EXEC | grep -m1 -E '/autonomous_issues\.py$' || true)
if [ -n "$L_PY" ] && [ -r "$L_PY" ]; then
  L_PY_SHA=$(sha256sum <"$L_PY" | cut -d' ' -f1)
  if [ "$L_PY_SHA" = "$SHA_BASE_EXEC" ]; then say "legacy код = база ${BASE_SHA:0:8} (sha256 ok)"; else chk "legacy код ($L_PY) sha256 ${L_PY_SHA:0:12} != база ${BASE_SHA:0:8} ${SHA_BASE_EXEC:0:12}: сначала сверить, что установлено"; fi
else chk "не прочитан legacy autonomous_issues.py из ExecStart (${L_PY:-не найден})"; fi
fi

idle_of() { # idle_of STATE_DIR -> prints idle|busy:<phase>:<issue>|missing
  python3 -I -c 'import json,sys,os
p=os.path.join(sys.argv[1],"state.json")
if not os.path.isfile(p): print("missing"); sys.exit()
d=json.load(open(p)); a=d.get("active")
print("idle" if a is None or a.get("phase")=="done" else "busy:%s:%s"%(a.get("phase"),a.get("issue")))' "$1"
}
lock_free() { flock -n -E 9 "$1/worker.lock" true; }

# ================================================================== REMOVE
if [ "$MODE" = remove ]; then
  [ -d "$VAR/slots/slot1" ] || bad "slot1 не установлен"
  S1=$(idle_of "$VAR/slots/slot1"); [ "$S1" = idle ] || bad "slot1 не в простое ($S1): дождитесь окончания задачи"
  run systemctl disable --now gobadminton-supervisor.service gobadminton-slot@slot1.service gobadminton-slot@slot2.service 2>/dev/null || true
  [ "$DRY" = 1 ] || lock_free "$VAR/slots/slot1" || bad "slot1 worker.lock занят после остановки"
  [ -n "$L_STATE" ] || L_STATE=/home/$LU/.gb-autonomy-state
  run mkdir -p -m 0700 "$BK"
  if [ -f "$VAR/slots/slot1/MIGRATION.json" ] && python3 -I -c 'import json,sys,hashlib
m=json.load(open(sys.argv[1]+"/MIGRATION.json"))
sys.exit(0 if all(hashlib.sha256(open(sys.argv[1]+"/"+n,"rb").read()).hexdigest()==h for n,h in m["files"].items()) else 1)' "$VAR/slots/slot1"; then
    say "slot1 не продвинулся после миграции: снимаю tombstone с legacy"
    run mv "$L_STATE/RETIRED_TO_SLOT.json" "$BK/RETIRED_TO_SLOT.json"
  else
    say "slot1 продвинулся: переношу его состояние обратно в legacy (sha256, без сброса)"
    run mv "$L_STATE" "$BK/legacy-state.before-remove"
    run install -d -m 0700 -o "$LU" -g "$(id -g "$LU")" "$L_STATE"
    run as "$LU" python3 -B "$LIB/slots.py" migrate --src "$VAR/slots/slot1" --dst "$L_STATE" --apply
    run rm -f "$L_STATE/MIGRATION.json"
  fi
  for f in gobadminton-slot@.service gobadminton-supervisor.service; do run mv "$UNITDIR/$f" "$BK/" 2>/dev/null || true; done
  run mv "$UNITDIR/gobadminton-slot@slot1.service.d" "$BK/" 2>/dev/null || true
  run systemctl daemon-reload
  for d in "$LIB" "$ETC" "$VAR" "$SRV"; do [ -e "$d" ] && run mv "$d" "$BK/$(echo "$d" | tr / _)"; done
  run luctl enable --now "$LUNIT"
  logl "removed; backup $BK"; say "откат выполнен, legacy-исполнитель запущен. Резерв: $BK"; exit 0
fi

# ================================================================== INSTALL
[ ! -e "$VAR" ] && [ ! -e "$SRV" ] && [ ! -e "$LIB" ] || chk "уже установлено ($VAR/$SRV/$LIB существуют); сначала --remove"
for t in git python3 setpriv flock systemctl useradd groupadd tar sha256sum base64; do command -v "$t" >/dev/null || chk "нет $t"; done
python3 -I -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || chk "нужен python3 >= 3.10"

# 1. code self-test as an unprivileged user (offline, temp dir)
T=$TMP/selftest; mkdir -p "$T/scripts/chatops/tests"; cp "$TMP/autonomous_issues.py" "$TMP/slots.py" "$T/scripts/chatops/"
cp "$TMP/test_autonomous_issues.py" "$TMP/test_slots.py" "$T/scripts/chatops/tests/"; chmod -R a+rX "$T"; chmod a+rx "$TMP"
for t in test_autonomous_issues test_slots; do
  if [ "$(id -u)" = 0 ]; then tr=(as nobody); else tr=(); fi
  ( cd "$T" && "${tr[@]}" python3 -B "scripts/chatops/tests/$t.py" >"$TMP/$t.log" 2>&1 ) || { tail -n 20 "$TMP/$t.log" >&2; bad "самотест $t не прошёл"; }
done
say "самотест: старые и новые тесты зелёные"

# 2. idle guard (before touching anything)
LSTATE=$(idle_of "$L_STATE")
[ "$LSTATE" = idle ] || chk "legacy-исполнитель НЕ в простое ($LSTATE). Установка только между задачами"
[ ! -e "$L_STATE/RETIRED_TO_SLOT.json" ] || chk "legacy state уже помечен RETIRED"
if [ "$DRY" = 1 ]; then
  say "DRY: legacy=$LSTATE; дальше были бы: backup -> stop legacy -> users/dirs -> base.git + slot1 clone -> migrate -> units -> проверки 1-9 -> старт slot1+supervisor (max_parallel=1) -> проверка 11"
  exit 0
fi
logl "install start head=$HEAD_SHA"

rollback() {
  local rc=$?
  [ "$rc" = 0 ] && return 0
  echo "[parallel-slots] ОТКАТ после ошибки (rc=$rc)" >&2
  systemctl disable --now gobadminton-supervisor.service gobadminton-slot@slot1.service >/dev/null 2>&1 || true
  if [ "$DONE_STARTED" = 1 ] && [ "$(idle_of "$VAR/slots/slot1")" != idle ]; then
    echo "[parallel-slots] slot1 уже взял задачу: автоматический откат состояния запрещён, всё остановлено. Сверка вручную; резерв $BK" >&2
    logl "rollback STOPPED: slot1 busy"; exit "$rc"
  fi
  rm -f "$UNITDIR/gobadminton-slot@.service" "$UNITDIR/gobadminton-supervisor.service"
  rm -rf "$UNITDIR/gobadminton-slot@slot1.service.d"; systemctl daemon-reload || true
  [ -e "$L_STATE/RETIRED_TO_SLOT.json" ] && mv "$L_STATE/RETIRED_TO_SLOT.json" "$BK/" || true
  for d in "$LIB" "$ETC" "$VAR" "$SRV"; do [ -e "$d" ] && mv "$d" "$BK/$(echo "$d" | tr / _)" || true; done
  if [ "$LEGACY_STOPPED" = 1 ]; then luctl enable --now "$LUNIT" || echo "[parallel-slots] НЕ удалось запустить legacy: запустите вручную" >&2; fi
  logl "rolled back; backup $BK"; exit "$rc"
}
trap 'rollback; rm -rf "$TMP"' EXIT

# 3. backup
install -d -m 0700 "$BK"
printf '%s\n' "$UNIT_TEXT" >"$BK/legacy-unit.txt"
tar -C "$(dirname "$L_STATE")" -cpf "$BK/legacy-state.tar" "$(basename "$L_STATE")"
( cd "$L_STATE" && find . -maxdepth 1 -type f -name '*.json' -exec sha256sum {} + | sort ) >"$BK/legacy-state.sha256"
sha256sum "$BK/legacy-state.tar" >"$BK/legacy-state.tar.sha256"
say "резерв: $BK"

# 4. stop legacy, re-check idle and lock
luctl stop "$LUNIT"; LEGACY_STOPPED=1
for _ in $(seq 1 30); do [ "$(luctl is-active "$LUNIT" 2>/dev/null || true)" = active ] || break; sleep 1; done
[ "$(luctl is-active "$LUNIT" 2>/dev/null || true)" != active ] || bad "legacy не остановился"
[ "$(idle_of "$L_STATE")" = idle ] || bad "legacy после остановки не в простое"
lock_free "$L_STATE" || bad "legacy worker.lock всё ещё занят"
luctl disable "$LUNIT" >/dev/null 2>&1 || true
say "legacy остановлен и отключён (файлы unit не менялись)"

# 5. users, group, code
getent group "$GRP" >/dev/null || groupadd --system "$GRP"
getent passwd "$SUP" >/dev/null || useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$SUP"
getent passwd "$S2" >/dev/null || useradd --system --user-group --home-dir "$SRV/slot2/home" --no-create-home --shell /usr/sbin/nologin "$S2"
install -d -m 0755 -o root -g root "$LIB"
install -m 0644 -o root -g root "$TMP/autonomous_issues.py" "$TMP/slots.py" "$LIB/"
echo "$SHA_EXEC  $LIB/autonomous_issues.py" | sha256sum -c --status - || bad "sha256 после установки"
echo "$SHA_SLOTS  $LIB/slots.py" | sha256sum -c --status - || bad "sha256 после установки"

# 6. directories
LG=$(id -g "$LU"); G=$(getent group "$GRP" | cut -d: -f3)
install -d -m 0755 -o root -g root "$VAR" "$VAR/slots" "$VAR/outbox"
install -d -m 0700 -o "$LU" -g "$LG" "$VAR/slots/slot1"
install -d -m 0700 -o "$S2" -g "$S2" "$VAR/slots/slot2"
install -d -m 0755 -o "$LU" -g "$LG" "$VAR/outbox/slot1"
install -d -m 0755 -o "$S2" -g "$S2" "$VAR/outbox/slot2"
install -d -m 0755 -o "$SUP" -g "$SUP" "$VAR/assign"
install -d -m 1770 -o root -g "$G" "$VAR/locks"
for f in integration.lock registry.lock; do install -m 0640 -o root -g "$G" /dev/null "$VAR/locks/$f"; done
install -m 0660 -o root -g "$G" /dev/null "$VAR/locks/api.clock"
install -d -m 0755 -o root -g root "$ETC" "$SRV"
install -m 0644 -o root -g root "$L_KH" "$ETC/known_hosts"
printf '%s\n' '{"schema": 1, "providers": {"codex": {"author": 40, "qa": 40}}, "slots": {"slot1": {"codex": {"author": 40, "qa": 40}}, "slot2": {"codex": {"author": 20, "qa": 20}}}}' >"$ETC/budgets.json"
printf '{"schema": "GB_SLOT_SUPERVISOR_V1", "slots": ["slot1", "slot2"], "max_parallel": 1, "approved_since": "%s", "poll": 240}\n' "$L_SINCE" >"$ETC/supervisor.json"
chmod 0644 "$ETC/budgets.json" "$ETC/supervisor.json"

# 7. git: one read-only object store, own clone per slot
git -c safe.directory='*' clone -q --mirror --no-hardlinks "$L_REPO" "$SRV/base.git"
chown -R root:root "$SRV/base.git"; chmod -R a+rX,go-w "$SRV/base.git"
install -d -m 0700 -o "$LU" -g "$LG" "$SRV/slot1" "$SRV/slot1/worktrees"
as "$LU" git -c safe.directory="$SRV/base.git" clone -q --shared --no-checkout "$SRV/base.git" "$SRV/slot1/repo"
install -d -m 0700 -o "$S2" -g "$S2" "$SRV/slot2" "$SRV/slot2/worktrees" "$SRV/slot2/home"
say "git: base.git + slot1/repo (alternates)"

# 8. migrate legacy state -> slot1 (byte-identical, sha256), tombstone legacy
as "$LU" python3 -B "$LIB/slots.py" migrate --src "$L_STATE" --dst "$VAR/slots/slot1" --apply >"$BK/migration.json"
( cd "$VAR/slots/slot1" && for f in $(cd "$L_STATE" && ls state.json parked.json qa-*.json before-*.json 2>/dev/null); do
    [ "$(sha256sum <"$f")" = "$(sha256sum <"$L_STATE/$f")" ] || exit 1; done ) || bad "проверка 9: sha256 slot1 != legacy"
[ -f "$L_STATE/RETIRED_TO_SLOT.json" ] || bad "tombstone legacy не записан"
say "проверка 9 ok: состояние перенесено без изменений"

# 9. units
cat >"$UNITDIR/gobadminton-slot@.service" <<UNIT
# PARALLEL_SLOTS_V1 (installed by parallel-slots-install, PR #100 @ ${HEAD_SHA:0:12})
[Unit]
Description=GoBadminton executor slot %i (PARALLEL_SLOTS_V1)
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
User=gb-%i
SupplementaryGroups=$GRP
ExecStart=/usr/bin/python3 -B $LIB/autonomous_issues.py --slot %i --repo $SRV/%i/repo --state-dir $VAR/slots/%i --worktrees-root $SRV/%i/worktrees --known-hosts $ETC/known_hosts --approved-since $L_SINCE$EXTRA
KillMode=control-group
TimeoutStopSec=20
SendSIGKILL=yes
Restart=on-failure
RestartSec=30
UMask=0077
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$VAR/slots/%i $VAR/outbox/%i $VAR/locks $SRV/%i
[Install]
WantedBy=multi-user.target
UNIT
mkdir -p "$UNITDIR/gobadminton-slot@slot1.service.d"
cat >"$UNITDIR/gobadminton-slot@slot1.service.d/10-legacy-account.conf" <<UNIT
# slot1 keeps the existing executor account: its own SSH key and Codex login, nothing copied.
[Service]
User=$LU
ProtectHome=read-only
ReadWritePaths=/home/$LU/.codex
UNIT
chmod 0644 "$UNITDIR/gobadminton-slot@slot1.service.d/10-legacy-account.conf"
if [ -n "$ENV_LINES" ]; then
  ( umask 0077; { echo "# legacy Environment*= of $LUNIT, verbatim (root-only 0600; values never printed)"; echo "[Service]"; printf '%s\n' "$ENV_LINES"; } >"$UNITDIR/gobadminton-slot@slot1.service.d/20-legacy-env.conf" )
  chown root:root "$UNITDIR/gobadminton-slot@slot1.service.d/20-legacy-env.conf"; chmod 0600 "$UNITDIR/gobadminton-slot@slot1.service.d/20-legacy-env.conf"
  [ "$(printf '%s\n' "$ENV_LINES" | sha256sum)" = "$(grep -E '^(Environment|EnvironmentFile|UnsetEnvironment|PassEnvironment)=' "$UNITDIR/gobadminton-slot@slot1.service.d/20-legacy-env.conf" | sha256sum)" ] || bad "20-legacy-env.conf: строки не совпали"
  say "slot1: Environment перенесён (0600 root, sha256 строк ok)"
fi
cat >"$UNITDIR/gobadminton-supervisor.service" <<UNIT
# PARALLEL_SLOTS_V1 supervisor (installed by parallel-slots-install)
[Unit]
Description=GoBadminton slot supervisor (PM scheduler; no GitHub writes, no keys)
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
User=$SUP
SupplementaryGroups=$GRP
ExecStart=/usr/bin/python3 -B $LIB/slots.py supervise --config $ETC/supervisor.json
Restart=on-failure
RestartSec=30
UMask=0022
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
ReadWritePaths=$VAR/assign $VAR/locks
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

# 10. isolation checks 1-8 (ISOLATION_PLAN.md) BEFORE start
p() { systemctl show "$1" -p "$2" --value; }
[ "$(p gobadminton-slot@slot1.service User)" = "$LU" ] && [ "$(p gobadminton-slot@slot2.service User)" = "$S2" ] \
  && [ "$(p gobadminton-slot@slot1.service KillMode)" = control-group ] && [ "$(p gobadminton-slot@slot1.service PrivateTmp)" = yes ] \
  && [ "$(p gobadminton-slot@slot1.service ProtectSystem)" = strict ] && [ "$(p gobadminton-supervisor.service User)" = "$SUP" ] \
  && [ "$(p gobadminton-supervisor.service NoNewPrivileges)" = yes ] || bad "проверка 1: свойства unit"
p gobadminton-slot@slot1.service ReadWritePaths | grep -q "$SRV/slot1" && ! p gobadminton-slot@slot1.service ReadWritePaths | grep -q "$SRV/slot2" || bad "проверка 1: ReadWritePaths"
say "проверка 1 ok: unit-ы"
keys() { grep -oE '(^|[[:space:]])[A-Za-z_][A-Za-z0-9_]*=' | tr -d ' \t=' | sort -u | tr '\n' ' '; }
K1=$(p gobadminton-slot@slot1.service Environment | keys); K2=$(p gobadminton-slot@slot2.service Environment | keys)
[ "$K1" = "$ENVN" ] || bad "проверка 1: ключи Environment slot1 [$K1] != legacy [$ENVN]"
[ "$(p gobadminton-slot@slot1.service EnvironmentFiles | grep -c . || true)" = "${ENVF:-0}" ] || bad "проверка 1: число EnvironmentFile slot1 != legacy"
[ -z "$K2" ] || bad "проверка 1: slot2 получил Environment [$K2] (не должен)"
say "проверка 1 ok: Environment slot1 = legacy по ключам [${ENVN:-нет}], slot2 пуст"
python3 -I - "$LIB" "$L_STATE" <<'PY' || bad "проверка 2: пересечение путей"
import os, sys
sys.path.insert(0, sys.argv[1]); import slots as s
legacy = os.path.realpath(sys.argv[2])
L = [s.Layout(f'slot{i}') for i in (1, 2)]
for x in L:
    own = [os.path.realpath(p) for p in x.own()]
    assert s.disjoint(own, [legacy]), x.slot
    for y in L:
        if x is not y: assert s.disjoint(own, [os.path.realpath(p) for p in y.own()]), (x.slot, y.slot)
PY
say "проверка 2 ok: каталоги слотов не пересекаются"
must_fail "gb-slot2 пишет в slot1 worktree" as "$S2" touch "$SRV/slot1/worktrees/.x"
must_fail "gb-slot2 пишет в state slot1" as "$S2" touch "$VAR/slots/slot1/.x"
must_fail "gb-slot2 читает state slot1" as "$S2" cat "$VAR/slots/slot1/state.json"
must_fail "gb-slot2 читает SSH-ключ slot1" as "$S2" cat "/home/$LU/.ssh/gobadminton-clean-chatops-ed25519"
must_fail "gb-slot2 пишет в base.git" as "$S2" touch "$SRV/base.git/.x"
must_fail "$LU пишет в slot2" as "$LU" touch "$SRV/slot2/worktrees/.x"
must_fail "$LU пишет в state slot2" as "$LU" touch "$VAR/slots/slot2/.x"
must_fail "$SUP пишет в state slot1" as "$SUP" touch "$VAR/slots/slot1/.x"
must_fail "$SUP пишет в outbox slot1" as "$SUP" touch "$VAR/outbox/slot1/.x"
must_fail "gb-slot2 пишет назначение" as_slots "$S2" touch "$VAR/assign/slot1.json"
say "проверка 3 ok: перекрёстная запись запрещена"
CD=$(as "$LU" git -C "$SRV/slot1/repo" rev-parse --path-format=absolute --git-common-dir)
[ "$CD" = "$SRV/slot1/repo/.git" ] && grep -qx "$SRV/base.git/objects" "$SRV/slot1/repo/.git/objects/info/alternates" || bad "проверка 4: git"
say "проверка 4 ok: свой clone, общий только read-only base.git"
cat >"$TMP/locks.py" <<'PY'
import os, signal, subprocess, sys, time
sys.path.insert(0, sys.argv[1]); import slots as s
var = sys.argv[2]
r = lambda: s.LockRegistry(var + '/locks', var + '/locks/registry.lock')
rec = dict(issue=999999, locks=['web:selftest'], allowed_paths=['apps/web/selftest/**'])
child = subprocess.Popen([sys.executable, '-c', 'import sys,time;sys.path.insert(0,sys.argv[1]);import slots as s;'
    'r=s.LockRegistry(sys.argv[2]+"/locks",sys.argv[2]+"/locks/registry.lock");'
    'assert r.acquire("slot8",dict(issue=999998,locks=["web:selftest"],allowed_paths=["apps/web/selftest/**"]));'
    'm=s.IntegrationMutex(sys.argv[2]+"/locks/integration.lock");assert m.try_acquire();print("ready",flush=True);time.sleep(60)',
    sys.argv[1], var], stdout=subprocess.PIPE)
assert child.stdout.readline().strip() == b'ready'
mine = r()
assert not mine.acquire('slot7', rec), 'conflicting lease granted'
assert not s.IntegrationMutex(var + '/locks/integration.lock').try_acquire(), 'second integrator'
child.send_signal(signal.SIGKILL); child.wait()
assert mine.acquire('slot7', rec), 'lease not reclaimable after holder death'
m = s.IntegrationMutex(var + '/locks/integration.lock'); assert m.try_acquire(), 'mutex not free after death'
m.release(); mine.release()
print('ok')
PY
chmod a+r "$TMP/locks.py"
[ "$(as_slots "$S2" python3 -B "$TMP/locks.py" "$LIB" "$VAR")" = ok ] || bad "проверки 5-6: аренды/mutex"
as_slots "$S2" rm -f "$VAR/locks/slot8.lease"; rm -f "$VAR/locks/slot8.lease" "$VAR/locks/slot7.lease"
say "проверки 5-6 ok: аренды живут только с процессом, интегратор один"
cat >"$TMP/plan.json" <<'JSON'
[{"issue": 1, "task": {"allowed_paths": ["apps/web/src/games/**"], "locks": ["web:games"]}},
 {"issue": 2, "task": {"allowed_paths": ["apps/web/src/games/map/**"], "locks": ["web:games:map"]}},
 {"issue": 3, "task": {"allowed_paths": ["apps/api/src/profiles/**"], "locks": ["api:profiles"]}},
 {"issue": 4, "task": {"allowed_paths": ["apps/api/src/db/**"], "locks": ["migrations"]}}]
JSON
OUT=$(python3 -B "$LIB/slots.py" plan --tasks "$TMP/plan.json" --max-parallel 3)
python3 -I -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["parallel"]=={"slot1":1,"slot2":3}, d; assert "2" in d["deferred"] and "4" in d["deferred"], d' "$OUT" || bad "проверка 7: планировщик $OUT"
say "проверка 7 ok: пересечение -> очередь, разные области -> параллельно, migrations -> одна"
AD=$(python3 -B "$LIB/slots.py" adapters)
echo "$AD" | grep -q '"adapter": "codex", "author": "enabled", "qa": "enabled"' && echo "$AD" | grep '"adapter": "cursor"' | grep -vq '"author": "enabled"' \
  && echo "$AD" | grep '"adapter": "agy"' | grep -q '"qa": "agy may never act as qa"' || bad "проверка 8: адаптеры"
say "проверка 8 ok: codex включён, cursor/agy выключены, agy никогда не QA"

# 11. start slot1 + supervisor (max_parallel=1), post-start checks
systemctl enable --now gobadminton-slot@slot1.service gobadminton-supervisor.service; DONE_STARTED=1
sleep 25
for u in gobadminton-slot@slot1.service gobadminton-supervisor.service; do [ "$(systemctl is-active "$u")" = active ] || { journalctl -u "$u" -n 20 --no-pager | sed -E 's/(gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_]+/\1[REDACTED]/g' >&2; bad "$u не активен"; }; done
python3 -I -c 'import json,sys; s=json.load(open(sys.argv[1])); l=json.load(open(sys.argv[2]))
assert s["slot"]=="slot1" and s["done"]==l["done"], "status.json slot1 != legacy"' "$VAR/outbox/slot1/status.json" "$VAR/slots/slot1/state.json" || bad "status slot1"
N=$(journalctl -u gobadminton-slot@slot1.service -u gobadminton-supervisor.service --since "-5min" --no-pager 2>/dev/null | grep -cE 'gh[pousr]_[A-Za-z0-9]{20}|github_pat_|sk-[A-Za-z0-9]{20}|BEGIN OPENSSH' || true)
[ "$N" = 0 ] || bad "проверка 11: в журнале $N строк, похожих на секреты"
say "проверка 11 ok: секретов в журнале нет"
trap 'rm -rf "$TMP"' EXIT
logl "installed head=$HEAD_SHA backup=$BK"
say "ГОТОВО: slot1 + supervisor работают (max_parallel=1). slot2 не запущен и без учётных данных. Откат: sudo bash /root/parallel-slots-install.sh --remove"
exit 0

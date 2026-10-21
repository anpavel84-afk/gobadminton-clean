#!/bin/bash
# =============================================================================
# parallel-slots-install: one-time ROOT install of PARALLEL_SLOTS_V1 (PR #100) on vmi3510488.
#
#   DRY=1 bash parallel-slots-install.sh     preflight + idle check + plan, change nothing
#   bash parallel-slots-install.sh           install (ONLY while the legacy executor is idle)
#   bash parallel-slots-install.sh --remove  roll back to the legacy single executor (slot1 must be idle)
#
# Installs : /usr/local/lib/gobadminton-slots/{autonomous_issues.py,slots.py} (root 0644, sha256-checked final offline sidecars; PR ancestry + reconciled live fixes)
#            /usr/local/lib/gobadminton-slots/check_foundation.py (root 0644, sha256-checked, reviewed source)
#            validates existing gb-supervisor/gb-slot2 accounts; creates only supplementary group gb-slots-clean
#            /var/lib/gobadminton-autonomy/{slots,outbox,assign,locks}, /srv/gb-slots/{base.git,slot1,slot2}
#            /etc/gobadminton-slots/{budgets.json,supervisor.json}; slot2 uses its own preinstalled public trust file
#            gobadminton-slot@.service (+ slot1 drop-in: User=agentagency-dev), gobadminton-supervisor.service
# Starts   : ONLY gobadminton-slot@slot1 + supervisor, max_parallel=1. slot2 is NOT started and has no credentials.
# Migrates : legacy state -> slots/slot1 byte-identical (sha256), no counter/history reset; legacy gets RETIRED_TO_SLOT.json
# Legacy   : gobadminton-autonomy.service (user unit of agentagency-dev) is stopped + disabled, its files are NOT changed.
# Never    : touches DEV/PROD services, the deploy helper, nginx, docker, sudoers, the codex-review user, any token.
# Backups  : /root/gb-parallel-slots.<stamp>/ (legacy state tar + sha256, unit hashes, root-only rollback files).  Log: /var/log/gb-ops.log
# =============================================================================
# shellcheck disable=SC2016
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8
umask 022
DRY=${DRY:-0}
CHK_FAILED=0
MODE=install
case "${1:-}" in "") ;; --remove) MODE=remove ;; --preflight-slot2) MODE=preflight ;; --activate-slot2) MODE=activate ;; *) echo "usage: $0 [--remove|--preflight-slot2|--activate-slot2]   (DRY=1 for a dry run)"; exit 64 ;; esac

LU=agentagency-dev
LUNIT=gobadminton-autonomy.service
LIB=/usr/local/lib/gobadminton-slots
VAR=/var/lib/gobadminton-autonomy
SRV=/srv/gb-slots
ETC=/etc/gobadminton-slots
UNITDIR=/etc/systemd/system
SUP=gb-supervisor
S2=gb-slot2
GRP=gb-slots-clean
GROUP_GID=65042
LOG=/var/log/gb-ops.log
STAMP=$(date +%Y%m%d-%H%M%S)
BK=/root/gb-parallel-slots.$STAMP
# Historical local commit pins: ancestry evidence, not the provenance of all patched bytes.
HEAD_SHA=750afb7c8a10eda47adcb94f01229d56bb0f7144
SHA_EXEC=@@SHA_EXEC@@
SHA_FOUNDATION=@@SHA_FOUNDATION@@
SHA_SLOTS=@@SHA_SLOTS@@
SHA_T1=@@SHA_T1@@
SHA_T2=@@SHA_T2@@
BASE_SHA=970e5a470a8c738e98a1a0bde8c862e2aa23b5c8
SHA_BASE_EXEC=@@SHA_BASE_EXEC@@
S2_CODEX=/opt/gb-slots/runtime/codex
S2_KH=/etc/gobadminton-slots/slot2-known_hosts
SLOT_MODEL=gpt-6.1-sol
SLOT_EFFORT=high
DONE_STARTED=0
LEGACY_STOPPED=0
LEGACY_ENABLED=""
LEGACY_MIGRATION_STARTED=0
UNITS_CHANGED=0
DROPIN_CREATED=0
GROUP_CREATED=0
GROUP_MARKER=$LIB/.gb-slots-group-created
ETC_CHANGED=0
UNIT_FILES=(gobadminton-slot@slot2.service.d/20-runtime.conf gobadminton-slot@.service gobadminton-supervisor.service gobadminton-slot@slot1.service.d/10-legacy-account.conf)

say() { echo "[parallel-slots] $*"; }
logl() { [ "$DRY" = 1 ] || [ "$MODE" = preflight ] || printf '%s root parallel-slots-install[%s] %s\n' "$(date -Is)" "$$" "$*" >>"$LOG" 2>/dev/null || true; }
bad() { echo "[parallel-slots] ОШИБКА: $*" >&2; logl "FAILED: $*"; exit 1; }
chk() { if [ "$DRY" = 1 ]; then echo "[dry] предупреждение: $*"; CHK_FAILED=1; else bad "$*"; fi; }
run() { if [ "$DRY" = 1 ]; then echo "[dry] $*"; else "$@"; fi; }
lu_uid() { id -u "$LU"; }
as() { local u=$1; shift; local g; g=$(id -g "$u"); setpriv --reuid="$u" --regid="$g" --init-groups -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 "$@"; }
as_slots() { local u=$1; shift; setpriv --reuid="$u" --regid="$(id -g "$u")" --groups="$(id -G "$u" | tr ' ' ,),$(getent group "$GRP" | cut -d: -f3)" -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 "$@"; }
luctl() { local uid; uid=$(lu_uid); setpriv --reuid="$LU" --regid="$(id -g "$LU")" --init-groups -- /usr/bin/env -i PATH=/usr/bin:/bin HOME="/home/$LU" XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user "$@"; }
must_fail() { local what=$1; shift; if "$@" >/dev/null 2>&1; then bad "изоляция: $what УДАЛОСЬ (ожидался отказ)"; fi; say "изоляция ok: $what -> отказ"; }

# Only these public properties are requested. Never read unit text, environment or credentials.
# ExecStart is parsed in the pipe; only validated public arguments and file metadata leave it.
legacy_properties() {
  local property value
  for property in LoadState NeedDaemonReload FragmentPath DropInPaths ExecStart; do
    value=$(luctl show "$LUNIT" -p "$property" --value) || return 1
    printf '%s=%s\n' "$property" "$value"
  done
}

legacy_snapshot() {
  legacy_properties | python3 -I -c '
import json, os, re, shlex, stat, sys
try:
    properties = dict(line.rstrip("\n").split("=", 1) for line in sys.stdin)
    if set(properties) != {"LoadState", "NeedDaemonReload", "FragmentPath", "DropInPaths", "ExecStart"}:
        raise ValueError("invalid properties")
    if properties["LoadState"] != "loaded" or properties["NeedDaemonReload"] != "no":
        raise ValueError("unloaded or stale unit")
    def public_path(value):
        if not re.fullmatch(r"/[A-Za-z0-9_./:+-]+", value) or ".." in value.split("/"):
            raise ValueError("invalid public path")
        return value
    paths = [public_path(properties["FragmentPath"])]
    paths += [public_path(path) for path in properties["DropInPaths"].split()]
    files = []
    for path in paths:
        info = os.lstat(path)
        if not stat.S_ISREG(info.st_mode) or os.path.realpath(path) != path:
            raise ValueError("unrecognized unit path")
        files.append([path, info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                      info.st_size, info.st_mtime_ns, info.st_ctime_ns])
    start = re.fullmatch(r"\{ path=([^;]+) ; argv\[\]=(.*?) ; ignore_errors=no ; [^{}]*\}", properties["ExecStart"])
    if not start or start[1] != "/usr/bin/python3":
        raise ValueError("unrecognized ExecStart")
    args = shlex.split(start[2])
    if not args or args.pop(0) != "/usr/bin/python3":
        raise ValueError("unrecognized interpreter")
    if args and args[0] == "-B":
        args.pop(0)
    script = public_path(args.pop(0)) if args else ""
    if not script.endswith("/autonomous_issues.py") or len(args) % 2:
        raise ValueError("unrecognized executor")
    flags = {"--repo", "--state-dir", "--worktrees-root", "--known-hosts", "--approved-since",
             "--codex", "--poll", "--wait-timeout", "--model-timeout"}
    values = dict.fromkeys(sorted(flags), "")
    seen = set()
    for flag, value in zip(args[::2], args[1::2]):
        if flag not in flags or flag in seen or not re.fullmatch(r"[A-Za-z0-9_./:+-]+", value):
            raise ValueError("unknown/duplicate/unsafe argument")
        seen.add(flag)
        if flag in {"--repo", "--state-dir", "--worktrees-root", "--known-hosts"}:
            public_path(value)
        if flag in {"--poll", "--wait-timeout", "--model-timeout"} and (not value.isascii() or not value.isdigit() or int(value) <= 0):
            raise ValueError("invalid timing")
        values[flag] = value
    if any(not values[key] for key in ("--repo", "--state-dir", "--worktrees-root", "--known-hosts", "--approved-since")):
        raise ValueError("missing argument")
    expected_paths = {
        "--repo": "/srv/gobadminton-clean/worktrees/autonomy-existing-issues-20261015",
        "--state-dir": "/home/agentagency-dev/.gb-autonomy-state",
        "--worktrees-root": "/srv/gobadminton-clean/worktrees",
        "--known-hosts": "/home/agentagency-dev/.ssh/known_hosts",
    }
    if any(values[key] != expected for key, expected in expected_paths.items()):
        raise ValueError("legacy path outside exact CLEAN commissioning scope")
    if script != expected_paths["--repo"] + "/scripts/chatops/autonomous_issues.py":
        raise ValueError("legacy executor outside exact CLEAN commissioning scope")
    if values["--codex"] not in ("", "/opt/gobadminton-clean-qa/bin/codex"):
        raise ValueError("unapproved legacy Codex runtime")
    values["--python"] = script
    values["--unknown"] = ""
    print(json.dumps(dict(arguments=values, files=files), sort_keys=True))
except (OSError, ValueError):
    sys.exit(1)'
}

legacy_unchanged() {
  local current
  current=$(legacy_snapshot) && [ "$current" = "$LEGACY_META" ]
}

legacy_args() {
  python3 -I -c '
import json, sys
for key, value in json.load(sys.stdin)["arguments"].items():
    print(key + "=" + value)'
}

known_hosts() { # Validate the EXISTING trust file only; never write/copy SSH trust configuration.
  python3 -I - "$L_KH" "$(lu_uid)" "/home/$LU/.ssh/known_hosts" "$@" <<'PYKH'
import base64, os, re, stat, sys
path, uid, expected = sys.argv[1:4]
limit = 1024 * 1024
def validate(info):
    owner_ok = info.st_uid == int(uid) or (info.st_uid == 0 and path == expected)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not owner_ok or not 0 < info.st_size <= limit:
        raise ValueError('invalid known_hosts')
def validate_content(data):
    if b'\0' in data:
        raise ValueError('invalid known_hosts content')
    for line in data.decode('utf-8').splitlines():
        fields = line.split()
        if not fields or fields[0].startswith('#'):
            continue
        if fields[0] in ('@cert-authority', '@revoked'):
            fields = fields[1:]
        if len(fields) < 3:
            raise ValueError('invalid known_hosts entry')
        hosts, key_type, key = fields[:3]
        if hosts.startswith('|'):
            hashed = hosts.split('|')
            if len(hashed) != 4 or hashed[:2] != ['', '1'] or any(len(base64.b64decode(part, validate=True)) != 20 for part in hashed[2:]):
                raise ValueError('invalid known_hosts hash')
        elif any(not re.fullmatch(r'!?(?:\[[A-Za-z0-9*?.:_%-]+\]:[0-9]+|[A-Za-z0-9*?_.:%-]+)', host) for host in hosts.split(',')):
            raise ValueError('invalid known_hosts host')
        if not re.fullmatch(r'(?:(?:ssh-(?:ed25519|rsa|dss)|ecdsa-sha2-nistp(?:256|384|521))(?:-cert-v01@openssh\.com)?|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)(?:-cert-v01)?@openssh\.com)', key_type) or not base64.b64decode(key, validate=True):
            raise ValueError('invalid known_hosts key')
try:
    if not os.path.isabs(path) or '..' in path.split('/') or os.path.realpath(path) != path:
        raise ValueError('invalid known_hosts path')
    # Pin every directory: a renamed parent must not redirect the root read through a symlink.
    parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        parts = path.split('/')[1:]
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        before = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
        validate(before)
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    with os.fdopen(fd, 'rb') as source:
        opened = os.fstat(source.fileno())
        validate(opened)
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError('known_hosts replaced')
        data = source.read(limit + 1)
        after = os.fstat(source.fileno())
        validate(after)
        if len(data) != opened.st_size or (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('known_hosts changed')
        validate_content(data)
except (OSError, ValueError):
    sys.exit(1)
PYKH
}

# Render the same reviewed bytes for installation and backup validation.
unit_content() {
  case "$1" in
    gobadminton-slot@.service) cat <<UNIT
# PARALLEL_SLOTS_V1 (installed by parallel-slots-install, PR #100 @ ${HEAD_SHA:0:12})
[Unit]
Description=GoBadminton executor slot %i (PARALLEL_SLOTS_V1)
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
User=gb-%i
SupplementaryGroups=$GRP
ExecStart=/usr/bin/python3 -B $LIB/autonomous_issues.py --slot %i --repo $SRV/%i/repo --state-dir $VAR/slots/%i --worktrees-root $SRV/%i/worktrees --known-hosts $L_KH --approved-since $L_SINCE --model $SLOT_MODEL --effort $SLOT_EFFORT$EXTRA
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
Environment=HOME=$SRV/%i/home CODEX_HOME=$SRV/%i/home/.codex
[Install]
WantedBy=multi-user.target
UNIT
      ;;
    gobadminton-slot@slot2.service.d/20-runtime.conf) cat <<UNIT
# Own reviewed executable and explicit model/effort; no credentials are installed.
[Service]
ExecStart=
ExecStart=/usr/bin/python3 -B $LIB/autonomous_issues.py --slot slot2 --repo $SRV/slot2/repo --state-dir $VAR/slots/slot2 --worktrees-root $SRV/slot2/worktrees --known-hosts $S2_KH --approved-since $L_SINCE --codex $S2_CODEX --model $SLOT_MODEL --effort $SLOT_EFFORT
UNIT
      ;;
    gobadminton-slot@slot1.service.d/10-legacy-account.conf) cat <<UNIT
# slot1 keeps the existing executor account: its own SSH key and Codex login, nothing copied.
[Service]
User=$LU
Environment=HOME=/home/$LU CODEX_HOME=/home/$LU/.codex
ProtectHome=read-only
ReadWritePaths=/home/$LU/.codex
UNIT
      ;;
    gobadminton-supervisor.service) cat <<UNIT
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
      ;;
    *) return 1 ;;
  esac
}

# Never persist unverified unit bytes or follow a symlink to its contents.
# With no destination this is a read-only preflight; errors reveal no file data.
checked_unit() {
  python3 -I -c '
import os, stat, sys
path = sys.argv[1]
dest = sys.argv[2] if len(sys.argv) > 2 else None
expected = sys.stdin.buffer.read()
try:
    info = os.lstat(path)
    if stat.S_ISLNK(info.st_mode):
        if os.listxattr(path, follow_symlinks=False):
            raise ValueError("unrecognized unit metadata")
        target = os.readlink(path)
        if dest:
            os.symlink(target, dest)
            os.chown(dest, info.st_uid, info.st_gid, follow_symlinks=False)
    else:
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("non-regular unit")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            # Reject metadata we cannot restore without copying unverified values.
            if not stat.S_ISREG(info.st_mode) or os.listxattr(source.fileno()) or source.read(len(expected) + 1) != expected:
                raise ValueError("unrecognized unit")
        if dest:
            with open(dest, "xb", opener=lambda p, flags: os.open(p, flags, 0o600)) as output:
                output.write(expected)
            with open(dest + ".stat", "x", opener=lambda p, flags: os.open(p, flags, 0o600)) as meta:
                meta.write(f"{stat.S_IMODE(info.st_mode):o} {info.st_uid} {info.st_gid}\n")
    if dest:
        os.utime(dest, ns=(info.st_atime_ns, info.st_mtime_ns), follow_symlinks=False)
except (OSError, ValueError):
    sys.exit(1)' "$@"
}

check_units() {
  local f d
  for d in "$UNITDIR/gobadminton-slot@slot1.service.d" "$UNITDIR/gobadminton-slot@slot2.service.d"; do
    [ ! -L "$d" ] && { [ ! -e "$d" ] || [ -d "$d" ]; } || return 1
    if [ -d "$d" ]; then
      for f in "$d"/*; do
        [ ! -e "$f" ] && [ ! -L "$f" ] && continue
        case "$f" in "$UNITDIR/gobadminton-slot@slot1.service.d/10-legacy-account.conf"|"$UNITDIR/gobadminton-slot@slot2.service.d/20-runtime.conf") ;; *) return 1 ;; esac
      done
    fi
  done
  for f in "${UNIT_FILES[@]}"; do
    if [ -e "$UNITDIR/$f" ] || [ -L "$UNITDIR/$f" ]; then
      unit_content "$f" | checked_unit "$UNITDIR/$f" || return 1
    fi
  done
}

backup_units() {
  local f d="$UNITDIR/gobadminton-slot@slot1.service.d"
  [ ! -L "$d" ] && { [ ! -e "$d" ] || [ -d "$d" ]; } || bad "небезопасный каталог drop-in: $d"
  [ -d "$d" ] || DROPIN_CREATED=1
  install -d -m 0700 -o root -g root "$BK/units" "$BK/units/gobadminton-slot@slot1.service.d" "$BK/units/gobadminton-slot@slot2.service.d"
  for f in "${UNIT_FILES[@]}"; do
    if [ -e "$UNITDIR/$f" ] || [ -L "$UNITDIR/$f" ]; then
      [ -f "$UNITDIR/$f" ] || [ -L "$UNITDIR/$f" ] || bad "не файл unit: $f"
      unit_content "$f" | checked_unit "$UNITDIR/$f" "$BK/units/$f" \
        || bad "unit не совпадает с шаблоном установщика или не сохранён: $f"
    else
      touch "$BK/units/$f.absent"
    fi
  done
}

restore_units() {
  local f mode uid gid
  [ "$UNITS_CHANGED" = 1 ] || return 0
  if [ "$DROPIN_CREATED" = 0 ]; then mkdir -p -- "$UNITDIR/gobadminton-slot@slot1.service.d" || return 1; fi
  for f in "${UNIT_FILES[@]}"; do
    rm -f -- "$UNITDIR/$f" || return 1
    if [ ! -f "$BK/units/$f.absent" ]; then
      mkdir -p -- "$(dirname "$UNITDIR/$f")" || return 1
      cp -a -- "$BK/units/$f" "$UNITDIR/$f" || return 1
      if [ ! -L "$BK/units/$f" ]; then
        read -r mode uid gid <"$BK/units/$f.stat" || return 1
        chown "$uid:$gid" -- "$UNITDIR/$f" || return 1
        chmod "$mode" -- "$UNITDIR/$f" || return 1
      fi
    fi
  done
  if [ "$DROPIN_CREATED" = 1 ]; then rmdir "$UNITDIR/gobadminton-slot@slot1.service.d" "$UNITDIR/gobadminton-slot@slot2.service.d" 2>/dev/null || true; fi
}

# Only known rollback files are eligible; never recurse or follow symlinks.
allowed_files() {
  python3 -I - "$1" "$2" "${3:-.}" <<'PYFILES'
import os, re, stat, sys
kind, directory, prefix = sys.argv[1:]
pattern = re.compile(r'(state|parked)\.json|(qa|before-resume|before-park)-[0-9]+-a[0-9]+(-i[0-9]+)?\.json|worker\.lock')
try:
    for name in sorted(os.listdir(directory)):
        allowed = name in {'budgets.json', 'supervisor.json'} if kind == 'config' else pattern.fullmatch(name)
        if not allowed:
            continue
        info = os.lstat(os.path.join(directory, name))
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('non-regular rollback file')
        sys.stdout.buffer.write(os.fsencode(os.path.join(prefix, name)) + b'\0')
except (OSError, ValueError):
    sys.exit(1)
PYFILES
}

filtered_tar() {
  local kind=$1 directory=$2 archive=$3 prefix=${4:-.}
  python3 -I - "$kind" "$directory" "$archive" "$prefix" <<'PYTAR'
import io, os, re, stat, sys, tarfile
kind, directory, archive, prefix = sys.argv[1:]
pattern = re.compile(r'(state|parked)\.json|(qa|before-resume|before-park)-[0-9]+-a[0-9]+(-i[0-9]+)?\.json|worker\.lock')
parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    path = os.path.join(directory, prefix)
    if not os.path.isabs(path) or '..' in path.split('/'):
        raise ValueError('invalid rollback directory')
    for part in path.split('/')[1:]:
        if part in ('', '.'):
            continue
        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        os.close(parent)
        parent = child
    # Open each eligible file once. Never let tar reopen a user-controlled path.
    target = sys.stdout.buffer if archive == '-' else open(archive, 'xb')
    try:
        with tarfile.open(fileobj=target, mode='w|', format=tarfile.PAX_FORMAT) as out:
            for name in sorted(os.listdir(parent)):
                allowed = name in {'budgets.json', 'supervisor.json'} if kind == 'config' else pattern.fullmatch(name)
                if not allowed:
                    continue
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                try:
                    before = os.fstat(fd)
                    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 16 * 1024 * 1024:
                        raise ValueError('unsafe rollback file')
                    with os.fdopen(os.dup(fd), 'rb') as source:
                        data = source.read(16 * 1024 * 1024 + 1)
                    after = os.fstat(fd)
                    current = os.stat(name, dir_fd=parent, follow_symlinks=False)
                    signature = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
                    if signature(before) != signature(after) or signature(before) != signature(current) or len(data) != before.st_size:
                        raise ValueError('rollback file changed during snapshot')
                    member = tarfile.TarInfo(os.path.join(prefix, name))
                    member.size, member.mode = len(data), stat.S_IMODE(before.st_mode)
                    member.uid, member.gid, member.mtime = before.st_uid, before.st_gid, before.st_mtime
                    out.addfile(member, io.BytesIO(data))
                finally:
                    os.close(fd)
    finally:
        if archive != '-': target.close()
finally:
    os.close(parent)
PYTAR
}

copy_settings() {
  config_files check "$1" || return 1
  mkdir -p -- "$2" || return 1
  config_files check "$2" || return 1
  filtered_tar config "$1" - | tar -C "$2" -xpf -
}

# Move only reviewed configuration files; leave trust/proof/foreign paths in place.
move_settings() {
  local name
  config_files check "$1" || return 1
  mkdir -p -- "$2" || return 1
  config_files check "$2" || return 1
  for name in budgets.json supervisor.json; do
    [ ! -e "$1/$name" ] || mv -T -- "$1/$name" "$2/$name" || return 1
  done
}

# Pin a root-owned, non-writable directory chain; lstat before atomic replacements.
config_files() {
  python3 -I - "${2:-$ETC}" "$1" "${L_SINCE:-}" <<'PYCONFIG'
import json, os, stat, sys
directory, action, since = sys.argv[1:]
parent = None
try:
    if not os.path.isabs(directory) or '..' in directory.split('/'):
        raise ValueError('invalid config directory')
    parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    for part in directory.split('/')[1:]:
        info = os.fstat(parent)
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('unsafe config directory')
        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        os.close(parent)
        parent = child
    info = os.fstat(parent)
    if info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('unsafe config directory')
    names = ('budgets.json', 'supervisor.json')
    for name in names:
        try:
            info = os.lstat(name, dir_fd=parent)
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('non-regular config file')
    if action == 'write':
        values = (
            {'schema': 1, 'providers': {'codex': {'author': None, 'qa': None}},
             'slots': {'slot1': {'codex': {'author': None, 'qa': None}}, 'slot2': {'codex': {'author': None, 'qa': None}}}},
            {'schema': 'GB_SLOT_SUPERVISOR_V1', 'slots': ['slot1', 'slot2'], 'max_parallel': 1,
             'approved_since': since, 'poll': 240},
        )
        for name, value in zip(names, values):
            tmp = '.' + name + '.' + os.urandom(16).hex()
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            try:
                with os.fdopen(fd, 'w') as target:
                    json.dump(value, target)
                    target.write('\n')
                    target.flush()
                    os.fchown(target.fileno(), 0, 0)
                    os.fchmod(target.fileno(), 0o644)
                    os.fsync(target.fileno())
                os.replace(tmp, name, src_dir_fd=parent, dst_dir_fd=parent)
            finally:
                try:
                    os.unlink(tmp, dir_fd=parent)
                except FileNotFoundError:
                    pass
except (OSError, ValueError):
    sys.exit(1)
finally:
    if parent is not None:
        os.close(parent)
PYCONFIG
}

# Configuration backups are independent of executor checkpoints.
backup_config() {
  [ ! -L "$ETC" ] && { [ ! -e "$ETC" ] || [ -d "$ETC" ]; } || bad "небезопасный каталог конфигурации: $ETC"
  if [ -d "$ETC" ]; then
    config_files check || bad "небезопасные файлы или каталог конфигурации: $ETC"
    [ ! -e "$ETC.bak.$STAMP" ] && [ ! -L "$ETC.bak.$STAMP" ] || bad "резерв конфигурации уже существует: $ETC.bak.$STAMP"
    if ! copy_settings "$ETC" "$ETC.bak.$STAMP"; then
      rm -rf -- "$ETC.bak.$STAMP"
      bad "не удалось сохранить резерв конфигурации: $ETC"
    fi
  fi
}

restore_config() {
  local p latest=""
  for p in "$ETC".bak.*; do
    [ -d "$p" ] && [ ! -L "$p" ] || continue
    [[ "${p#"$ETC.bak."}" =~ ^[0-9]{8}-[0-9]{6}$ ]] || continue
    if [[ "$p" > "$latest" ]]; then latest=$p; fi
  done
  [ -z "$latest" ] || copy_settings "$latest" "$ETC"
}

# Removal manifest: only these installed public payloads, with exact release hashes.
# Homes, repositories, all state/ledgers and foreign files stay at their original paths.
library_files() {
  python3 -I - "$1" "$LIB" "$BK/installed-library" "$SHA_EXEC" "$SHA_SLOTS" "$SHA_FOUNDATION" <<'PYLIB'
import hashlib, os, stat, sys
action, library, backup = sys.argv[1:4]
manifest = dict(zip(('autonomous_issues.py', 'slots.py', 'check_foundation.py'), sys.argv[4:]))
def directory(path):
    if not os.path.isabs(path) or '..' in path.split('/'):
        raise ValueError('invalid library directory')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.split('/')[1:]:
            info = os.fstat(fd)
            if info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('unsafe library directory')
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('unsafe library directory')
        return fd
    except Exception:
        os.close(fd)
        raise
def payload(fd, name):
    try:
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o644 or info.st_size > 4 * 1024 * 1024):
        raise ValueError('unsafe library file')
    file = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(file, 'rb') as stream:
        if os.fstat(stream.fileno()) != info:
            raise ValueError('library file changed')
        data = stream.read(4 * 1024 * 1024 + 1)
    if hashlib.sha256(data).hexdigest() != manifest[name]:
        raise ValueError('library SHA mismatch')
    return data
lib = saved = None
try:
    lib = directory(library)
    if action == 'check' or (action == 'restore' and not os.path.lexists(backup)):
        if any(payload(lib, name) is None for name in manifest):
            raise ValueError('incomplete library manifest')
    else:
        if action not in ('move', 'restore'):
            raise ValueError('invalid library action')
        if action == 'move':
            os.mkdir(backup, 0o700)
        saved = directory(backup)
        source, target = (lib, saved) if action == 'move' else (saved, lib)
        # Validate the whole manifest before changing any file. Never enumerate a tree.
        plan = [(name, payload(source, name), payload(target, name)) for name in manifest]
        for name, data, current in plan:
            if (action == 'move' and (data is None or current is not None)) or (data is None and current is None):
                raise ValueError('ambiguous library manifest')
        for name, data, current in plan:
            if data is not None and current is None:
                tmp = '.library-' + os.urandom(16).hex()
                file = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=target)
                try:
                    with os.fdopen(file, 'wb') as stream:
                        stream.write(data)
                        stream.flush()
                        os.fchmod(stream.fileno(), 0o644)
                        os.fsync(stream.fileno())
                    os.link(tmp, name, src_dir_fd=target, dst_dir_fd=target, follow_symlinks=False)
                finally:
                    os.unlink(tmp, dir_fd=target)
                os.fsync(target)
            if action == 'move':
                os.unlink(name, dir_fd=source)
                os.fsync(source)
except (OSError, ValueError):
    sys.exit(1)
finally:
    for fd in (lib, saved):
        if fd is not None:
            os.close(fd)
PYLIB
}

remove_created_group() {
  # Historical files retain this GID. Never scan unrelated host paths or delete its mapping.
  say "удаление группы $GRP не выполнялось: GID и архивы сохранены; постоянные участники не добавлялись. Перед повторной установкой нужна OPS-сверка metadata новой группы"
}

# Record only issue ids, never restore or edit executor data. Restart the old executor only
# when the migration manifest proves that its checkpoint still represents all slot work.
record_completed() {
  python3 -I - "$L_STATE" "${2:-$VAR}" "$BK/completed-issues.json" "${1:-1}" "${3:-0}" <<'PYDONE'
import hashlib, json, os, re, stat, sys
from pathlib import Path
def safe_bytes(path, limit=16 * 1024 * 1024):
    path = os.fspath(path)
    if not os.path.isabs(path) or ".." in path.split("/"):
        raise ValueError("unsafe public file path")
    parts = path.split("/")[1:]
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
                raise ValueError("unsafe public file metadata")
            with os.fdopen(os.dup(fd), "rb") as source:
                data = source.read(limit + 1)
            after = os.fstat(fd)
            current = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            signature = lambda s: (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            if signature(before) != signature(after) or signature(before) != signature(current) or len(data) != before.st_size:
                raise ValueError("public file changed during read")
            return data
        finally:
            os.close(fd)
    finally:
        os.close(parent)
legacy, var, output = map(Path, sys.argv[1:4])
try:
    def read(path):
        return json.loads(safe_bytes(path))
    old = read(legacy / 'state.json')
    done = set(read(output)['done']) if output.exists() else set()
    states = sorted((var / 'slots').glob('slot*/state.json'))
    slot_done = set()
    for path in [legacy / 'state.json', *states, *sorted((var / 'outbox').glob('slot*/status.json'))]:
        data = read(path)
        if sys.argv[4] == '0' and path.name == 'state.json':
            if set(data) != {'active', 'done'} or not isinstance(data['done'], list):
                raise ValueError('partial checkpoint')
            active = data['active']
            if active is not None and (not isinstance(active, dict) or not isinstance(active.get('phase'), str)
                                       or type(active.get('issue')) is not int or active['issue'] <= 0):
                raise ValueError('partial active checkpoint')
        done.update(data['done'])
        if path.parent != legacy:
            slot_done.update(data['done'])
        active = data.get('active') or {}
        if active.get('phase') == 'done':
            done.add(active['issue'])
    if any(type(n) is not int or n <= 0 for n in done):
        raise ValueError('invalid issue id')
    skip = done - set(old['done'])
    safe = not skip and (old.get('active') is None or old['active'].get('phase') == 'done')
    legacy_matches = True
    if sys.argv[4] == '1':
        slot1 = var / 'slots' / 'slot1'
        manifest = read(slot1 / 'MIGRATION.json')['files']
        pattern = r'(state|parked)\.json|(qa|before-resume|before-park)-[0-9]+-a[0-9]+(-i[0-9]+)?\.json'
        names = {p.name for p in slot1.iterdir() if re.fullmatch(pattern, p.name)}
        legacy_matches = {p.name for p in legacy.iterdir() if re.fullmatch(pattern, p.name)} == set(manifest)
        safe = safe and legacy_matches and 'state.json' in manifest and names == set(manifest)
        for name, digest in manifest.items():
            if not re.fullmatch(pattern, name):
                raise ValueError('invalid manifest path')
            for root in (legacy, slot1):
                path = root / name
                matches = hashlib.sha256(safe_bytes(path)).hexdigest() == digest
                safe = safe and matches
                if root == legacy:
                    legacy_matches = legacy_matches and matches
        safe = safe and all(p.parent == slot1 for p in states)
    slots_safe = sys.argv[5] != '1' or (legacy_matches and done <= slot_done)
    value = dict(done=sorted(done), skip=sorted(skip), legacy_resume_safe=safe, slots_resume_safe=slots_safe)
    tmp = output.with_suffix('.tmp')
    with open(tmp, 'w', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, sort_keys=True)
        stream.write('\n')
    os.replace(tmp, output)
except (OSError, ValueError, KeyError, TypeError, AttributeError):
    print('[parallel-slots] НЕ удалось записать завершённые issue: восстановление запрещено', file=sys.stderr)
    sys.exit(1)
PYDONE
}

legacy_resume_safe() {
  python3 -I -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["legacy_resume_safe"] else 1)' "$BK/completed-issues.json"
}

write_unit() {
  local f=$1
  UNITS_CHANGED=1
  mkdir -p -- "$(dirname "$UNITDIR/$f")"
  rm -f -- "$UNITDIR/$f"  # replace a saved symlink, never follow it
  cat >"$UNITDIR/$f"
}

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || bad "нужен root: sudo bash $0"
[ "$(id -u)" = 0 ] || [ "$DRY" = 1 ] || exit 1
[ "$(hostname)" = vmi3510488 ] || chk "это не vmi3510488"
if [ "$DRY" != 1 ] && [ "$MODE" != preflight ]; then exec 8>/run/gb-ops.lock; flock -w 120 8 || bad "занята другая операция gb-ops"; fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/parallel-slots-install.XXXXXX"); trap 'rm -rf "$TMP"' EXIT

# ------------------------------------------------------------------ embedded files (sha256-checked)
unpack() { # unpack NAME SHA  (payload follows the marker line @@NAME@@)
  awk -v m="__PAYLOAD_$1__" '$0==m{f=1;next} /^__PAYLOAD_/{f=0} f' "$0" | base64 -d >"$TMP/$1" || bad "распаковка $1"
  echo "$2  $TMP/$1" | sha256sum -c --status - || bad "sha256 $1 не совпал"
}
unpack autonomous_issues.py "$SHA_EXEC"; unpack slots.py "$SHA_SLOTS"
unpack check_foundation.py "$SHA_FOUNDATION"
unpack test_autonomous_issues.py "$SHA_T1"; unpack test_slots.py "$SHA_T2"
say "payload PR @${HEAD_SHA:0:12} + сверенные live fixes: sha256 ok"

# ------------------------------------------------------------------ legacy discovery (read-only)
id -u "$LU" >/dev/null 2>&1 || chk "нет пользователя $LU"
LEGACY_META=$(legacy_snapshot) || bad "не найден user-unit $LUNIT у $LU или небезопасный аргумент legacy; нужна сверка effective unit/drop-in"
LEGACY_ARGS=$(printf '%s\n' "$LEGACY_META" | legacy_args)
arg() { printf '%s\n' "$LEGACY_ARGS" | sed -n "s/^$1=//p"; }
L_REPO=$(arg --repo); L_STATE=$(arg --state-dir); L_KH=$(arg --known-hosts); L_SINCE=$(arg --approved-since)
L_CODEX=$(arg --codex); L_POLL=$(arg --poll); L_WAIT=$(arg --wait-timeout); L_MT=$(arg --model-timeout)
[ "$MODE" = remove ] || { [ -n "$L_REPO" ] && [ -n "$L_STATE" ] && [ -n "$L_KH" ] && [ -n "$L_SINCE" ] || chk "не разобран ExecStart legacy"; }
EXTRA=""
[ -z "$L_CODEX" ] || EXTRA="$EXTRA --codex $L_CODEX"
[ -z "$L_POLL" ] || EXTRA="$EXTRA --poll $L_POLL"
[ -z "$L_WAIT" ] || EXTRA="$EXTRA --wait-timeout $L_WAIT"
[ -z "$L_MT" ] || EXTRA="$EXTRA --model-timeout $L_MT"
for v in "$L_REPO" "$L_STATE" "$L_KH" "$L_SINCE" $EXTRA; do [[ $v =~ ^[A-Za-z0-9_./:+-]*$ ]] || bad "небезопасный аргумент legacy"; done
say "legacy: repo=$L_REPO state=$L_STATE since=$L_SINCE"
if [ "$MODE" = install ]; then
# preflight A: no flag of the legacy ExecStart may be silently dropped
[ -z "$(arg --unknown)" ] || chk "неизвестный флаг legacy ExecStart (не переносится в slot1)"
# preflight B: environment/credential properties and unit bytes are never requested or migrated.
# preflight C: exact installed baseline, reconciled against supplied live bytes (PARK drift + finite failures).
L_PY=$(arg --python)
if [ -n "$L_PY" ] && [ -r "$L_PY" ]; then
  L_PY_SHA=$(python3 -I - "$L_PY" <<'PYBASE'
import hashlib,os,stat,sys
def safe_bytes(path, limit=16 * 1024 * 1024):
    path = os.fspath(path)
    if not os.path.isabs(path) or ".." in path.split("/"):
        raise ValueError("unsafe public file path")
    parts = path.split("/")[1:]
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
                raise ValueError("unsafe public file metadata")
            with os.fdopen(os.dup(fd), "rb") as source:
                data = source.read(limit + 1)
            after = os.fstat(fd)
            current = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            signature = lambda s: (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            if signature(before) != signature(after) or signature(before) != signature(current) or len(data) != before.st_size:
                raise ValueError("public file changed during read")
            return data
        finally:
            os.close(fd)
    finally:
        os.close(parent)
try:
    print(hashlib.sha256(safe_bytes(sys.argv[1],2*1024*1024)).hexdigest())
except (OSError,ValueError):
    sys.exit(1)
PYBASE
  ) || bad "legacy code is not a stable single-link regular file through pinned non-symlink directories"
  if [ "$L_PY_SHA" = "$SHA_BASE_EXEC" ]; then say "legacy код = сверенный live baseline ${SHA_BASE_EXEC:0:12} (sha256 ok)"; else chk "legacy код ($L_PY) sha256 ${L_PY_SHA:0:12} != сверенный live baseline ${SHA_BASE_EXEC:0:12}: сначала сверить, что установлено"; fi
else chk "не прочитан legacy autonomous_issues.py из ExecStart (${L_PY:-не найден})"; fi
# preflight D: resolve and probe the local common dir as its owner, before stopping legacy
if L_COMMON_DIR=$(as "$LU" git -C "$L_REPO" rev-parse --path-format=absolute --git-common-dir) && [ "$L_COMMON_DIR" = /srv/gobadminton-clean/repo/.git ] && [ "$(realpath -e -- "$L_COMMON_DIR")" = "$L_COMMON_DIR" ]; then
  as "$LU" git --git-dir="$L_COMMON_DIR" show-ref --verify --quiet refs/heads/dev || chk "legacy git common dir не содержит refs/heads/dev"
  for sha in "$HEAD_SHA" "$BASE_SHA"; do
    as "$LU" git --git-dir="$L_COMMON_DIR" cat-file -e "$sha^{commit}" || chk "legacy git common dir не содержит коммит $sha"
  done
else chk "не определён локальный git common dir legacy ($L_REPO) от $LU"; fi
# preflight E: validate existing trust path without creating/modifying SSH configuration.
known_hosts \
  || chk "небезопасный known_hosts legacy: нужен обычный файл $LU (root только /home/$LU/.ssh/known_hosts), 1..1048576 байт, абсолютный путь без .. и симлинков, формат known_hosts"
fi

if [ "$MODE" = install ]; then as "$LU" test -r "$L_KH" || chk "legacy account не читает исходный trusted known_hosts"; fi

check_units || chk "unit-ы не совпадают с шаблонами установщика; неизвестное содержимое не сохраняется"

idle_of() { # idle_of STATE_DIR -> prints idle|busy:<phase>:<issue>|missing
  python3 -I -c 'import json,sys,os,stat
def safe_bytes(path, limit=16 * 1024 * 1024):
    path = os.fspath(path)
    if not os.path.isabs(path) or ".." in path.split("/"):
        raise ValueError("unsafe public file path")
    parts = path.split("/")[1:]
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
                raise ValueError("unsafe public file metadata")
            with os.fdopen(os.dup(fd), "rb") as source:
                data = source.read(limit + 1)
            after = os.fstat(fd)
            current = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            signature = lambda s: (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            if signature(before) != signature(after) or signature(before) != signature(current) or len(data) != before.st_size:
                raise ValueError("public file changed during read")
            return data
        finally:
            os.close(fd)
    finally:
        os.close(parent)
p=os.path.join(sys.argv[1],"state.json")
try:
    raw=safe_bytes(p,2097152)
except FileNotFoundError:
    print("missing"); sys.exit()
d=json.loads(raw)
if set(d)!={"active","done"} or not isinstance(d["done"],list): raise ValueError("invalid checkpoint")
if any(type(n) is not int or n<=0 for n in d["done"]): raise ValueError("invalid done")
a=d["active"]
if a is not None and (not isinstance(a,dict) or a.get("phase") not in {
    "claimed","developing","candidate","pr_wait","qa","ci","promoting","dev_wait","done","blocked"}
    or type(a.get("issue")) is not int or a["issue"]<=0): raise ValueError("invalid active")
print("idle" if a is None or a["phase"]=="done" else "busy:%s:%s"%(a["phase"],a["issue"]))' "$1"
}
lock_free() { # Probe an existing lock without creating/truncating legacy files.
  python3 -I -c 'import fcntl,os,sys
fd=os.open(sys.argv[1]+"/worker.lock", os.O_RDONLY | os.O_NOFOLLOW)
try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError: sys.exit(9)' "$1"
}

# Read metadata only. Existing system accounts are not proof of readiness and are never repaired/deleted.
check_accounts() {
  python3 -I - "$SRV" <<'PYACCOUNTS'
import grp, json, pwd, sys
expected = [('gb-slot2', 978, 968, sys.argv[1] + '/slot2/home'),
            ('gb-supervisor', 979, 969, '/nonexistent')]
try:
    users = pwd.getpwall()
    for name, uid, gid, home in expected:
        try:
            account = pwd.getpwnam(name)
        except KeyError:
            account = None
        try:
            group = grp.getgrnam(name)
        except KeyError:
            group = None
        if any(u.pw_uid == uid and u.pw_name != name or u.pw_gid == gid and u.pw_name != name for u in users):
            raise ValueError(name + ': expected uid/gid occupied')
        try:
            if grp.getgrgid(gid).gr_name != name:
                raise ValueError(name + ': expected gid occupied')
        except KeyError:
            pass
        if group and (group.gr_gid != gid or group.gr_mem):
            raise ValueError(name + ': unexpected primary group/members')
        if account:
            actual = dict(uid=account.pw_uid, gid=account.pw_gid, home=account.pw_dir, shell=account.pw_shell)
            print(name + ' metadata: ' + json.dumps(actual, sort_keys=True))
            if (account.pw_uid, account.pw_gid, account.pw_dir, account.pw_shell) != (uid, gid, home, '/usr/sbin/nologin'):
                raise ValueError(name + ': uid/gid/home/shell mismatch')
            if not group or any(g.gr_name != name and name in g.gr_mem for g in grp.getgrall()):
                raise ValueError(name + ': unexpected account group scope')
        else:
            raise ValueError(name + ': required existing account absent; installer does not create identities')
except (OSError, ValueError) as error:
    print('ОШИБКА: ' + str(error) + '; OPS: сверить metadata/scope, не usermod/userdel и не удалять файлы', file=sys.stderr)
    sys.exit(1)
PYACCOUNTS
}

installed_payloads() {
  local name expected
  for name in autonomous_issues.py slots.py check_foundation.py; do
    case "$name" in autonomous_issues.py) expected=$SHA_EXEC ;; slots.py) expected=$SHA_SLOTS ;; *) expected=$SHA_FOUNDATION ;; esac
    [ -f "$LIB/$name" ] && [ ! -L "$LIB/$name" ] || return 1
    [ "$(stat -c '%u:%g:%a' "$LIB/$name")" = 0:0:644 ] || return 1
    echo "$expected  $LIB/$name" | sha256sum -c --status - || return 1
  done
}

slot2_readiness() {
  legacy_unchanged || { say "legacy effective unit/drop-in изменился: нужна сверка"; return 1; }
  check_accounts || return 1
  config_files check || { say "небезопасная конфигурация installed slots"; return 1; }
  installed_payloads || { say "установленные payload не совпадают с reviewed installer"; return 1; }
  check_units || { say "unit-ы не совпадают с reviewed installer"; return 1; }
  [ "$(systemctl show gobadminton-slot@slot2.service -p User --value)" = "$S2" ] \
    && [ "$(systemctl show gobadminton-slot@slot2.service -p KillMode --value)" = control-group ] \
    && [ "$(systemctl show gobadminton-slot@slot2.service -p ProtectHome --value)" = yes ] \
    && [ "$(systemctl show gobadminton-slot@slot2.service -p ProtectSystem --value)" = strict ] \
    && [ "$(systemctl show gobadminton-slot@slot2.service -p SupplementaryGroups --value)" = "$GRP" ] \
    || { say "изоляция slot2 unit не подтверждена"; return 1; }
  [ "$(systemctl show gobadminton-slot@slot2.service -p FragmentPath --value)" = "$UNITDIR/gobadminton-slot@.service" ] \
    && [ "$(systemctl show gobadminton-slot@slot2.service -p DropInPaths --value)" = "$UNITDIR/gobadminton-slot@slot2.service.d/20-runtime.conf" ] \
    || { say "slot2 загружен с другими fragment/drop-in: нужна сверка"; return 1; }
  as_slots "$S2" python3 -B "$LIB/slots.py" preflight-slot2 --codex "$S2_CODEX" \
    --model "$SLOT_MODEL" --effort "$SLOT_EFFORT" --known-hosts "$S2_KH"
}

set_parallel() {
  python3 -I - "$ETC/supervisor.json" "$1" <<'PYPARALLEL'
import json, os, sys, tempfile
path, count = sys.argv[1:]
with open(path) as source:
    value = json.load(source)
value['max_parallel'] = int(count)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
try:
    with os.fdopen(fd, 'w') as target:
        os.fchmod(target.fileno(), 0o644)
        json.dump(value, target)
        target.write('\n')
        target.flush()
        os.fsync(target.fileno())
    os.replace(tmp, path)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
PYPARALLEL
}

activation_idle() {
  [ "$(idle_of "$VAR/slots/slot1")" = idle ] || return 1
  local state2
  state2=$(idle_of "$VAR/slots/slot2") || return 1
  [ "$state2" = idle ] || { [ "$state2" = missing ] && [ ! -e "$VAR/slots/slot2/state.json" ] && [ ! -L "$VAR/slots/slot2/state.json" ]; } || return 1
  [ ! -e "$VAR/assign/slot1.json" ] && [ ! -e "$VAR/assign/slot2.json" ]
}

if [ "$MODE" = preflight ] || [ "$MODE" = activate ]; then
  slot2_readiness || bad "slot2 НЕ готов: устранить перечисленные блокеры через существующий review pipeline; NEEDS_EXCEPTION не разрешение"
  if [ "$MODE" = preflight ] || [ "$DRY" = 1 ]; then
    activation_idle || bad "active/blocked task или pending assignment: activation запрещён"
    [ "$CHK_FAILED" = 0 ] || bad "DRY/preflight: есть блокеры"
    say "preflight slot2 ok; это capability evidence, два реальных task runs ещё не подтверждены"
    exit 0
  fi
  activation_idle || bad "active/blocked task или pending assignment: activation запрещён"
  [ "$(systemctl is-enabled gobadminton-slot@slot2.service 2>/dev/null || true)" = disabled ] || bad "slot2 должен быть disabled перед activation"
  [ "$(systemctl is-active gobadminton-slot@slot2.service 2>/dev/null || true)" != active ] || bad "slot2 уже активен: нужна сверка"
  OLD_PARALLEL=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["max_parallel"])' "$ETC/supervisor.json")
  [ "$OLD_PARALLEL" = 1 ] || bad "activation ожидает max_parallel=1"
  ACT_STOPPED=0; ACT_STARTED=0
  ACT_UNITS=(gobadminton-supervisor.service gobadminton-slot@slot1.service)
  ACT_ACTIVE=(); ACT_ENABLED=()
  for u in "${ACT_UNITS[@]}"; do
    ACT_ACTIVE+=("$(systemctl is-active "$u" 2>/dev/null || true)")
    ACT_ENABLED+=("$(systemctl is-enabled "$u" 2>/dev/null || true)")
  done
  activation_rollback() {
    local rc=$? i
    [ "$rc" = 0 ] && return 0
    trap - EXIT
    set +e
    if [ "$ACT_STARTED" = 1 ]; then
      # Stop dispatch first; never discard an active/blocked checkpoint or lower capacity under it.
      if ! systemctl stop gobadminton-supervisor.service; then
        set_parallel 2
        systemctl enable --now gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service
        say "activation rollback HELD: dispatch не остановлен; checkpoints и max_parallel=2 сохранены $BK"
        rm -rf "$TMP"; exit "$rc"
      fi
      case "$(systemctl is-active gobadminton-supervisor.service 2>/dev/null || true)" in
        inactive|failed) ;; *)
          set_parallel 2
          systemctl enable --now gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service
          say "activation rollback HELD: остановка dispatch не подтверждена $BK"
          rm -rf "$TMP"; exit "$rc" ;;
      esac
      if ! activation_idle; then
        set_parallel 2
        systemctl enable --now gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service
        say "activation rollback HELD: задача/assignment сохранены; два слота оставлены, нужна сверка $BK"
        rm -rf "$TMP"; exit "$rc"
      fi
      if ! systemctl disable --now gobadminton-slot@slot2.service; then
        systemctl enable --now gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service
        say "activation rollback HELD: slot2 не остановлен; max_parallel=2 и checkpoints сохранены $BK"
        rm -rf "$TMP"; exit "$rc"
      fi
      case "$(systemctl is-active gobadminton-slot@slot2.service 2>/dev/null || true)" in
        inactive|failed) ;; *)
          systemctl enable --now gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service
          say "activation rollback HELD: остановка slot2 не подтверждена $BK"
          rm -rf "$TMP"; exit "$rc" ;;
      esac
      if ! activation_idle || { [ -e "$VAR/slots/slot2/worker.lock" ] && ! lock_free "$VAR/slots/slot2"; }; then
        systemctl enable --now gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service
        say "activation rollback HELD: slot2 продвинулся при остановке; состояние сохранено $BK"
        rm -rf "$TMP"; exit "$rc"
      fi
    fi
    set_parallel "$OLD_PARALLEL" || say "ОШИБКА отката max_parallel; резерв $BK/supervisor.json"
    if [ "$ACT_STOPPED" = 1 ]; then
      for i in "${!ACT_UNITS[@]}"; do
        case "${ACT_ENABLED[i]}" in enabled) systemctl enable "${ACT_UNITS[i]}" ;; disabled) systemctl disable "${ACT_UNITS[i]}" ;; enabled-runtime) systemctl enable --runtime "${ACT_UNITS[i]}" ;; esac
        case "${ACT_ACTIVE[i]}" in active|activating|reloading) systemctl start "${ACT_UNITS[i]}" ;; esac
      done
    fi
    logl "activation rolled back; checkpoints unchanged; backup $BK"
    rm -rf "$TMP"; exit "$rc"
  }
  install -d -m 0700 -o root -g root "$BK"
  install -m 0600 -o root -g root "$ETC/supervisor.json" "$BK/supervisor.json"
  trap 'activation_rollback; rm -rf "$TMP"' EXIT
  ACT_STOPPED=1
  systemctl stop "${ACT_UNITS[@]}"
  activation_idle || bad "задача появилась при остановке: activation отменён"
  lock_free "$VAR/slots/slot1" || bad "slot1 worker.lock занят"
  if [ -e "$VAR/slots/slot2/worker.lock" ]; then lock_free "$VAR/slots/slot2" || bad "slot2 worker.lock занят"; fi
  slot2_readiness || bad "повторный preflight slot2 не прошёл"
  set_parallel 2
  ACT_STARTED=1
  systemctl enable --now gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service
  sleep 25
  for u in gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service; do
    [ "$(systemctl is-active "$u")" = active ] || bad "$u не активен"
  done
  trap 'rm -rf "$TMP"' EXIT
  logl "activated max_parallel=2; task-run evidence pending; backup $BK"
  say "max_parallel=2, оба unit активны; успех только после TWO independent task runs с exact-SHA QA/CI/ACCEPTED"
  exit 0
fi

# ================================================================== REMOVE
if [ "$MODE" = remove ]; then
  [ -d "$VAR/slots/slot1" ] || bad "slot1 не установлен"
  S1=$(idle_of "$VAR/slots/slot1"); [ "$S1" = idle ] || bad "slot1 не в простое ($S1): дождитесь окончания задачи"
  S2_STATE=$(idle_of "$VAR/slots/slot2")
  [ "$S2_STATE" = idle ] || [ "$S2_STATE" = missing ] || bad "slot2 не в простое ($S2_STATE): state сохраняется"
  [ -n "$L_STATE" ] || L_STATE=/home/$LU/.gb-autonomy-state
  [ -d "$L_STATE" ] && [ ! -L "$L_STATE" ] || bad "нет обычного каталога legacy state"
  [ -f "$L_STATE/RETIRED_TO_SLOT.json" ] || bad "legacy state не помечен RETIRED: нужна сверка вручную"
  [ ! -e "$VAR/slots/slot1/RETIRED_TO_SLOT.json" ] || bad "slot1 уже помечен RETIRED: нужна сверка вручную"
  [ "$(luctl is-active "$LUNIT" 2>/dev/null || true)" != active ] || bad "legacy уже запущен: удаление небезопасно"
  case "$(systemctl is-active gobadminton-slot@slot2.service 2>/dev/null || true)" in
    inactive|failed) ;; *) bad "slot2 запущен: сначала дождитесь простоя и остановите его" ;;
  esac
  library_files check || bad "файлы библиотеки не совпадают с manifest: удаление остановлено"
  # Check legacy resumability before stopping or removing any working slot.
  REMOVE_CHECK_BK=$BK; BK=$TMP
  record_completed && legacy_resume_safe || bad "--remove запрещён: slot state продвинулся; рабочие службы сохранены, нужна сверка истории"
  BK=$REMOVE_CHECK_BK
  if [ "$DRY" = 1 ]; then
    say "DRY: slot1=$S1; дальше были бы: backup units -> stop slots -> idle/lock -> запись завершённых issue -> восстановление config/units -> старт legacy только без риска повтора; state не меняется"
    exit 0
  fi
  REMOVE_UNITS=(gobadminton-supervisor.service gobadminton-slot@slot1.service gobadminton-slot@slot2.service)
  REMOVE_ACTIVE=(); REMOVE_ENABLED=(); REMOVE_DIRS_MOVED=()
  REMOVE_STOPPED=0; REMOVE_LEGACY_START=0; REMOVE_CONFIG_RESTORED=0; REMOVE_LIBRARY_STARTED=0
  for u in "${REMOVE_UNITS[@]}"; do
    REMOVE_ACTIVE+=("$(systemctl is-active "$u" 2>/dev/null || true)")
    REMOVE_ENABLED+=("$(systemctl is-enabled "$u" 2>/dev/null || true)")
  done
  REMOVE_LEGACY_ENABLED=$(luctl is-enabled "$LUNIT" 2>/dev/null || true)

  remove_rollback() {
    local rc=$? d i
    [ "$rc" = 0 ] && return 0
    trap - EXIT
    set +e
    echo "[parallel-slots] ОТКАТ --remove после ошибки (rc=$rc)" >&2
    if [ "$REMOVE_LEGACY_START" = 1 ]; then
      # A partially successful start must never cause new legacy work to be reset.
      if [ "$(idle_of "$L_STATE")" != idle ]; then
        luctl enable --now "$LUNIT"
        echo "[parallel-slots] legacy уже взял задачу: откат состояния запрещён, legacy оставлен запущенным. Нужна сверка вручную; резерв $BK" >&2
        logl "remove rollback HELD: legacy busy; reconciliation required"; rm -rf "$TMP"; exit "$rc"
      fi
      luctl stop "$LUNIT" || { echo "[parallel-slots] legacy не остановлен: состояние не откатываю; резерв $BK" >&2; rm -rf "$TMP"; exit "$rc"; }
      if [ "$(idle_of "$L_STATE")" != idle ]; then
        luctl enable --now "$LUNIT"
        echo "[parallel-slots] legacy взял задачу при остановке: состояние сохранено; нужна сверка вручную, резерв $BK" >&2
        rm -rf "$TMP"; exit "$rc"
      fi
      if ! lock_free "$L_STATE"; then
        luctl enable --now "$LUNIT"
        echo "[parallel-slots] legacy worker.lock занят: состояние сохранено; нужна сверка вручную, резерв $BK" >&2
        rm -rf "$TMP"; exit "$rc"
      fi
    fi
    local record_var=$VAR
    [ ! -d "$BK/$(echo "$VAR" | tr / _)" ] || record_var="$BK/$(echo "$VAR" | tr / _)"
    # Until legacy may have run, resuming the same slots cannot replay legacy work.
    # Failed checkpoint/status reads must not prevent restoring their services.
    if [ "$REMOVE_LEGACY_START" = 1 ]; then
      record_completed 1 "$record_var" "$REMOVE_LEGACY_START" || { rm -rf "$TMP"; exit "$rc"; }
    fi
    if [ "$REMOVE_CONFIG_RESTORED" = 1 ] && { [ -e "$ETC" ] || [ -L "$ETC" ]; }; then
      move_settings "$ETC" "$BK/config.failed-remove" || { rm -rf "$TMP"; exit "$rc"; }
    fi
    for ((i=${#REMOVE_DIRS_MOVED[@]}-1; i>=0; i--)); do
      d=${REMOVE_DIRS_MOVED[i]}
      [ "$d" = "$ETC" ] || { rm -rf "$TMP"; exit "$rc"; }
      if [ -e "$BK/$(echo "$d" | tr / _)" ]; then
        move_settings "$BK/$(echo "$d" | tr / _)" "$ETC" || { rm -rf "$TMP"; exit "$rc"; }
      fi
    done
    if [ "$REMOVE_LIBRARY_STARTED" = 1 ]; then
      library_files restore || { echo "[parallel-slots] НЕ удалось вернуть библиотеку по manifest: резерв $BK" >&2; rm -rf "$TMP"; exit "$rc"; }
    fi
    restore_units || { echo "[parallel-slots] НЕ удалось восстановить unit-ы: резерв $BK/units" >&2; rm -rf "$TMP"; exit "$rc"; }
    systemctl daemon-reload || true
    if [ "$REMOVE_STOPPED" = 1 ]; then
      if [ "$REMOVE_LEGACY_START" = 1 ] && ! python3 -I -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["slots_resume_safe"] else 1)' "$BK/completed-issues.json"; then
        luctl disable "$LUNIT"
        systemctl disable "${REMOVE_UNITS[@]}"
        echo "[parallel-slots] legacy продвинулся: slots оставлены остановленными, повтор завершённых issue запрещён; нужна сверка вручную, $BK/completed-issues.json" >&2
        logl "remove rollback HELD: legacy progressed; completed issues retained; reconciliation required"
        rm -rf "$TMP"; exit "$rc"
      fi
      if [ -e "$BK/RETIRED_TO_SLOT.json" ]; then
        mv -- "$BK/RETIRED_TO_SLOT.json" "$L_STATE/RETIRED_TO_SLOT.json" || { rm -rf "$TMP"; exit "$rc"; }
      fi
      case "$REMOVE_LEGACY_ENABLED" in enabled) luctl enable "$LUNIT" ;; enabled-runtime) luctl enable --runtime "$LUNIT" ;; disabled) luctl disable "$LUNIT" ;; esac
      for i in "${!REMOVE_UNITS[@]}"; do
        case "${REMOVE_ENABLED[i]}" in
          enabled) systemctl enable "${REMOVE_UNITS[i]}" ;;
          enabled-runtime) systemctl enable --runtime "${REMOVE_UNITS[i]}" ;;
          disabled) systemctl disable "${REMOVE_UNITS[i]}" ;;
        esac
        case "${REMOVE_ACTIVE[i]}" in active|activating|reloading) systemctl start "${REMOVE_UNITS[i]}" || echo "[parallel-slots] НЕ удалось запустить ${REMOVE_UNITS[i]}: запустите вручную" >&2 ;; esac
      done
    fi
    logl "remove rolled back; previous state/units/services restored; backup $BK"
    say "--remove отменён: исходные state/unit-ы и статусы служб восстановлены; резерв $BK"
    rm -rf "$TMP"; exit "$rc"
  }
  trap 'remove_rollback; rm -rf "$TMP"' EXIT

  # Copy and validate service/config state; legacy checkpoints remain untouched.
  install -d -m 0700 -o root -g root "$BK"
  backup_units
  legacy_unchanged || bad "legacy effective unit/drop-in изменился: удаление остановлено"
  REMOVE_STOPPED=1
  systemctl disable --now "${REMOVE_UNITS[@]}"
  for u in "${REMOVE_UNITS[@]}"; do
    [ "$(systemctl is-active "$u" 2>/dev/null || true)" != active ] || bad "$u не остановился"
  done
  [ "$(idle_of "$VAR/slots/slot1")" = idle ] || bad "slot1 после остановки не в простое"
  lock_free "$VAR/slots/slot1" || bad "slot1 worker.lock занят после остановки"
  S2_STATE=$(idle_of "$VAR/slots/slot2")
  [ "$S2_STATE" = idle ] || [ "$S2_STATE" = missing ] || bad "slot2 после остановки не в простое ($S2_STATE): state сохраняется"
  if [ -e "$VAR/slots/slot2/worker.lock" ]; then lock_free "$VAR/slots/slot2" || bad "slot2 worker.lock занят после остановки"; fi
  lock_free "$L_STATE" || bad "legacy worker.lock занят"
  record_completed || bad "не записаны завершённые issue: удаление остановлено"
  legacy_resume_safe || bad "legacy не может безопасно продолжить: удаление отменено, восстанавливаю slots"
  UNITS_CHANGED=1
  for f in "${UNIT_FILES[@]}"; do rm -f -- "$UNITDIR/$f"; done
  rmdir "$UNITDIR/gobadminton-slot@slot1.service.d" "$UNITDIR/gobadminton-slot@slot2.service.d" 2>/dev/null || true
  systemctl daemon-reload
  REMOVE_LIBRARY_STARTED=1
  library_files move || bad "не удалось сохранить библиотеку по manifest: резерв $BK"
  for d in "$ETC"; do
    if [ -e "$d" ]; then
      REMOVE_DIRS_MOVED+=("$d")
      move_settings "$d" "$BK/$(echo "$d" | tr / _)"
    fi
  done
  REMOVE_CONFIG_RESTORED=1
  restore_config
  if legacy_resume_safe; then
    mv -- "$L_STATE/RETIRED_TO_SLOT.json" "$BK/RETIRED_TO_SLOT.json"
    REMOVE_LEGACY_START=1
    luctl enable --now "$LUNIT"
    [ "$(luctl is-active "$LUNIT" 2>/dev/null || true)" = active ] || bad "legacy не запущен после --remove"
  else
    luctl disable "$LUNIT"
    say "завершённые issue пропущены; legacy оставлен остановленным: состояние slot1 продвинулось, нужна сверка вручную; список $BK/completed-issues.json"
  fi
  trap 'rm -rf "$TMP"' EXIT
  remove_created_group "$GROUP_MARKER"
  logl "removed; backup $BK"
  if [ "$REMOVE_LEGACY_START" = 1 ]; then say "откат выполнен, legacy-исполнитель запущен. Резерв: $BK"
  else say "откат config/unit-ов выполнен без повторной постановки задач; legacy остановлен. Резерв: $BK"; fi
  exit 0
fi

# A separate root inventory proves this fixed GID has no pre-existing file dependencies.
verify_new_group_gid() {
 python3 -I - <<'PYGID'
import os,stat,json,pwd,grp,time
from pathlib import Path
p=Path('/root/gb-slots-gid65042-audit.json')
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);info=os.fstat(fd)
assert stat.S_ISREG(info.st_mode) and info.st_uid==info.st_gid==0 and stat.S_IMODE(info.st_mode)==0o600 and info.st_nlink==1 and info.st_size<8192
with os.fdopen(fd) as f:r=json.load(f)
assert r['schema']=='GB_GID_AUDIT_V1' and r['gid']==65042
assert 0<=time.time()-r['finished_at']<=14400 and r['started_at']<=r['finished_at']
assert r['results']==[dict(root=x,exit_code=0,matches=0) for x in ['/','/run','/dev']]
assert not any(u.pw_gid==65042 for u in pwd.getpwall())
assert not any(g.gr_gid==65042 for g in grp.getgrall())
print('fixed shared-lock gid65042 inventory verified; no existing primary/group/file dependencies')
PYGID
}

# ================================================================== INSTALL
[ ! -e "$VAR" ] && [ ! -L "$VAR" ] && [ ! -e "$SRV" ] && [ ! -L "$SRV" ] && [ ! -e "$LIB" ] && [ ! -L "$LIB" ] || chk "остатки установки ($VAR/$SRV/$LIB): только read-only инвентаризация и сверка; не удалять историю/чужие файлы"
if getent group "$GRP" >/dev/null; then chk "группа $GRP уже существует: её доступ вне locks не проверен; STOP. OPS: сверить gid970 и /root/gb-parallel-slots.20261019-231505; отдельный reviewed cleanup только при доказанном отсутствии primary/supplementary members, файлов gid970 и зависимостей units/ACL; пустой список members не разрешает reuse/groupdel"; fi
verify_new_group_gid || chk "не подтверждён свободный gid65042: дождаться root inventory, не выдавать непроверенные права"
[ ! -e "$ETC" ] || [ "$(stat -c %u:%g:%a -- "$ETC")" = 0:0:755 ] || chk "existing config directory must already be root:root 0755; permission changes are refused"
for t in git python3 setpriv flock systemctl groupadd tar sha256sum base64; do command -v "$t" >/dev/null || chk "нет $t"; done
python3 -I -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || chk "нужен python3 >= 3.10"

check_accounts || chk "существующий пользователь не соответствует expected metadata/scope"

# 1. code self-test as an unprivileged user (offline, temp dir)
T=$TMP/selftest; mkdir -p "$T/scripts/chatops/tests"; cp "$TMP/autonomous_issues.py" "$TMP/slots.py" "$T/scripts/chatops/"
cp "$TMP/test_autonomous_issues.py" "$TMP/test_slots.py" "$T/scripts/chatops/tests/"; chmod -R a+rX "$T"; chmod a+rx "$TMP"
for t in test_autonomous_issues test_slots; do
  if [ "$(id -u)" = 0 ]; then tr=(as nobody); else tr=(); fi
  ( umask 077; cd "$T" && "${tr[@]}" python3 -B "scripts/chatops/tests/$t.py" >"$TMP/$t.log" 2>&1 ) || { tail -n 20 "$TMP/$t.log" >&2; bad "самотест $t не прошёл"; }
done
say "самотест: старые и новые тесты зелёные"

# 2. read-only guards; the live idle check follows stop, under the rollback trap.
[ ! -e "$L_STATE/RETIRED_TO_SLOT.json" ] || chk "legacy state уже помечен RETIRED"
LSTATE=$(idle_of "$L_STATE")
[ "$LSTATE" = idle ] || chk "legacy-исполнитель НЕ в простое ($LSTATE). Установка только между задачами"
if [ "$DRY" = 1 ]; then
  say "DRY: legacy=$LSTATE; дальше были бы: stop legacy -> idle/lock -> backup -> users/dirs -> base.git + slot1 clone -> migrate -> units -> проверки 1-9 -> старт slot1+supervisor (max_parallel=1) -> проверка 11"
  [ "$CHK_FAILED" = 0 ] || bad "DRY: есть блокеры, установка запрещена"
  exit 0
fi
logl "install start head=$HEAD_SHA"

keep_slot1() {
  # Never restore the legacy snapshot once slot1 may have claimed work.
  python3 -I - "$ETC/supervisor.json" <<'PY' || echo "[parallel-slots] НЕ удалось закрепить max_parallel=1: нужна сверка вручную" >&2
import json, os, sys, tempfile
path = sys.argv[1]
with open(path) as stream:
    value = json.load(stream)
value['max_parallel'] = 1
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
try:
    with os.fdopen(fd, 'w') as stream:
        os.fchmod(stream.fileno(), 0o644)
        json.dump(value, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
PY
  systemctl enable --now gobadminton-slot@slot1.service gobadminton-supervisor.service || echo "[parallel-slots] НЕ удалось запустить slot1 + supervisor: запустите вручную, max_parallel=1" >&2
  echo "[parallel-slots] slot1 уже взял задачу: автоматический откат состояния запрещён; slot1 оставлен запущенным, supervisor max_parallel=1. Нужна сверка вручную; резерв $BK" >&2
  logl "rollback HELD: slot1 busy; slot1 + supervisor max_parallel=1; reconciliation required"
}

rollback() {
  local rc=$? u d legacy_safe=0
  local -a rollback_errors=()
  [ "$rc" = 0 ] && return 0
  trap - EXIT
  set +e
  echo "[parallel-slots] ОТКАТ после ошибки (rc=$rc)" >&2
  if [ "$DONE_STARTED" = 1 ]; then
    if [ "$(idle_of "$VAR/slots/slot1")" != idle ]; then keep_slot1; rm -rf "$TMP"; exit "$rc"; fi
    systemctl stop gobadminton-supervisor.service >/dev/null 2>&1 || rollback_errors+=("остановка supervisor")
    if [ "$(idle_of "$VAR/slots/slot1")" != idle ]; then keep_slot1; rm -rf "$TMP"; exit "$rc"; fi
  fi
  if [ "$UNITS_CHANGED" = 1 ] || [ "$DONE_STARTED" = 1 ]; then
    systemctl disable --now gobadminton-supervisor.service gobadminton-slot@slot1.service >/dev/null 2>&1 || rollback_errors+=("отключение slots")
  fi
  if [ "$DONE_STARTED" = 1 ]; then
    for u in gobadminton-supervisor.service gobadminton-slot@slot1.service; do
      case "$(systemctl is-active "$u" 2>/dev/null || true)" in
        active|activating|reloading|deactivating) keep_slot1; rm -rf "$TMP"; exit "$rc" ;;
      esac
    done
  fi
  # Close the check/stop race: resume rather than discard newly claimed work.
  if [ "$DONE_STARTED" = 1 ] && [ "$(idle_of "$VAR/slots/slot1")" != idle ]; then keep_slot1; rm -rf "$TMP"; exit "$rc"; fi
  if [ "$DONE_STARTED" = 1 ] && ! lock_free "$VAR/slots/slot1"; then keep_slot1; rm -rf "$TMP"; exit "$rc"; fi
  if [ "$DONE_STARTED" = 0 ]; then
    # Migration only copies checkpoints and adds a tombstone. Resume the untouched
    # legacy checkpoint even if stop caught it busy, or validation/backup failed.
    legacy_safe=1
  elif record_completed "$DONE_STARTED"; then
    if legacy_resume_safe; then legacy_safe=1; fi
  else
    # Retain the working executor when its history cannot safely be reconciled.
    keep_slot1; rm -rf "$TMP"; exit "$rc"
  fi
  if [ "$DONE_STARTED" = 1 ] && [ "$legacy_safe" != 1 ]; then
    keep_slot1; rm -rf "$TMP"; exit "$rc"
  fi
  restore_units || { echo "[parallel-slots] НЕ удалось восстановить unit-ы из $BK/units: нужна сверка вручную" >&2; rollback_errors+=("восстановление unit-ов"); }
  systemctl daemon-reload || rollback_errors+=("daemon-reload")
  for d in "$LIB" "$ETC" "$VAR" "$SRV"; do
    [ "$d" != "$ETC" ] || [ "$ETC_CHANGED" = 1 ] || continue
    if [ "$d" = "$ETC" ] && [ -d "$d" ]; then
      move_settings "$d" "$BK/$(echo "$d" | tr / _)" || rollback_errors+=("перемещение $d")
      continue
    fi
    [ ! -e "$d" ] || mv "$d" "$BK/$(echo "$d" | tr / _)" || rollback_errors+=("перемещение $d")
  done
  if [ "$ETC_CHANGED" = 1 ]; then restore_config || rollback_errors+=("восстановление конфигурации"); fi
  if [ "$GROUP_CREATED" = 1 ]; then remove_created_group "$BK/$(echo "$LIB" | tr / _)/.gb-slots-group-created"; fi
  if [ "$LEGACY_STOPPED" = 1 ]; then
    if [ "$legacy_safe" = 1 ]; then
      if [ "$LEGACY_MIGRATION_STARTED" = 1 ]; then
        rm -f -- "$L_STATE/RETIRED_TO_SLOT.json" || rollback_errors+=("удаление tombstone legacy")
      fi
      case "$LEGACY_ENABLED" in
        enabled) luctl enable "$LUNIT" || rollback_errors+=("включение legacy") ;;
        enabled-runtime) luctl enable --runtime "$LUNIT" || rollback_errors+=("включение legacy runtime") ;;
        disabled) luctl disable "$LUNIT" || rollback_errors+=("отключение автозапуска legacy") ;;
      esac
      luctl start "$LUNIT" || {
        echo "[parallel-slots] НЕ удалось запустить legacy: повторяю запуск" >&2
        rollback_errors+=("включение/запуск legacy")
        luctl start "$LUNIT" || rollback_errors+=("повторный запуск legacy")
      }
    else echo "[parallel-slots] завершённые issue пропущены; legacy оставлен остановленным: состояние slot1 продвинулось, нужна сверка вручную; список $BK/completed-issues.json" >&2; fi
  fi
  rm -rf "$TMP" || rollback_errors+=("удаление временных файлов")
  if [ "${#rollback_errors[@]}" != 0 ]; then
    printf '[parallel-slots] Ошибки отката: %s\n' "${rollback_errors[@]}" >&2
    logl "rollback errors: ${rollback_errors[*]}; backup $BK"
  fi
  logl "rolled back; backup $BK"; exit "$rc"
}
trap 'rollback; rm -rf "$TMP"' EXIT

# Stop before inspecting idle/checkpoints: a running legacy executor can claim work
# at any time. Failures before slot startup automatically resume its current state.
LEGACY_ENABLED=$(luctl is-enabled "$LUNIT" 2>/dev/null || true)
LEGACY_STOPPED=1; luctl stop "$LUNIT"
for _ in $(seq 1 30); do
  case "$(luctl is-active "$LUNIT" 2>/dev/null || true)" in inactive|failed) break ;; esac
  sleep 1
done
case "$(luctl is-active "$LUNIT" 2>/dev/null || true)" in inactive|failed) ;; *) bad "legacy не остановился" ;; esac
[ "$(idle_of "$L_STATE")" = idle ] || bad "legacy после остановки не в простое"
lock_free "$L_STATE" || bad "legacy worker.lock всё ещё занят"
legacy_unchanged || bad "legacy effective unit/drop-in изменился: установка остановлена"

# 3. backup
install -d -m 0700 -o root -g root "$BK"
install -m 0600 -o root -g root /dev/null "$BK/legacy-unit-metadata.json"
printf '%s\n' "$LEGACY_META" >"$BK/legacy-unit-metadata.json"
backup_units
backup_config
filtered_tar state "$(dirname "$L_STATE")" "$BK/legacy-state.tar" "$(basename "$L_STATE")"
python3 -I - "$BK/legacy-state.tar" >"$BK/legacy-state.sha256" <<'PYSUM'
import hashlib,sys,tarfile
with tarfile.open(sys.argv[1]) as archive:
    for member in archive:
        assert member.isfile()
        with archive.extractfile(member) as stream:
            print(hashlib.sha256(stream.read()).hexdigest() + '  ' + member.name)
PYSUM
sha256sum "$BK/legacy-state.tar" >"$BK/legacy-state.tar.sha256"
say "резерв: $BK"

# 4. disable the stopped, validated legacy executor
luctl disable "$LUNIT" >/dev/null 2>&1 || true
say "legacy остановлен и отключён (файлы unit не менялись)"

# 5. users, group, code
install -d -m 0755 -o root -g root "$LIB"
verify_new_group_gid || bad "gid65042 изменился после preflight"
groupadd --system --gid "$GROUP_GID" "$GRP"
GROUP_CREATED=1
getent group "$GRP" | cut -d: -f3 >"$GROUP_MARKER"
getent group "$SUP" >/dev/null || bad "required existing supervisor primary group absent"
getent group "$S2" >/dev/null || bad "required existing slot2 primary group absent"
getent passwd "$SUP" >/dev/null || bad "required existing supervisor account absent"
getent passwd "$S2" >/dev/null || bad "required existing slot2 account absent"
install -m 0644 -o root -g root "$TMP/autonomous_issues.py" "$TMP/slots.py" "$TMP/check_foundation.py" "$LIB/"
echo "$SHA_EXEC  $LIB/autonomous_issues.py" | sha256sum -c --status - || bad "sha256 после установки"
echo "$SHA_SLOTS  $LIB/slots.py" | sha256sum -c --status - || bad "sha256 после установки"
echo "$SHA_FOUNDATION  $LIB/check_foundation.py" | sha256sum -c --status - || bad "sha256 после установки"

# 6. directories
LG=$(id -g "$LU"); G=$(getent group "$GRP" | cut -d: -f3)
[ "$G" != 0 ] && [ "$G" != "$LG" ] && [ "$G" != "$(id -g "$SUP")" ] && [ "$G" != "$(id -g "$S2")" ] || bad "группа locks совпала с основной группой службы/root"
[ -z "$(getent group "$GRP" | cut -d: -f4)" ] || bad "группа $GRP уже имеет постоянных участников: доступ допускается только через SupplementaryGroups unit-ов"
install -d -m 0755 -o root -g root "$VAR" "$VAR/slots" "$VAR/outbox"
install -d -m 0700 -o "$LU" -g "$LG" "$VAR/slots/slot1"
install -d -m 0700 -o "$S2" -g "$S2" "$VAR/slots/slot2"
install -d -m 0755 -o "$LU" -g "$LG" "$VAR/outbox/slot1"
install -d -m 0755 -o "$S2" -g "$S2" "$VAR/outbox/slot2"
install -d -m 0755 -o "$SUP" -g "$SUP" "$VAR/assign"
install -d -m 3770 -o root -g "$G" "$VAR/locks"
for f in integration.lock registry.lock; do install -m 0640 -o root -g "$G" /dev/null "$VAR/locks/$f"; done
install -m 0660 -o root -g "$G" /dev/null "$VAR/locks/api.clock"
ETC_CHANGED=1
install -d -m 0755 -o root -g root "$ETC" "$SRV"
config_files write || bad "не удалось безопасно записать конфигурацию: $ETC"

# 7. git: one read-only object store, own clone per slot
# The source owner streams a Git bundle; root never opens the user-controlled Git tree.
# The root-owned bundle and destination cannot receive unprivileged hardlink injection.
as "$LU" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/agentagency-dev LANG=C.UTF-8 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git --git-dir="$L_COMMON_DIR" -c core.hooksPath=/dev/null -c core.fsmonitor=false bundle create - --all "$HEAD_SHA" "$BASE_SHA" >"$TMP/legacy-common.bundle" || bad "не удалось получить Git bundle от legacy owner"
install -d -m 0700 -o root -g root "$SRV/base.git.tmp"
/usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c protocol.ext.allow=never -c protocol.file.allow=always clone -q --mirror --no-hardlinks "$TMP/legacy-common.bundle" "$SRV/base.git.tmp" || bad "не удалось клонировать root-owned Git bundle в закрытый root каталог"
chmod -R a+rX,go-w "$SRV/base.git.tmp"
mv "$SRV/base.git.tmp" "$SRV/base.git"
git --git-dir="$SRV/base.git" show-ref --verify --quiet refs/heads/dev || bad "base.git не содержит refs/heads/dev"
for sha in "$HEAD_SHA" "$BASE_SHA"; do
  git --git-dir="$SRV/base.git" cat-file -e "$sha^{commit}" || bad "base.git не содержит коммит $sha"
done
install -d -m 0700 -o "$LU" -g "$LG" "$SRV/slot1" "$SRV/slot1/worktrees"
as "$LU" git -c safe.directory="$SRV/base.git" clone -q --shared --no-checkout --upload-pack="git -c safe.directory=$SRV/base.git -c core.hooksPath=/dev/null -c core.fsmonitor=false upload-pack" "$SRV/base.git" "$SRV/slot1/repo"
install -d -m 0700 -o "$S2" -g "$S2" "$SRV/slot2" "$SRV/slot2/worktrees" "$SRV/slot2/home"
as "$S2" git -c safe.directory="$SRV/base.git" clone -q --shared --branch dev --upload-pack="git -c safe.directory=$SRV/base.git -c core.hooksPath=/dev/null -c core.fsmonitor=false upload-pack" "$SRV/base.git" "$SRV/slot2/repo"
chmod 0700 "$SRV/slot2/repo"
say "git: base.git + slot1/repo + slot2/repo (alternates; slot2 disabled)"

# 8. migrate legacy state -> slot1 (byte-identical, sha256), tombstone legacy
# Preserve the final validated idle checkpoint separately before migration.
record_completed 0 "$TMP" && legacy_resume_safe || bad "legacy state перед миграцией не прошёл проверку"
filtered_tar state "$L_STATE" "$BK/legacy-state.pre-migration.tar"
sha256sum "$BK/legacy-state.pre-migration.tar" >"$BK/legacy-state.pre-migration.tar.sha256"
LEGACY_MIGRATION_STARTED=1
as "$LU" python3 -B "$LIB/slots.py" migrate --src "$L_STATE" --dst "$VAR/slots/slot1" --apply >"$BK/migration.json"
filtered_tar state "$VAR/slots/slot1" "$BK/slot1-state.post-migration.tar"
python3 -I - "$BK/legacy-state.pre-migration.tar" "$BK/slot1-state.post-migration.tar" <<'PYCOMPARE' || bad "проверка 9: sha256 slot1 != legacy"
import hashlib,sys,tarfile
from pathlib import PurePosixPath
def manifest(path):
    result = {}
    with tarfile.open(path) as archive:
        for member in archive:
            assert member.isfile()
            name = PurePosixPath(member.name).name
            if name == 'worker.lock': continue
            assert name not in result
            with archive.extractfile(member) as stream:
                result[name] = hashlib.sha256(stream.read()).hexdigest()
    return result
assert manifest(sys.argv[1]) == manifest(sys.argv[2])
PYCOMPARE
[ -f "$L_STATE/RETIRED_TO_SLOT.json" ] || bad "tombstone legacy не записан"
say "проверка 9 ok: состояние перенесено без изменений"

# 9. units
for f in "${UNIT_FILES[@]}"; do
  UNIT_CONTENT=$(unit_content "$f")
  write_unit "$f" <<<"$UNIT_CONTENT"
done
systemctl daemon-reload

# 10. isolation checks 1-8 (ISOLATION_PLAN.md) BEFORE start
p() { systemctl show "$1" -p "$2" --value; }
[ "$(p gobadminton-slot@slot1.service User)" = "$LU" ] && [ "$(p gobadminton-slot@slot2.service User)" = "$S2" ] \
  && [ "$(p gobadminton-slot@slot1.service KillMode)" = control-group ] && [ "$(p gobadminton-slot@slot1.service PrivateTmp)" = yes ] \
  && [ "$(p gobadminton-slot@slot1.service ProtectSystem)" = strict ] && [ "$(p gobadminton-supervisor.service User)" = "$SUP" ] \
  && [ "$(p gobadminton-supervisor.service NoNewPrivileges)" = yes ] || bad "проверка 1: свойства unit"
for u in gobadminton-slot@slot1.service gobadminton-slot@slot2.service gobadminton-supervisor.service; do
  [ "$(p "$u" SupplementaryGroups)" = "$GRP" ] || bad "проверка 1: SupplementaryGroups $u"
done
p gobadminton-slot@slot1.service ReadWritePaths | grep -q "$SRV/slot1" && ! p gobadminton-slot@slot1.service ReadWritePaths | grep -q "$SRV/slot2" || bad "проверка 1: ReadWritePaths"
say "проверка 1 ok: unit-ы"
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
must_fail "gb-slot2 пишет в base.git" as "$S2" touch "$SRV/base.git/.x"
must_fail "$LU пишет в slot2" as "$LU" touch "$SRV/slot2/worktrees/.x"
must_fail "$LU пишет в state slot2" as "$LU" touch "$VAR/slots/slot2/.x"
must_fail "$SUP пишет в state slot1" as "$SUP" touch "$VAR/slots/slot1/.x"
must_fail "$SUP пишет в outbox slot1" as "$SUP" touch "$VAR/outbox/slot1/.x"
must_fail "gb-slot2 пишет назначение" as_slots "$S2" touch "$VAR/assign/slot1.json"
# Probe with the real supplementary group set used by services, not just account groups.
GROUP_PATH=$(find "$VAR" "$SRV" "$LIB" "$ETC" -gid "$G" ! -path "$VAR/locks" ! -path "$VAR/locks/*" -print -quit) || bad "не удалось проверить область доступа группы $GRP"
[ -z "$GROUP_PATH" ] || bad "группа $GRP имеет файлы вне $VAR/locks"
for u in "$LU" "$S2" "$SUP"; do
  as_slots "$u" test -r "$VAR/locks/registry.lock" && as_slots "$u" test -w "$VAR/locks/api.clock" || bad "группа $GRP не даёт $u требуемого доступа к locks"
  for slot in slot1 slot2; do
    case "$u:$slot" in "$LU:slot1"|"$S2:slot2") continue ;; esac
    for d in "$VAR/slots/$slot" "$SRV/$slot" "$SRV/$slot/worktrees"; do
      must_fail "$u + $GRP пишет в чужой state/repo ($d)" as_slots "$u" test -w "$d"
      must_fail "$u + $GRP проходит в чужой state/repo ($d)" as_slots "$u" test -x "$d"
    done
  done
done
say "изоляция ok: группа $GRP даёт доступ только к $VAR/locks (3770; mutex/registry 0640, api.clock 0660); записи в state/repo других слотов нет"
say "проверка 3 ok: перекрёстная запись запрещена"
CD=$(as "$LU" git -c safe.directory="$SRV/slot1/repo" -C "$SRV/slot1/repo" rev-parse --path-format=absolute --git-common-dir)
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
DONE_STARTED=1  # enable --now may start slot1 and then fail while starting the supervisor
systemctl enable --now gobadminton-slot@slot1.service gobadminton-supervisor.service
sleep 25
for u in gobadminton-slot@slot1.service gobadminton-supervisor.service; do
  [ "$(systemctl is-active "$u")" = active ] || {
    systemctl show "$u" -p ActiveState -p SubState -p ExecMainCode -p ExecMainStatus >&2 || true
    bad "$u не активен"
  }
done
python3 -I - "$VAR/outbox/slot1/status.json" "$VAR/slots/slot1/state.json" <<'PYSTATUS' || bad "status slot1"
import json,os,stat,sys
def safe_bytes(path, limit=16 * 1024 * 1024):
    path = os.fspath(path)
    if not os.path.isabs(path) or ".." in path.split("/"):
        raise ValueError("unsafe public file path")
    parts = path.split("/")[1:]
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
                raise ValueError("unsafe public file metadata")
            with os.fdopen(os.dup(fd), "rb") as source:
                data = source.read(limit + 1)
            after = os.fstat(fd)
            current = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            signature = lambda s: (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            if signature(before) != signature(after) or signature(before) != signature(current) or len(data) != before.st_size:
                raise ValueError("public file changed during read")
            return data
        finally:
            os.close(fd)
    finally:
        os.close(parent)
s=json.loads(safe_bytes(sys.argv[1]));l=json.loads(safe_bytes(sys.argv[2]))
assert s["slot"]=="slot1" and s["done"]==l["done"], "status.json slot1 != legacy"
PYSTATUS
say "проверка 11: public status.json и done сверены; содержимое журналов не читается"
trap 'rm -rf "$TMP"' EXIT
logl "installed head=$HEAD_SHA backup=$BK"
say "ПОДГОТОВКА: slot1 + supervisor работают (max_parallel=1, quota UNKNOWN до утверждённого daily cap). Два активных слота НЕ подтверждены; slot2 не запущен и без учётных данных. Откат: sudo bash /root/parallel-slots-install.sh --remove"
exit 0

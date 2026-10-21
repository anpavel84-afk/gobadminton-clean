#!/usr/bin/python3
"""Reviewed offline installer. DRY by default. Never executes bundle/candidate payloads.
PMA runs a reviewed copy with an independently reviewed manifest digest. No auth/sudoers changes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
from core import HERE, Refused, digest, loads, need
from receiver import (AUTONOMY, POLICY, STATE, UNITS, atomic, checkpoint, free_lock,
                      identity, journal, locked, no_models, read, trusted_tree, units_quiet)

INSTALL = Path('/usr/local/lib/gb-actions-train')
HELPER = Path('/usr/local/sbin/gb-deploy-helper.sh')
MONITOR_PAYLOADS = {
    'scripts/chatops/actions_train/monitor_payload/writer.py': Path('/usr/local/lib/gb-ops-monitor/opsmon/writer.py'),
    'scripts/chatops/actions_train/monitor_payload/app.js': Path('/usr/local/lib/gb-ops-monitor/web/app.js'),
}
MONITOR_BEFORE = {
    '/usr/local/lib/gb-ops-monitor/opsmon/writer.py': '957ebb3fb201efea31c7f29aa174bf142466c09e3222c03e5880b3467a14bc24',
    '/usr/local/lib/gb-ops-monitor/web/app.js': 'b8d617d74d3b707cd459c305b90054b5ab263c0f8184bc877c943730bbd13f3b',
}
LIVE_HELPER = 'f5e442d7ddd6c22834a1f31dc858deeb995377afd4b95be81791ad52813d5a1b'
SAFE = {'candidate', 'pr_wait', 'ci', 'done'}
HANDOFF = Path('/var/lib/gb-actions-migration/quiescent-handoff.json')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

def units():
    out = {}
    for unit in UNITS:
        p = subprocess.run(['/usr/bin/systemctl', 'show', unit,
                            '--property=ActiveState,MainPID,UnitFileState'], check=True,
                           capture_output=True, text=True, timeout=10)
        out[unit] = dict(l.split('=', 1) for l in p.stdout.splitlines() if '=' in l)
    return out

def payload(bundle, expected):
    manifest_path = bundle / 'scripts/chatops/actions_train/manifest.json'
    need(sha(manifest_path) == expected, 'unreviewed manifest')
    manifest = loads(manifest_path.read_bytes())
    need(manifest['schema'] == 'GB_ACTIONS_TRAIN_INSTALL_V1', 'invalid manifest')
    out = {}
    for source, checksum in manifest['files'].items():
        prefix = 'scripts/chatops/actions_train/'
        if source == 'scripts/chatops/server/gb-deploy-helper.sh': target = HELPER
        elif source in MONITOR_PAYLOADS: target = MONITOR_PAYLOADS[source]
        else:
            need(source.startswith(prefix) and '..' not in source.split('/'), 'out-of-scope payload')
            target = INSTALL / source[len(prefix):]
        path = bundle / source
        need(path.is_file() and not path.is_symlink() and sha(path) == checksum, 'payload hash drift')
        out[target] = path
    need(HELPER in out and INSTALL / 'receiver.py' in out, 'incomplete bundle')
    return out


def safe_state(slot, activation=False, handoff=None):
    import pwd
    user = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2')
    no_models(user.pw_uid, slot)
    free_lock(AUTONOMY / 'slots' / slot / 'worker.lock')
    free_lock(AUTONOMY / 'locks' / f'{slot}.lease')
    state, _ = checkpoint(slot)
    active = state['active']
    if not activation:
        archive = AUTONOMY / 'slots' / slot / 'actions-deferred.json'
        if archive.exists():
            need(not read(archive, user.pw_uid).get('entries'),
                 'old runtime does not understand Actions deferrals; compatibility reconciliation required')
    verified_unpublished = False
    if active and active['phase'] == 'promoting' and activation and handoff:
        entry = handoff.get('tasks', {}).get(slot, {})
        verified_unpublished = (handoff.get('schema') == 'GB_ACTIONS_QUIESCENT_HANDOFF_V1'
            and entry.get('checkpoint') == state and entry.get('phase') == 'promoting'
            and entry.get('head') == active['head'] and entry.get('base') == active['base']
            and handoff.get('remote_dev') == active['base']
            and entry.get('state_sha256') == sha(AUTONOMY / 'slots' / slot / 'state.json'))
    need(not active or active['phase'] in SAFE or verified_unpublished,
         'unknown/author/QA/push/deploy checkpoint; takeover refused')
    if active and active['phase'] != 'done':
        # Read-only nonroot V6 clean verification. No candidate execution, Git hooks or auth reads.
        work = Path('/srv/gb-slots') / slot / 'worktrees' / f'issue-{active["issue"]}'
        def check_git(args):
            def drop():
                os.setgroups([65042]); os.setgid(user.pw_gid); os.setuid(user.pw_uid)
            p = subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args],
                               cwd=work, env={'PATH': '/usr/bin:/bin', 'HOME': user.pw_dir,
                                             'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'},
                               capture_output=True, text=True, timeout=20, check=True, preexec_fn=drop)
            return p.stdout.strip()
        need(check_git(['rev-parse', 'HEAD']) == active['head'] and
             check_git(['symbolic-ref', '--short', 'HEAD']) == f'automation/issue-{active["issue"]}' and
             not check_git(['status', '--porcelain=v1', '--untracked-files=all']), 'dirty source takeover')
        for marker in ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'):
            need(not os.path.lexists(check_git(['rev-parse', '--path-format=absolute', '--git-path', marker])),
                 'unfinished source mutation')
    return digest(state)


def put(source, target, mode):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    trusted_tree(target.parent)
    if target.is_relative_to(INSTALL):
        INSTALL.chmod(0o755)
        target.parent.chmod(0o755)
    tmp = target.with_name('.' + target.name + '.install')
    need(not tmp.exists() and not tmp.is_symlink(), 'stale install temporary')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as f:
        f.write(source.read_bytes()); f.flush(); os.fsync(f.fileno())
    os.chown(tmp, 0, 0); os.chmod(tmp, mode)
    os.replace(tmp, target)
    directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(directory)
    finally: os.close(directory)


def prepare(bundle, expected, apply=False):
    files = payload(bundle, expected)
    before = {str(p): sha(p) for p in files}
    need(before[str(HELPER)] == LIVE_HELPER, 'deployed helper drift; re-review tiny hook against actual LIVE')
    for path, expected_before in MONITOR_BEFORE.items():
        if path in before: need(before[path] == expected_before, 'monitor baseline drift')
    need(not POLICY.exists() and not STATE.exists() and not INSTALL.exists(), 'existing train installation; use recorded upgrade review')
    report = dict(schema='GB_ACTIONS_TRAIN_BACKUP_V1', manifest=expected, before=before,
                  after={str(p): sha(s) for p, s in files.items()}, units=units(), activated=False)
    if not apply: return dict(dry=True, plan=report)  # NO mkdir/copy/chmod/managed write
    need(os.geteuid() == 0, 'root installation required')
    for p in (STATE.parent, POLICY.parent.parent, INSTALL.parent): trusted_tree(p)
    STATE.mkdir(mode=0o700)
    backup = STATE / 'backup'; backup.mkdir(mode=0o700)
    for i, target in enumerate(files):
        if target.exists():
            trusted_tree(target)
            shutil.copy2(target, backup / str(i))
    report['targets'] = [str(p) for p in files]
    atomic(STATE / 'backup.json', report)
    # Disabled policy committed before helper exposure; existing units/checkpoints untouched.
    POLICY.parent.mkdir(mode=0o755)
    atomic(POLICY, dict(schema='GB_ACTIONS_TRAIN_POLICY_V1', mode='disabled', owned={},
                        controller_sha=None, codex={}), mode=0o644)
    try:
        for target, source in files.items():
            need(sha(target) == before[str(target)], 'before hash changed during installation')
            put(source, target, 0o755 if target == HELPER else 0o644)
        need(all(sha(p) == sha(s) for p, s in files.items()), 'installed hash mismatch')
    except BaseException:
        # Recoverable partial install: policy stays disabled and backup is durable.
        raise
    return dict(installed=True, mode='disabled', manifest=expected)


def activate(controller_sha, proof_path, codex, apply=False):
    import re
    need(re.fullmatch('[0-9a-f]{40}', controller_sha or ''), 'exact immutable controller SHA required')
    policy = read(POLICY, 0)
    need(policy['mode'] in ('disabled', 'shadow') and not policy['owned'], 'already active')
    record = read(STATE / 'backup.json', 0)
    need(all(sha(Path(p)) == h for p, h in record['after'].items()), 'installed code drift')
    trusted_tree(proof_path)
    proof = read(proof_path, 0, 16384)
    need(set(proof) == {'schema', 'manifest', 'controller_sha', 'stage_workflow_sha256', 'handoff_sha256', 'probe_run', 'reviewed', 'codex'} and
         proof['schema'] == 'GB_ACTIONS_TRAIN_PROOF_V1' and proof['manifest'] == record['manifest']
         and proof['controller_sha'] == controller_sha and proof['reviewed'] is True
         and re.fullmatch('[0-9a-f]{64}', proof['stage_workflow_sha256'])
         and re.fullmatch('[0-9a-f]{64}', proof['handoff_sha256'])
         and type(proof['probe_run']) is int and proof['probe_run'] > 0, 'missing reviewed shadow proof')
    need(codex == proof['codex'] and set(codex) == {'slot1', 'slot2'}, 'exact existing model executable paths required')
    for path in codex.values():
        need(Path(path).is_absolute() and Path(path).is_file() and os.access(path, os.X_OK), 'model executable unavailable')
    old = units()
    need(all(p['ActiveState'] == 'inactive' and p['MainPID'] == '0' and
             p['UnitFileState'] in ('enabled', 'disabled', 'masked') for p in old.values()), 'workers must drain; installer never stops them')
    handoff_path = HANDOFF
    trusted_tree(handoff_path)
    need(sha(handoff_path) == proof['handoff_sha256'], 'quiescent handoff proof changed')
    handoff = read(handoff_path, 0)
    hashes = {slot: safe_state(slot, True, handoff) for slot in ('slot1', 'slot2')}
    need(not any(journal(slot)['pending'] for slot in hashes), 'pending stage takeover')
    result = dict(mode='active', owned=hashes, controller_sha=controller_sha,
                  stage_workflow_sha256=proof['stage_workflow_sha256'], codex=codex)
    if not apply: return dict(dry=True, plan=result, old_units=old)
    # Snapshot actual activation state and enabled flags, not an old context copy.
    atomic(STATE / 'activation.json', dict(units=old, checkpoint_hashes=hashes))
    for unit, props in old.items():
        if props['UnitFileState'] == 'enabled':
            subprocess.run(['/usr/bin/systemctl', 'disable', unit], check=True, timeout=20)
    units_quiet(UNITS)
    need(hashes == {slot: safe_state(slot, True, handoff) for slot in hashes}, 'checkpoint drift during activation')
    atomic(POLICY, policy | result, mode=0o644)
    return dict(activated=True, **result)


def rollback(apply=False):
    policy = read(POLICY, 0)
    record = read(STATE / 'backup.json', 0)
    need(all(sha(Path(p)) in (record['before'][p], h) for p, h in record['after'].items()), 'rollback code drift')
    if apply:
        # First action always stops NEW dispatch, even if quiescence later refuses rollback.
        atomic(POLICY, policy | {'mode': 'disabled'}, mode=0o644)
    for slot in policy['owned']:
        need(not journal(slot)['pending'], 'running/unknown stage; rollback runtime refused')
        safe_state(slot)
    if policy['owned']: units_quiet(UNITS)
    need(not (STATE / 'integration.json').exists(), 'unfinished integration/DEV acceptance')
    activation = read(STATE / 'activation.json', 0) if (STATE / 'activation.json').exists() else None
    if not apply: return dict(dry=True, restore=record['before'], units=activation and activation['units'])
    for i, name in reversed(list(enumerate(record['targets']))):
        target = Path(name)
        original = record['before'][name]
        if original is None: target.unlink(missing_ok=True)
        else:
            source = STATE / 'backup' / str(i)
            need(sha(source) == original, 'backup hash mismatch')
            put(source, target, stat.S_IMODE(source.stat().st_mode))
    if activation:
        for unit, props in activation['units'].items():
            if props['UnitFileState'] == 'enabled':
                subprocess.run(['/usr/bin/systemctl', 'enable', unit], check=True, timeout=20)
    # Policy stays disabled. No checkpoint/history/attempt/budget restoration, no auto service start.
    atomic(STATE / 'rollback.json', dict(at=int(__import__('time').time()), history_preserved=True))
    return dict(rolled_back=True, mode='disabled', history_preserved=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=('prepare', 'activate', 'rollback'))
    p.add_argument('--apply', action='store_true')
    p.add_argument('--bundle', type=Path)
    p.add_argument('--manifest-sha256')
    p.add_argument('--controller-sha')
    p.add_argument('--proof', type=Path)
    p.add_argument('--codex-slot1')
    p.add_argument('--codex-slot2')
    args = p.parse_args()
    need(not args.apply or os.geteuid() == 0, 'root required')
    if args.action == 'prepare': result = prepare(args.bundle, args.manifest_sha256, args.apply)
    else:
        # Exclusion with root receiver. DRY never creates or changes a managed file.
        fd = None
        if args.apply: fd = locked(STATE / 'controller.lock')
        try:
            if args.action == 'activate':
                result = activate(args.controller_sha, args.proof,
                                  {'slot1': args.codex_slot1, 'slot2': args.codex_slot2}, args.apply)
            else: result = rollback(args.apply)
        finally:
            if fd is not None: os.close(fd)
    print(json.dumps(result, sort_keys=True))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error, Refused) else type(error).__name__, file=sys.stderr)
        sys.exit(1)

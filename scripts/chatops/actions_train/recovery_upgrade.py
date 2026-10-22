"""Reviewed integrator runtime upgrade, never activation. DRY/APPLY/ROLLBACK, no services.

Run a reviewed copy, never a product candidate. The caller supplies independently reviewed
manifest AND proof digests. All effects use the existing controller.lock, fixed destinations,
and disabled policy. No source/task/budget state is restored, removed, or reset.
"""
import argparse
import copy
import os
from pathlib import Path
from core import SHA, Refused, digest, need
import installer
import receiver
import recovery

CHANGES = {'core.py', 'client.py', 'receiver.py', 'stage.py', 'recovery.py', 'recovery_upgrade.py', 'recovery_admission.py', 'recovery_publish.py', 'qa_recovery.py'}
BUDGET = Path('/etc/gobadminton-slots/budgets.json')


def preserved():
    roots = (receiver.AUTONOMY / 'slots', receiver.AUTONOMY / 'outbox', receiver.STATE / 'history')
    files = [p for root in roots if root.exists() for p in root.rglob('*') if p.is_file()]
    files += [receiver.STATE / name for name in ('slot1.json', 'slot2.json', 'planning.json', 'integration.json')]
    files += [BUDGET]
    return {str(p): installer.sha(p) for p in sorted(set(files))}


def quiet():
    receiver.units_quiet(receiver.UNITS)
    for slot in ('slot1', 'slot2'):
        j=receiver.journal(slot)
        if j['pending']:
            op=j.get('operations',{}).get(j['pending'],{})
            need(op.get('binding',{}).get('stage')=='qa' and op.get('result',{}).get('status')=='unknown',
                 'pending/unknown stage; drain/reconcile, never kill')
        state=receiver.checkpoint(slot)[0]
        from qa_recovery import safe_pending
        stopped_qa=safe_pending(j,state,receiver.alive)
        need(not j['pending'] or stopped_qa, 'pending/unknown stage; drain/reconcile, never kill')
        need(not state['active'] or state['active']['phase']=='done' or stopped_qa,
             'active source task; upgrade does not interrupt it')
        import pwd
        receiver.no_models(pwd.getpwnam('agentagency-dev' if slot=='slot1' else 'gb-slot2').pw_uid,slot)
        receiver.free_lock(receiver.AUTONOMY / 'slots' / slot / 'worker.lock')
        receiver.free_lock(receiver.AUTONOMY / 'locks' / (slot + '.lease'))
    need(not (receiver.STATE / 'integration.json').exists(), 'integration/DEV pending')
    cache = receiver.read(receiver.STATE / 'recovery.json', 0) if (receiver.STATE / 'recovery.json').exists() else recovery.empty()
    need(not any(r['status'].endswith('_pending') for r in cache['receipts'].values()), 'ambiguous recovery; reconcile before upgrade')


def upgrade(action, bundle, expected, proof, apply=False):
    """Caller holds existing controller.lock even for dry. Never imports bundle code."""
    need(action in ('install', 'rollback'), 'invalid upgrade operation')
    quiet()
    policy = receiver.read(receiver.POLICY, 0)
    record = receiver.read(receiver.STATE / 'backup.json', 0)
    path = receiver.STATE / 'upgrade-185.json'
    backups = receiver.STATE / 'upgrade-185-backup'
    if action == 'rollback':
        j = receiver.read(path, 0)
        need(policy['mode'] == 'disabled' and j['phase'] in ('applying', 'installed-disabled'), 'pause/drain before runtime rollback')
        need(preserved() == j['preserved'], 'state changed since upgrade; re-review rollback without restoring state')
        for name, h in j['changes'].items():
            need(installer.sha(Path(name)) in (h['before'], h['after']), 'rollback payload drift')
        if not apply: return dict(dry=True, phase=j['phase'], restore=j['changes'])
        for i, (name, h) in enumerate(sorted(j['changes'].items())):
            if h['before'] is None: Path(name).unlink(missing_ok=True)
            else:
                source = backups / str(i)
                need(installer.sha(source) == h['before'], 'upgrade backup drift')
                installer.put(source, Path(name), 0o644)
        receiver.atomic(receiver.STATE / 'backup.json', j['record_before'])
        receiver.atomic(receiver.POLICY, j['policy_before'] | {'mode': 'disabled'}, mode=0o644)
        # Keep recovery receipts, including spent reservations. No task/history/budget rewind.
        j['phase'] = 'rolled-back-disabled'; receiver.atomic(path, j)
        return dict(phase=j['phase'], state_preserved=True)

    need(set(proof) == {'schema', 'reviewed', 'old_manifest', 'old_controller_sha', 'manifest',
         'controller_sha', 'stage_workflow_sha256', 'recovery', 'enrollment_slot'}, 'invalid reviewed upgrade proof')
    need(proof['schema'] == 'GB_RECOVERY_UPGRADE_185_V1' and proof['reviewed'] is True
         and proof['manifest'] == expected and proof['old_manifest'] == record['manifest']
         and proof['old_controller_sha'] == policy['controller_sha'] and SHA.fullmatch(proof['controller_sha'])
         and proof['enrollment_slot'] in ('slot1', 'slot2'), 'upgrade proof mismatch')
    proposed = policy | dict(mode='disabled', controller_sha=proof['controller_sha'],
         stage_workflow_sha256=proof['stage_workflow_sha256'], recovery=proof['recovery'])
    p = recovery.policy(proposed)
    need(set(p['enrolled']) == {'177'}, 'this deployment must explicitly enroll only current exact failure177')
    files = installer.payload(bundle, expected)
    after = {str(k): installer.sha(v) for k, v in files.items()}
    need(all(installer.sha(Path(k)) == h for k, h in record['after'].items()), 'installed baseline drift')
    need(set(record['after']) <= set(after), 'payload removal forbidden')
    changes = {k: dict(before=installer.sha(Path(k)), after=v) for k, v in after.items() if v != record['after'].get(k)}
    need(changes and set(changes) <= {str(installer.INSTALL / n) for n in CHANGES}, 'unexpected upgrade paths; live/monitor are frozen')
    workflow = bundle / '.github/workflows/train-stage.yml'
    need(installer.sha(workflow) == proof['stage_workflow_sha256'], 'reviewed stage workflow mismatch')
    # The source pass intentionally keeps the old checkout pin. Integrator must prepare an
    # independently reviewed workflow pin before enabling a newly published controller.
    need(('ref: ' + proof['controller_sha']).encode() in workflow.read_bytes(), 'workflow still pins old controller; integrator review required')
    slot = proof['enrollment_slot']
    import pwd
    user = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2')
    archive = receiver.read(receiver.AUTONOMY / 'slots' / slot / 'actions-deferred.json', user.pw_uid)
    entries = [e for e in archive['entries'] if digest(e) == p['enrolled']['177'] and e['issue'] == 177]
    need(len(entries) == 1, 'exact enrolled177 archive absent/ambiguous')
    cache_path = receiver.STATE / 'recovery.json'
    cache = receiver.read(cache_path, 0) if cache_path.exists() else recovery.empty()
    cache_before = digest(cache)
    done = receiver.checkpoint('slot1')[0]['done'] + receiver.checkpoint('slot2')[0]['done']
    recovery.enroll(cache, entries[0], slot, proposed, done=done)
    report = dict(phase='prepared', changes=changes, policy_before=policy, record_before=record,
                  preserved=preserved(), cache_before=cache_before, manifest=expected)
    if not apply: return dict(dry=True, **report)
    need(policy['mode'] == 'disabled', 'operator must disable NEW dispatch and drain before apply')
    need(not path.exists() and not backups.exists(), 'existing upgrade journal; reconcile/rollback')
    backups.mkdir(mode=0o700)
    for i, (name, h) in enumerate(sorted(changes.items())):
        if h['before'] is not None:
            target = Path(name); receiver.trusted_tree(target)
            installer.put(target, backups / str(i), 0o600)
    report['phase'] = 'applying'; receiver.atomic(path, report)  # before replacing a single byte
    receiver.atomic(receiver.POLICY, proposed, mode=0o644)
    for name in sorted(changes): installer.put(files[Path(name)], Path(name), 0o644)
    need(all(installer.sha(Path(k)) == v for k, v in after.items()), 'post-upgrade payload drift')
    need(preserved() == report['preserved'], 'state changed during upgrade')
    current_cache = receiver.read(cache_path, 0) if cache_path.exists() else recovery.empty()
    need(digest(current_cache) == cache_before, 'receipt cache changed during upgrade')
    receiver.atomic(cache_path, cache)
    updated = copy.deepcopy(record); updated.update(manifest=expected, after=after)
    for name in sorted(changes):
        if name not in updated['before']:
            updated['before'][name] = None; updated['targets'].append(name)
    receiver.atomic(receiver.STATE / 'backup.json', updated)
    report['phase'] = 'installed-disabled'; receiver.atomic(path, report)
    return dict(phase=report['phase'], state_preserved=True, activation='separate reviewed hosted probe/policy gate required')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=('install', 'rollback')); p.add_argument('--apply', action='store_true')
    p.add_argument('--bundle', type=Path); p.add_argument('--manifest-sha256')
    p.add_argument('--proof', type=Path); p.add_argument('--proof-sha256')
    args = p.parse_args()
    need(os.geteuid() == 0, 'reviewed root integrator only')
    receiver.trusted_tree(receiver.STATE); receiver.trusted_tree(receiver.POLICY)
    # Existing lock opened without O_CREAT: dry cannot create/change managed state.
    import fcntl
    fd = os.open(receiver.STATE / 'controller.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        proof = None
        if args.action == 'install':
            receiver.trusted_tree(args.proof)
            need(installer.sha(args.proof) == args.proof_sha256, 'unreviewed proof digest')
            proof = receiver.read(args.proof, 0, 16384)
        print(__import__('json').dumps(upgrade(args.action, args.bundle, args.manifest_sha256, proof, args.apply), sort_keys=True))
    finally: os.close(fd)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error, Refused) else type(error).__name__)
        raise SystemExit(1)

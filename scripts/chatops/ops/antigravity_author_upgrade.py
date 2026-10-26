#!/usr/bin/python3
"""Reviewed root-only AGY author install subset; dry by default, never activates.

No policy/old marker/ledger writes. The existing controller lock and a disabled,
fully quiescent train are mandatory. READY promotion/shadow activation are a
separate reviewed OPS step (see ANTIGRAVITY_AUTHOR_ROUTE.md).
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as r
import installer as i
from core import loads, need

INSTALL = Path('/usr/local/lib/gb-actions-train')
CONFIG = Path('/etc/gobadminton-slots')
STATE = r.STATE
JOURNAL = STATE/'antigravity-author-upgrade.json'
BACKUP = STATE/'antigravity-author-backup'
FILES = ('native_antigravity_author.py', 'core.py', 'stage.py', 'cost_policy.py')
PINS = ('native_antigravity_author.py', 'native_antigravity.py', 'native_guard.py')
MODEL = 'claude-sonnet-5-5-medium'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    r.trusted_tree(path)
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'nonregular upgrade input')
    return path.read_bytes()


def optional(path):
    need(not path.is_symlink(), 'upgrade target symlink')
    return read(path) if path.exists() else None


def encoded(value):
    return json.dumps(value, sort_keys=True).encode()


def budget_extension(raw, calls):
    """Insert only two new author members. Every old JSON byte is preserved."""
    need(type(calls) is int and 1 <= calls <= 10000, 'finite positive budget required')
    old = loads(raw); desired = copy.deepcopy(old)
    need(old.get('schema') == 1 and old.get('providers', {}).get('agy', {}).get('qa') == 2,
         'unexpected AGY QA budget baseline')
    need('author' not in old['providers']['agy'], 'prior author budget must be reconciled')
    own = old.get('slots', {}).get('slot2')
    need(type(own) is dict and 'author' not in own.get('agy', {}), 'slot2 budget baseline differs')
    desired['providers']['agy']['author'] = calls
    desired['slots']['slot2'].setdefault('agy', {})['author'] = calls
    decoder = json.JSONDecoder()
    text = raw.decode('utf-8')
    def insert(text, path, key, value):
        def whitespace(pos):
            while pos < len(text) and text[pos].isspace(): pos += 1
            return pos
        start = whitespace(0)
        for component in path:
            need(text[start] == '{', 'budget object required')
            pos = whitespace(start+1); found = None
            while text[pos] != '}':
                name, end = decoder.raw_decode(text, pos)
                pos = whitespace(end); need(text[pos] == ':', 'invalid budget member')
                begin = whitespace(pos+1)
                _, end = decoder.raw_decode(text, begin)
                if name == component: found = begin
                pos = whitespace(end)
                if text[pos] == ',': pos = whitespace(pos+1)
                else: break
            need(found is not None, 'missing budget object')
            start = found
        value_before, end = decoder.raw_decode(text, start)
        need(type(value_before) is dict and key not in value_before, 'budget member already exists')
        pos = end-1
        return text[:pos] + (',' if value_before else '') + json.dumps(key)+':'+json.dumps(value) + text[pos:]
    text = insert(text, ('providers', 'agy'), 'author', calls)
    if 'agy' in own:
        text = insert(text, ('slots', 'slot2', 'agy'), 'author', calls)
    else:
        text = insert(text, ('slots', 'slot2'), 'agy', {'author': calls})
    result = text.encode('utf-8')
    need(loads(result) == desired, 'unrelated budget fields changed')
    return result


def quiet(base_controller):
    policy = r.read(r.POLICY, 0)
    need(policy.get('mode') == 'disabled' and policy.get('controller_sha') == base_controller,
         'base controller differs or launches enabled')
    r.units_quiet(r.UNITS)
    for slot in ('slot1', 'slot2'):
        journal = r.journal(slot); checkpoint, _ = r.checkpoint(slot)
        need(not journal.get('pending') and all(v.get('finished_at') for v in journal['operations'].values()),
             'operation active or outcome unresolved')
        need(not checkpoint.get('active') or checkpoint['active']['phase'] == 'done', 'task still active')
        i.safe_state(slot, activation=True)
    need(not (STATE/'integration.json').exists(), 'integration active')
    need(not any(v['status'].endswith('_pending') for v in r.recovery_journal()['receipts'].values()),
         'recovery active')


def preserved():
    """Read-only fingerprint of policy, old markers and all authoritative history."""
    result = {}
    roots = (STATE, r.AUTONOMY/'slots', r.AUTONOMY/'outbox')
    for root in roots:
        for path in root.rglob('*'):
            if path in (JOURNAL, STATE/'controller.lock') or BACKUP == path or BACKUP in path.parents:
                continue
            need(not path.is_symlink(), 'history link refused')
            if path.is_file(): result[str(path)] = i.sha(path)
    for path in (r.POLICY, CONFIG/'antigravity-qa.json', CONFIG/'cursor-author.json'):
        result[str(path)] = i.sha(path)
    return result


def plan(bundle, manifest_hash, base_controller, task_hash, calls):
    need(re.fullmatch('[a-f0-9]{40}', base_controller or '') and re.fullmatch('[a-f0-9]{64}', task_hash or ''),
         'exact baseline and canary task hash required')
    quiet(base_controller)
    manifest_raw = read(bundle/'scripts/chatops/actions_train/manifest.json')
    need(sha(manifest_raw) == manifest_hash, 'unreviewed manifest')
    manifest = loads(manifest_raw)
    need(manifest['schema'] == 'GB_ACTIONS_TRAIN_INSTALL_V1', 'invalid manifest')
    source = bundle/'scripts/chatops/actions_train'
    payload = {}
    for name in set(FILES) | set(PINS):
        raw = read(source/name)
        need(sha(raw) == manifest['files'].get('scripts/chatops/actions_train/'+name), 'manifest hash drift')
        if name in FILES: payload[INSTALL/name] = raw
        else: need(read(INSTALL/name) == raw, 'pinned QA helper would change')
    qa = loads(read(CONFIG/'antigravity-qa.json'))
    need(qa.get('schema') == 'GB_ANTIGRAVITY_QA_29_V1' and qa.get('phase') in ('canary', 'ready')
         and all(qa.get('modules', {}).get(n) == sha(read(INSTALL/n))
                 for n in ('native_antigravity.py', 'native_guard.py')), 'AGY QA marker pins stale; separate reviewed re-pin required')
    record = loads(read(STATE/'backup.json'))
    for name in FILES:
        path = INSTALL/name; before = optional(path)
        if name == 'native_antigravity_author.py':
            need(before is None, 'prior author installation must be reconciled')
        else:
            need(before is not None and record.get('after', {}).get(str(path)) == sha(before), 'base controller file drift')
    need(optional(CONFIG/'antigravity-author.json') is None, 'prior author qualification exists')
    marker = dict(schema='GB_ANTIGRAVITY_AUTHOR_V1', phase='canary', slot='slot2', executor_uid=978,
                  canary_task_sha256=task_hash, admitted_models=[MODEL],
                  modules={n:sha(read(source/n)) for n in PINS})
    payload[CONFIG/'antigravity-author.json'] = encoded(marker)
    payload[CONFIG/'budgets.json'] = budget_extension(read(CONFIG/'budgets.json'), calls)
    return payload, preserved()


def put(path, raw, mode=0o644):
    """Exact bytes, same-directory atomic replace; only the fixed target allowlist."""
    allowed = {INSTALL/n for n in FILES} | {CONFIG/'antigravity-author.json', CONFIG/'budgets.json'}
    need(path in allowed or path == JOURNAL or path.parent == BACKUP, 'out-of-scope upgrade write')
    r.trusted_tree(path.parent); need(not path.is_symlink(), 'upgrade destination link')
    fd, temp = tempfile.mkstemp(prefix='.agy-upgrade-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            os.fchmod(out.fileno(), mode); out.write(raw); out.flush(); os.fsync(out.fileno())
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(temp): os.unlink(temp)


def execute(action, bundle, manifest_hash, base_controller, task_hash, calls=1):
    """Caller holds existing controller.lock; main acquires it, fixture caller isolates it."""
    need(os.geteuid() == 0, 'root OPS only')
    need(action in ('dry', 'apply', 'verify', 'rollback'), 'unsupported upgrade action')
    if action in ('dry', 'apply'):
        payload, history = plan(bundle, manifest_hash, base_controller, task_hash, calls)
        need(not JOURNAL.exists() and not BACKUP.exists(), 'prior upgrade journal must be reconciled')
        changes = {str(p):dict(before=sha(raw) if (raw := optional(p)) is not None else None,
                               after=sha(after)) for p, after in payload.items()}
        if action == 'dry': return dict(dry=True, changes=changes, qa_pins='match', no_activation=True)
        j = dict(schema='GB_AGY_AUTHOR_UPGRADE_V1', phase='backing-up', changes=changes,
                 base_controller=base_controller, task_sha256=task_hash, history=history,
                 metadata={str(p):stat.S_IMODE(p.stat().st_mode) if p.exists() else 0o644 for p in payload})
        put(JOURNAL, encoded(j), 0o600)
        BACKUP.mkdir(mode=0o700)
        for n, name in enumerate(sorted(changes)):
            before = optional(Path(name))
            if before is not None: put(BACKUP/str(n), before, 0o600)
        j['phase'] = 'applying'; put(JOURNAL, encoded(j), 0o600)
        for target, raw in payload.items(): put(target, raw)
        need(all(sha(read(Path(p))) == row['after'] for p, row in changes.items()), 'installed verification failed')
        need(preserved() == history, 'authoritative history changed')
        j['phase'] = 'installed-canary-disabled'; put(JOURNAL, encoded(j), 0o600)
        return dict(phase=j['phase'], qa_pins='match', no_activation=True)
    j = loads(read(JOURNAL))
    need(j.get('schema') == 'GB_AGY_AUTHOR_UPGRADE_V1' and j['base_controller'] == base_controller
         and j['task_sha256'] == task_hash, 'upgrade identity differs')
    quiet(base_controller)
    need(preserved() == j['history'], 'history changed; never rewind it')
    allowed = {str(INSTALL/n) for n in FILES} | {str(CONFIG/'antigravity-author.json'), str(CONFIG/'budgets.json')}
    need(set(j['changes']) == allowed, 'invalid journal targets')
    restore = []
    for n, (name, row) in enumerate(sorted(j['changes'].items())):
        raw = optional(Path(name)); actual = sha(raw) if raw is not None else None
        need(actual in (row['before'], row['after']), 'foreign target drift')
        if action == 'verify':
            need(actual == row['after'], 'installed target differs')
        elif actual != row['before']:
            before = None
            if row['before'] is not None:
                before = read(BACKUP/str(n)); need(sha(before) == row['before'], 'backup drift')
            restore.append((Path(name), before, j['metadata'][name]))
    # Validate ALL targets/backups before the first rollback write.
    for target, before, mode in restore:
        if before is None:
            target.unlink()
            directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        else: put(target, before, mode)
    if action == 'rollback':
        need(all((sha(raw) if (raw := optional(Path(p))) is not None else None) == row['before']
                 for p, row in j['changes'].items()), 'rollback verification failed')
        need(preserved() == j['history'], 'history changed during rollback')
        j['phase'] = 'rolled-back-disabled'; put(JOURNAL, encoded(j), 0o600)
    return dict(phase=j['phase'], verified=True, no_activation=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--action', choices=('dry', 'apply', 'verify', 'rollback'), default='dry')
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--base-controller', required=True)
    parser.add_argument('--canary-task-sha256', required=True)
    parser.add_argument('--author-budget', type=int, default=1)
    args = parser.parse_args()
    need(os.geteuid() == 0, 'root OPS only')
    # Open the EXISTING lock only: dry-run must not create it or any other file.
    import fcntl
    fd = os.open(STATE/'controller.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(execute(args.action, args.bundle, args.manifest_sha256,
                                 args.base_controller, args.canary_task_sha256, args.author_budget), sort_keys=True))
    finally: os.close(fd)


if __name__ == '__main__': main()

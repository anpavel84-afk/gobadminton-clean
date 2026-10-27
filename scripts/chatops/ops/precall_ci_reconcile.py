#!/usr/bin/python3
"""Bounded C5 no-author CI refresh, for the existing trusted Root OPS path.

Source authoring/testing is NOT installation, independent QA or live clearance.
CLI: dry/apply/verify/rollback --operation HEX --bundle ROOT_OWNED_WORKTREE
     --source-commit SHA --source-branch BRANCH --source-ci-run INTEGER
     --qa-receipt ROOT_OWNED_RECEIPT
All CLI paths are read-only source inputs; runtime paths are fixed. Only apply
and rollback may write the two metadata targets and private durable receipts.
No provider, publish, deploy, policy toggle, attempt reset or UNKNOWN rewrite.
"""
import argparse
import ast
import base64
import contextlib
import copy
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = 'anpavel84-afk/gobadminton-clean'
REPO_ID = 1416250340
CONTROLLER = '41e12be2d551158e97ea30eaf8e95f992f998615'
STAGE_WORKFLOW = 'b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d'
POLICY_PIN = '52250df8b6391b46fe4b80f6805c27e89d06a1c493ca27002b187b1f1f7567d4'
INVENTORY_PIN = '4b0eb93039712737a21b59bf9550084da01a963c67472034e25563deedd1f1bc'
# Exact 27-file public installed closure observed 2026-10-27, per-file identity.
PROFILE = {'accepted-engineering-rules.md': ('017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269',
                                   113203),
 'antigravity_qa_recovery.py': ('93efc05c7aa46fc7ff0d6da70f0db01a9ebda434dbc7d99066590e0459a92a2e',
                                57449),
 'client.py': ('1c63f4a53709f749cd6d7e88ee6cf1fd479a76762b385dc3a94764f4d42bce65', 13214),
 'content_identity.py': ('e2df72bcf044149bd5f87a8a9f01a64ed8116a6db72d691a0e6e2b2036cf71af', 29131),
 'context_exchange.py': ('baa4463cc6919e015ceabb1c05f398e095beb8c22a633191125442435586e132', 14404),
 'context_policy.py': ('d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806', 10574),
 'core.py': ('3ed9ab5503694f39011102ff34935810ef1dce67cf712c87be89b023689a15a7', 24252),
 'cost_policy.py': ('18f303fae73b3edf9b73249ae9d904050f65ed4089712dac3bbb98c1c9f58fad', 5493),
 'failure_diagnosis.py': ('ced74509f2f80bcd6b073607846b9283c7c7861c5d43fb52f2721ac5d589c75c',
                          11939),
 'installer.py': ('efed82cd43d26abe917c76091743feda5437445630aa9aecb65af3075c2a9d26', 14366),
 'live/autonomous_issues.py': ('f3ca85b4392fa1e2ba76a09ec1140d78ebc6c708ba42397bee047184fec3ebe0',
                               94653),
 'live/check_foundation.py': ('c2975b19bd46d00acbdbc08227545b8f9c9501d7b8e8783e9b397751c612bd13',
                              15753),
 'live/slots.py': ('3c7b4ab36dd3cd8b41c3309a4d58c54ffc99027b1d7c1e5ad2235b5cd1f72a76', 50924),
 'monitor.py': ('1b0cdd9895c24407294739b5092cf8ad06b8761e2672eaede15900d4fe859a6e', 7522),
 'native_antigravity.py': ('01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72',
                           112849),
 'native_cursor.py': ('02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089', 17488),
 'native_guard.py': ('dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762', 8036),
 'owner_package_admission.py': ('bb5bf8516d26ae293f16d794c2e46f90b01d0c27b34da15febbd0bff4398c7c5',
                                32123),
 'qa_equivalence.py': ('b95d571ee22b666e329d38ac690fbba948b40b712a2f63aa566b51705143809d', 12791),
 'qa_recovery.py': ('1d8a93beb61b871e5321e5b3b9a6803731e40a9687a4d48f2ce8c52ffe1cd185', 8416),
 'queue_diagnostics.py': ('0ee6b2628fb4d1a65e50ceb5b33b1fbc9d5f2838d9a425882d977bf3ffabbd14', 3874),
 'receiver.py': ('6405168b06f3902e40595528d30856c025a0311abfc31d70b59e969ed384af4e', 48026),
 'recovery.py': ('315fb1f8349f0881073148737371ef1f519411883994ea4769db173b47e4e7c9', 26494),
 'recovery_admission.py': ('b6eb1b4e73829f612d7603bb335fd1bdbace73235eac3d5c25c84782dc5854c7',
                           10751),
 'recovery_publish.py': ('51e110d5beaf1a0e46b98eaffb2691d7e4e975c36ab939575e93e87d2850a8c9', 2704),
 'recovery_upgrade.py': ('ce8cc88f3cb3230b51f425d9082e826511c35332ca363d2af97bb8b18e4498f6', 10143),
 'stage.py': ('ea79b894076c755f28d62619154b0681ecb636b7b32dd05c18a8c996112a1c2e', 39124)}
# Exact public installed metadata, distinct from the source/release commit.
PROFILE_MTIME_NS = {'accepted-engineering-rules.md': 1792920706738859053,
 'antigravity_qa_recovery.py': 1793049176412272652,
 'client.py': 1792793845817118364,
 'content_identity.py': 1792872459232260362,
 'context_exchange.py': 1792775310532400261,
 'context_policy.py': 1792920706731859080,
 'core.py': 1792793845836118350,
 'cost_policy.py': 1792756471535459708,
 'failure_diagnosis.py': 1792793845841118346,
 'installer.py': 1792625085957885271,
 'live/autonomous_issues.py': 1792793845853118337,
 'live/check_foundation.py': 1792625085964885270,
 'live/slots.py': 1792716963715516474,
 'monitor.py': 1792756471543459704,
 'native_antigravity.py': 1793008118775235597,
 'native_cursor.py': 1792716963718516471,
 'native_guard.py': 1792716963721516468,
 'owner_package_admission.py': 1793049176443272644,
 'qa_equivalence.py': 1792793845857118334,
 'qa_recovery.py': 1792705392928352952,
 'queue_diagnostics.py': 1792641815992911431,
 'receiver.py': 1792793845860118331,
 'recovery.py': 1792793845863118329,
 'recovery_admission.py': 1792793845866118327,
 'recovery_publish.py': 1792657620607667113,
 'recovery_upgrade.py': 1792657620613667109,
 'stage.py': 1792874565967064062}
SHA = re.compile(r'[0-9a-f]{40}')
HASH = re.compile(r'[0-9a-f]{64}')
CI_JOBS = frozenset(('foundation', 'source (api)', 'source (web)',
                     'source (admin)', 'source (contracts)', 'database', 'receiver'))
REQUIRED_STEPS = {
    'foundation': frozenset(('Run python3 scripts/check_foundation.py',
                            'Check bounded contract exemptions even on foundation failure')),
    'database': frozenset(('Run bash scripts/chatops/db-ci.sh',)),
    'receiver': frozenset(("Run find scripts/chatops -name '*.sh' -exec bash -n {} +",)),
    **{f'source ({p})': frozenset(f'Run pnpm --filter @gobadminton/{p} run {c}'
                               for c in ('typecheck', 'lint', 'test:unit'))
       for p in ('api', 'web', 'admin', 'contracts')},
}
SCHEMA = 'GB_PRECALL_CI_RECONCILE_V1'
SOURCE_PATH = 'scripts/chatops/ops/precall_ci_reconcile.py'
TEST_PATH = 'scripts/chatops/tests/test_actions_train_precall_ci_reconcile.py'


class Hold(Exception):
    """A local refusal; never inference that an UNKNOWN had no effects."""


class TransactionHold(Hold):
    def __init__(self, reason, target_writes):
        super().__init__(reason)
        self.target_writes = target_writes


def need(ok, code):
    if not ok:
        raise Hold(code)


def keys(value, names, code):
    need(type(value) is dict and set(value) == set(names.split()), code)


def positive(value):
    return type(value) is int and 0 < value < 2**63


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def loads(raw):
    try:
        return json.loads(raw, object_pairs_hook=unique,
                          parse_constant=lambda _: need(False, 'NONFINITE_JSON'))
    except (ValueError, UnicodeError, RecursionError):
        raise Hold('INVALID_JSON') from None


def canonical(raw):
    """Preserve the live Store/receiver serializer, including ensure_ascii."""
    value = loads(raw)
    for ascii_flag in (True, False):
        if encode(value, ascii_flag) == raw:
            return value, ascii_flag
    raise Hold('NONCANONICAL_STATE')


def encode(value, ascii_flag=True):
    return json.dumps(value, sort_keys=True, ensure_ascii=ascii_flag).encode()


def token(info):
    return [info.st_dev, info.st_ino, info.st_uid, info.st_gid,
            stat.S_IMODE(info.st_mode), info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns]


def directory(path):
    """Open every ancestor without following links, including intermediate ones."""
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'NONCANONICAL_PATH')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for name in path.parts[1:]:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                            dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


@dataclass(frozen=True)
class Image:
    raw: bytes
    identity: tuple

    @property
    def checksum(self):
        return sha(self.raw)


def read_image(path, owner, mode, limit=4 * 1024 * 1024):
    path = Path(path)
    parent = directory(path.parent)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                     dir_fd=parent)
        try:
            before = os.fstat(fd)
            need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                 and before.st_uid == owner and stat.S_IMODE(before.st_mode) == mode,
                 'FILE_TYPE_OWNER_MODE_LINK')
            need(before.st_size <= limit, 'FILE_SIZE_CAP')
            parts, total = [], 0
            while True:
                part = os.read(fd, min(65536, limit + 1 - total))
                if not part:
                    break
                parts.append(part)
                total += len(part)
                need(total <= limit, 'FILE_SIZE_CAP')
            now = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
            need(token(before) == token(os.fstat(fd)) == token(now), 'READ_CAS_DRIFT')
            return Image(b''.join(parts), tuple(token(now)))
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def runtime_profile(root, owner=0):
    """Read-only fixed byte/metadata closure check; does not execute these files.

    owner substitution is for nonroot fixture materialization only. It is not
    exposed by CLI and is not a substitute for root trust in a future collector.
    Unknown regular files, caches, links and additional directories are refused.
    """
    root = Path(root)
    expected = set(PROFILE)
    found = set()

    def walk(base, prefix=''):
        fd = directory(base)
        try:
            info = os.fstat(fd)
            need(info.st_uid == owner and stat.S_IMODE(info.st_mode) & 0o022 == 0,
                 'RUNTIME_DIRECTORY_TRUST')
            entries = os.listdir(fd)
            need(len(entries) <= 64, 'RUNTIME_INVENTORY_CAP')
            for name in entries:
                rel = prefix + name
                item = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISDIR(item.st_mode):
                    need(rel == 'live', 'RUNTIME_UNKNOWN_DIRECTORY')
                    walk(base / name, rel + '/')
                else:
                    need(rel in expected, 'RUNTIME_UNKNOWN_FILE')
                    image = read_image(base / name, owner, 0o644)
                    pin, size = PROFILE[rel]
                    need(image.checksum == pin and len(image.raw) == size,
                         'RUNTIME_PIN_DRIFT:' + rel)
                    need(image.identity[3] == (0 if owner == 0 else os.getgid()),
                         'RUNTIME_GROUP_DRIFT')
                    found.add(rel)
            need(token(info) == token(os.fstat(fd)), 'RUNTIME_INVENTORY_DRIFT')
        finally:
            os.close(fd)

    walk(root)
    need(found == expected, 'RUNTIME_INCOMPLETE_CLOSURE')
    return digest(PROFILE)


def classify(journal, checkpoint):
    """Closed structural proof of the pinned exhausted guard, NOT live clearance.

    The actual stage.py pin proves author/route/charge/repair/publish are after
    the attempt guard. Callers must separately prove execution of that closure,
    all pre-guard effects, process death and immutable local/remote candidate.
    Only the ordinary Cursor auto, source-only, pr_wait 1/1 case is supported.
    """
    keys(journal, 'confirmed deferred generation last operations pending profiles stage_counts',
         'JOURNAL_SCHEMA')
    keys(checkpoint, 'active done', 'CHECKPOINT_SCHEMA')
    need(type(checkpoint['done']) is list and all(positive(n) for n in checkpoint['done']),
         'DONE_SCHEMA')
    op_id = journal['pending']
    need(type(op_id) is str and HASH.fullmatch(op_id), 'NO_EXACT_PENDING_OPERATION')
    need(type(journal['operations']) is dict and op_id in journal['operations'], 'MISSING_OPERATION')
    op = journal['operations'][op_id]
    keys(op, 'after before binding checkpoint_before finished_at process read_attempts record '
             'result run run_attempt started_at task_hash', 'UNSUPPORTED_OPERATION_SCHEMA')
    binding = op['binding']
    keys(binding, 'action attempt generation head issue phase profile slot stage', 'BINDING_SCHEMA')
    need(digest(binding) == op_id and positive(journal['generation'])
         and type(binding['generation']) is int
         and binding['generation'] == journal['generation'], 'OPERATION_BINDING')
    need(binding['action'] == 'train' and binding['stage'] == 'author'
         and binding['phase'] == 'pr_wait' and binding['profile'] == 'auto'
         and binding['slot'] in ('slot1', 'slot2') and positive(binding['issue'])
         and type(binding['attempt']) is int and binding['attempt'] == 1
         and type(binding['head']) is str and SHA.fullmatch(binding['head']),
         'UNSUPPORTED_PRECALL_BRANCH')
    active = checkpoint['active']
    need(type(active) is dict, 'MISSING_ACTIVE')
    fields = set('approved_since attempt base ci ci_failure deterministic_failure fingerprint head '
                 'independent_qa_pending issue phase pr qa qa_equivalence qa_origin run task'.split())
    need(set(active) in (fields, fields | {'history'}), 'UNSUPPORTED_ACTIVE_SCHEMA')
    for name in ('issue', 'phase', 'attempt', 'head'):
        need(active.get(name) == binding[name] and type(active.get(name)) is type(binding[name]),
             'CHECKPOINT_BINDING:' + name)
    need(active.get('independent_qa_pending') is True and active.get('qa') is None
         and active.get('qa_origin') is None and active.get('qa_equivalence') is None
         and active.get('ci') is None and active.get('ci_failure') is None
         and active.get('run') is None, 'UNSUPPORTED_CHECKPOINT_STATE')
    need(type(active.get('base')) is str and SHA.fullmatch(active['base'])
         and positive(active.get('pr')) and type(active.get('fingerprint')) is str
         and HASH.fullmatch(active['fingerprint']), 'CANDIDATE_BINDINGS')
    task = active.get('task')
    need(type(task) is dict and task.get('schema') == 'GOBADMINTON_AUTONOMY_V1'
         and task.get('kind') == 'source_only' and task.get('target') == 'dev'
         and task.get('author_routes') == ['cursor:auto']
         and type(task.get('max_attempts')) is int and task['max_attempts'] == 1
         and isinstance(task.get('qa_routes'), list) and bool(task['qa_routes'])
         and 'routing_policy' in task, 'UNSUPPORTED_TASK')
    need(op['before'] == op['after'] == digest(checkpoint)
         and op['checkpoint_before'] == checkpoint and op['task_hash'] == digest(task),
         'CHECKPOINT_TASK_DRIFT')
    need(op['record'] == dict(issue=active['issue'],
                             allowed_paths=task.get('allowed_paths'),
                             depends_on=task.get('depends_on', []), locks=task.get('locks', [])),
         'TASK_RECORD_DRIFT')
    result = dict(status='unknown', reason='attempts exhausted', safe_release=False,
                  checkpoint=dict(issue=active['issue'], phase='pr_wait', head=active['head'],
                                  attempt=1, pr=active['pr'], ci_failure=None,
                                  ci=dict(id=None, sha=None),
                                  qa=dict(reviewed_sha=None, verdict=None), release_id=None))
    need(op['result'] == result, 'NOT_EXACT_EXHAUSTED_RESULT')
    keys(op['process'], 'boot pid start', 'PROCESS_IDENTITY_SCHEMA')
    need(positive(op['process']['pid']) and type(op['process']['start']) is str
         and re.fullmatch(r'[0-9]+', op['process']['start'])
         and type(op['process']['boot']) is str
         and re.fullmatch(r'[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}', op['process']['boot']),
         'PROCESS_IDENTITY')
    need(all(positive(op[n]) for n in ('run', 'run_attempt', 'started_at', 'finished_at'))
         and op['finished_at'] >= op['started_at'] and type(op['read_attempts']) is int
         and op['read_attempts'] == 1, 'OPERATION_LIFECYCLE')
    failure = active.get('deterministic_failure')
    keys(failure, 'failed head run run_attempt', 'MISSING_EXACT_DETERMINISTIC_FAILURE')
    need(failure['head'] == active['head'] and positive(failure['run'])
         and positive(failure['run_attempt']) and type(failure['failed']) is list
         and 0 < len(failure['failed']) <= 7, 'FAILURE_BINDING')
    names = set()
    for failed in failure['failed']:
        keys(failed, 'job steps', 'FAILURE_JOB_SCHEMA')
        need(failed['job'] in CI_JOBS and failed['job'] not in names
             and type(failed['steps']) is list and bool(failed['steps'])
             and all(type(s) is str and 0 < len(s) <= 2048 for s in failed['steps']),
             'FAILURE_JOB_BINDING')
        names.add(failed['job'])
    return dict(operation=op_id, operation_sha256=digest(op), binding=copy.deepcopy(binding),
                task_sha256=op['task_hash'], checkpoint_sha256=digest(checkpoint),
                runtime_profile_sha256=digest(PROFILE),
                classification='C5_EXHAUSTED_AUTHOR_PR_WAIT_PRECALL', live_clearance=False)


def exact_ci(proof, active, workflow_raw, workflow_sha256, *, branch=None):
    """Validate a bounded credential-free GET projection; never fetch or trust URLs.

    A future trusted collector must obtain current run, exact attempt, jobs,
    checks, workflow blob and latest exact-head run before taking locks, with
    bounded revalidation at commit. Caller-supplied JSON alone is not authority.
    """
    keys(proof, 'schema current attempt_run runs total_count jobs checks workflow_revision', 'CI_SCHEMA')
    need(proof['schema'] == 'GB_PRECALL_PRODUCT_CI_READS_V1'
         and proof['workflow_revision'] == active['head']
         and type(workflow_sha256) is str and HASH.fullmatch(workflow_sha256)
         and sha(workflow_raw) == workflow_sha256, 'CI_WORKFLOW_PROVENANCE')
    run = proof['attempt_run']
    need(type(run) is dict and positive(run.get('id')) and positive(run.get('run_attempt')),
         'CI_RUN_ID')
    for row in (run, proof['current']):
        need(type(row) is dict and row.get('id') == run['id']
             and positive(row.get('id')) and positive(row.get('run_attempt'))
             and row.get('run_attempt') == run['run_attempt']
             and row.get('head_sha') == active['head']
             and row.get('head_branch') == (branch or f'automation/issue-{active["issue"]}')
             and row.get('repository', {}).get('id') == REPO_ID
             and row.get('head_repository', {}).get('id') == REPO_ID
             and row.get('path') == '.github/workflows/ci.yml'
             and row.get('event') == 'push' and row.get('name') == 'Product CI'
             and row.get('status') == 'completed' and row.get('conclusion') == 'success',
             'CI_CURRENT_ATTEMPT_IDENTITY')
    failure = active['deterministic_failure']
    need((run['id'], run['run_attempt']) > (failure['run'], failure['run_attempt']),
         'CI_NOT_NEWER_THAN_SAVED_FAILURE')
    rows = proof['runs']
    need(type(rows) is list and type(proof['total_count']) is int
         and proof['total_count'] == len(rows) and 0 < len(rows) <= 20, 'CI_INCOMPLETE_RUN_LIST')
    need(all(type(r) is dict and positive(r.get('id')) and positive(r.get('run_attempt'))
             and r.get('head_sha') == active['head']
             and r.get('head_branch') == run['head_branch'] for r in rows), 'CI_RUN_LIST_IDENTITY')
    need(max((r['id'], r['run_attempt']) for r in rows) == (run['id'], run['run_attempt'])
         and len({(r['id'], r['run_attempt']) for r in rows}) == len(rows), 'CI_STALE_RUN')
    jobs, checks = proof['jobs'], proof['checks']
    need(type(jobs) is list and len(jobs) == 7 and type(checks) is list and len(checks) == 7,
         'CI_NOT_SEVEN_JOBS_CHECKS')
    need({j.get('name') for j in jobs} == CI_JOBS, 'CI_JOB_SET')
    seen_jobs, seen_checks = set(), set()
    projected = []
    for job in jobs:
        jid, cid = job.get('id'), job.get('check_run_id')
        need(positive(jid) and positive(cid) and jid not in seen_jobs and cid not in seen_checks
             and positive(job.get('run_id')) and positive(job.get('run_attempt'))
             and job.get('head_sha') == active['head'] and job.get('run_id') == run['id']
             and job.get('run_attempt') == run['run_attempt'] and job.get('status') == 'completed'
             and job.get('conclusion') == 'success', 'CI_JOB_IDENTITY')
        seen_jobs.add(jid)
        seen_checks.add(cid)
        matches = [c for c in checks if c.get('id') == cid]
        need(len(matches) == 1, 'CI_CHECK_DUPLICATE_OR_MISSING')
        check = matches[0]
        need(check.get('head_sha') == active['head'] and check.get('name') == job['name']
             and check.get('status') == 'completed' and check.get('conclusion') == 'success'
             and check.get('app', {}).get('slug') == 'github-actions'
             and check.get('details_url') == f'https://github.com/{REPO}/actions/runs/{run["id"]}/job/{jid}',
             'CI_CHECK_PROVENANCE')
        steps = job.get('steps')
        need(type(steps) is list and 0 < len(steps) <= 64
             and all(type(s) is dict and type(s.get('name')) is str
                     and positive(s.get('number')) and s.get('status') == 'completed'
                     and s.get('conclusion') in ('success', 'skipped') for s in steps)
             and len({s['number'] for s in steps}) == len(steps), 'CI_STEPS_INCOMPLETE')
        for required in REQUIRED_STEPS[job['name']]:
            matches = [s for s in steps if s['name'] == required]
            need(len(matches) == 1 and matches[0]['conclusion'] == 'success', 'CI_MANDATORY_STEP')
        projected.append(dict(id=jid, check_run_id=cid, name=job['name'],
                              steps_sha256=digest(steps)))
    return dict(id=run['id'], run_attempt=run['run_attempt'], sha=active['head'],
                workflow_sha256=workflow_sha256, workflow_revision=active['head'],
                jobs=sorted(projected, key=lambda j: j['name']), reads_sha256=digest(proof))


@dataclass(frozen=True)
class Plan:
    journal_before: bytes
    checkpoint_before: bytes
    journal_after: bytes
    checkpoint_after: bytes
    certificate: bytes


def transition(journal_raw, checkpoint_raw, ci_proof, workflow_raw, workflow_sha256):
    """Pure proposed delta; never occupancy release without actual exact-CI input."""
    journal, ja = canonical(journal_raw)
    checkpoint, ca = canonical(checkpoint_raw)
    certificate = classify(journal, checkpoint)
    active = checkpoint['active']
    ci = exact_ci(ci_proof, active, workflow_raw, workflow_sha256)
    need(not any(type(h) is dict and h.get('kind') == 'NO_AUTHOR_CI_REFRESH'
                 and h.get('operation') == certificate['operation']
                 for h in active.get('history', [])), 'EXISTING_RECONCILIATION')
    new_checkpoint = copy.deepcopy(checkpoint)
    new_active = new_checkpoint['active']
    receipt = dict(kind='NO_AUTHOR_CI_REFRESH', operation=certificate['operation'],
                   operation_sha256=certificate['operation_sha256'],
                   checkpoint_before_sha256=certificate['checkpoint_sha256'],
                   attempt=active['attempt'], head=active['head'], base=active['base'], pr=active['pr'],
                   original_deterministic_failure=copy.deepcopy(active['deterministic_failure']),
                   ci=ci, next_stage='qa', author_replay_authorized=False)
    need(type(active.get('history', [])) is list, 'HISTORY_SCHEMA')
    new_active['history'] = copy.deepcopy(active.get('history', [])) + [receipt]
    new_active['deterministic_failure'] = None
    new_journal = copy.deepcopy(journal)
    new_journal['generation'] += 1
    new_journal['pending'] = None
    # Strong invariant: the old object, result, last, counts, profiles and grants
    # are not reclassified. The only journal changes are gen and occupancy.
    need(new_journal['operations'] == journal['operations'], 'UNKNOWN_MUTATED')
    need({k: v for k, v in new_active.items() if k not in ('history', 'deterministic_failure')}
         == {k: v for k, v in active.items() if k not in ('history', 'deterministic_failure')},
         'EXCESS_CHECKPOINT_DELTA')
    certificate.update(transition=receipt, status='OFFLINE_PROPOSAL_ONLY')
    return Plan(journal_raw, checkpoint_raw, encode(new_journal, ja),
                encode(new_checkpoint, ca), encode(certificate))


def closed_acl(path):
    """Extended ACLs/capabilities are not covered by Unix mode proofs."""
    need(not any(n in ('system.posix_acl_access', 'system.posix_acl_default',
                       'security.capability') for n in os.listxattr(path, follow_symlinks=False)),
         'EXTENDED_AUTHORITY')


def trusted(path, uid=0, gid=0, mode=None):
    info = Path(path).lstat()
    need(not stat.S_ISLNK(info.st_mode) and info.st_uid == uid and info.st_gid == gid
         and not info.st_mode & 0o022 and (mode is None or stat.S_IMODE(info.st_mode) == mode),
         'PROTECTED_LAYOUT:' + str(path))
    closed_acl(path)
    return info


def bounded_command(argv, env, timeout=20, cap=16 * 1024 * 1024):
    """No shell; bounded drain of BOTH pipes, no credential/error echo."""
    output, total, deadline = [], 0, time.monotonic() + timeout
    with subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, env=env, start_new_session=True) as process:
        try:
            with selectors.DefaultSelector() as selector:
                for stream in (process.stdout, process.stderr):
                    selector.register(stream, selectors.EVENT_READ)
                while selector.get_map():
                    left = deadline - time.monotonic()
                    need(left > 0, 'READ_COMMAND_TIMEOUT')
                    for key, _ in selector.select(left):
                        raw = os.read(key.fileobj.fileno(), 65536)
                        if not raw:
                            selector.unregister(key.fileobj)
                            continue
                        total += len(raw)
                        need(total <= cap, 'READ_COMMAND_OVERSIZE')
                        if key.fileobj is process.stdout:
                            output.append(raw)
            need(process.wait(timeout=max(.001, deadline - time.monotonic())) == 0,
                 'READ_COMMAND_FAILED')
        finally:
            if process.poll() is None:
                # Only our bounded read-only helper's process group.
                import signal
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
    return b''.join(output)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Hold('GITHUB_REDIRECT')


class GitHubReads:
    """Fixed public repo, GET-only, no auth-file/env/token access or URL input.

    Uses the existing public unauthenticated OPS API pattern. Rate, permission,
    transport, redirect and oversize responses HOLD; no automatic rerun/mutation.
    Callers pass typed components to methods, never endpoint URLs from responses.
    """
    def __init__(self):
        self.open = urllib.request.build_opener(NoRedirect()).open
        self.calls = 0
        self.deadline = time.monotonic() + 120

    def get(self, endpoint):
        patterns = (
            r'', r'issues/[1-9][0-9]*', r'issues/[1-9][0-9]*/comments\?per_page=100&page=1',
            r'pulls/[1-9][0-9]*', r'pulls/[1-9][0-9]*/files\?per_page=100&page=1',
            r'actions/runs/[1-9][0-9]*(?:/attempts/[1-9][0-9]*(?:/jobs\?per_page=100&page=1)?)?',
            r'actions/workflows/ci.yml/runs\?head_sha=[0-9a-f]{40}&per_page=20&page=1',
            r'check-runs/[1-9][0-9]*',
            r'contents/\.github/workflows/ci.yml\?ref=[0-9a-f]{40}',
            r'git/commits/[0-9a-f]{40}',
        )
        need(type(endpoint) is str and any(re.fullmatch(p, endpoint) for p in patterns),
             'GITHUB_ENDPOINT_REFUSED')
        self.calls += 1
        need(self.calls <= 128 and time.monotonic() < self.deadline, 'GITHUB_BOUNDED_CALLS')
        request = urllib.request.Request('https://api.github.com/repos/' + REPO + '/' + endpoint,
            headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'gb-precall-ci-readonly',
                     'X-GitHub-Api-Version': '2022-11-28'}, method='GET')
        try:
            with self.open(request, timeout=min(15, max(.001, self.deadline - time.monotonic()))) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            need(len(raw) <= 2 * 1024 * 1024, 'GITHUB_OVERSIZE')
            return loads(raw)
        except urllib.error.HTTPError as error:
            raise Hold('GITHUB_HTTP_' + str(error.code)) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            raise Hold('GITHUB_TRANSPORT') from None

    def ci(self, active, run_id=None, branch=None):
        repo = self.get('')
        need(repo.get('id') == REPO_ID and repo.get('full_name') == REPO
             and repo.get('default_branch') == 'main', 'GITHUB_REPOSITORY')
        listing = self.get('actions/workflows/ci.yml/runs?head_sha=' + active['head'] + '&per_page=20&page=1')
        rows = listing.get('workflow_runs')
        need(type(rows) is list and 0 < len(rows) <= 20
             and listing.get('total_count') == len(rows), 'GITHUB_INCOMPLETE_RUNS')
        if run_id is None:
            run_id = max(r['id'] for r in rows)
        need(positive(run_id), 'GITHUB_RUN_ID')
        current = self.get(f'actions/runs/{run_id}')
        attempt = current.get('run_attempt')
        need(positive(attempt), 'GITHUB_ATTEMPT')
        run = self.get(f'actions/runs/{run_id}/attempts/{attempt}')
        data = self.get(f'actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100&page=1')
        jobs = data.get('jobs')
        need(type(jobs) is list and len(jobs) == data.get('total_count') == 7, 'GITHUB_INCOMPLETE_JOBS')
        checks = []
        jobs = copy.deepcopy(jobs)
        for job in jobs:
            # API jobs expose check_run_url, not check_run_id. Never fetch the URL.
            match = re.fullmatch('https://api.github.com/repos/' + re.escape(REPO)
                                + r'/check-runs/([1-9][0-9]*)', job.get('check_run_url', ''))
            need(match is not None, 'GITHUB_JOB_CHECK_ID')
            job['check_run_id'] = cid = int(match[1])
            checks.append(self.get(f'check-runs/{cid}'))
        wf = self.get('contents/.github/workflows/ci.yml?ref=' + active['head'])
        need(wf.get('encoding') == 'base64' and wf.get('path') == '.github/workflows/ci.yml',
             'GITHUB_WORKFLOW')
        try:
            workflow = base64.b64decode(''.join(wf['content'].split()), validate=True)
        except (ValueError, KeyError):
            raise Hold('GITHUB_WORKFLOW_ENCODING') from None
        need(len(workflow) <= 262144 and blob_oid(workflow) == wf.get('sha'), 'GITHUB_WORKFLOW_BLOB')
        proof = dict(schema='GB_PRECALL_PRODUCT_CI_READS_V1', current=current, attempt_run=run,
                     runs=rows, total_count=len(rows), jobs=jobs, checks=checks,
                     workflow_revision=active['head'])
        exact_ci(proof, active, workflow, sha(workflow), branch=branch)
        # Current attempt/list re-read after the seven checks closes rerun race.
        need(self.get(f'actions/runs/{run_id}') == current
             and self.get('actions/workflows/ci.yml/runs?head_sha=' + active['head']
                          + '&per_page=20&page=1') == listing, 'GITHUB_CURRENTNESS_DRIFT')
        return proof, workflow


def blob_oid(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


class SafeGit:
    """Read-only Git on a verified plain/standard linked worktree.

    Root-owned source runs root; slot-owned candidate runs its EXISTING owner
    through fixed runuser, never root safe.directory on candidate-controlled Git.
    Overrides are process-local. Native config is vetted before each invocation.
    """
    def __init__(self, work, uid=0, gid=0):
        self.work, self.uid, self.gid = Path(work), uid, gid

    def layout(self):
        trusted(self.work, self.uid, self.gid)
        dot = self.work / '.git'
        if stat.S_ISDIR(dot.lstat().st_mode):
            gd = common = dot
        else:
            raw = read_image(dot, self.uid, 0o644, 4096).raw.decode()
            need(re.fullmatch(r'gitdir: /[^\n\r\0]+\n?', raw), 'GIT_POINTER')
            gd = Path(raw[8:].strip())
            raw = read_image(gd / 'commondir', self.uid, 0o644, 4096).raw.decode().strip()
            common = Path(os.path.abspath(gd / raw))
            need(gd.parent.name == 'worktrees' and gd.parent.parent == common
                 and read_image(gd / 'gitdir', self.uid, 0o644, 4096).raw.decode().strip() == str(dot),
                 'GIT_COMMON_BACKLINK')
        for root in {common, gd}:
            trusted(root, self.uid, self.gid)
            if self.uid == 0:
                for ancestor in root.parents:
                    trusted(ancestor)
            for name in ('objects/info/alternates', 'objects/info/http-alternates', 'shallow',
                         'config.worktree', 'info/attributes', 'modules', 'refs/replace'):
                need(not os.path.lexists(root / name), 'GIT_INDIRECTION')
        config = read_image(common / 'config', self.uid, 0o644, 65536).raw
        section = None
        for line in config.decode().splitlines():
            line = line.strip()
            if not line or line.startswith(('#', ';')):
                continue
            header = re.fullmatch(r'\[(core|user)\]|\[(remote|branch) "[A-Za-z0-9_./-]+"\]', line)
            if header:
                section = header[1] or header[2]
                continue
            pair = re.fullmatch(r'([a-zA-Z]+)\s*=\s*([^\\\x00-\x1f]*)', line)
            allowed = {'core': {'repositoryformatversion': ('0',), 'bare': ('false',),
                               'filemode': ('true', 'false'), 'logallrefupdates': ('true',)},
                       'user': {'name': None, 'email': None},
                       'remote': {'url': None, 'fetch': None}, 'branch': {'remote': None, 'merge': None}}
            need(pair is not None and section in allowed, 'GIT_CONFIG_SYNTAX')
            key, value = pair[1].lower(), pair[2].strip()
            need(key in allowed[section] and (allowed[section][key] is None
                 or value.lower() in allowed[section][key]), 'GIT_CONFIG_KEY')
        count, deadline = 0, time.monotonic() + 20
        for root in {common, gd}:
            for base, dirs, files in os.walk(root, followlinks=False):
                count += len(dirs) + len(files)
                need(count <= 200000 and time.monotonic() < deadline, 'GIT_METADATA_CAP')
                trusted(base, self.uid, self.gid)
                for name in dirs:
                    trusted(Path(base) / name, self.uid, self.gid)
                for name in files:
                    path = Path(base) / name
                    info = trusted(path, self.uid, self.gid)
                    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'GIT_METADATA_TYPE')
                    if path.parent.name == 'hooks':
                        need(re.fullmatch(r'[a-z-]+\.sample', name), 'GIT_ACTIVE_HOOK')
        return gd, common

    def read(self, *args):
        allowed = (('rev-parse', '--verify', 'HEAD^{commit}'), ('symbolic-ref', '--short', 'HEAD'),
                   ('remote', 'get-url', 'origin'), ('ls-files', '-v', '-z'), ('ls-files', '-s', '-z'),
                   ('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=all'))
        need(args in allowed or (len(args) == 4 and args[:3] == ('ls-tree', '-r', '-z')
                                 and SHA.fullmatch(args[3]))
             or (len(args) == 3 and args[:2] == ('cat-file', 'blob') and SHA.fullmatch(args[2])),
             'GIT_ARGV_REFUSED')
        gd, _ = self.layout()
        trusted('/usr/bin/git', 0, 0)
        argv = ['/usr/bin/git', '--no-optional-locks', '--no-replace-objects',
                '--git-dir=' + str(gd), '--work-tree=' + str(self.work)]
        for setting in ('core.fsmonitor=false', 'core.hooksPath=/dev/null', 'core.untrackedCache=false',
                        'core.pager=cat', 'protocol.allow=never', 'gc.auto=0', 'maintenance.auto=false'):
            argv += ['-c', setting]
        if self.uid != os.geteuid():
            import pwd
            user = pwd.getpwuid(self.uid)
            need(user.pw_gid == self.gid, 'GIT_SLOT_IDENTITY')
            trusted('/usr/sbin/runuser', 0, 0)
            argv = ['/usr/sbin/runuser', '-u', user.pw_name, '--'] + argv
        env = dict(PATH='/usr/bin:/bin', HOME='/nonexistent', LANG='C.UTF-8',
                   GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_SYSTEM='/dev/null',
                   GIT_OPTIONAL_LOCKS='0', GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1',
                   GIT_TERMINAL_PROMPT='0')
        return bounded_command(argv + list(args), env)

    def clean(self, head, branch):
        need(SHA.fullmatch(head) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./-]*', branch)
             and '..' not in branch, 'GIT_EXACT_IDENTITY')
        need(self.read('rev-parse', '--verify', 'HEAD^{commit}').strip().decode() == head
             and self.read('symbolic-ref', '--short', 'HEAD').strip().decode() == branch,
             'GIT_HEAD_BRANCH')
        need(self.read('remote', 'get-url', 'origin').strip().decode() in
             ('https://github.com/' + REPO, 'https://github.com/' + REPO + '.git',
              'git@github.com:' + REPO + '.git'), 'GIT_ORIGIN')
        need(not self.read('status', '--porcelain=v1', '-z', '--untracked-files=all',
                           '--ignored=matching', '--ignore-submodules=all'), 'GIT_DIRTY')
        need(all(row.startswith(b'H ') for row in self.read('ls-files', '-v', '-z').split(b'\0') if row),
             'GIT_INDEX_FLAGS')
        tree, total, material = {}, 0, {}
        for row in self.read('ls-tree', '-r', '-z', head).split(b'\0'):
            if not row:
                continue
            header, raw_path = row.split(b'\t', 1)
            mode, kind, oid = header.split()
            path = raw_path.decode()
            need(mode in (b'100644', b'100755') and kind == b'blob' and SHA.fullmatch(oid.decode())
                 and not path.startswith('/') and all(p not in ('', '.', '..', '.git') for p in path.split('/'))
                 and path not in tree and len(tree) < 10000, 'GIT_TREE')
            image = read_image(self.work / path, self.uid, 0o755 if mode == b'100755' else 0o644,
                               16 * 1024 * 1024)
            closed_acl(self.work / path)
            raw = image.raw
            total += len(raw)
            need(total <= 256 * 1024 * 1024 and blob_oid(raw) == oid.decode(), 'GIT_RAW_BLOB')
            tree[path] = (mode, oid)
            material[path] = raw
        index = {}
        for row in self.read('ls-files', '-s', '-z').split(b'\0'):
            if row:
                header, path = row.split(b'\t', 1)
                mode, oid, stage = header.split()
                need(stage == b'0' and path.decode() not in index, 'GIT_INDEX_STAGE')
                index[path.decode()] = (mode, oid)
        need(tree == index, 'GIT_INDEX_TREE')
        return material


def stopped_processes(op, uid, proc=Path('/proc'), cgroups=Path('/sys/fs/cgroup')):
    """No argv/environ reads. Pinned supervisor setsid() makes pid==pgid==sid.

    Reject target UID writers as well as root children/group/session survivors.
    Scan stat/status only; read cgroups only for the target scope. Two scans are
    required under all locks. PID disappearance alone is never this proof.
    """
    process = op['process']
    boot = (proc / 'sys/kernel/random/boot_id').read_text().strip()
    need(boot == process['boot'], 'PROCESS_BOOT_CHANGED_RECONCILIATION_REQUIRED')

    def scan():
        found = {}
        deadline = time.monotonic() + 10
        entries = list(proc.iterdir())
        need(len(entries) <= 131072, 'PROCESS_COUNT_CAP')
        for entry in entries:
            need(time.monotonic() < deadline, 'PROCESS_SCAN_TIMEOUT')
            if not entry.name.isdigit():
                continue
            try:
                with (entry / 'stat').open('rb') as stream:
                    raw = stream.read(8193)
                need(len(raw) <= 8192, 'PROCESS_STAT_CAP')
                fields = raw.rsplit(b')', 1)[1].split()
                with (entry / 'status').open() as stream:
                    status = stream.read(65537)
                need(len(status) <= 65536, 'PROCESS_STATUS_CAP')
                uids = re.search(r'^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$', status, re.M)
                need(uids is not None, 'PROCESS_UID_MISSING')
                found[int(entry.name)] = (int(fields[1]), int(fields[2]), int(fields[3]),
                                         fields[19].decode(), tuple(map(int, uids.groups())))
            except FileNotFoundError:
                continue
            except (IndexError, ValueError):
                raise Hold('PROCESS_UNPARSEABLE') from None
        pid = process['pid']
        descendants = {pid}
        while True:
            more = {p for p, f in found.items() if f[0] in descendants}
            if more <= descendants:
                break
            descendants |= more
        scoped = {p: f for p, f in found.items()
                  if p in descendants or f[1] == pid or f[2] == pid or uid in f[4]}
        need(not scoped, 'TARGET_PROCESS_GROUP_SESSION_UID_OR_DESCENDANT_ALIVE')
        # The legacy unit cgroup alone is insufficient; inspect EVERY actual
        # cgroup.procs for target survivors (including inherited service scope).
        count = 0
        for base, dirs, files in os.walk(cgroups, followlinks=False):
            count += 1
            need(count <= 20000 and time.monotonic() < deadline, 'CGROUP_COUNT_CAP')
            need(all(not (Path(base) / d).is_symlink() for d in dirs), 'CGROUP_DIRECTORY_LINK')
            if 'cgroup.procs' in files:
                raw = (Path(base) / 'cgroup.procs').read_text()
                need(len(raw) <= 1024 * 1024, 'CGROUP_PROCS_CAP')
                members = {int(p) for p in raw.split()}
                need(not (members & descendants) and all(p not in scoped for p in members),
                     'TARGET_CGROUP_LIVE')
        return digest(dict(boot=boot, target=process, target_uid=uid, survivors=[]))

    first = scan()
    need(scan() == first, 'PROCESS_OBSERVATION_DRIFT')
    return first


class OfflineTransaction:
    """Shared two-file protocol with a deliberately nonroot synthetic harness.

    This constructor requires a fixture marker and cannot run as root. The
    protected adapter below supplies fixed paths, metadata policy and collectors;
    no CLI flag can substitute this constructor for those production gates.

    Fixed noncreating lock order: controller -> worker -> target lease ->
    registry. All are held nonblocking across manifest CAS and writes. External
    reads do not take place under these locks. The lease is never edited/reset.
    Forward writes: checkpoint first, scheduling journal last. Inverse: journal
    first, checkpoint last. Both pre/post pairs plus the immutable certificate
    are backed up before the first target write. Progress is inferred from
    predeclared staged inodes, never from a caller's claimed phase.
    """
    PREFIX = 'OFFLINE'
    def __init__(self, root, plan, boundary=None):
        self.root = Path(root)
        self.plan = plan
        self.boundary = boundary or (lambda _: None)
        need(os.getuid() == os.geteuid() != 0, 'OFFLINE_NONROOT_ONLY')
        self.uid, self.gid = os.getuid(), os.getgid()
        self.cert = loads(plan.certificate)
        self.slot = self.cert['binding']['slot']
        self.op = self.cert['operation']
        need(HASH.fullmatch(self.op), 'OFFLINE_OPERATION_ID')
        marker = read_image(self.root / 'synthetic.json', self.uid, 0o600)
        need(loads(marker.raw) == {'schema': 'GB_PRECALL_SYNTHETIC_ONLY_V1'}, 'OFFLINE_MARKER')
        self.targets = {
            'checkpoint': self.root / 'autonomy/slots' / self.slot / 'state.json',
            'journal': self.root / 'controller' / (self.slot + '.json'),
        }
        self.lock_paths = (
            (self.root / 'controller/controller.lock', 0o600),
            (self.root / 'autonomy/slots' / self.slot / 'worker.lock', 0o600),
            (self.root / 'autonomy/locks' / (self.slot + '.lease'), 0o644),
            (self.root / 'autonomy/locks/registry.lock', 0o640),
        )
        self.tx = self.root / 'controller' / ('precall-ci-' + self.op)
        self.before = dict(checkpoint=plan.checkpoint_before, journal=plan.journal_before)
        self.after = dict(checkpoint=plan.checkpoint_after, journal=plan.journal_after)
        self.plan_hash = digest({k: sha(getattr(plan, k)) for k in plan.__dataclass_fields__})
        self.target_write_started = False
        self.target_writes = 0

    def file_owner(self, path):
        return self.uid, self.gid

    def file_metadata(self, path, fd, mode):
        os.fchmod(fd, mode)

    def image(self, path, mode=0o600):
        owner, group = self.file_owner(path)
        image = read_image(path, owner, mode)
        need(image.identity[3] == group, 'FILE_GROUP_DRIFT')
        return image

    def effect(self, name, fn):
        self.boundary('before:' + name)
        value = fn()
        self.boundary('after:' + name)
        return value

    @contextlib.contextmanager
    def locks(self):
        held = []
        try:
            for path, mode in self.lock_paths:
                image = self.image(path, mode)
                parent = directory(path.parent)
                try:
                    fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                                 dir_fd=parent)
                finally:
                    os.close(parent)
                held.append((path, mode, fd, image))
                need(tuple(token(os.fstat(fd))) == image.identity, 'LOCK_INODE_CAS')
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise Hold('LOCK_HELD:' + path.name) from None
                need(self.image(path, mode) == image, 'LOCK_PATH_CAS')
            yield
            for path, mode, fd, image in held:
                need(tuple(token(os.fstat(fd))) == image.identity
                     and self.image(path, mode) == image, 'LOCK_CHANGED')
        finally:
            for _, _, fd, _ in reversed(held):
                os.close(fd)

    def manifest(self):
        out, total = {}, 0

        def walk(path):
            nonlocal total
            if path == self.tx:
                return
            fd = directory(path)
            try:
                initial = os.fstat(fd)
                need(initial.st_uid == self.uid and stat.S_IMODE(initial.st_mode) & 0o022 == 0,
                     'OFFLINE_DIRECTORY_TRUST')
                key = str(path.relative_to(self.root))
                out[key + '/'] = token(initial)[:5]
                names = os.listdir(fd)
                need(len(names) <= 10000, 'MANIFEST_COUNT_CAP')
                for name in names:
                    child = path / name
                    if child == self.tx:
                        continue
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        walk(child)
                    else:
                        need(stat.S_ISREG(info.st_mode), 'MANIFEST_UNSAFE_ENTRY')
                        image = read_image(child, self.uid, stat.S_IMODE(info.st_mode))
                        total += len(image.raw)
                        need(len(out) < 20000 and total <= 64 * 1024 * 1024, 'MANIFEST_CAP')
                        out[str(child.relative_to(self.root))] = [image.checksum, list(image.identity)]
                need(token(initial) == token(os.fstat(fd)), 'MANIFEST_DIRECTORY_DRIFT')
            finally:
                os.close(fd)

        walk(self.root)
        return out

    def preserved(self):
        value = self.manifest()
        for path in self.targets.values():
            value.pop(str(path.relative_to(self.root)))
        return value

    def fsync(self, path, name):
        fd = directory(path)
        try:
            self.effect(name, lambda: os.fsync(fd))
        finally:
            os.close(fd)

    def artifact(self, name, raw, mode=0o600):
        """Create immutable durable backup/intent/stage; never overwrite artifacts.

        A crash may leave an exact prefix at the fixed private artifact name.
        Under all four locks, append only the predetermined missing suffix;
        never truncate, replace, delete or reinterpret foreign artifact bytes.
        """
        path = self.tx / name
        if os.path.lexists(path):
            self.prepare_artifact(path, raw, mode)
            image = self.image(path, mode)
            need(raw.startswith(image.raw), 'PARTIAL_OR_FOREIGN_ARTIFACT:' + name)
            # A previous process may have died after data but before fsync.
            # Exact bytes in page cache are not yet a durable backup/intent.
            parent = directory(self.tx)
            try:
                fd = os.open(name, os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
                try:
                    need(tuple(token(os.fstat(fd))) == image.identity, 'ARTIFACT_REENTRY_CAS')
                    os.lseek(fd, len(image.raw), os.SEEK_SET)
                    view = memoryview(raw)[len(image.raw):]
                    while view:
                        count = self.effect(name + ':resume_data', lambda: os.write(fd, view))
                        need(count > 0, 'SHORT_WRITE')
                        view = view[count:]
                    self.effect(name + ':reentry_fsync', lambda: os.fsync(fd))
                finally:
                    os.close(fd)
            finally:
                os.close(parent)
            self.fsync(self.tx, name + ':reentry_directory_fsync')
            image = self.image(path, mode)
            need(image.raw == raw, 'ARTIFACT_REENTRY_BYTES')
            return image
        parent = directory(self.tx)
        fd = None
        try:
            self.boundary('before:' + name + ':create')
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                         mode, dir_fd=parent)
            self.boundary('after:' + name + ':create')
            self.effect(name + ':metadata', lambda: self.file_metadata(path, fd, mode))
            # Preserve exact fixture uid/gid. No privilege substitution.
            need((os.fstat(fd).st_uid, os.fstat(fd).st_gid) == self.file_owner(path),
                 'ARTIFACT_OWNER_GROUP')
            view = memoryview(raw)
            while view:
                count = self.effect(name + ':data', lambda: os.write(fd, view))
                need(count > 0, 'SHORT_WRITE')
                view = view[count:]
            self.effect(name + ':fsync', lambda: os.fsync(fd))
        finally:
            if fd is not None:
                os.close(fd)
            os.close(parent)
        self.fsync(self.tx, name + ':directory_fsync')
        return self.image(path, mode)

    def prepare_artifact(self, path, raw, mode):
        pass

    def existing(self, name):
        return loads(self.image(self.tx / name).raw)

    def make_intent(self):
        if os.path.lexists(self.tx / 'intent.json'):
            try:
                loads(self.image(self.tx / 'intent.json').raw)
            except Hold as error:
                need(str(error) == 'INVALID_JSON', 'INTENT_NOT_PARTIAL_JSON')
                # No target write can start before a complete durable intent.
                # Reconstruct from the still-exact originals and staged inodes.
            else:
                intent, backup = self.checked_intent()
                # The process could have died after writing complete JSON but
                # before its fsync. Reentry reestablishes durability first.
                self.artifact('backup.json', encode(backup))
                self.artifact('intent.json', encode(intent))
                return intent, backup
        originals = {n: self.image(p) for n, p in self.targets.items()}
        need(all(originals[n].raw == self.before[n] for n in originals), 'PREIMAGE_DRIFT')
        preserved = self.preserved()
        if not os.path.lexists(self.tx):
            self.effect('backup_directory:mkdir', lambda: self.tx.mkdir(mode=0o700))
            self.fsync(self.tx.parent, 'backup_directory:fsync')
        fd = directory(self.tx)
        try:
            info = os.fstat(fd)
            need(info.st_uid == self.uid and stat.S_IMODE(info.st_mode) == 0o700,
                 'BACKUP_DIRECTORY_TRUST')
        finally:
            os.close(fd)
        self.fsync(self.tx.parent, 'backup_directory:reentry_fsync')
        backup = dict(schema=SCHEMA, plan_sha256=self.plan_hash,
                      certificate=self.plan.certificate.decode(),
                      before={n: raw.decode() for n, raw in self.before.items()},
                      after={n: raw.decode() for n, raw in self.after.items()},
                      originals={n: list(i.identity) for n, i in originals.items()},
                      preserved=preserved)
        self.artifact('backup.json', encode(backup))
        staged = {}
        for direction, images in (('forward', self.after), ('inverse', self.before)):
            staged[direction] = {n: list(self.artifact(direction + '-' + n, raw).identity)
                                 for n, raw in images.items()}
        need(self.preserved() == preserved and all(self.image(self.targets[n])
             == originals[n] for n in originals), 'PRE_INTENT_CAS_DRIFT')
        intent = dict(schema=SCHEMA, plan_sha256=self.plan_hash,
                      backup_sha256=digest(backup), staged=staged)
        self.artifact('intent.json', encode(intent))
        return self.checked_intent()

    def checked_intent(self):
        intent, backup = self.existing('intent.json'), self.existing('backup.json')
        keys(intent, 'schema plan_sha256 backup_sha256 staged', 'INTENT_SCHEMA')
        keys(backup, 'schema plan_sha256 certificate before after originals preserved', 'BACKUP_SCHEMA')
        need(intent['schema'] == backup['schema'] == SCHEMA
             and intent['plan_sha256'] == backup['plan_sha256'] == self.plan_hash
             and intent['backup_sha256'] == digest(backup)
             and backup['certificate'] == self.plan.certificate.decode()
             and backup['before'] == {n: r.decode() for n, r in self.before.items()}
             and backup['after'] == {n: r.decode() for n, r in self.after.items()}, 'BACKUP_PLAN_DRIFT')
        keys(intent['staged'], 'forward inverse', 'INTENT_STAGE_SCHEMA')
        for direction in intent['staged'].values():
            keys(direction, 'checkpoint journal', 'INTENT_TARGET_SCHEMA')
            need(all(type(v) is list and len(v) == 9 and all(type(i) is int for i in v)
                     for v in direction.values()), 'INTENT_INODE_SCHEMA')
        need(self.preserved() == backup['preserved'], 'PRESERVED_STATE_DRIFT')
        return intent, backup

    def position(self, name, intent, backup):
        image = self.image(self.targets[name])
        if list(image.identity) == backup['originals'][name] and image.raw == self.before[name]:
            return 'original'
        # Rename updates ctime. The inode/mode/uid/gid/size/mtime was committed
        # in the durable intent BEFORE rename. A later Store atomic write has a
        # different inode, even if its JSON or generation happens to match.
        for direction, expected in (('forward', self.after), ('inverse', self.before)):
            if list(image.identity[:8]) == intent['staged'][direction][name][:8] and image.raw == expected[name]:
                return direction
        raise Hold('TARGET_INODE_OR_CONTENT_CAS:' + name)

    def move(self, name, direction, intent, backup):
        expected = self.after if direction == 'forward' else self.before
        source = self.tx / (direction + '-' + name)
        image = self.image(source)
        need(list(image.identity) == intent['staged'][direction][name]
             and image.raw == expected[name], 'STAGED_INODE_CAS')
        need(self.preserved() == backup['preserved'], 'PRE_RENAME_PRESERVED_DRIFT')
        positions = {n: self.position(n, intent, backup) for n in self.targets}
        need(positions[name] in (('original',) if direction == 'forward' else ('original', 'forward')),
             'UNSUPPORTED_TRANSACTION_DIRECTION')
        src_fd, dst_fd = directory(self.tx), directory(self.targets[name].parent)
        try:
            self.effect(direction + ':' + name + ':rename', lambda: os.replace(
                source.name, self.targets[name].name, src_dir_fd=src_fd, dst_dir_fd=dst_fd))
            self.effect(direction + ':' + name + ':target_fsync', lambda: os.fsync(dst_fd))
            self.effect(direction + ':' + name + ':source_fsync', lambda: os.fsync(src_fd))
        finally:
            os.close(dst_fd)
            os.close(src_fd)
        need(self.position(name, intent, backup) == direction, 'POST_RENAME_CAS')

    def execute(self, action):
        need(action in ('dry', 'apply', 'verify', 'rollback'), 'OFFLINE_ACTION')
        with self.locks():
            if action == 'dry':
                need(not os.path.lexists(self.tx), 'EXISTING_TRANSACTION_USE_VERIFY')
                for name, path in self.targets.items():
                    need(self.image(path).raw == self.before[name], 'PREIMAGE_DRIFT')
                first = self.manifest()
                need(self.manifest() == first, 'UNSTABLE_MANIFEST')
                return dict(status=self.PREFIX + '_DRY', protected_writes=0, live_clearance=False)
            if action == 'apply':
                need(not os.path.lexists(self.tx / 'rollback-intent.json'), 'ROLLBACK_ALREADY_REQUESTED')
                intent, backup = self.make_intent()
                positions = {n: self.position(n, intent, backup) for n in self.targets}
                need(set(positions.values()) <= {'original', 'forward'}, 'APPLY_AFTER_ROLLBACK')
                for name in ('checkpoint', 'journal'):
                    if positions[name] == 'original':
                        self.move(name, 'forward', intent, backup)
                # Reentry after rename but before parent fsync must not skip
                # the durability barrier merely because the postimage exists.
                for name in ('checkpoint', 'journal'):
                    self.fsync(self.targets[name].parent, 'forward:' + name + ':commit_fsync')
                self.artifact('complete.json', encode(dict(plan_sha256=self.plan_hash,
                                                          operation=self.op, status=self.PREFIX + '_COMPLETE')))
            elif action == 'rollback':
                intent, backup = self.checked_intent()
                positions = {n: self.position(n, intent, backup) for n in self.targets}
                self.artifact('rollback-intent.json', encode(dict(plan_sha256=self.plan_hash,
                                                                 operation=self.op)))
                for name in ('journal', 'checkpoint'):
                    if positions[name] == 'forward':
                        self.move(name, 'inverse', intent, backup)
                for name in ('journal', 'checkpoint'):
                    self.fsync(self.targets[name].parent, 'inverse:' + name + ':commit_fsync')
                self.artifact('rolled-back.json', encode(dict(plan_sha256=self.plan_hash,
                                                             operation=self.op, status=self.PREFIX + '_ROLLED_BACK')))
            else:
                intent, backup = self.checked_intent()
                need(not os.path.lexists(self.tx / 'rollback-intent.json'), 'ROLLBACK_ALREADY_REQUESTED')
                need(self.existing('complete.json') == dict(plan_sha256=self.plan_hash,
                     operation=self.op, status=self.PREFIX + '_COMPLETE'), 'INCOMPLETE_TRANSACTION')
            intent, backup = self.checked_intent()
            positions = {n: self.position(n, intent, backup) for n in self.targets}
            need(set(positions.values()) <= ({'original', 'inverse'} if action == 'rollback' else {'forward'}),
                 'POST_TRANSACTION_POSITION')
            return dict(status=self.PREFIX + '_ROLLED_BACK' if action == 'rollback' else self.PREFIX + '_COMPLETE',
                        live_clearance=False, model_calls=0)


@dataclass(frozen=True)
class Layout:
    controller: Path = Path('/var/lib/gobadminton-actions-train')
    autonomy: Path = Path('/var/lib/gobadminton-autonomy')
    runtime: Path = Path('/usr/local/lib/gb-actions-train')
    policy: Path = Path('/etc/gobadminton-actions-train/policy.json')
    proc: Path = Path('/proc')
    cgroups: Path = Path('/sys/fs/cgroup')
    worktrees: Path = Path('/srv/gb-slots/slot1/worktrees')
    system: Path = Path('/')


def pinned_next_qa(core_raw, active):
    """Execute only the exact pinned planner function, never candidate modules."""
    need(sha(core_raw) == PROFILE['core.py'][0], 'PLANNER_SOURCE_PIN')
    tree = ast.parse(core_raw)
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'next_stage']
    need(len(functions) == 1 and active.get('deterministic_failure') is None
         and active.get('phase') == 'pr_wait', 'PLANNER_INPUT')
    # next_stage imports failure_diagnosis before its pr_wait branch. Supply only
    # a sealed module whose callable MUST remain unreachable for this input.
    import types
    def forbidden(*args, **kwargs):
        raise Hold('PLANNER_REPAIR_ROUTE_REACHABLE')
    module = types.ModuleType('failure_diagnosis')
    module.next_stage = forbidden
    def importer(name, *args, **kwargs):
        need(name == 'failure_diagnosis', 'PLANNER_IMPORT')
        return module
    namespace = {'__builtins__': {'__import__': importer}}
    exec(compile(ast.Module(body=functions, type_ignores=[]), '<pinned-c5-next-stage>', 'exec'), namespace)
    need(namespace['next_stage'](copy.deepcopy(active)) == 'qa', 'ACTUAL_C5_NEXT_STAGE_NOT_QA')


def owner_task(api, active):
    issue = api.get(f'issues/{active["issue"]}')
    need(issue.get('number') == active['issue'] and issue.get('state') == 'open'
         and 'pull_request' not in issue and issue.get('user', {}).get('id') == 318610566,
         'IMMUTABLE_OWNER_ISSUE')
    immutable = {k: issue[k] for k in ('number', 'body', 'user', 'created_at')}
    # Native fingerprint uses normal sorted JSON (not core.digest's compact JSON).
    need(sha(encode(immutable)) == active['fingerprint'], 'OWNER_ISSUE_FINGERPRINT')
    marker, separator, raw = issue.get('body', '').partition('\n')
    need(marker == 'GOBADMINTON_AUTONOMY_V1' and separator
         and loads(raw) == active['task'], 'RAW_OWNER_TASK_DRIFT')
    comments = api.get(f'issues/{active["issue"]}/comments?per_page=100&page=1')
    need(type(comments) is list and len(comments) < 100, 'OWNER_COMMENTS_INCOMPLETE')
    # This closed class is a body-admission task. A later Owner authorization
    # marker is a conflict, not permission to silently replace the old task.
    for comment in comments:
        need(not (comment.get('user', {}).get('id') == 318610566
                  and any(comment.get('body', '').startswith(marker) for marker in
                          ('GOBADMINTON_AUTONOMY_V1', 'GOBADMINTON_RESUME_V1', 'GOBADMINTON_PARK_V1'))),
             'COMPETING_OWNER_ADMISSION')
    pr = api.get(f'pulls/{active["pr"]}')
    need(pr.get('number') == active['pr'] and pr.get('state') == 'open' and not pr.get('merged')
         and pr.get('head', {}).get('sha') == active['head']
         and pr.get('head', {}).get('ref') == f'automation/issue-{active["issue"]}'
         and pr.get('head', {}).get('repo', {}).get('id') == REPO_ID
         and pr.get('base', {}).get('repo', {}).get('id') == REPO_ID
         and pr.get('base', {}).get('ref') == 'dev', 'CURRENT_PR_IDENTITY')
    commit = api.get('git/commits/' + active['head'])
    need(commit.get('sha') == active['head']
         and [p.get('sha') for p in commit.get('parents', [])] == [active['base']], 'CANDIDATE_PARENT')
    files = api.get(f'pulls/{active["pr"]}/files?per_page=100&page=1')
    need(type(files) is list and len(files) == pr.get('changed_files') and 0 < len(files) < 100,
         'PR_FILES_INCOMPLETE')
    allowed = active['task']['allowed_paths']
    # Exact paths only for this closed ordinary no-author class. No glob expansion.
    need(all(type(p) is str and not re.search(r'[*?\[\]]', p) for p in allowed)
         and set(f.get('filename') for f in files) <= set(allowed)
         and all(f.get('status') in ('added', 'modified', 'removed') for f in files), 'CANDIDATE_SCOPE')
    return digest(dict(issue=issue, comments=comments, pr=pr, commit=commit, files=files))


def source_release(bundle, commit, branch, qa_path, ci_run, api):
    """Existing OPS packaging boundary: root ownership is required, insufficient.

    Raw tree/index/self bytes, exact independent QA receipt and fresh mandatory
    Product CI are all checked. This does not create/approve the receipt or GO.
    The integrator supplies the reviewed receipt via its existing trusted path.
    """
    for path in (Path(bundle), *Path(bundle).parents, Path(qa_path), *Path(qa_path).parents):
        trusted(path)
    git = SafeGit(bundle)
    material = git.clean(commit, branch)
    need(SOURCE_PATH in material and TEST_PATH in material, 'SOURCE_BUNDLE_INCOMPLETE')
    self_image = read_image(Path(__file__).absolute(), 0, 0o644)
    need(material[SOURCE_PATH] == self_image.raw, 'EXECUTING_SELF_NOT_REVIEWED_BLOB')
    qa = loads(read_image(qa_path, 0, 0o600).raw)
    keys(qa, 'schema repo reviewed_sha verdict role risk author_session reviewer_session files',
         'SOURCE_QA_RECEIPT_SCHEMA')
    need(qa['schema'] == 'GB_PRECALL_SOURCE_QA_V1' and qa['repo'] == REPO
         and qa['reviewed_sha'] == commit and qa['verdict'] == 'PASS'
         and qa['role'] == 'independent_source_qa' and qa['risk'] == 'critical'
         and type(qa['author_session']) is str and qa['author_session']
         and type(qa['reviewer_session']) is str and qa['reviewer_session']
         and qa['reviewer_session'] != qa['author_session']
         and qa['files'] == {p: sha(material[p]) for p in (SOURCE_PATH, TEST_PATH)},
         'SOURCE_QA_EXACT_INDEPENDENT_RECEIPT')
    active = dict(head=commit, issue=1, deterministic_failure=dict(run=0, run_attempt=0))
    proof, workflow = api.ci(active, ci_run, branch)
    need(material.get('.github/workflows/ci.yml') == workflow, 'SOURCE_CI_WORKFLOW_BLOB')
    return digest(dict(commit=commit, branch=branch, qa=qa,
                       files={p: sha(raw) for p, raw in material.items()}, ci=proof))


class ProtectedTransaction(OfflineTransaction):
    """Actual fixed-layout adapter over the same crash-safe two-file protocol.

    Construction/CLI offers no substituted uid, layout, pin, proof or force flag.
    Tests instantiate internal objects with synthetic paths and identities only.
    All four noncreating locks are retained through currentness/CAS and writes.
    """
    PREFIX = 'PROTECTED'
    def __init__(self, layout, plan, collector, boundary=None):
        need(os.getuid() == os.geteuid() == 0, 'ROOT_OPS_IDENTITY_REQUIRED')
        self.root, self.layout, self.plan = layout.controller, layout, plan
        self.collector = collector
        self.boundary = boundary or (lambda _: None)
        self.uid = self.gid = 0
        self.cert = loads(plan.certificate)
        self.slot, self.op = self.cert['binding']['slot'], self.cert['operation']
        # Fixed class currently proved only for installed Slot1 UID1002 layout.
        need(self.slot == 'slot1', 'UNQUALIFIED_SLOT_LAYOUT')
        self.targets = dict(checkpoint=layout.autonomy / 'slots/slot1/state.json',
                            journal=layout.controller / 'slot1.json')
        self.lock_paths = ((layout.controller / 'controller.lock', 0o600),
                           (layout.autonomy / 'slots/slot1/worker.lock', 0o600),
                           (layout.autonomy / 'locks/slot1.lease', 0o644),
                           (layout.autonomy / 'locks/registry.lock', 0o640))
        self.tx = layout.controller / ('precall-ci-' + self.op)
        self.before = dict(checkpoint=plan.checkpoint_before, journal=plan.journal_before)
        self.after = dict(checkpoint=plan.checkpoint_after, journal=plan.journal_after)
        self.plan_hash = digest({k: sha(getattr(plan, k)) for k in plan.__dataclass_fields__})

    def file_owner(self, path):
        path = Path(path)
        if path in (self.targets['checkpoint'], self.lock_paths[1][0]):
            return 1002, 1002
        if path == self.lock_paths[2][0]:
            return 1002, 65042
        if path == self.lock_paths[3][0]:
            return 0, 65042
        if path.parent == self.tx and path.name in ('forward-checkpoint', 'inverse-checkpoint'):
            return 1002, 1002
        return 0, 0

    def file_metadata(self, path, fd, mode):
        os.fchown(fd, *self.file_owner(path))
        os.fchmod(fd, mode)

    def prepare_artifact(self, path, raw, mode):
        if path.name not in ('forward-checkpoint', 'inverse-checkpoint'):
            return
        meta = path.lstat()
        if (meta.st_uid, meta.st_gid) == self.file_owner(path):
            return
        need(not os.path.lexists(self.tx / 'intent.json'), 'STAGED_METADATA_AFTER_INTENT')
        # Crash between exclusive create and fchown: only an exact prefix in the
        # private root directory, before durable intent, can have metadata fixed.
        image = read_image(path, 0, mode)
        need(image.identity[3] == 0 and raw.startswith(image.raw), 'STAGED_PARTIAL_METADATA')
        fd = os.open(path, os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            need(tuple(token(os.fstat(fd))) == image.identity, 'STAGED_PARTIAL_CAS')
            self.file_metadata(path, fd, mode)
            os.fsync(fd)
        finally:
            os.close(fd)

    def make_intent(self):
        result = super().make_intent()
        self.artifact('live-attestation.json', encode(dict(
            schema='GB_PRECALL_CI_LIVE_OBSERVATIONS_V1',
            source_release=self.collector.release_hash,
            local=self.collector.local_evidence, remote_sha256=self.collector.remote_digest)))
        return result

    def image(self, path, mode=0o600):
        if Path(path).parent == self.tx:
            trusted(self.tx, 0, 0, 0o700)
        closed_acl(path)
        return super().image(path, mode)

    def manifest(self):
        result, count, total = {}, 0, 0
        # Only state trees, NEVER /etc credentials, slot home, argv or env.
        for label, root in (('controller', self.layout.controller), ('autonomy', self.layout.autonomy)):
            for base, dirs, files in os.walk(root, followlinks=False):
                path = Path(base)
                dirs[:] = sorted(d for d in dirs if path / d != self.tx)
                need(all(not (path / d).is_symlink() for d in dirs), 'STATE_DIRECTORY_LINK')
                info = path.lstat()
                need(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, 1002, 978)
                     and (not info.st_mode & 0o022 or path == self.layout.autonomy / 'locks'
                          and stat.S_IMODE(info.st_mode) == 0o1770), 'STATE_DIRECTORY_TRUST')
                closed_acl(path)
                key = label + '/' + str(path.relative_to(root))
                result[key + '/'] = token(info)[:5]
                for name in sorted(files):
                    item = path / name
                    meta = item.lstat()
                    need(meta.st_uid in (0, 1002, 978) and not meta.st_mode & 0o022,
                         'STATE_FILE_TRUST')
                    image = read_image(item, meta.st_uid, stat.S_IMODE(meta.st_mode), 32 * 1024 * 1024)
                    closed_acl(item)
                    count += 1
                    total += len(image.raw)
                    need(count <= 50000 and total <= 256 * 1024 * 1024, 'PROTECTED_MANIFEST_CAP')
                    result[label + '/' + str(item.relative_to(root))] = [image.checksum, list(image.identity)]
                need(token(info) == token(path.lstat()), 'STATE_DIRECTORY_RACE')
        return result

    def preserved(self):
        result = self.manifest()
        result.pop('controller/slot1.json')
        result.pop('autonomy/slots/slot1/state.json')
        return result

    def effect(self, name, fn):
        # Locks already held. The collector proves local layout/process/accounting
        # unchanged immediately before either target rename, including rollback.
        if name.endswith(':rename'):
            self.collector.local()
            if self.action != 'rollback':
                self.collector.current()
            active = loads(self.after['checkpoint'])['active']
            pinned_next_qa(self.collector.core_raw, active)
            self.target_write_started = True
        result = super().effect(name, fn)
        if name.endswith(':rename'):
            self.target_writes += 1
        return result

    def execute(self, action):
        self.target_write_started = False
        self.target_writes = 0
        try:
            return self.guarded_execute(action)
        except (Hold, OSError) as error:
            reason = str(error) if isinstance(error, Hold) else type(error).__name__
            raise TransactionHold(reason, 'UNKNOWN_CHECK_DURABLE_INTENT'
                                  if self.target_write_started else 0) from None

    def guarded_execute(self, action):
        # Acquire once here. super().execute uses locks() reentrantly via the
        # context marker, never a second independent descriptor/flock.
        with super().locks():
            self.action = action
            self.collector.local()
            if action != 'rollback':
                self.collector.current()
            self._held = True
            try:
                result = super().execute(action)
                self.collector.local()
            finally:
                self._held = False
        result['status'] = result['status'].replace('OFFLINE_', 'PROTECTED_')
        result['live_clearance'] = action in ('apply', 'verify')
        result['target_metadata_writes'] = self.target_writes
        return result

    @contextlib.contextmanager
    def locks(self):
        need(getattr(self, '_held', False), 'ALL_LOCKS_REQUIRED')
        yield


class LiveCollector:
    def __init__(self, layout, plan, api, release_hash=None, release_guard=None):
        self.layout, self.plan, self.api = layout, plan, api
        self.original = loads(plan.journal_before)
        self.checkpoint = loads(plan.checkpoint_before)
        self.cert = classify(self.original, self.checkpoint)
        self.op = self.original['operations'][self.cert['operation']]
        self.core_raw = b''
        self.local_digest = None
        self.remote_digest = None
        self.release_hash, self.release_guard = release_hash, release_guard

    def public_configuration(self):
        result = {}
        base = self.layout.system / 'etc/gobadminton-slots'
        for name in ('budgets.json', 'continuity.json', 'cursor-author.json'):
            path = base / name
            trusted(path.parent)
            info = trusted(path)
            need(stat.S_IMODE(info.st_mode) in (0o600, 0o644), 'PUBLIC_CONFIG_MODE')
            image = read_image(path, 0, stat.S_IMODE(info.st_mode), 65536)
            data = loads(image.raw)
            need(type(data) is dict, 'PUBLIC_CONFIG_SCHEMA')
            if name == 'cursor-author.json':
                need(data.get('schema') == 'GB_CURSOR_AUTHOR_211_V1'
                     and data.get('phase') in ('canary', 'ready') and 'slot1' in data.get('slots', [])
                     and (data['phase'] == 'ready' or data.get('canary_task_sha256') == self.op['task_hash'])
                     and all(data.get('modules', {}).get(p) == PROFILE[p][0]
                             for p in ('native_cursor.py', 'native_guard.py')), 'CURSOR_QUALIFICATION')
            elif name == 'continuity.json':
                need(data.get('schema') == 'GB_SLOT_CONTINUITY_V1' and data.get('enabled') is True,
                     'CONTINUITY_DISABLED')
            else:
                need(set(data) <= {'schema', 'providers', 'slots'}
                     and all(type(data.get(n, {})) is dict for n in ('providers', 'slots')), 'BUDGET_SCHEMA')
            result[name] = [image.checksum, list(image.identity)]
        need(not os.path.lexists(base / 'continuity.pending'), 'INSTALL_ACTIVATION_PENDING')
        return result

    def legacy_quiet(self):
        # Only the target legacy scope; the unrelated paid Slot2 UNKNOWN is not
        # an installer-wide idle requirement and is never cleared here.
        trusted('/usr/bin/systemctl')
        observations = {}
        for unit in ('gobadminton-supervisor.service', 'gobadminton-slot@slot1.service'):
            raw = bounded_command(['/usr/bin/systemctl', 'show', unit,
                '--property=ActiveState,MainPID,ControlGroup'], dict(PATH='/usr/bin:/bin', LANG='C.UTF-8'))
            values = dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)
            need(values.get('ActiveState') == 'inactive' and values.get('MainPID') == '0', 'LEGACY_WRITER_ACTIVE')
            group = values.get('ControlGroup')
            need(type(group) is str and (not group or group.startswith('/') and '..' not in group.split('/')),
                 'LEGACY_CGROUP_PATH')
            if group:
                path = self.layout.cgroups / group.lstrip('/')
                if path.exists():
                    for item in path.rglob('cgroup.procs'):
                        need(not item.read_text().split(), 'LEGACY_CGROUP_LIVE')
            observations[unit] = values
        return observations

    def local(self):
        layout, active = self.layout, self.checkpoint['active']
        for path in (layout.controller, layout.runtime, layout.policy.parent):
            for ancestor in (path, *path.parents):
                trusted(ancestor)
        policy = read_image(layout.policy, 0, 0o644)
        need(policy.checksum == POLICY_PIN,
             'ACTUAL_POLICY_PIN')
        data = loads(policy.raw)
        need(data.get('mode') == 'active' and data.get('controller_sha') == CONTROLLER
             and data.get('stage_workflow_sha256') == STAGE_WORKFLOW, 'POLICY_CONTROLLER_WORKFLOW')
        inventory = read_image(layout.controller / 'backup.json', 0, 0o600, 32 * 1024 * 1024)
        need(inventory.checksum == INVENTORY_PIN,
             'ACTUAL_INVENTORY_PIN')
        inventory_data = loads(inventory.raw)
        need(inventory_data.get('schema') == 'GB_ACTIONS_TRAIN_BACKUP_V1', 'INVENTORY_SCHEMA')
        after = inventory_data.get('after')
        need(type(after) is dict and len(after) <= 64, 'INVENTORY_AFTER')
        pins = {}
        for path, checksum in after.items():
            need(path.startswith('/usr/local/lib/gb-actions-train/') or path in
                 ('/usr/local/lib/gb-ops-monitor/opsmon/writer.py',
                  '/usr/local/lib/gb-ops-monitor/web/app.js', '/usr/local/sbin/gb-deploy-helper.sh'),
                 'INVENTORY_PATH')
            p = layout.system / path.removeprefix('/')
            trusted(p)
            info = p.lstat()
            image = read_image(p, 0, stat.S_IMODE(info.st_mode))
            need(image.checksum == checksum, 'INVENTORY_CONTENT_DRIFT')
            pins[path] = [checksum, list(image.identity)]
        for rel, (checksum, size) in PROFILE.items():
            path = layout.runtime / rel
            image = read_image(path, 0, 0o644)
            closed_acl(path)
            need(image.checksum == checksum and len(image.raw) == size
                 and image.identity[3] == 0
                 and (rel not in PROFILE_MTIME_NS or image.identity[7] == PROFILE_MTIME_NS[rel])
                 and after.get('/usr/local/lib/gb-actions-train/' + rel) == checksum,
                 'ACTUAL_RUNTIME_CLOSURE:' + rel)
            if rel == 'core.py':
                self.core_raw = image.raw
        for base, dirs, files in os.walk(layout.runtime, followlinks=False):
            need(all(d == 'live' for d in dirs), 'UNPINNED_RUNTIME_DIRECTORY_OR_BYTECODE')
            trusted(base)
            for name in files:
                need('/usr/local/lib/gb-actions-train/'
                     + str((Path(base) / name).relative_to(layout.runtime)) in after, 'UNPINNED_RUNTIME_FILE')
        processes = stopped_processes(self.op, 1002, layout.proc, layout.cgroups)
        configuration = self.public_configuration()
        legacy = self.legacy_quiet()
        lease = read_image(layout.autonomy / 'locks/slot1.lease', 1002, 0o644)
        need(lease.identity[3] == 65042 and loads(lease.raw) == self.op['record'], 'EXACT_TARGET_LEASE')
        # The pinned C5 guard proves no invoke/charge/publish path is reachable.
        # Corroborate actual invocation trace if one exists, never equate a missing
        # field with proof and never generalize this to a paid provider UNKNOWN.
        trace_path = layout.autonomy / 'outbox/slot1/actions-process.json'
        trace = None
        trace_image = None
        if os.path.lexists(trace_path):
            trace_image = read_image(trace_path, 1002, 0o600)
            trace = loads(trace_image.raw)
            need(not (trace.get('workflow_run') == self.op['run']
                      and (trace.get('process') is not None or trace.get('model') is not None)),
                 'OPERATION_MODEL_PROCESS_EVIDENCE')
        cursor_receipt = layout.autonomy / 'outbox/slot1/cursor-author-receipt.json'
        receipt_image = None
        if os.path.lexists(cursor_receipt):
            receipt_image = read_image(cursor_receipt, 1002, 0o600)
            receipt = loads(receipt_image.raw)
            need(not (receipt.get('task_sha256') == self.op['task_hash']
                      and receipt.get('issue') == active['issue']
                      and type(receipt.get('started_at')) is int
                      and receipt['started_at'] >= self.op['started_at']), 'OPERATION_CURSOR_INVOCATION_EVIDENCE')
        candidate = SafeGit(layout.worktrees / f'issue-{active["issue"]}', 1002, 1002).clean(
            active['head'], f'automation/issue-{active["issue"]}')
        # Accounting/grants/other-slot closure is a complete state manifest in
        # the transaction, retained byte-for-byte. No reset/refund or zero usage.
        self.local_evidence = dict(policy=[policy.checksum, list(policy.identity)],
                              inventory=[inventory.checksum, list(inventory.identity)],
                              pins=pins, processes=processes, lease=[lease.checksum, list(lease.identity)],
                              trace=None if trace_image is None else [trace_image.checksum, list(trace_image.identity)],
                              cursor_receipt=None if receipt_image is None else
                                  [receipt_image.checksum, list(receipt_image.identity)],
                              configuration=configuration, legacy=legacy,
                              candidate={p: sha(raw) for p, raw in candidate.items()})
        current = digest(self.local_evidence)
        if self.local_digest is None:
            self.local_digest = current
        need(self.local_digest == current, 'LIVE_LOCAL_ATTESTATION_DRIFT')
        if self.release_guard:
            self.release_guard()
        return current

    def current(self):
        active = self.checkpoint['active']
        remote = owner_task(self.api, active)
        proof, workflow = self.api.ci(active)
        need(transition(self.plan.journal_before, self.plan.checkpoint_before, proof, workflow,
                        sha(workflow)) == self.plan, 'CURRENT_CI_PLAN_DRIFT')
        current = digest(dict(owner=remote, ci=proof, workflow=sha(workflow)))
        if self.remote_digest is None:
            self.remote_digest = current
        need(current == self.remote_digest, 'REMOTE_CURRENTNESS_DRIFT')


def live_execute(args):
    need(os.getuid() == os.geteuid() == 0, 'ROOT_OPS_IDENTITY_REQUIRED')
    api = GitHubReads()
    release_hash = source_release(Path(args.bundle), args.source_commit, args.source_branch,
                                  Path(args.qa_receipt), args.source_ci_run, api)
    source = SafeGit(Path(args.bundle))
    source_material = source.clean(args.source_commit, args.source_branch)
    qa_image = read_image(Path(args.qa_receipt), 0, 0o600)
    source_current = api.get(f'actions/runs/{args.source_ci_run}')
    source_listing_path = ('actions/workflows/ci.yml/runs?head_sha=' + args.source_commit
                           + '&per_page=20&page=1')
    source_listing = api.get(source_listing_path)
    def release_guard():
        need(source.clean(args.source_commit, args.source_branch) == source_material
             and read_image(Path(args.qa_receipt), 0, 0o600) == qa_image, 'SOURCE_RELEASE_CAS_DRIFT')
        need(api.get(f'actions/runs/{args.source_ci_run}') == source_current
             and api.get(source_listing_path) == source_listing, 'SOURCE_CI_CURRENTNESS_DRIFT')
    layout = Layout()
    journal_path = layout.controller / 'slot1.json'
    checkpoint_path = layout.autonomy / 'slots/slot1/state.json'
    tx_path = layout.controller / ('precall-ci-' + args.operation)
    backup = None
    # Reentry reads ORIGINAL bytes from the immutable private backup; transaction
    # validates its plan/hash/inodes/preserved inventory under all locks.
    if os.path.lexists(tx_path / 'backup.json'):
        try:
            backup = loads(read_image(tx_path / 'backup.json', 0, 0o600).raw)
        except Hold as error:
            need(str(error) == 'INVALID_JSON' and args.action == 'apply', 'PARTIAL_BACKUP_HOLD')
            # No intent/target mutation is reachable before complete backup.
            need(not os.path.lexists(tx_path / 'intent.json'), 'PARTIAL_BACKUP_WITH_INTENT')
            journal_raw = read_image(journal_path, 0, 0o600).raw
            checkpoint_raw = read_image(checkpoint_path, 1002, 0o600).raw
        else:
            journal_raw = backup['before']['journal'].encode()
            checkpoint_raw = backup['before']['checkpoint'].encode()
    else:
        journal_raw = read_image(journal_path, 0, 0o600).raw
        checkpoint_raw = read_image(checkpoint_path, 1002, 0o600).raw
    journal, checkpoint = loads(journal_raw), loads(checkpoint_raw)
    need(classify(journal, checkpoint)['operation'] == args.operation, 'REQUEST_OPERATION_BINDING')
    if args.action == 'rollback':
        need(type(backup) is dict, 'ROLLBACK_REQUIRES_DURABLE_BACKUP')
        # Inverse occupancy restoration does not assert that old failed CI now
        # passes. It must work when candidate CI is unavailable/has rerun.
        # checked_intent validates private backups, plan hash, exact target
        # inodes and every preserved byte under all locks before any inverse.
        plan = Plan(journal_raw, checkpoint_raw, backup['after']['journal'].encode(),
                    backup['after']['checkpoint'].encode(), backup['certificate'].encode())
    else:
        proof, workflow = api.ci(checkpoint['active'])
        plan = transition(journal_raw, checkpoint_raw, proof, workflow, sha(workflow))
    collector = LiveCollector(layout, plan, api, release_hash, release_guard)
    transaction = ProtectedTransaction(layout, plan, collector)
    return transaction.execute(args.action)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('action', choices=('dry', 'apply', 'verify', 'rollback'))
    parser.add_argument('--operation', required=True, type=lambda v: v if HASH.fullmatch(v)
                        else parser.error('operation must be 64 lowercase hex characters'))
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--source-commit', required=True, type=lambda v: v if SHA.fullmatch(v)
                        else parser.error('source commit must be exact SHA'))
    parser.add_argument('--source-branch', required=True)
    parser.add_argument('--source-ci-run', required=True, type=int)
    parser.add_argument('--qa-receipt', required=True)
    args = parser.parse_args(argv)
    try:
        result = live_execute(args)
    except (Hold, OSError, ValueError, KeyError, TypeError) as error:
        # Never print subprocess stderr, HTTP bodies, environments or arbitrary
        # exception text. A failure after intent may have partial metadata writes.
        code = str(error) if isinstance(error, Hold) else type(error).__name__
        result = dict(status='HOLD', reason=code, operation=args.operation,
                      target_metadata_writes=error.target_writes if isinstance(error, TransactionHold) else 0,
                      model_calls=0)
    print(json.dumps(result, sort_keys=True))
    return 1 if result['status'] == 'HOLD' else 0


if __name__ == '__main__':
    sys.exit(main())

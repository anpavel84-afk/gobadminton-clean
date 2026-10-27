#!/usr/bin/python3
"""Bounded C5 pre-call CI reconciliation, PARTIAL SOURCE / NOT LIVE QUALIFIED.

The pure classifier, exact-CI projection and metadata transaction below can be
exercised offline. They do not attest that supplied observations came from the
host or GitHub. The CLI deliberately returns HOLD for EVERY verb: the protected
live evidence collector and source/release admission are not implemented. Do
not wire Transaction directly into a root launcher. A JSON assertion, successful
unit test or the public runtime snapshot is not execution authority.

No runtime imports, subprocesses, credentials, model, Git or service operations.
No installed module/policy modification. Old UNKNOWN records remain immutable.
"""
import argparse
import contextlib
import copy
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

REPO = 'anpavel84-afk/gobadminton-clean'
REPO_ID = 1416250340
CONTROLLER = '41e12be2d551158e97ea30eaf8e95f992f998615'
STAGE_WORKFLOW = 'b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d'
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
SCHEMA = 'GB_PRECALL_CI_RECONCILE_OFFLINE_V1'
LIVE_GAPS = (
    'LIVE_PROCESS_GROUP_CGROUP_AND_WRITER_ATTESTATION_NOT_IMPLEMENTED',
    'LIVE_OPERATION_ACCOUNTING_AND_ADMISSION_ATTESTATION_NOT_IMPLEMENTED',
    'LIVE_CANDIDATE_RAW_GIT_AND_BOUNDED_GITHUB_COLLECTOR_NOT_IMPLEMENTED',
    'ROOT_SOURCE_QA_CI_RELEASE_SELF_PROVENANCE_GATE_NOT_IMPLEMENTED',
    'LIVE_FIXED_PATH_LAYOUT_AND_FULL_PRESERVED_INVENTORY_NOT_IMPLEMENTED',
)


class Hold(Exception):
    """A local refusal; never inference that an UNKNOWN had no effects."""


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


def exact_ci(proof, active, workflow_raw, workflow_sha256):
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
             and row.get('head_branch') == f'automation/issue-{active["issue"]}'
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


class OfflineTransaction:
    """Exercise the proposed two-file protocol on a synthetic nonroot Store.

    This is deliberately NOT a live adapter. It cannot run as root and requires
    a fixture marker and a synthetic directory layout. Root integration needs
    the missing gates listed in LIVE_GAPS; changing this guard is a new reviewed
    source change, not an installation option.

    Fixed noncreating lock order: controller -> worker -> target lease ->
    registry. All are held nonblocking across manifest CAS and writes. External
    reads do not take place under these locks. The lease is never edited/reset.
    Forward writes: checkpoint first, scheduling journal last. Inverse: journal
    first, checkpoint last. Both pre/post pairs plus the immutable certificate
    are backed up before the first target write. Progress is inferred from
    predeclared staged inodes, never from a caller's claimed phase.
    """
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
                image = read_image(path, self.uid, mode)
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
                need(read_image(path, self.uid, mode) == image, 'LOCK_PATH_CAS')
            yield
            for path, mode, fd, image in held:
                need(tuple(token(os.fstat(fd))) == image.identity
                     and read_image(path, self.uid, mode) == image, 'LOCK_CHANGED')
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
            image = read_image(path, self.uid, mode)
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
            image = read_image(path, self.uid, mode)
            need(image.raw == raw, 'ARTIFACT_REENTRY_BYTES')
            return image
        parent = directory(self.tx)
        fd = None
        try:
            self.boundary('before:' + name + ':create')
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                         mode, dir_fd=parent)
            self.boundary('after:' + name + ':create')
            self.effect(name + ':metadata', lambda: os.fchmod(fd, mode))
            # Preserve exact fixture uid/gid. No privilege substitution.
            need(os.fstat(fd).st_uid == self.uid and os.fstat(fd).st_gid == self.gid,
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
        return read_image(path, self.uid, mode)

    def existing(self, name):
        return loads(read_image(self.tx / name, self.uid, 0o600).raw)

    def make_intent(self):
        if os.path.lexists(self.tx / 'intent.json'):
            try:
                loads(read_image(self.tx / 'intent.json', self.uid, 0o600).raw)
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
        originals = {n: read_image(p, self.uid, 0o600) for n, p in self.targets.items()}
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
        need(self.preserved() == preserved and all(read_image(self.targets[n], self.uid, 0o600)
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
        image = read_image(self.targets[name], self.uid, 0o600)
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
        image = read_image(source, self.uid, 0o600)
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
                    need(read_image(path, self.uid, 0o600).raw == self.before[name], 'PREIMAGE_DRIFT')
                first = self.manifest()
                need(self.manifest() == first, 'UNSTABLE_MANIFEST')
                return dict(status='OFFLINE_DRY', protected_writes=0, live_clearance=False)
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
                                                          operation=self.op, status='OFFLINE_COMPLETE')))
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
                                                             operation=self.op, status='OFFLINE_ROLLED_BACK')))
            else:
                intent, backup = self.checked_intent()
                need(not os.path.lexists(self.tx / 'rollback-intent.json'), 'ROLLBACK_ALREADY_REQUESTED')
                need(self.existing('complete.json') == dict(plan_sha256=self.plan_hash,
                     operation=self.op, status='OFFLINE_COMPLETE'), 'INCOMPLETE_TRANSACTION')
            intent, backup = self.checked_intent()
            positions = {n: self.position(n, intent, backup) for n in self.targets}
            need(set(positions.values()) <= ({'original', 'inverse'} if action == 'rollback' else {'forward'}),
                 'POST_TRANSACTION_POSITION')
            return dict(status='OFFLINE_ROLLED_BACK' if action == 'rollback' else 'OFFLINE_COMPLETE',
                        live_clearance=False, model_calls=0)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('action', choices=('dry', 'apply', 'verify', 'rollback'))
    parser.add_argument('--operation', required=True, type=lambda v: v if HASH.fullmatch(v)
                        else parser.error('operation must be 64 lowercase hex characters'))
    args = parser.parse_args(argv)
    # This source revision cannot be installed as a working reconciler. No
    # caller flag, root identity, file pin or JSON can turn these gaps into PASS.
    print(json.dumps(dict(status='HOLD', action=args.action, operation=args.operation,
                          source_status='PARTIAL_NOT_LIVE_QUALIFIED', missing=list(LIVE_GAPS),
                          protected_writes=0, model_calls=0, network_calls=0), sort_keys=True))
    return 1


if __name__ == '__main__':
    sys.exit(main())

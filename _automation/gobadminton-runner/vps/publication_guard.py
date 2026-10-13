"""Serialized PM pre-push safety, also reused after publication.

This is a cooperative Git transport gate, not a security boundary against an
executor deliberately replacing Git/hooks or using another credential/channel.
No installed hook/config is changed by importing this source module.
"""
from __future__ import annotations

import json
import fcntl
import re
import sys
from pathlib import Path

import backlog_sync
import runner
import writer_bridge


MAX_ADMISSION_PAIRS = 4


def admission_delta(before, after):
    old = {t['id']: t for t in before['tasks']}
    new = {t['id']: t for t in after['tasks']}
    backlog_sync.verify_source_review_immutability(old, new)
    fields = ('source', 'admission', 'source_review', 'depends_on_completed',
              'depends_on_accepted', 'locks', 'order', 'effect_ceiling', 'notes')
    return {t['id'] for t in after['tasks'] if t.get('enabled') is True
            and t.get('status', 'queued') == 'queued'
            and (t['id'] not in old or old[t['id']].get('enabled') is not True
                 or any(old[t['id']].get(k) != t.get(k) for k in fields))}


def normalized_paths(value):
    """Only exact relative files/directories and trailing /** are understood.

    Unknown future scope/glob syntax is rejected, never treated as disjoint.
    These are publication metadata; Runner's executable task schema is unchanged.
    """
    if not isinstance(value, list) or not value:
        raise backlog_sync.SyncBlocked('write_paths must be a nonempty list')
    result = []
    for path in value:
        if not isinstance(path, str):
            raise backlog_sync.SyncBlocked('invalid write path')
        path = path.removesuffix('/**').rstrip('/')
        if (not path or path.startswith('/') or '\\' in path
                or any(part in {'', '.', '..'} for part in path.split('/'))
                or not re.fullmatch(r'[A-Za-z0-9_./-]+', path)):
            raise backlog_sync.SyncBlocked('ambiguous write path/scope')
        result.append(path)
    return result


def paths_overlap(left, right):
    return any(a == b or a.startswith(b + '/') or b.startswith(a + '/')
               for a in left for b in right)


def validate_admission_batch(before, after, state, receipt, binding):
    """Fail closed on the entire publication, including unreported admissions.

    Each new producer needs its own newly admitted QA. QA-only intake is allowed
    for an existing completed producer. Pair boundaries are independent locks,
    optionally narrowed by durable reviewed write_paths (never by guessed scope).
    Recovery's stricter one-pair/max5 validation still runs separately.
    """
    ids = receipt.get('task_ids')
    delta = admission_delta(before, after)
    if (not isinstance(ids, list) or not ids or any(not isinstance(x, str) for x in ids)
            or len(ids) != len(set(ids)) or set(ids) != delta):
        raise backlog_sync.SyncBlocked('receipt must cover exact newly admitted task delta')
    instructions = binding.get('instructions') if isinstance(binding, dict) else None
    if (not isinstance(binding, dict) or binding.get('project') != 'GoBadminton' or not isinstance(instructions, list)
            or not instructions or any(not isinstance(item, dict)
                or item.get('action') != receipt.get('action')
                or not isinstance(item.get('task_ids'), list)
                or any(not isinstance(tid, str) for tid in item['task_ids']) for item in instructions)
            or {tid for item in instructions for tid in item['task_ids']} != delta):
        raise backlog_sync.SyncBlocked('all admitted tasks require durable instruction binding')
    tasks = {t['id']: t for t in after['tasks']}
    metadata = receipt.get('admission_pairs', [])
    if not isinstance(metadata, list) or binding.get('admission_pairs', []) != metadata:
        raise backlog_sync.SyncBlocked('pair scope metadata must match durable binding')
    scopes = {}
    for item in metadata:
        if (not isinstance(item, dict) or set(item) != {'producer_task_id', 'qa_task_id', 'write_paths'}
                or not isinstance(item['producer_task_id'], str)
                or not isinstance(item['qa_task_id'], str)
                or item['producer_task_id'] in scopes):
            raise backlog_sync.SyncBlocked('invalid/future pair scope metadata')
        scopes[item['producer_task_id']] = (item['qa_task_id'], normalized_paths(item['write_paths']))
    pairs = []
    covered = set()
    # Source-only release handoffs are bounded source tasks, not deploy jobs.
    handoffs = [tid for tid in ids if "release_handoff" in tasks[tid]]
    if (len(handoffs) > 1
            or receipt.get("release_handoff_task_ids", []) != handoffs
            or binding.get("release_handoff_task_ids", []) != handoffs):
        raise backlog_sync.SyncBlocked("bounded handoff IDs must match Owner binding")
    for tid in handoffs:
        task = tasks[tid]
        deps = runner._v2_dependencies(task, "depends_on_accepted")
        if (task.get("effect_ceiling") != "source_only"
                or task.get("release_handoff") !=
                    {"kind": "ci_candidate", "target": "authorized_release_job"}
                or task.get("sandbox") != "read-only"
                or "global" not in runner.task_locks(task)
                or runner._v2_dependencies(task, "depends_on_completed")
                or len(deps) != 1 or deps[0] not in tasks
                or "source_qa" not in tasks[deps[0]]
                or runner._v2_history_status(state, tid) in backlog_sync.TERMINAL_STATUSES
                or any(k in task for k in ("write_paths", "file_scope", "allowed_paths"))):
            raise backlog_sync.SyncBlocked("handoff must wait for approved source QA")
        for key in ("source", "admission"):
            if not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(task.get(key) or "")):
                raise backlog_sync.SyncBlocked("handoff requires immutable Owner source")
        for claim in runner.active_claims(state):
            if claim["id"] != tid:
                raise backlog_sync.SyncBlocked("handoff overlaps active claim")
        covered.add(tid)
    # Direct independent source-review tasks have no synthetic producer.
    # They are exact Owner-bound, immutable and SOURCE_ONLY, never merger authority.
    reviews=[tid for tid in ids if "source_review" in tasks[tid]]
    if (len(reviews) > 1
            or receipt.get("source_review_task_ids",[]) != reviews
            or binding.get("source_review_task_ids",[]) != reviews):
        raise backlog_sync.SyncBlocked('source review IDs need exact durable Owner binding')
    for tid in reviews:
        task=tasks[tid]
        if (task.get("effect_ceiling")!="source_only"
                or task.get("sandbox")!="read-only"
                or runner._v2_history_status(state,tid) in backlog_sync.TERMINAL_STATUSES
                or any(k in task for k in ("write_paths","file_scope","allowed_paths"))
                or runner._v2_dependencies(task,"depends_on_completed")
                or runner._v2_dependencies(task,"depends_on_accepted")):
            raise backlog_sync.SyncBlocked('source review must be new read-only bounded task')
        for key in ("source","admission"):
            if not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(task.get(key) or "")):
                raise backlog_sync.SyncBlocked('source review lacks immutable admission')
        for claim in runner.active_claims(state):
            if claim["id"]!=tid and (
                    claim["id"] not in tasks or runner.locks_conflict(
                        runner.task_locks(task),runner.task_locks(tasks[claim["id"]]))):
                raise backlog_sync.SyncBlocked('source review overlaps active claim')
        covered.add(tid)
    for qa_id in ids:
        if not qa_id.startswith('qa-'):
            continue
        qa = tasks[qa_id]
        producers = [d for d in runner._v2_dependencies(qa, 'depends_on_completed')
                     if not d.startswith('qa-')]
        if len(producers) != 1 or producers[0] not in tasks:
            raise backlog_sync.SyncBlocked('QA requires exactly one own producer')
        pid = producers[0]
        producer = tasks[pid]
        if any(p[0] == pid for p in pairs):
            raise backlog_sync.SyncBlocked('producer has duplicate QA in batch')
        if pid not in delta and runner._v2_history_status(state, pid) != 'completed':
            raise backlog_sync.SyncBlocked('QA-only intake requires completed existing producer')
        for task in (producer, qa):
            if task.get('effect_ceiling') != 'source_only':
                raise backlog_sync.SyncBlocked('continuous admission requires source_only pair')
            if (task.get('status', 'queued') in {'qa_failed', 'qa_blocked', 'blocked', 'deferred', 'owner_skipped', 'superseded_before_launch'}
                    or task.get('status') == 'completed' and task['id'] in delta
                    or runner._v2_history_status(state, task['id']) in backlog_sync.TERMINAL_STATUSES
                    and task['id'] in delta):
                raise backlog_sync.SyncBlocked('terminal task cannot be readmitted')
            for key in ('source', 'admission'):
                if not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(task.get(key) or '')):
                    raise backlog_sync.SyncBlocked('pair requires exact source/admission authority')
            # Explicit future file scope on a task cannot silently bypass schema.
            if any(k in task for k in ('write_paths', 'file_scope', 'allowed_paths')):
                raise backlog_sync.SyncBlocked('task scope must use durable admission_pairs metadata')
        scope = scopes.get(pid)
        if scope and scope[0] != qa_id:
            raise backlog_sync.SyncBlocked('scope QA identity mismatch')
        if "source_qa" in qa and qa["source_qa"].get("producer_task_id") != pid:
            raise backlog_sync.SyncBlocked("source QA does not bind its own producer")
        locks = tuple(set(runner.task_locks(producer)) | set(runner.task_locks(qa)))
        paths = scope[1] if scope else []
        for other_pid, other_qa, other_locks, other_paths in pairs:
            # Pre-admission is not simultaneous execution. The existing
            # scheduler AND claim lock serialize conflicting resource locks.
            # Overlapping write paths without a shared lock remain forbidden.
            if paths_overlap(paths, other_paths) and not runner.locks_conflict(locks, other_locks):
                raise backlog_sync.SyncBlocked("overlapping write paths lack serialization lock")
        for claim in runner.active_claims(state):
            if claim['id'] in delta:
                continue  # post-sync Runner may already have claimed this exact publication
            active_task = tasks.get(claim['id'])
            if active_task is None or runner.locks_conflict(locks, runner.task_locks(active_task)):
                raise backlog_sync.SyncBlocked('admission overlaps active claim')
            if 'write_paths' in claim and paths_overlap(paths, normalized_paths(claim['write_paths'])):
                raise backlog_sync.SyncBlocked('admission paths overlap active claim')
        pairs.append((pid, qa_id, locks, paths))
        covered.add(qa_id)
        if pid in delta:
            covered.add(pid)
    units = len(pairs) + len(reviews) + len(handoffs)
    # Ordinary <=4-pair intake unchanged; one Owner-bound source review and
    # one final nondeploying handoff extend the total to at most five units.
    if (len(pairs) > MAX_ADMISSION_PAIRS or units < 1
            or units > MAX_ADMISSION_PAIRS + 1 or covered != delta):
        raise backlog_sync.SyncBlocked("bounded producer/QA/review/handoff batch exceeded")
    if set(scopes) - {p[0] for p in pairs}:
        raise backlog_sync.SyncBlocked('scope metadata references unreported pair')
    for tid in delta:
        if tid in backlog_sync.dependency_closure(tasks[tid], tasks):
            raise backlog_sync.SyncBlocked("cyclic Owner-bound DAG admission")
    return pairs


def read_receipt(root, task):
    path = Path(task.get('receipt') or task.get('receipt_path') or
                Path(root) / 'receipts' / (task['id'] + '.json'))
    raw = path.read_bytes()
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise backlog_sync.SyncBlocked('merge receipt must be an object')
    return path, raw, data


def accepted_merge_proof(repo, root, before, state, receipt, baseline, target):
    """Own QA identity, explicit zero blockers, fresh publication and exact merge."""
    git = lambda *args: backlog_sync.run_git(Path(repo), list(args))
    qa_id = receipt.get('accepted_qa_task_id')
    candidate = receipt.get('merged_candidate_sha')
    tasks = {t['id']: t for t in before['tasks']}
    if (not isinstance(qa_id, str) or not qa_id.startswith('qa-') or qa_id not in tasks
            or not re.fullmatch(r'[0-9a-f]{40}', str(candidate or ''))
            or receipt.get('result_commit') != target
            or runner._v2_history_status(state, qa_id) != 'completed'
            or tasks[qa_id].get('status') in {'qa_failed', 'qa_blocked'}):
        raise backlog_sync.SyncBlocked('source merge requires exact completed independent QA identity/result SHA')
    qa = tasks[qa_id]
    qp, qr, data = read_receipt(root, qa)
    tree = git('rev-parse', candidate + '^{tree}')
    if (data.get('project') != 'GoBadminton' or data.get('task_id') != qa_id
            or data.get('ok') is not True or data.get('candidate_sha') != candidate
            or data.get('candidate_tree') != tree
            or data.get('verdict') not in {'PASS', 'PASS_WITH_NONBLOCKING_GAPS'}
            or data.get('blocking_findings') != []
            or ('blocking_gap_count' in data and
                (type(data['blocking_gap_count']) is not int or data['blocking_gap_count'] != 0))
            or data.get('merge_recommendation') != 'MERGE_RECOMMENDED'):
        raise backlog_sync.SyncBlocked('source merge independent QA rejected/mismatched/nonzero blockers')
    producers = [d for d in runner._v2_dependencies(qa, 'depends_on_completed') if not d.startswith('qa-')]
    if len(producers) != 1 or producers[0] not in tasks:
        raise backlog_sync.SyncBlocked('source merge QA own producer unavailable')
    producer = tasks[producers[0]]
    pp, pr, own = read_receipt(root, producer)
    branch = own.get('branch')
    if (runner._v2_history_status(state, producer['id']) != 'completed'
            or own.get('project') != 'GoBadminton' or own.get('task_id') != producer['id']
            or own.get('ok') is not True or own.get('candidate_sha') != candidate
            or own.get('candidate_tree') != tree or not isinstance(branch, str)
            or data.get('producer_task_id', producer['id']) != producer['id']
            or data.get('branch', branch) != branch
            or qa.get('candidate_sha', candidate) != candidate):
        raise backlog_sync.SyncBlocked('source merge producer SHA/tree/branch identity mismatch')
    terminal_proofs = []
    # No historical FAIL/BLOCKED can be relabelled by choosing another QA ID.
    for row in state['history']:
        if row['status'] not in {'qa_failed', 'qa_blocked'}:
            continue
        failed_task = tasks.get(row['id'])
        if failed_task:
            fp, fr, failed = read_receipt(root, failed_task)
            terminal_proofs.append((fp, fr, row["id"]))
            if failed.get('candidate_sha') == candidate:
                raise backlog_sync.SyncBlocked('source merge candidate is terminal FAIL/BLOCKED')
    source = backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(producer.get('source') or ''))
    baseline_sha = producer.get('base_sha') or (source[1] if source else None)
    if not re.fullmatch(r'[0-9a-f]{40}', str(baseline_sha or '')):
        raise backlog_sync.SyncBlocked('source merge producer baseline unavailable')
    git('merge-base', '--is-ancestor', baseline_sha, candidate)
    git('check-ref-format', 'refs/heads/' + branch)
    remote = git('ls-remote', '--refs', 'origin', 'refs/heads/' + branch).split()
    if len(remote) != 2 or remote[1] != 'refs/heads/' + branch:
        raise backlog_sync.SyncBlocked('source merge producer branch missing')
    git('fetch', '--no-tags', '--quiet', 'origin', 'refs/heads/' + branch)
    if git('rev-parse', 'FETCH_HEAD') != remote[0]:
        raise backlog_sync.SyncBlocked('source merge producer publication changed during fetch')
    git('merge-base', '--is-ancestor', candidate, remote[0])
    git('merge-base', '--is-ancestor', baseline, target)
    git('merge-base', '--is-ancestor', candidate, target)
    backlog_sync.validate_immutable_sources(Path(repo), [producer, qa])
    # The accepted source must actually be newly incorporated in this result.
    import subprocess
    if subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', candidate, baseline],
                      capture_output=True).returncode == 0:
        raise backlog_sync.SyncBlocked('candidate already on baseline; preexisting merge needs manual remediation')
    expected_tree = git('merge-tree', '--write-tree', baseline, candidate).splitlines()[0]
    paths = git('diff', '--name-only', expected_tree, target).splitlines()
    if any(not (p.startswith('docs/') or p == backlog_sync.CANONICAL_PATH) for p in paths):
        raise backlog_sync.SyncBlocked('source merge result contains source outside exact accepted candidate')
    return [(qp, qr, qa_id), (pp, pr, producer['id']), *terminal_proofs]


def quarantine(root, target, reason):
    # Quarantine is shared publication metadata, not a lock-free diagnostic.
    with writer_bridge.bridge_section():
        backlog_sync.atomic_write(Path(root) / 'source-publication-quarantine.json',
            (json.dumps({'status': 'QUARANTINED', 'result_commit': target,
                         'reason': reason, 'manual_remediation_required': True,
                         'updated_at': backlog_sync.now_iso()}) + '\n').encode())


def pre_push(repo, root, context, receipt, baseline, target):
    """Validate before transport; reserve merges until post-publication verification."""
    root = Path(root)
    state = backlog_sync.read_runner_state(root / 'state.json')
    if (state.get('paused') or state.get('global_gates') or state.get('project_global_blocker')
            or state.get('blocked') and not runner.lane_local_block(state)):
        raise backlog_sync.SyncBlocked('publication blocked by paused/Owner/global/ambiguous gate')
    git = lambda *args: backlog_sync.run_git(Path(repo), list(args))
    before = json.loads(git('show', baseline + ':' + backlog_sync.CANONICAL_PATH))
    after = json.loads(git('show', target + ':' + backlog_sync.CANONICAL_PATH))
    # All publication actions, including quarantined, share this immutable
    # review-pin boundary before any writer, merge or CAS side effect.
    backlog_sync.verify_source_review_immutability(
        {t['id']: t for t in before['tasks']},
        {t['id']: t for t in after['tasks']},
    )
    git('merge-base', '--is-ancestor', baseline, target)
    runner.validate_backlog(after)
    backlog_sync.verify_candidate(json.dumps(after).encode(), json.dumps(before).encode(), state['active'])
    validated_recovery = backlog_sync.validate_recovery_transition(root, before, after, state, Path(repo), baseline, target, receipt)
    delta = admission_delta(before, after)
    # Recovery transition above verified immutable ledger/pair proof. Merely
    # labelling a normal pair 'repair' in a receipt is not an exemption.
    old_ids = {t['id'] for t in before['tasks']}
    repair = validated_recovery and bool(delta) and not (delta & old_ids) and all(
        t.get('recovery_from') for t in after['tasks'] if t['id'] in delta)
    writer_bridge.deny_admit_pair(has_admission=bool(delta), verified_repair=repair)
    proofs = backlog_sync.verify_dependency_rebindings(Path(repo), root,
        {t['id']: t for t in before['tasks']}, {t['id']: t for t in after['tasks']}, state, target)
    action = receipt.get('action')
    if (receipt.get('ok') is not True or receipt.get('project') != 'GoBadminton'
            or receipt.get('result_commit') != target
            or action not in {'enqueued', 'quarantined', 'merged', 'merged_and_enqueued'}):
        raise backlog_sync.SyncBlocked('write exact publication receipt before pushing main')
    if delta and action not in {'enqueued', 'merged_and_enqueued'}:
        raise backlog_sync.SyncBlocked('new task admission requires Owner-bound enqueued publication')
    if action in {'enqueued', 'merged_and_enqueued'}:
        binding_path = receipt.get('owner_binding_path')
        if (not isinstance(binding_path, str) or not re.fullmatch(r'docs/manifest/[A-Za-z0-9_./-]+\.json', binding_path)
                or '..' in binding_path.split('/')):
            raise backlog_sync.SyncBlocked('admission requires durable Owner binding')
        binding = json.loads(git('show', target + ':' + binding_path))
        validate_admission_batch(before, after, state, receipt, binding)
        backlog_sync.validate_immutable_sources(Path(repo),
            [t for t in after['tasks'] if t['id'] in admission_delta(before, after)])
    merging = action in {'merged', 'merged_and_enqueued'}
    if context.get('active_admission_only') and action != 'enqueued':
        raise backlog_sync.SyncBlocked('source-only intake cannot merge/release')
    if merging:
        if state['active'] or state.get('paused') or state.get('blocked') or state.get('global_gates') or state.get('project_global_blocker'):
            raise backlog_sync.SyncBlocked('source merge requires idle safe publication boundary')
        proofs += accepted_merge_proof(repo, root, before, state, receipt, baseline, target)
    else:
        paths = git('diff', '--name-only', baseline, target).splitlines()
        if any(not (p.startswith('docs/') or p == backlog_sync.CANONICAL_PATH) for p in paths):
            raise backlog_sync.SyncBlocked('PM admission changed executable source without accepted merge')
    observed = git('ls-remote', '--refs', 'origin', 'refs/heads/main').split()
    if observed != [baseline, 'refs/heads/main'] or context.get('baseline') != baseline:
        raise backlog_sync.SyncBlocked('STALE_MAIN: expected main SHA changed; fresh replan required')
    # Network proof is outside the short lock. Claims and competing hook
    # processes cannot pass the final byte/history check and merge reservation.
    with backlog_sync.claim_sync_section(root):
        writer_bridge.deny_admit_pair(has_admission=bool(delta), verified_repair=repair)
        latest = backlog_sync.read_runner_state(root / 'state.json')
        stable = latest == state if merging else all(latest.get(k) == state.get(k) for k in
            ('history', 'paused', 'blocked', 'global_gates', 'project_global_blocker'))
        if not stable or any(p.read_bytes() != raw for p, raw, _ in proofs):
            raise backlog_sync.SyncBlocked('merge/admission evidence changed before push')
        if not merging:
            # Independent claims may use the spare slot during source intake.
            # Recheck their complete definitions, rather than requiring an
            # unchanged active map and stranding a bounded repair on this race.
            backlog_sync.verify_candidate(json.dumps(after).encode(), json.dumps(before).encode(), latest['active'])
            backlog_sync.validate_recovery_transition(root, before, after, latest, receipt=receipt)
            if action == 'enqueued':
                validate_admission_batch(before, after, latest, receipt, binding)
        reservation = root / 'source-merge-reservation.json'
        existing = json.loads(reservation.read_text()) if reservation.exists() else {}
        if existing.get('status') == 'RESERVED' and existing.get('result_commit') != target:
            raise backlog_sync.SyncBlocked('another serialized source publication is reserved')
        if merging:
            backlog_sync.atomic_write(reservation, (json.dumps({'status': 'RESERVED',
                'result_commit': target, 'baseline': baseline,
                'accepted_qa_task_id': receipt['accepted_qa_task_id']}) + '\n').encode())


def reconcile_reservation(repo, root):
    """Recover an interrupted planner without leaving independent lanes frozen.

    Call only after the managed planner has exited. Never repeat its push.
    """
    root = Path(root)
    path = root / 'source-merge-reservation.json'
    if not path.exists():
        return None
    entry = json.loads(path.read_text())
    if entry.get('status') != 'RESERVED':
        return entry
    git = lambda *args: backlog_sync.run_git(Path(repo), list(args))
    git('fetch', '--no-tags', '--quiet', 'origin', 'main')
    head = git('rev-parse', 'refs/remotes/origin/main')
    remote = git('ls-remote', '--refs', 'origin', 'refs/heads/main').split()
    if remote != [head, 'refs/heads/main']:
        raise backlog_sync.SyncBlocked('reservation reconciliation main observation changed')
    import subprocess
    included = subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor',
                              entry['result_commit'], head], capture_output=True).returncode == 0
    reason = 'interrupted publication did not reach observed main; no push retried'
    status = 'ABORTED'
    if included:
        try:
            receipt = json.loads((root / 'autopilot-receipt.json').read_text())
            if head != entry['result_commit']:
                raise backlog_sync.SyncBlocked('main advanced beyond interrupted exact result')
            before = json.loads(git('show', entry['baseline'] + ':' + backlog_sync.CANONICAL_PATH))
            state = backlog_sync.read_runner_state(root / 'state.json')
            accepted_merge_proof(repo, root, before, state, receipt, entry['baseline'], head)
            status, reason = 'VERIFIED', 'interrupted exact accepted source publication verified'
        except (RuntimeError, OSError, ValueError, KeyError, TypeError) as exc:
            status, reason = 'QUARANTINED', 'manual remediation required: ' + str(exc)
            quarantine(root, head, reason)
    with backlog_sync.claim_sync_section(root):
        if json.loads(path.read_text()) != entry:
            raise backlog_sync.SyncBlocked('publication reservation changed during reconciliation')
        result = {**entry, 'status': status, 'reason': reason}
        backlog_sync.atomic_write(path, (json.dumps(result) + '\n').encode())
    return result


def publish_main(repo, root, context, receipt):
    """One serialized expected-SHA, atomic, fast-forward Git transaction.

    The dedicated publication lock spans transport, never blocks Runner claims,
    and is separate from the short claim/evidence critical section. A stale
    lease never retries the push; PM must prepare/revalidate a fresh result.
    """
    with (Path(root) / 'planner-publication.lock').open('a+') as fp:
        try:
            fcntl.flock(fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise backlog_sync.SyncBlocked('another atomic Git publication writer is active') from exc
        try:
            baseline, target = context['baseline'], receipt['result_commit']
            pre_push(repo, root, context, receipt, baseline, target)
            return backlog_sync.run_git(Path(repo), ['push', '--atomic',
                '--force-with-lease=refs/heads/main:' + baseline, 'origin',
                target + ':refs/heads/main'], timeout=120)
        finally:
            fcntl.flock(fp.fileno(), fcntl.LOCK_UN)


def main(argv=None):
    arguments = list(argv or sys.argv[1:])
    publish = arguments[0] == '--publish'
    if publish:
        arguments.pop(0)
    repo, root, context_path = map(Path, arguments[:3])
    context = json.loads(context_path.read_text())
    try:
        if publish:
            receipt = json.loads((root / 'autopilot-receipt.json').read_text())
            publish_main(repo, root, context, receipt)
            return 0
        for line in sys.stdin:
            local_ref, target, remote_ref, baseline = line.split()
            if remote_ref != 'refs/heads/main':
                continue
            if context['baseline'] != baseline or target == '0' * 40 or baseline == '0' * 40:
                raise backlog_sync.SyncBlocked('main publication baseline changed/deleted; replan')
            receipt = json.loads((root / 'autopilot-receipt.json').read_text())
            pre_push(repo, root, context, receipt, baseline, target)
        return 0
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as exc:
        print('GoBadminton publication refused: ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

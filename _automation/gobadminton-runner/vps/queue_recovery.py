"""Source-only PM intake; never claims, retries, accepts or merges a task.

All scheduling authority remains in runner. Ledger transactions serialize intake
across timers; a crashed dispatch is held for publication reconciliation rather
than replayed. Exactly-once external effects cannot be inferred from an ACK.
"""
from __future__ import annotations
import copy
import fcntl
import hashlib
import json
from contextlib import contextmanager
from pathlib import Path
from typing import Any
import backlog_sync
import runner
import writer_bridge


class RecoveryHold(RuntimeError):
    pass


def digest(data: Any) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode()).hexdigest()


def failed_dependencies(task, q, st, seen=None):
    """Use both explicit and legacy effective Runner dependencies, recursively."""
    seen = set() if seen is None else seen
    found = set()
    for key in ('depends_on_completed', 'depends_on_accepted'):
        for dep in runner._v2_dependencies(task, key):
            if dep in seen:
                continue
            seen.add(dep)
            definition = runner._v2_task_map(q).get(dep)
            status = runner._v2_history_status(st, dep)
            if status in {'qa_failed', 'qa_blocked'} or (definition or {}).get('status') in {'qa_failed', 'qa_blocked'}:
                found.add(dep)
            elif definition and not runner._v2_dependency_accepted(q, st, dep):
                found.update(failed_dependencies(definition, q, st, seen))
    return sorted(found)


def classify(q, st, cfg):
    backlog_sync.validate_history(st.get('history'))
    rows = runner.queue_eligibility(q, st, cfg)
    if st.get('global_gates') or st.get('project_global_blocker'):
        for row in rows:
            if row['status'] not in {'ACTIVE', 'TERMINAL', 'TERMINAL_QA'}:
                row.update(status='WAITING_OWNER_RELEASE', reason='true project global safety/Owner gate')
        return rows
    lookup = runner._v2_task_map(q)
    for row in rows:
        if row['status'] == 'WAITING_DEPENDENCY':
            failures = failed_dependencies(lookup[row['id']], q, st)
            if failures:
                row.update(status='TERMINAL_QA_DEPENDENCY', failed_qa_ids=failures,
                           reason='immutable QA terminal; new PM successor required')
            else:
                deps = [d for k in ('depends_on_completed', 'depends_on_accepted')
                        for d in runner._v2_dependencies(lookup[row['id']], k)]
                accepted = runner._v2_dependencies(lookup[row['id']], 'depends_on_accepted')
                completed = runner._v2_dependencies(lookup[row['id']], 'depends_on_completed')
                if any(d not in lookup or (runner._v2_history_status(st, d) == 'completed' and (
                       (d in accepted and not runner._v2_dependency_accepted(q, st, d)) or
                       (row['id'].startswith('qa-') and d in completed and not d.startswith('qa-') and
                        runner._v2_verified_producer_candidate(lookup[row['id']], lookup[d]) is None))) for d in deps):
                    row.update(status='PLANNER_REQUIRED', reason='missing admission or accepted-source merge/evidence')
    return rows


def failure_evidence(qa_id, q, st):
    qa = runner._v2_task_map(q).get(qa_id)
    if not qa:
        raise RecoveryHold('failed QA definition unavailable: ' + qa_id)
    path = runner.receipt_path_for(qa)
    raw = path.read_bytes()
    receipt = json.loads(raw)
    candidate = runner._v2_candidate_sha(receipt.get('candidate_sha'))
    if (receipt.get('project') != 'GoBadminton' or receipt.get('task_id') != qa_id
            or receipt.get('verdict') not in {'FAIL', 'BLOCKED'} or not candidate
            or runner._v2_history_status(st, qa_id) not in {'qa_failed', 'qa_blocked'}):
        raise RecoveryHold('failed QA identity/history/candidate unverifiable: ' + qa_id)
    # Gates are evidence for Owner disposition, never ordinary source repair.
    if receipt.get('owner_blocker') is not False or receipt.get('blocker_scope') != 'lane_local':
        raise RecoveryHold('WAITING_OWNER_RELEASE: failed QA scope not ordinary lane-local')
    if not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(receipt.get('result_ref') or '')):
        raise RecoveryHold('failed QA immutable report unavailable')
    producers = [d for d in runner._v2_dependencies(qa, 'depends_on_completed') if not d.startswith('qa-')]
    if len(producers) != 1:
        raise RecoveryHold('failed QA must bind one own producer')
    producer = runner._v2_task_map(q).get(producers[0])
    if not producer or runner._v2_verified_producer_candidate(qa, producer, allow_terminal_failure=True) != candidate:
        raise RecoveryHold('failed QA producer candidate/tree/publication unavailable')
    if not set(runner.task_locks(producer)) <= {'api', 'schema-contracts', 'web', 'docs', 'runner-control'}:
        raise RecoveryHold('WAITING_OWNER_RELEASE: operational/host/global domain needs separate source-repair admission')
    repo = runner._v2_evidence_repo()
    backlog_sync.validate_immutable_sources(repo, [qa, producer])
    report = backlog_sync.FULL_GITHUB_SOURCE.fullmatch(receipt['result_ref'])
    backlog_sync.run_git(repo, ['cat-file', '-e', report[1] + ':' + report[2]])
    blockers = receipt.get('blocking_findings') or receipt.get('blockers')
    if not isinstance(blockers, list) or not blockers:
        raise RecoveryHold('QA blockers unavailable; PM must classify evidence')
    # BLOCKED is terminal but is not evidence of a code defect. Explicit PM
    # immutable metadata is required for an infrastructure-only successor.
    policy = producer.get('recovery_policy') or {}
    if receipt['verdict'] == 'BLOCKED' and policy.get('blocked_source_repair') is not True:
        raise RecoveryHold('WAITING_OWNER_RELEASE: BLOCKED needs explicit source-only defect disposition')
    lineage = producer.get('recovery_from') or {}
    if 'repair' in producer['id'] and not lineage and 'prior_attempts' not in policy:
        raise RecoveryHold('conceptual repair lineage unavailable; PM must preserve existing slice counter')
    slice_id = lineage.get('slice_id') or policy.get('slice_id') or producer['id']
    attempt = lineage.get('attempt', policy.get('prior_attempts', 0))
    if not isinstance(slice_id, str) or not slice_id or type(attempt) is not int or not 0 <= attempt <= 5:
        raise RecoveryHold('invalid conceptual slice/attempt lineage')
    qa_digest = hashlib.sha256(raw).hexdigest()
    return dict(failed_task_id=qa_id, candidate_sha=candidate, qa_digest=qa_digest,
                receipt_path=str(path), receipt=receipt, blockers=blockers,
                producer_task_id=producer['id'], source=producer['source'],
                slice_id=slice_id, predecessor_attempt=attempt,
                dependent_task_ids=[t['id'] for t in q['tasks']
                                    if qa_id in failed_dependencies(t, q, st)])


@contextmanager
def transaction(root):
    # The ledger read/modify/write and its local recovery lock must be
    # serialized against the exact v3 Publisher lease as one transaction.
    with writer_bridge.bridge_section():
        root.mkdir(parents=True, exist_ok=True)
        with (root / 'qa-recovery.lock').open('a') as fp:
            fcntl.flock(fp, fcntl.LOCK_EX)
            path = root / 'qa-recovery-ledger.json'
            if path.exists():
                try:
                    ledger = json.loads(path.read_text())
                except (OSError, ValueError) as exc:
                    raise RecoveryHold('corrupt recovery ledger; preserve bytes') from exc
                if (not isinstance(ledger, dict) or ledger.get('version') != 1
                        or not isinstance(ledger.get('actions'), dict) or not isinstance(ledger.get('slices'), dict)):
                    raise RecoveryHold('corrupt recovery ledger schema; preserve bytes')
                for key, action in ledger['actions'].items():
                    if (not isinstance(action, dict) or action.get('key') != key
                            or action.get('status') not in {'NOTICE', 'DISPATCH_RESERVED', 'HOLD', 'ADMITTED', 'RUNNING', 'CLOSED'}
                            or not isinstance(action.get('evidence'), dict)):
                        raise RecoveryHold('corrupt recovery action; preserve bytes')
                for count in ledger['slices'].values():
                    if type(count) is not int or not 0 <= count <= 5:
                        raise RecoveryHold('corrupt recovery attempt counter; preserve bytes')
            else:
                ledger = dict(version=1, actions={}, slices={})
            yield ledger
            backlog_sync.atomic_write(path, (json.dumps(ledger, indent=2, ensure_ascii=False)+'\n').encode())


def prepare(root, evidence, create_notice):
    key = digest([evidence['failed_task_id'], evidence['candidate_sha'], evidence['qa_digest']])
    with transaction(root) as ledger:
        # Mutation of a terminal receipt is a hold, never a new attempt key.
        for other in ledger['actions'].values():
            old = other['evidence']
            if (old['failed_task_id'] == evidence['failed_task_id'] and
                    (old['candidate_sha'] != evidence['candidate_sha'] or old['qa_digest'] != evidence['qa_digest'])):
                raise RecoveryHold('terminal QA receipt changed; preserve original recovery identity')
        count = max(ledger['slices'].get(evidence['slice_id'], 0), evidence['predecessor_attempt'])
        entry = ledger['actions'].get(key)
        if entry is None:
            count = max(ledger['slices'].get(evidence['slice_id'], 0), evidence['predecessor_attempt'])
            ledger['slices'][evidence['slice_id']] = count
            entry = dict(key=key, evidence=evidence, status='NOTICE', created_at=backlog_sync.now_iso(),
                         notice_id='system-qa-recovery-'+key)
            if count >= 5:
                entry.update(status='HOLD', reason='STOPPED_SAFE: five source repairs exhausted; Owner root-cause disposition')
            ledger['actions'][key] = entry
        text = ('PM intake — terminal immutable QA. Standing ordinary source-repair authority only. '
                'Publish ONE NEW source-only repair + own independent QA (distinct task IDs and candidate); '
                'no retry/enable of failed task/SHA. Preserve conceptual slice and max5 counter. '
                'Do not rebind downstream before independent acceptance AND actual source merge. '
                'No deploy, real-user/legal/privacy/finance/GPS/staff/secret gate changes. '
                'Both tasks require effect_ceiling=source_only, recovery_from={key,slice_id,attempt}, '
                'repair QA depends_on_completed=[new producer]; no existing-task activation. '
                'Publish durable Owner binding for this SYSTEM evidence ID/text, then main/backlog parity.\n'
                + json.dumps(dict(evidence, next_attempt=entry.get('attempt', count+1) if entry['status']=='NOTICE' else entry.get('attempt')), ensure_ascii=False, sort_keys=True))
        notice = dict(id=entry['notice_id'], origin='SYSTEM_QA_RECOVERY_NOT_OWNER', status='NEW',
                      text=text, recovery_key=key, created_at=entry['created_at'])
        # Existing ACK/status cannot swallow ledger action; authoritative payload
        # is returned from this persisted identity on every tick.
        create_notice(root/'owner-inbox'/(notice['id']+'.json'), notice)
        return copy.deepcopy(entry), notice


def reserve(root, key, *, baseline=None):
    with transaction(root) as ledger:
        entry = ledger['actions'][key]
        if entry['status'] != 'NOTICE':
            return None
        slice_id = entry['evidence']['slice_id']
        if ledger['slices'][slice_id] >= 5:
            entry.update(status='HOLD', reason='STOPPED_SAFE: five attempts exhausted')
            return None
        # Another failed SHA for this conceptual slice cannot create parallel repair.
        if any(e['key'] != key and e['evidence']['slice_id'] == slice_id
               and e['status'] in {'DISPATCH_RESERVED', 'ADMITTED', 'RUNNING'} for e in ledger['actions'].values()):
            return None
        ledger['slices'][slice_id] += 1
        entry.update(status='DISPATCH_RESERVED', attempt=ledger['slices'][slice_id],
                     baseline=baseline, dispatch_at=backlog_sync.now_iso(), reason='publication reconciliation required after interruption')
        return copy.deepcopy(entry)


def finish(root, key, status, **details):
    with transaction(root) as ledger:
        entry = ledger['actions'][key]
        entry.update(status=status, updated_at=backlog_sync.now_iso(), **details)


def validate_pair(entry, before, after, receipt, st):
    """Additional semantic gates AFTER actual immutable main/parity verification."""
    ids = receipt.get('task_ids')
    if not isinstance(ids, list) or len(ids) != 2 or len(set(ids)) != 2:
        raise RecoveryHold('repair requires exactly one NEW producer + own independent QA')
    old = runner._v2_task_map(before); new = runner._v2_task_map(after)
    if set(new) - set(old) != set(ids):
        raise RecoveryHold('entire recovery delta must contain exactly the authorized pair')
    if any(tid in old or tid not in new or runner._v2_history_status(st, tid) is not None for tid in ids):
        raise RecoveryHold('repair IDs must be fresh, never terminal task replay')
    producers = [new[tid] for tid in ids if not tid.startswith('qa-')]
    qas = [new[tid] for tid in ids if tid.startswith('qa-')]
    if len(producers) != 1 or len(qas) != 1:
        raise RecoveryHold('repair pair identity invalid')
    producer, qa = producers[0], qas[0]
    expected = dict(key=entry['key'], slice_id=entry['evidence']['slice_id'], attempt=entry['attempt'])
    for t in (producer, qa):
        if (t.get('effect_ceiling') != 'source_only' or t.get('recovery_from') != expected
                or t.get('enabled') is not True or t.get('status') != 'queued'
                or t.get('candidate_sha') == entry['evidence']['candidate_sha']
                or any(k.startswith('requires_') for k in t)
                or not set(runner.task_locks(t)) <= {'api', 'schema-contracts', 'web', 'docs', 'runner-control'}
                or not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(t.get('source') or ''))
                or not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(t.get('admission') or ''))):
            raise RecoveryHold('repair effect/attempt/new-candidate/admission gate invalid')
    if runner._v2_dependencies(qa, 'depends_on_completed') != [producer['id']]:
        raise RecoveryHold('repair QA must bind own new producer')
    for tid, previous in old.items():
        current = new.get(tid)
        if current is None:
            raise RecoveryHold('existing task removed')
        # Exact definitions include all present/future permission, release,
        # requires_*, baseline, lane/lock and legacy-note fields. Successor
        # rebinding is a separate accepted-source transition, never pair intake.
        if previous != current:
            raise RecoveryHold('recovery must preserve full existing task definition: ' + tid)
    old_policy = {k: v for k, v in before.items() if k not in {'tasks', '_canonical_commit'}}
    new_policy = {k: v for k, v in after.items() if k not in {'tasks', '_canonical_commit'}}
    if old_policy != new_policy:
        raise RecoveryHold('recovery cannot change queue policy/authority gates')
    return ids


def observe(root, q, st, pid_alive):
    if not (root / 'qa-recovery-ledger.json').exists():
        return dict(version=1, actions={}, slices={})
    with transaction(root) as ledger:
        for entry in ledger['actions'].values():
            if entry['status'] not in {'ADMITTED', 'RUNNING'}:
                continue
            ids = entry['task_ids']; producer = next(t for t in ids if not t.startswith('qa-'))
            qa = next(t for t in ids if t.startswith('qa-'))
            claim = runner._v2_active(st).get(producer) or runner._v2_active(st).get(qa)
            if claim and claim.get('agent_pid') and pid_alive(claim['agent_pid']):
                entry.update(status='RUNNING', claim_pid=claim['agent_pid'], claim_task_id=claim['id'])
            if runner._v2_history_status(st, qa) in {'qa_failed','qa_blocked'} or runner._v2_dependency_accepted(q, st, qa):
                entry.update(status='CLOSED', terminal_qa=qa)
        return copy.deepcopy(ledger)

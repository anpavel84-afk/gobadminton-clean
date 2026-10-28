#!/usr/bin/env python3
"""Finite #29 admission helper. No dispatcher, subprocess launcher or model calls.

Installed trusted root only. The receiver's controller.lock serializes the
entire read/verify/intent/commit operation. Importable validators are pure.
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import owner_package_admission as A
from core import Refused, _NoRedirect, digest, loads, need

R, Q, N = A.R, A.Q, A.N
PREFIX = 'GOBADMINTON_ADMISSION_DELEGATION_V1\n'
SCHEMA = 'GB_ADMISSION_DELEGATION_V1'
PROVENANCE = 'GB_ADMISSION_PM_PROVENANCE_V1'
TRANSACTION = 'GB_AGY_29_ADMISSION_PM_TRANSACTION_V1'
ROLES = ('technical_pm_product_analyst', 'independent_qa')
FIELDS = {'schema', 'issue', 'repo_id', 'scope', 'roles',
          'model', 'max_calls_per_package', 'max_total_calls', 'max_packages',
          'controller_sha', 'rules_sha256', 'expires_at', 'allowed_input_paths'}
REQUEST_FIELDS = {'source_base', 'source_head', 'input_revision', 'input_path', 'input_sha256'}
RECEIPT_PREFIX = A.RECEIPT_PREFIX + 'delegated-'
# Existing receiver.read and native_antigravity.trusted contracts; not new limits.
METADATA_READ_LIMIT = 2097152
MARKER_READ_LIMIT = 65536


class NeedsOwner(Refused):
    pass


def authority(ok, reason):
    if not ok:
        raise NeedsOwner(reason)


def hexstr(value, length):
    return type(value) is str and re.fullmatch('[a-f0-9]{%d}' % length, value) is not None


def utc(value):
    need(type(value) is str and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', value),
         'UTC timestamp required')
    return dt.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)


def validate_delegation(comment, comment_id, *, controller=None, now=None):
    """Validate actual GitHub response, never a fabricated Owner/user identity."""
    need(type(comment) is dict and len(A.encoded(comment)) <= 32768, 'delegation too large')
    need(type(comment.get('user')) is dict, 'invalid delegation author')
    need(type(comment_id) is int and comment_id > 0 and comment.get('id') == comment_id
         and comment.get('issue_url') == A.ISSUE_URL
         and comment.get('user', {}).get('id') == A.OWNER_ID
         and comment.get('user', {}).get('login') == 'anpavel84-afk'
         and comment.get('author_association') in ('OWNER', 'MEMBER', 'COLLABORATOR'),
         'authenticated repository Owner Issue #29 comment required')
    need(type(comment.get('created_at')) is str
         and comment['created_at'] == comment.get('updated_at'), 'edited delegation comment')
    created = utc(comment['created_at'])
    body = comment.get('body')
    need(type(body) is str and body.startswith(PREFIX), 'missing delegation prefix')
    text = body[len(PREFIX):]
    v = loads(text)
    need(json.dumps(v, sort_keys=True, separators=(',', ':'), allow_nan=False) == text,
         'delegation JSON not canonical')
    need(type(v) is dict and set(v) == FIELDS, 'unexpected delegation fields')
    need(v['schema'] == SCHEMA and type(v['issue']) is int and v['issue'] == 29
         and type(v['repo_id']) is int and v['repo_id'] == A.REPO_ID,
         'delegation identity drift')
    authority(v['scope'] == 'DEV_OPS_ONLY', 'scope outside DEV_OPS_ONLY')
    authority(type(v['roles']) is list and 1 <= len(v['roles']) <= 2
              and len(set(v['roles'])) == len(v['roles']) and set(v['roles']) <= set(ROLES),
              'role outside Owner path')
    authority(v['model'] == N.MODEL, 'model outside Owner path')
    need(type(v['max_calls_per_package']) is int and 1 <= v['max_calls_per_package'] <= 5,
         'EOM 6.3 package ceiling must be 1..5')
    need(all(type(v[k]) is int and 1 <= v[k] <= 2147483647
             for k in ('max_total_calls', 'max_packages')), 'finite delegation budgets required')
    authority(v['rules_sha256'] == A.RULES, 'wrong accepted rules')
    need(v['controller_sha'] == 'INSTALLED_ACTIVE' or hexstr(v['controller_sha'], 40),
         'invalid controller pin')
    if controller is not None:
        authority(v['controller_sha'] in ('INSTALLED_ACTIVE', controller), 'wrong controller')
    expiry = utc(v['expires_at'])
    need(created < expiry, 'expiry must follow creation')
    if now is not None:
        need(created <= now, 'future delegation comment')
        authority(now < expiry, 'delegation expired')
    paths = v['allowed_input_paths']
    # Exact triples are intentionally the only V1 form. No glob/path expansion.
    need(type(paths) is list and 1 <= len(paths) <= 64, 'finite exact input triples required')
    seen = set()
    for row in paths:
        need(type(row) is dict and set(row) == {'revision', 'path', 'sha256'}
             and hexstr(row['revision'], 40) and hexstr(row['sha256'], 64)
             and type(row['path']) is str and re.fullmatch(
                 r'scripts/chatops/tests/fixtures/agy-[a-z0-9-]+\.json', row['path']),
             'input path outside existing addressed Git surface')
        key = (row['revision'], row['path'])
        need(key not in seen, 'duplicate delegation input')
        seen.add(key)
    return v


def fetch_delegation(comment_id):
    """One bounded public GET of this comment only; no proxies, redirects or retries."""
    import urllib.request
    need(type(comment_id) is int and comment_id > 0, 'invalid delegation comment id')
    url = 'https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/comments/' + str(comment_id)
    req = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json',
                                             'User-Agent': 'GoBadminton-admission-pm-v1'})
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        with opener.open(req, timeout=10) as response:
            need(response.status == 200 and response.geturl() == url, 'delegation HTTP validation failed')
            raw = response.read(32769)
        need(len(raw) <= 32768, 'delegation too large')
        data = loads(raw)
        need(type(data) is dict and type(data.get('user')) is dict, 'invalid GitHub comment response')
        # Reactions/avatar metadata can change without editing authority bytes.
        # Retain only the actual authenticated immutable envelope, never invented fields.
        value = {k: data.get(k) for k in ('id', 'issue_url', 'author_association', 'created_at', 'updated_at', 'body')}
        value['user'] = {k: data['user'].get(k) for k in ('id', 'login')}
        return value
    except OSError as error:
        raise NeedsOwner('delegation unavailable: ' + type(error).__name__) from None


def validate_request(issue, role, request, delegation):
    authority(type(issue) is int and issue == 29, 'issue outside delegation')
    authority(role in delegation['roles'], 'role outside delegation')
    need(type(request) is dict and set(request) == REQUEST_FIELDS, 'unexpected request fields; needs technical review')
    need(all(hexstr(request[k], 40) for k in ('source_base', 'source_head', 'input_revision'))
         and request['source_base'] != request['source_head'] and hexstr(request['input_sha256'], 64),
         'invalid immutable source/input SHA')
    triple = dict(revision=request['input_revision'], path=request['input_path'], sha256=request['input_sha256'])
    authority(triple in delegation['allowed_input_paths'], 'input outside delegation')
    if role == ROLES[0]:
        need(request['input_revision'] == request['source_head'], 'analysis must bind candidate input')
        # The native role is still the existing INERT Issue230 analysis only.
        authority((request['input_path'], request['input_sha256']) ==
                  (Q.ANALYSIS_INPUT, Q.ANALYSIS_INPUT_SHA256), 'analysis outside existing INERT Owner scope')
    return request


def identity(issue, role, comment_id, request):
    return digest(dict(issue=issue, role=role, delegation_comment=comment_id, request=request))


def validate_provenance(p, *, grant=None, now=None):
    """Closed provenance embedded in BOTH ledger and grant (including marker)."""
    need(type(p) is dict and set(p) == {'schema', 'comment', 'request', 'role', 'admission_id',
         'inherited_calls', 'prior_packages', 'analysis'}, 'invalid delegation provenance fields')
    need(p['schema'] == PROVENANCE, 'invalid delegation provenance schema')
    need(type(p['comment']) is dict and type(p['role']) is str, 'invalid delegation origin')
    comment_id = p['comment'].get('id')
    v = validate_delegation(p['comment'], comment_id, now=now)
    request = validate_request(29, p['role'], p['request'], v)
    need(p['admission_id'] == identity(29, p['role'], comment_id, request), 'request digest mismatch')
    need(type(p['inherited_calls']) is int and 0 <= p['inherited_calls'] <
         min(v['max_calls_per_package'], v['max_total_calls']), 'invalid inherited calls')
    pins = p['prior_packages']
    need(type(pins) is list and len(pins) < v['max_packages'], 'package lineage ceiling')
    names = set()
    for pin in pins:
        need(type(pin) is dict and set(pin) == {'path', 'sha256'}
             and type(pin['path']) is str and re.fullmatch(
                 re.escape(Q.OWNER_PACKAGE_LEDGER_PREFIX) + r'(?:[1-9][0-9]*|delegated-[a-f0-9]{64})\.json', pin['path'])
             and hexstr(pin['sha256'], 64) and pin['path'] not in names, 'invalid lineage package pin')
        names.add(pin['path'])
    analysis = p['analysis']
    if p['role'] == ROLES[1]:
        need(type(analysis) is dict and set(analysis) == {'grant', 'operation'}
             and hexstr(analysis['operation'], 64), 'QA requires predecessor analysis')
        ag = analysis['grant']
        need(type(ag) is dict and ag.get('role') == ROLES[0]
             and type(ag.get('delegation', {})) is dict
             and ag.get('delegation', {}).get('analysis') is None, 'nested analysis authority')
        Q.validate_addressed_grant(ag, enrollment=True)
        need(ag['role'] == ROLES[0] and (ag['base'], ag['head']) ==
             (request['source_base'], request['source_head']), 'QA analysis source mismatch')
    else:
        need(analysis is None, 'analysis package cannot import a QA predecessor')
    if grant is not None:
        need(grant['owner_comment'] == comment_id and grant['role'] == p['role']
             and grant['rules_sha256'] == v['rules_sha256']
             and all(grant[g] == request[r] for g, r in
                     (('base', 'source_base'), ('head', 'source_head'), ('input_revision', 'input_revision'),
                      ('input_path', 'input_path'), ('input_sha256', 'input_sha256'))), 'delegated grant/request drift')
        authority(v['controller_sha'] in ('INSTALLED_ACTIVE', grant['controller_revision']), 'wrong controller')
    return v


def package_path(admission_id):
    return R.STATE / (Q.OWNER_PACKAGE_LEDGER_PREFIX + 'delegated-' + admission_id + '.json')


def receipt_path(admission_id):
    return R.STATE / (RECEIPT_PREFIX + admission_id + '.json')


def historical_operations(r, slot):
    """Union of charges in existing historical journals, never their cumulative totals.

    HIST/SUP are distinct per-grant charges. The qualification lineage includes
    its original reservation; the one-shot is separate. BUDGET is a pinned limit
    configuration, not another usage journal. No historical record is written.
    Also used by the existing delegated ledger reader before runtime reservation.
    """
    spent = set()
    for filename, checksum, validator in (
        (Q.ADDRESSED_LEDGER, A.HIST, Q.addressed_ledger),
        (Q.SUPPLEMENT_LEDGER, A.SUP, Q.supplemental_ledger),
    ):
        path = r.STATE / filename
        Q.raw_pin(r, path, checksum)
        value = validator(r.read(path, 0))
        operations = [row['operation'] for row in value['grants'].values() if row['operation'] is not None]
        need(len(operations) == len(set(operations)) == value['used_calls'], 'historical charge/count drift')
        need(not spent.intersection(operations), 'duplicate historical grant charge')
        spent.update(operations)
    Q.raw_pin(r, getattr(r, 'BUDGET', R.BUDGET), A.BUDGET)
    path = r.STATE / Q.LINEAGE
    if path.exists():
        Q.raw_pin(r, path, Q.LINEAGE_RAW)
        value = r.read(path, 0)
        need(value.get('schema') == 'GB_AGY_29_LINEAGE_V1' and value.get('ceiling') == 2
             and type(value.get('used_calls')) is int and value['used_calls'] in (1, 2)
             and value.get('parent_task') == Q.PARENT_TASK, 'historical qualification lineage drift')
        spent.add(Q.PARENT_OPERATION)
        if value['used_calls'] == 2:
            need(value.get('reserved_operation') == Q.SECOND_OPERATION, 'missing qualification charge')
            spent.add(value['reserved_operation'])
    else:
        need(not {Q.PARENT_OPERATION, Q.SECOND_OPERATION}.intersection(slot['operations']),
             'missing historical qualification lineage')
    path = r.STATE / Q.FIXED
    if path.exists():
        value = r.read(path, 0)
        need(digest(value) == Q.PARENT_RESERVATION_DIGEST and value.get('operation') == Q.PARENT_OPERATION,
             'historical original reservation drift')
        spent.add(value['operation'])  # Already included when the lineage exists.
    path = r.STATE / Q.GRANT_LEDGER
    if path.exists():
        value = r.read(path, 0)
        need(value.get('schema') == Q.GRANT_SCHEMA and value.get('ceiling') == 1
             and type(value.get('used_calls')) is int and value['used_calls'] == 1
             and value.get('task_sha256') == Q.THIRD_TASK
             and value.get('reserved_operation') == Q.THIRD_OPERATION, 'historical one-shot charge drift')
        spent.add(value['reserved_operation'])
    else:
        need(Q.THIRD_OPERATION not in slot['operations'], 'missing historical one-shot ledger')
    need(all(operation in slot['operations'] for operation in spent), 'historical charged operation missing')
    return spent


def lineage(slot, *, exclude=None):
    """Read the whole lineage; count unique charges, not cumulative counters."""
    pins, packages, spent = [], [], historical_operations(R, slot)
    for path in sorted(R.STATE.glob(Q.OWNER_PACKAGE_LEDGER_PREFIX + '*.json')):
        if path == exclude or path.name.startswith(A.RECEIPT_PREFIX):
            continue
        value = Q.owner_package_ledger(R.read(path, 0))
        need(path == Q.owner_package_path(R, next(iter(value['grants'].values()))['grant']),
             'package filename/identity mismatch')
        if 'delegation' in value:
            receipt = receipt_path(value['delegation']['admission_id'])
        else:
            receipt = R.STATE / (A.RECEIPT_PREFIX + str(value['owner_comment']) + '.json')
        proof = R.read(receipt, 0)
        initial = copy.deepcopy(value)
        for row in initial['grants'].values():
            row['operation'] = None
        initial['used_calls'] = initial.get('delegation', {}).get('inherited_calls', 0)
        need(proof.get('schema') in (TRANSACTION, 'GB_AGY_29_OWNER_PACKAGE_TRANSACTION_V2')
             and proof.get('phase') == 'complete' and proof.get('body_sha256') == value['body_sha256']
             and proof.get('controller_sha') == value['controller_sha']
             and proof.get('owner_comment') == value['owner_comment']
             and proof.get('package_sha256') == hashlib.sha256(A.encoded(initial)).hexdigest(),
             'unfinished or changed package receipt')
        for pin in value.get('delegation', {}).get('prior_packages', []):
            Q.raw_pin(R, R.STATE/pin['path'], pin['sha256'])
        pins.append(dict(path=path.name, sha256=A.sha(path)))
        packages.append(value)
        for row in value['grants'].values():
            if row['operation'] is not None:
                need(row['operation'] not in spent, 'duplicate lineage charge')
                spent.add(row['operation'])
                op = slot['operations'].get(row['operation'], {})
                q = A.exact_qualification(row['grant'], value['controller_sha'])
                need(op.get('task_hash') == q['task_sha256'], 'charged operation missing or different task')
                reservation = R.read(Q.reservation_path(R.STATE, q), 0)
                need(reservation.get('schema') == 'GB_ANTIGRAVITY_QA_29_RESERVATION_V1'
                     and reservation.get('operation') == row['operation']
                     and reservation.get('task_hash') == q['task_sha256']
                     and reservation.get('descriptor') == q and reservation.get('finished_at') is not None
                     and (reservation.get('result') or {}).get('status') == (op.get('result') or {}).get('status'),
                     'unfinished or changed model reservation receipt')
    for path in sorted(R.STATE.glob('antigravity-29-addressed-*.json')):
        if not re.fullmatch(r'antigravity-29-addressed-[a-f0-9]{64}\.json', path.name):
            continue
        reservation = R.read(path, 0)
        g = reservation.get('descriptor', {}).get('qualification_grant')
        if Q.owner_package(g):
            need(reservation.get('operation') in spent, 'orphan model reservation receipt')
            need(path == Q.reservation_path(R.STATE, reservation['descriptor']), 'model reservation filename drift')
    # All receipts, including personal Owner QA intents, must be complete. The
    # only resumable intent is THIS exact request, handled by run() below.
    for path in sorted(R.STATE.glob(A.RECEIPT_PREFIX + '*.json')):
        if exclude is not None and path == receipt_path(exclude.stem.rsplit('delegated-', 1)[-1]):
            continue
        need(R.read(path, 0).get('phase') == 'complete', 'unfinished previous admission intent')
    for key, op in slot['operations'].items():
        result = op.get('result') or {}
        need(op.get('finished_at') is not None and result.get('status') in ('confirmed', 'failed', 'unknown'),
             'unfinished operation: ' + key)
        # Existing exact reconciliations can establish scheduling release while
        # preserving UNKNOWN. No new reconciliation authority is implemented.
        if result.get('status') == 'unknown' and result.get('safe_release') is not True:
            reconciled = False
            for filename, field, expected in (
                (Q.RECONCILIATION, 'parent_operation_sha256', Q.PARENT_DIGEST),
                (Q.GRANT_RECONCILIATION, 'second_operation_sha256', Q.SECOND_DIGEST),
                (Q.ADDRESSED_RECONCILIATION, 'third_operation_sha256', Q.THIRD_DIGEST),
            ):
                proof_path = R.STATE / filename
                if digest(op) == expected and proof_path.exists():
                    proof = R.read(proof_path, 0)
                    reconciled = proof.get('phase') == 'complete' and proof.get(field) == expected
            need(reconciled, 'unresolved UNKNOWN: ' + key)
        # Refusals are not repeat authority even if a scheduler reservation was released.
        need(not result.get('safety_refusal') and result.get('error_class') != 'safety_refusal',
             'platform/model safety refusal requires review: ' + key)
    return pins, packages, len(spent)


def build_package(comment, v, role, request, controller, slot, pins, packages, used):
    remaining = dict(used_calls=used, package_calls=max(0, v['max_calls_per_package']-used),
                     total_calls=max(0, v['max_total_calls']-used),
                     packages=max(0, v['max_packages']-len(packages)))
    if used >= min(v['max_calls_per_package'], v['max_total_calls']) or len(packages) >= v['max_packages']:
        error = NeedsOwner('delegation call budget exhausted' if used >= min(
            v['max_calls_per_package'], v['max_total_calls']) else 'delegation package budget exhausted')
        error.remaining = remaining
        raise error
    for previous in packages:
        for row in previous['grants'].values():
            g = row['grant']
            need((g['role'], g['head'], g['input_sha256']) !=
                 (role, request['source_head'], request['input_sha256']),
                 'unchanged candidate/role/input already admitted; needs technical review')
    admission_id = identity(29, role, comment['id'], request)
    analysis = None
    if role == ROLES[1]:
        for previous in packages:
            for row in previous['grants'].values():
                g = row['grant']
                if g['role'] == ROLES[0] and row['operation'] is not None and (
                    g['base'], g['head'], g['controller_revision']) == (
                        request['source_base'], request['source_head'], controller):
                    # Keep exact analysis grant including its provenance for runtime
                    # marker comparison; validation below pins the predecessor ledger.
                    analysis = copy.deepcopy(row)
        need(analysis is not None, 'no matching completed analysis; needs technical review')
    p = dict(schema=PROVENANCE, comment=comment, request=request, role=role, admission_id=admission_id,
             inherited_calls=used, prior_packages=pins, analysis=analysis)
    g = dict(schema=Q.ADDRESSED_SCHEMA, lineage=Q.ADDRESSED_LINEAGE, owner_comment=comment['id'],
             role=role, controller_revision=controller, cli_sha256=N.AGY_SHA256, rules_sha256=A.RULES,
             base=request['source_base'], head=request['source_head'], input_revision=request['input_revision'],
             input_path=request['input_path'], input_sha256=request['input_sha256'], timeout=1800,
             max_output_bytes=N.MAX_OUT, permission_mode=N.PERMISSION_MODE, input_transport='stream-json',
             ceiling=1, delegation=p)
    ledger = dict(schema=Q.OWNER_PACKAGE_SCHEMA, owner_comment=comment['id'], owner_id=A.OWNER_ID, issue=29,
                  controller_sha=controller, rules_sha256=A.RULES, source_base=g['base'], source_head=g['head'],
                  body_sha256=hashlib.sha256(comment['body'].encode()).hexdigest(),
                  ceiling=min(v['max_calls_per_package'], v['max_total_calls']), used_calls=used,
                  grants={digest(g): dict(grant=g, operation=None)}, previous_addressed_sha256=A.HIST,
                  previous_supplement_sha256=A.SUP, delegation=p)
    Q.owner_package_ledger(ledger)
    # Reuse the fixed native root Git read surface; a missing base is not a
    # valid continuation even when the HEAD input happens to exist.
    verify_materialization(g)
    return ledger


def verify_materialization(grant):
    try:
        N.git(N.QUALIFICATION_WORK, 'show', grant['base'] + ':' + Q.ANALYSIS_INPUT,
              _addressed_installer=True)
    except N.ReviewError:
        raise Refused('source base unavailable at exact immutable revision') from None
    try:
        Q.addressed_input(N.QUALIFICATION_WORK, grant, installer=True)
    except N.ReviewError:
        raise Refused('source HEAD or immutable input unavailable; native Git precheck failed') from None


def result(status, *, admission_id, reason, remaining=None, dry_run=False, replayed=False):
    return dict(status=status, admission_id=admission_id,
                package_path=str(package_path(admission_id)) if admission_id else None,
                receipt_path=str(receipt_path(admission_id)) if admission_id else None,
                reason=reason, remaining_budget=remaining, model_calls=0,
                needs_review=status in ('BLOCKED', 'NEEDS_OWNER'), dry_run=dry_run, replayed=replayed)


def recoverable_sizes(transaction, package, newmarker, newslot):
    """Check exact atomic JSON bytes for EVERY write before the first mutation.

    The raw slot journal is JSON-escaped again inside the transaction. Its own
    read limit therefore cannot guarantee the intent/complete receipt will fit.
    Check both phases (complete is longer), including all other commit targets.
    A.encoded uses the same serialization as receiver.atomic; keep one byte of
    headroom even though the readers accept an object exactly at their limit.
    This admission-only preflight leaves the personal Owner path unchanged.
    """
    for name, value, limit in (
        ('intent', transaction, METADATA_READ_LIMIT),
        ('complete receipt', dict(transaction, phase='complete'), METADATA_READ_LIMIT),
        ('package', package, METADATA_READ_LIMIT),
        ('marker', newmarker, MARKER_READ_LIMIT),
        ('slot journal', newslot, METADATA_READ_LIMIT),
        ('disabled policy', dict(transaction['policy_before'], mode='disabled'), METADATA_READ_LIMIT),
        ('active policy', dict(transaction['policy_before'], mode='active'), METADATA_READ_LIMIT),
    ):
        need(len(A.encoded(value)) < limit,
             'admission ' + name + ' must be strictly below recovery read limit: ' + str(limit) + ' bytes')


def run(mode, issue, role, comment_id, request):
    """Caller holds the receiver lock; all state access uses trusted receiver helpers."""
    admission_id = identity(issue, role, comment_id, request)
    path, receipt = package_path(admission_id), receipt_path(admission_id)
    # Local idempotence comes before any remote verification, even after expiry
    # or when GitHub is unavailable. Receipts bind the actual posted comment ID.
    existing = R.read(receipt, 0) if receipt.exists() else None
    if mode == '--status' and existing is None:
        return result('BLOCKED', admission_id=admission_id, reason='request not registered')
    authority(type(comment_id) is int and comment_id > 0, 'no valid delegation comment')
    policy = R.read(R.POLICY, 0)
    controller = policy['controller_sha']
    authority(hexstr(controller, 40), 'wrong installed controller')
    if existing is not None:
        comment = existing.get('comment')
        v = validate_delegation(comment, comment_id, controller=controller)
        validate_request(issue, role, request, v)
        need(existing.get('schema') == TRANSACTION and existing.get('admission_id') == admission_id
             and existing.get('controller_sha') == controller and existing.get('request') == request
             and existing.get('owner_comment') == comment_id and existing.get('role') == role
             and existing.get('phase') in ('intent', 'complete'),
             'foreign or changed admission intent')
        need(policy in (existing['policy_before'], dict(existing['policy_before'], mode='disabled')),
             'policy changed since admission intent')
        if existing['phase'] == 'complete' and policy['mode'] == 'active':
            package = Q.owner_package_ledger(R.read(path, 0))
            need(package['delegation']['admission_id'] == admission_id
                 and package['delegation']['comment'] == comment, 'completed package drift')
            return result('GRANTED', admission_id=admission_id, reason='same request already registered',
                          remaining=existing['remaining_budget'], replayed=True)
    if mode == '--status':
        return result('BLOCKED', admission_id=admission_id,
                      reason='intent needs --apply recovery' if existing else 'request not registered')
    if existing:
        need(mode == '--apply', 'dry-run cannot resume intent')
        # Recovery may complete only authority that is still valid. Inspection
        # and completed replay above never acquire or renew any authority.
        validate_delegation(comment, comment_id, controller=controller, now=dt.datetime.now(dt.timezone.utc))
    else:
        comment = fetch_delegation(comment_id)
        v = validate_delegation(comment, comment_id, controller=controller, now=dt.datetime.now(dt.timezone.utc))
        validate_request(issue, role, request, v)
    slot = A.quiescent(controller)
    marker = R.read(N.MARKER, 0)
    need(marker.get('phase') == 'canary' and marker.get('executor_uid') == 978,
         'existing isolated canary marker required')
    pins, packages, used = lineage(slot, exclude=path if existing else None)
    if existing:
        package = existing['package']
        Q.owner_package_ledger(package)
        verify_materialization(next(iter(package['grants'].values()))['grant'])
        need(package['delegation']['prior_packages'] == pins
             and package['delegation']['inherited_calls'] == used, 'intent lineage changed')
        prior_slot = loads(existing['slot_before_raw'])
        prior_marker = existing['marker_before']
    else:
        authority(policy['mode'] == 'active', 'new admission requires active installed controller')
        need(not path.exists(), 'orphan package without receipt')
        package = build_package(comment, v, role, request, controller, slot, pins, packages, used)
        prior_slot, prior_marker = slot, marker
    action = 'analysis' if role == ROLES[0] else 'qa'
    q, newmarker, newslot = A.transition_plan(action, comment_id, controller, prior_slot, prior_marker, package)
    remaining = dict(used_calls=used, package_calls=package['ceiling'] - used,
                     total_calls=v['max_total_calls'] - used, packages=v['max_packages'] - len(packages) - 1)
    targets = dict(slot_after_sha256=hashlib.sha256(A.encoded(newslot)).hexdigest(),
                   marker_after_sha256=hashlib.sha256(A.encoded(newmarker)).hexdigest(),
                   package_sha256=hashlib.sha256(A.encoded(package)).hexdigest(), task_sha256=q['task_sha256'])
    if existing:
        need(all(existing[k] == val for k, val in targets.items())
             and existing['slot_before_sha256'] == hashlib.sha256(existing['slot_before_raw'].encode()).hexdigest()
             and existing['marker_before_sha256'] == hashlib.sha256(A.encoded(prior_marker)).hexdigest(),
             'intent target drift')
        transaction = existing
    else:
        raw = (R.STATE / 'slot2.json').read_bytes()
        transaction = dict(schema=TRANSACTION, phase='intent', action=action, admission_id=admission_id,
                           owner_comment=comment_id, controller_sha=controller, request=request, comment=comment,
                           body_sha256=package['body_sha256'], package=package,
                           slot_before_raw=raw.decode(), slot_before_sha256=A.sha(R.STATE / 'slot2.json'),
                           marker_before=marker, marker_before_sha256=A.sha(N.MARKER),
                           policy_before=policy, historic_sha256=A.HIST, supplement_sha256=A.SUP,
                           budget_sha256=A.BUDGET, charged_calls=0, role=role, remaining_budget=remaining, **targets)
    recoverable_sizes(transaction, package, newmarker, newslot)
    now_slot, now_marker = A.sha(R.STATE / 'slot2.json'), A.sha(N.MARKER)
    need(now_slot in (transaction['slot_before_sha256'], transaction['slot_after_sha256'])
         and now_marker in (transaction['marker_before_sha256'], transaction['marker_after_sha256'])
         and (A.sha(path) if path.exists() else None) in (None, transaction['package_sha256']),
         'foreign change during admission')
    if existing and existing['phase'] == 'intent' and policy['mode'] == 'active':
        need(now_slot == transaction['slot_before_sha256'] and now_marker == transaction['marker_before_sha256']
             and not path.exists(), 'incomplete active admission exposed grants')
    if mode == '--dry-run':
        return result('GRANTED', admission_id=admission_id, reason='validated; no writes', remaining=remaining, dry_run=True)
    A.commit_transaction(existing=existing, receipt=receipt, transaction=transaction, policy=policy, action=action,
                         path=path, package=package, newmarker=newmarker, newslot=newslot, q=q,
                         now_slot=now_slot, now_marker=now_marker, controller=controller)
    return result('GRANTED', admission_id=admission_id, replayed=existing is not None,
                  reason='recovered exact intent' if existing else 'finite package registered', remaining=remaining)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    for mode in ('--dry-run', '--apply', '--status'):
        modes.add_argument(mode, dest='mode', action='store_const', const=mode)
    parser.add_argument('--issue', type=int, required=True)
    parser.add_argument('--role', required=True)
    parser.add_argument('--delegation-comment', '--delegation-comment-id', dest='delegation_comment_id',
                        type=int, required=True)
    parser.add_argument('--request-json', required=True, help='JSON object, not a filename')
    args = parser.parse_args(argv)
    lock = None
    # A malformed JSON request still has a stable refusal identity. Valid JSON
    # uses the same canonical request digest as enrollment and replay.
    admission_id = identity(args.issue, args.role, args.delegation_comment_id, args.request_json)
    try:
        request = loads(args.request_json)
        admission_id = identity(args.issue, args.role, args.delegation_comment_id, request)
        need(os.geteuid() == 0, 'trusted root required')
        R.trusted_tree(Path(__file__).resolve())
        # Same mutex used by owner_package_admission and receiver. No new lock domain.
        lock = os.open(R.STATE / 'controller.lock', os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
        import fcntl
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        value = run(args.mode, args.issue, args.role, args.delegation_comment_id, request)
    except (Refused, N.ReviewError, ValueError, TypeError, KeyError, OSError) as error:
        value = result('NEEDS_OWNER' if isinstance(error, NeedsOwner) else 'BLOCKED',
                       admission_id=admission_id, reason=str(error), remaining=getattr(error, 'remaining', None))
    finally:
        if lock is not None:
            os.close(lock)
    print(json.dumps(value, sort_keys=True, allow_nan=False))


if __name__ == '__main__':
    main()

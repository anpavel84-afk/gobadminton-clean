#!/usr/bin/env python3
"""One exact Issue#29 scheduling reconciliation, NOT replay, refund or QA acceptance.

Review/install this helper only through the existing trusted OPS process. The
real --apply requires the original installed controller, root identity and an
already-disabled policy at the normal quiescent boundary. No bypass of platform
permissions or protected-state approval is attempted by this source package.
"""
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys

# Trusted installed receiver remains the single root metadata/locking authority.
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
try:
    import receiver as R
    from core import digest, need, loads
    from antigravity_qa_recovery import executor_quiet
except ImportError:
    R = None  # Pure offline unit tests still import the module.
    class Refused(Exception): pass
    def need(ok, msg):
        if not ok: raise Refused(msg)
    def digest(v): return hashlib.sha256(json.dumps(v, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    def loads(b): return json.loads(b)
    def executor_quiet(): raise Refused('no installed executor proof')

EXPECTED = {
    'controller': '3ce9a1339a73e1c9b3fb2ca5b269483faf2fc4f8',
    'operation': 'c4494f9b91d6e4c21b15ef4eac7432228dfb71ebaa4bcfbc02f454f6cd7cff74',
    'operation_sha256': '686868dd01161a00a996d53385ecb9a217d8ba057cec3acd90a320692d2df679',
    'slot_before_sha256': '78c497982f91a9e49f412ef3413f7e5e0cbd2715b91bee944c64b1f76e10eeb9',
    'ledger_sha256': '897ff2537e1f75049550440a0788dc3fe2627bdb1a47b40cc5c82eada580c255',
    'reservation_sha256': '9c5ba3f69ae89c93c34eb2967a55c98b999341106b04a7e465dcfd3f4574142d',
    'checkpoint_sha256': '6b5c9fab7fe8c73a9164d2fe7a1731232bfeb80cbf78746ab09a9b5e57e6b4eb',
    'task_sha256': '9fd1933560ffa788c8b18101aa9312eef955c2332a7d4782da5f896a17c379f1',
    'run': 39957073497,
    'evidence_id': 'afb87df5066a48e393174ad79f2727b6',
    'generation_before': 90,
    'generation_after': 91,
    'pid': 2186294,
    'pid_start': '41402686',
    'boot': '447e18ce-024d-4230-b88f-bd8ca81e2a9e',
    'head': '12f35ac4430348ae811cf712d9bb24d2a19b62e6',
    'evidence_phase': 'preflight',
    'error_code': 'AGY_PRECHECK_FAILED',
    'terminal_evidence_sha256': 'e2bbe13cba66c60aa7c81c38141fb1290ce868f7568bf213372a24d5490e3270',
}
STATE = Path('/var/lib/gobadminton-actions-train')
AUTONOMY = Path('/var/lib/gobadminton-autonomy')
RECEIPT = STATE / 'agy29-qa-unknown90-scheduling-reconcile.json'
MARKER = Path('/etc/gobadminton-slots/antigravity-qa.json')
PHASE = AUTONOMY / 'slots/slot2/antigravity-evidence' / EXPECTED['evidence_id'] / 'phase-03.json'
BEFORE = STATE / 'slot2.json'
LEDGER = STATE / 'antigravity-29-addressed-ledger.json'
RESERVATION = STATE / ('antigravity-29-addressed-' + EXPECTED['task_sha256'] + '.json')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(obj):
    return json.dumps(obj, sort_keys=True).encode('utf-8')


def change_only_occupancy(before):
    """Closed, lossless view of the *same* ledger without touching op history."""
    need(type(before) is dict and before.get('generation') == EXPECTED['generation_before']
         and before.get('pending') == EXPECTED['operation'], 'foreign pending/generation')
    after = copy.deepcopy(before)
    after.update(pending=None, generation=EXPECTED['generation_after'])
    need(set(after) == set(before) and all(after[key] == value for key, value in before.items()
         if key not in ('pending','generation')), 'other slot data would change')
    return after


def validate_preflight(*, raw, j, checkpoint, ledger, ledger_raw, reservation,
                       reservation_raw, terminal, terminal_raw, marker, policy, process_exists, process_alive):
    """Pure bounded verification. A false/unknown proof is a refusal, never cleanup."""
    need(sha(raw) == EXPECTED['slot_before_sha256'], 'original slot raw hash mismatch')
    need(j == loads(raw), 'different parsed original slot')
    op = j.get('operations', {}).get(EXPECTED['operation'])
    need(isinstance(op, dict) and digest(op) == EXPECTED['operation_sha256'],
         'exact operation history drift')
    need(op.get('run') == EXPECTED['run'] and op.get('run_attempt') == 1
         and op.get('task_hash') == EXPECTED['task_sha256']
         and op.get('before') == op.get('after') == EXPECTED['checkpoint_sha256']
         and op.get('checkpoint_before') == checkpoint,
         'source run/checkpoint mismatch')
    expected_binding = {'action': 'train', 'attempt': 0, 'generation': 90,
                        'head': EXPECTED['head'], 'issue': 29, 'phase': 'idle',
                        'profile': 'agy', 'slot': 'slot2', 'stage': 'qa_qualification'}
    need(op.get('binding') == expected_binding, 'foreign bounded QA operation')
    result = op.get('result')
    need(isinstance(result, dict) and result.get('status') == 'unknown'
         and result.get('safe_release') is False
         and result.get('reason') == EXPECTED['error_code']
         and result.get('adapter_error') == {'code': EXPECTED['error_code'],
                                             'evidence_id': EXPECTED['evidence_id'],
                                             'phase': EXPECTED['evidence_phase']},
         'historical UNKNOWN must remain untouched')
    process = {'pid': EXPECTED['pid'], 'start': EXPECTED['pid_start'], 'boot': EXPECTED['boot']}
    need(op.get('process') == process and process_exists is False and process_alive is False,
         'original executor may be live or PID reused')
    need(checkpoint.get('active') is None and digest(checkpoint) == EXPECTED['checkpoint_sha256'],
         'candidate checkpoint changed')
    need(sha(ledger_raw) == EXPECTED['ledger_sha256'] and ledger == loads(ledger_raw)
         and ledger.get('ceiling') == 4 and ledger.get('used_calls') == 2,
         'original paid-attempt history drift')
    grants = ledger.get('grants', {})
    need(any(row.get('operation') == EXPECTED['operation']
             and row.get('grant', {}).get('role') == 'independent_qa'
             and row.get('grant', {}).get('head') == EXPECTED['head']
             for row in grants.values()), 'missing consumed exact grant')
    need(sha(reservation_raw) == EXPECTED['reservation_sha256']
         and reservation == loads(reservation_raw)
         and reservation.get('operation') == EXPECTED['operation']
         and reservation.get('task_hash') == EXPECTED['task_sha256']
         and reservation.get('result', {}).get('status') == 'unknown'
         and reservation.get('result', {}).get('safe_release') is False,
         'reservation must remain spent')
    need(sha(terminal_raw) == EXPECTED['terminal_evidence_sha256']
         and terminal == loads(terminal_raw), 'terminal evidence content drift')
    need(isinstance(terminal, dict) and terminal.get('phase') == 'preflight'
         and terminal.get('error_code') == EXPECTED['error_code']
         and terminal.get('charge_state') == 'not_charged'
         and terminal.get('input_sha256') is None and terminal.get('status') == 'unknown',
         'not proven pre-model')
    need(marker.get('phase') == 'canary' and marker.get('schema') == 'GB_ANTIGRAVITY_QA_29_V1',
         'canary marker drift')
    need(policy.get('controller_sha') == EXPECTED['controller']
         and policy.get('mode') in ('active', 'disabled'), 'installed controller drift')
    after = change_only_occupancy(j)
    return after


def receipt_template(raw, after):
    return {
        'schema': 'GB_AGY_29_UNKNOWN90_SCHEDULING_RECONCILE_V1',
        'phase': 'intent', 'controller_sha': EXPECTED['controller'],
        'operation': EXPECTED['operation'], 'operation_sha256': EXPECTED['operation_sha256'],
        'run': EXPECTED['run'], 'generation_before': 90, 'generation_after': 91,
        'slot_before_sha256': EXPECTED['slot_before_sha256'],
        'slot_after_sha256': sha(encoded(after)),
        'slot_before_raw': raw.decode('utf-8'),
        'checkpoint_sha256': EXPECTED['checkpoint_sha256'],
        'ledger_sha256': EXPECTED['ledger_sha256'],
        'reservation_sha256': EXPECTED['reservation_sha256'],
        'evidence_id': EXPECTED['evidence_id'],
        'action': 'scheduling_occupancy_only',
        'provider_calls': 0,
        'attempts_refunded': 0,
    }


def validate_receipt(receipt):
    need(type(receipt) is dict and set(receipt) == set(receipt_template(b'{}', {})),
         'foreign journal schema')
    need(receipt['schema'] == 'GB_AGY_29_UNKNOWN90_SCHEDULING_RECONCILE_V1'
         and receipt['phase'] in ('intent','complete')
         and receipt['controller_sha'] == EXPECTED['controller']
         and receipt['operation'] == EXPECTED['operation']
         and receipt['operation_sha256'] == EXPECTED['operation_sha256']
         and receipt['run'] == EXPECTED['run']
         and receipt['generation_before'] == 90 and receipt['generation_after'] == 91
         and receipt['slot_before_sha256'] == EXPECTED['slot_before_sha256']
         and receipt['checkpoint_sha256'] == EXPECTED['checkpoint_sha256']
         and receipt['ledger_sha256'] == EXPECTED['ledger_sha256']
         and receipt['reservation_sha256'] == EXPECTED['reservation_sha256']
         and receipt['evidence_id'] == EXPECTED['evidence_id']
         and receipt['action'] == 'scheduling_occupancy_only'
         and receipt['provider_calls'] == 0 and receipt['attempts_refunded'] == 0,
         'reconciliation receipt drift')
    before_bytes = receipt['slot_before_raw'].encode('utf-8')
    need(sha(before_bytes) == EXPECTED['slot_before_sha256'], 'backup original raw drift')
    before = loads(before_bytes);after = change_only_occupancy(before)
    need(sha(encoded(after)) == receipt['slot_after_sha256'], 'future occupancy drift')
    return before, after


def validate_termination(r):
    proc = {'pid': EXPECTED['pid'], 'start': EXPECTED['pid_start'], 'boot': EXPECTED['boot']}
    # If PID has been reused, even a different current process fails closed.
    pid_exists = Path('/proc',str(EXPECTED['pid'])).exists()
    need(not pid_exists and r.identity(EXPECTED['pid']) is None and not r.alive(proc),
         'original process live, reused, or uninspectable')
    executor_quiet()
    r.no_models(978,'slot2')
    r.units_quiet(('gobadminton-supervisor.service','gobadminton-slot@slot2.service'))
    r.free_lock(AUTONOMY/'slots/slot2/worker.lock')
    r.free_lock(AUTONOMY/'locks/slot2.lease')


def execute(mode, r=R):
    need(mode in ('dry-run','apply'), 'only dry-run/apply supported')
    need(os.geteuid() == 0 and r is not None, 'root trusted operator required')
    r.trusted_tree(Path(__file__).resolve())
    r.trusted_tree(Path('/usr/local/lib/gb-actions-train/receiver.py'))
    # Nonblocking existing controller lock (not a new lock or scheduler).
    lockfd = os.open(STATE/'controller.lock', os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        try: fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('controller busy; no write performed')
        policy=r.read(r.POLICY,0)
        need(policy.get('controller_sha') == EXPECTED['controller'], 'installed controller changed')
        if mode == 'apply':
            need(policy['mode'] == 'disabled', 'controlled disabled policy boundary required')
        raw=BEFORE.read_bytes()
        slot=r.read(BEFORE,0)
        checkpoint,_=r.checkpoint('slot2')
        ledger_raw=LEDGER.read_bytes()
        reserve_raw=RESERVATION.read_bytes()
        ledger=r.read(LEDGER,0)
        reservation=r.read(RESERVATION,0)
        terminal=r.read(PHASE,978,8192)
        terminal_raw=PHASE.read_bytes()
        marker=r.read(MARKER,0)
        before_receipt=r.read(RECEIPT,0) if RECEIPT.exists() else None
        need(checkpoint.get('active') is None and digest(checkpoint) == EXPECTED['checkpoint_sha256'],
             'checkpoint changed during incomplete transaction')
        if before_receipt:
            before, after = validate_receipt(before_receipt)
            need(sha(raw) in (EXPECTED['slot_before_sha256'],sha(encoded(after))),
                 'unexpected slot during crash recovery')
            need(slot == before or slot == after, 'reconciliation slot is not exact')
            # Irrespective of crash phase, original evidence and credentials remain pinned.
            need(sha(ledger_raw) == EXPECTED['ledger_sha256']
                 and sha(reserve_raw) == EXPECTED['reservation_sha256'], 'spent grant drift')
            if slot == before:
                validate_preflight(raw=raw,j=slot,checkpoint=checkpoint,ledger=ledger,
                                   ledger_raw=ledger_raw,reservation=reservation,
                                   reservation_raw=reserve_raw,terminal=terminal,terminal_raw=terminal_raw,marker=marker,
                                   policy=policy,process_exists=Path('/proc',str(EXPECTED['pid'])).exists(),
                                   process_alive=r.alive({'pid':EXPECTED['pid'],
                                        'start':EXPECTED['pid_start'],'boot':EXPECTED['boot']}))
        else:
            need(sha(raw) == EXPECTED['slot_before_sha256'],
                 'slot changed before reconciliation; do not reset blindly')
            after=validate_preflight(raw=raw,j=slot,checkpoint=checkpoint,ledger=ledger,
                                    ledger_raw=ledger_raw,reservation=reservation,
                                    reservation_raw=reserve_raw,terminal=terminal,terminal_raw=terminal_raw,marker=marker,
                                    policy=policy,process_exists=Path('/proc',str(EXPECTED['pid'])).exists(),
                                    process_alive=r.alive({'pid':EXPECTED['pid'],
                                        'start':EXPECTED['pid_start'],'boot':EXPECTED['boot']}))
            before_receipt=receipt_template(raw,after)
        need(sha(terminal_raw) == EXPECTED['terminal_evidence_sha256'],
             'terminal evidence changed during restart')
        validate_termination(r)
        target_sha=sha(encoded(after))
        if mode == 'dry-run':
            return {'status':'READY_FOR_DISABLED_BOUNDARY' if policy['mode']=='active' else 'READY_TO_APPLY',
                    'slot':'slot2','operation':EXPECTED['operation'],'generation_before':90,
                    'generation_after':91,'checkpoint_unchanged':True,'history_preserved':True,
                    'slot_before_sha256':EXPECTED['slot_before_sha256'],
                    'slot_after_sha256':target_sha,'write_performed':False}
        if before_receipt['phase']=='complete':
            need(slot==after,'reconciliation receipt complete but slot drift')
            return {'status':'ALREADY_COMPLETE','operation':EXPECTED['operation'],
                    'slot_after_sha256':target_sha,'write_performed':False}
        if not RECEIPT.exists():
            r.atomic(RECEIPT,before_receipt,mode=0o600)  # write-ahead, full original backup
        if slot != after:
            need(slot == loads(before_receipt['slot_before_raw']) and sha(BEFORE.read_bytes()) == EXPECTED['slot_before_sha256'],
                 'slot drift before atomic')
            r.atomic(BEFORE,after)                         # ONLY occupancy+generation change
        r.atomic(RECEIPT,{**before_receipt,'phase':'complete'},mode=0o600)
        need(r.read(BEFORE,0)==after and r.read(RECEIPT,0)['phase']=='complete',
             'reconciliation postcondition failure')
        return {'status':'COMPLETE','operation':EXPECTED['operation'],
                'generation':91,'slot_after_sha256':target_sha,
                'write_performed':True,'provider_calls':0,'attempts_refunded':0}
    finally:
        os.close(lockfd)


def main():
    import argparse
    p=argparse.ArgumentParser(description='Exact #29 pre-model UNKNOWN scheduling-only reconciliation')
    p.add_argument('action',choices=('dry-run','apply'))
    args=p.parse_args()
    result=execute(args.action)
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':
    main()

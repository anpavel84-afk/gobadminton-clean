"""Additive TEST PLAN checks. Trusted tooling only; candidate Git objects are DATA."""
import builtins
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import ModuleType

PINS = {
    'safe_io.py': '29e8491e7fdfa67c577a4c4f64f6359d876a6d82d7dcba0b7959ccdbde2f1e60',
    'catalog.py': 'f6bdb7f7ad65aa212b17062a3b20d6cac70f1ff5b93b8b7d079002b6ddf239f9',
    'tier_classifier.py': 'b91d63fc3edc6814a511350cb9bb59c933887eb69588af2f2e74dd12bc52b4ca',
    'plan_block.py': '09fb047673d48e193c15163423da9ff3849502b181e84830e5008d9c918ecebe',
    'verify_profile.py': '88f06439c18fdc7441a8ec1eb5c6bff24891b0e27f394f8d038aaa9dea3290b1',
    'test_groups.json': 'ba25961ba9b2f41750387e2d47d0465fc518214512d13b76f62ec5a9bf3479c2',
}
# Single status policy for guidance and evidence consumers. No cache is evidence.
STATUSES = {s: (s == 'PASS') for s in
            ('PASS', 'FAIL', 'NOT_TESTED', 'ENV_ERROR', 'TIMEOUT', 'UNKNOWN')}
OK = {'OK', 'OVER_DECLARED'}
STAGES = {'claim', 'author', 'publish', 'qa', 'promote'}


class GateError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def testing_directory():
    here = Path(__file__).absolute().parent
    installed = here / 'testing'
    return installed if installed.exists() else here.parent / 'testing'


def _read(path):
    """No-follow parents/files, and import the exact bytes that were hashed."""
    path = path.absolute()
    fd = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        source = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(source, 'rb') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise GateError('TESTING_PIN_MISMATCH')
            return stream.read()
    finally:
        os.close(fd)


def trusted_tools():
    """Private imports ignore sys.path/sys.modules copies of testing modules."""
    directory = testing_directory()
    try:
        sources = {name: _read(directory / name) for name in PINS}
        if any(hashlib.sha256(sources[n]).hexdigest() != pin for n, pin in PINS.items()):
            raise GateError('TESTING_PIN_MISMATCH')
    except OSError as exc:
        raise GateError('TESTING_PIN_MISMATCH') from exc
    sys.dont_write_bytecode = True
    modules = {}
    def importer(name, globals=None, locals=None, fromlist=(), level=0):
        filename = name + '.py'
        if level == 0 and filename in sources:
            if name not in modules:
                module = ModuleType(name)
                module.__file__ = str(directory / filename)
                module.__dict__['__builtins__'] = dict(vars(builtins), __import__=importer)
                modules[name] = module
                exec(compile(sources[filename], module.__file__, 'exec'), module.__dict__)
                if name == 'catalog':
                    # parse() must use the same verified catalog bytes, without a second read.
                    module.read_bytes = lambda path, **kw: sources['test_groups.json']
            return modules[name]
        return builtins.__import__(name, globals, locals, fromlist, level)
    return importer('plan_block'), importer('tier_classifier'), importer('verify_profile')


def evidence_passes(evidence, *, head, fingerprint):
    """Identity checks supplement (never replace) runner provenance validation."""
    return (isinstance(evidence, dict) and STATUSES.get(evidence.get('status'), False)
            and evidence.get('head') == head and evidence.get('fingerprint') == fingerprint
            and bool(re.fullmatch(r'[0-9a-f]{40}', head or ''))
            and bool(re.fullmatch(r'[0-9a-f]{64}', fingerprint or ''))
            and evidence.get('pending') is False and evidence.get('cached') is False)


def claim_check(task, request, *, seed=None, previous=None):
    """Pure preview, not a claim/checkpoint. A wire claim describes an idle slot.

    The existing delegated certificate supplies the candidate base/head separately;
    it does not supply TEST PLAN policy provenance or a legacy exemption.
    """
    return check(dict(task=task, base=(seed or {}).get('base'),
                      head=(seed or {}).get('head')), request, previous=previous)


def check(active, request, repo=None, previous=None, *, structural_only=False):
    """Re-derive from admitted acceptance and immutable base..head, never a cache.

    _task_hash / recovery keys are receiver-owned internal fields, not wire or
    task text. Existing unchanged_issue/certificate checks remain mandatory.
    previous is an optional in-process receipt, never a checkpoint/store field.
    OK here certifies a profile only, and NEVER test execution or release PASS.
    """
    receipt = dict(tier=None, derived_tier=None, plan_sha256=None,
                   base=active.get('base'), head=active.get('head'),
                   visual_qa_required=False, independent_qa_required=True,
                   required_groups=[], testing_pins_digest=digest(PINS), status='NOT_TESTED')
    try:
        block, classifier, verifier = trusted_tools()
        task = active['task']
        receipt['task_sha256'] = digest(task)
        if request.get('_task_hash') and request['_task_hash'] != digest(task):
            raise GateError('PLAN_SWAPPED')
        if request['stage'] == 'claim':
            # None is the idle wire identity, never the delegated candidate head.
            if request.get('head') is not None or request.get('attempt', 0) != 0:
                raise GateError('HEAD_MISMATCH')
        elif (request.get('head', active.get('head')) != active.get('head')
                or request.get('base', active.get('base')) != active.get('base')):
            raise GateError('HEAD_MISMATCH')
        if previous:
            if previous.get('testing_pins_digest') != receipt['testing_pins_digest']:
                raise GateError('TESTING_PIN_MISMATCH')
            if (previous.get('base'), previous.get('head')) != (receipt['base'], receipt['head']):
                raise GateError('HEAD_MISMATCH')
            if previous.get('task_sha256') != receipt['task_sha256']:
                raise GateError('PLAN_SWAPPED')
        acceptance = task.get('acceptance', '')
        if not isinstance(acceptance, str):
            raise GateError('BAD_FIELD')
        try:
            plan = block.parse(acceptance)
        except block.PlanError as exc:
            if exc.code == 'MISSING_TEST_PLAN':
                # No supported input here proves the admission's legacy plan-policy
                # provenance and exact continued operation. Never invent a cutover
                # from cost EPOCH, schema, dates, recovery flags or receipt IDs.
                receipt['legacy_proof'] = 'MISSING_LEGACY_OPERATION_PROOF'
                if previous and previous.get('plan_sha256'):
                    raise GateError('PLAN_SWAPPED') from exc
            raise GateError(exc.code) from exc
        receipt.update(tier=plan['tier'], plan_sha256=digest(plan),
                       visual_qa_required=plan['visual_qa'], required_groups=plan['groups'])
        if previous:
            if previous['plan_sha256'] != receipt['plan_sha256']:
                raise GateError('PLAN_SWAPPED')
        required = set(classifier.STRICT_GROUPS) if plan['tier'] == 'T3' else set()
        # Root preflight reads only task DATA; the slot worker derives the full
        # immutable diff before lease/model/effects. Never run candidate Git as root.
        if not structural_only and request['stage'] in {'publish', 'qa', 'promote'}:
            if not all(re.fullmatch(r'[0-9a-f]{40}', receipt[k] or '') for k in ('base', 'head')):
                raise GateError('HEAD_MISMATCH')
            changes = verifier.diff_changes(receipt['base'], receipt['head'], repo)
            result = classifier.verify_declared(plan['tier'], changes)
            derived = result['derived']
            receipt.update(derived_tier=derived['tier'],
                           visual_qa_required=plan['visual_qa'] or derived['visual_qa'])
            if not result['ok']:
                raise GateError('UNDER_DECLARED')
            required.update(derived['required_groups'])
            if derived['visual_qa'] and not plan['visual_qa']:
                raise GateError('VISUAL_QA_REQUIRED')
            receipt['status'] = 'OVER_DECLARED' if plan['tier'] != derived['tier'] else 'OK'
        else:
            receipt['status'] = 'OK'
        if not required <= set(plan['groups']):
            raise GateError('MISSING_REQUIRED_GROUPS')
    except GateError as exc:
        receipt['status'] = str(exc)
    except ValueError as exc:
        code = str(exc)
        receipt['status'] = code if code in {'EMPTY_CHANGES', 'BAD_CHANGE', 'BAD_MODE', 'BAD_RAW_DIFF'} else 'BAD_RAW_DIFF'
    except Exception:
        receipt['status'] = 'DIFF_UNAVAILABLE'
    return receipt


def stage_check(request, active, bridge):
    """Only ephemeral bridge metadata, carried by the existing result channel."""
    if request['stage'] not in STAGES:
        return None
    previous = getattr(bridge, 'test_plan', None)
    receipt = check(active, request, bridge.work, previous)
    bridge.test_plan = receipt
    return receipt


def guidance(receipt):
    if not receipt or receipt['status'] == 'LEGACY_RECOVERY':
        return ''
    # Catalog bounds the longest group list; this is <=900 UTF-8 bytes even at T3.
    text = ('TEST PLAN ' + receipt['tier'] + ' groups=' + ','.join(receipt['required_groups'])
            + '. Run tests ONLY via python3 scripts/chatops/testing/run_test_group.py '
            'run --detach / collect; no polling or ad-hoc repeated full runs. '
            'Targeted groups only while fixing. Reruns need a reason code; same fingerprint is not rerun. '
            + '/'.join(s for s, passing in STATUSES.items() if not passing)
            + ' never reported as PASS. Only conclusive PASS at the same fingerprint and exact head counts. '
            'UNKNOWN: reconciliation, never replay. T3/critical: full independent QA, all mandatory '
            'release gates and all 7 Product CI jobs. T2: visual QA retained. Guidance never reduces QA/CI.')
    assert len(text.encode()) <= 900
    return text

"""Trusted bridge receipts for runtime review reuse; never creates a new runtime PASS.

Files live beside the original protected saved-QA receipts, outside candidate/model writes.
Historical receipts without provenance remain valid for their exact SHA only.
"""
import hashlib
from pathlib import Path
from core import Refused, digest, loads, need
from content_identity import equivalence
from context_policy import RULES_COMMIT, RULES_SHA256


def binding(active):
    return dict(issue=active['issue'], task=active['task'],
                admission={k: active.get(k) for k in ('fingerprint', 'comment', 'approved_since', 'recovery_receipt')},
                rules_commit=RULES_COMMIT, rules_sha256=RULES_SHA256)


def name(active):
    suffix = '-i' + str(active['integration']) if active.get('integration') else ''
    return f'qa-{active["issue"]}-a{active["attempt"]}{suffix}.json'


def prior_origin(active):
    if (active.get('qa') or {}).get('verdict') != 'PASS': return None
    return active.get('qa_origin') if active.get('qa_equivalence') else name(active)


def raw(directory, filename):
    need(isinstance(filename, str) and Path(filename).name == filename, 'invalid receipt name')
    p = directory / filename
    need(not p.is_symlink() and p.is_file() and p.stat().st_size <= 262144, 'missing/unsafe QA evidence')
    return p.read_bytes()


def immutable(directory, filename, value, atomic):
    encoded = digest(value)
    p = directory / filename
    if p.exists() or p.is_symlink():
        need(digest(loads(raw(directory, filename))) == encoded, 'immutable QA evidence drift')
    else: atomic(p, value)


def record(bridge, active, result, atomic):
    if result.get('verdict') != 'PASS': return
    filename = name(active)
    receipt = raw(bridge.c.state_dir, filename)
    need(loads(receipt) == result and result['reviewed_sha'] == active['head'], 'original QA mismatch')
    # Reading actual objects now prevents caller-supplied manifests from becoming authority.
    identity = equivalence(bridge.work, active['head'], active['head'])
    metadata = dict(schema='GB_QA_ORIGIN_V1', receipt=filename,
        receipt_sha256=hashlib.sha256(receipt).hexdigest(), original=active['head'],
        base=active['base'], binding=binding(active), tree=identity['before'])
    immutable(bridge.c.state_dir, filename + '.origin.json', metadata, atomic)


def origin(bridge, active, filename):
    receipt = raw(bridge.c.state_dir, filename)
    meta = loads(raw(bridge.c.state_dir, filename + '.origin.json'))
    result = loads(receipt)
    need(meta['schema'] == 'GB_QA_ORIGIN_V1' and meta['receipt'] == filename
         and meta['receipt_sha256'] == hashlib.sha256(receipt).hexdigest()
         and digest(meta['binding']) == digest(binding(active)), 'stale QA provenance')
    need(set(result) == {'verdict', 'findings', 'reviewed_sha'} and result['verdict'] == 'PASS'
         and result['findings'] == [] and result['reviewed_sha'] == meta['original'], 'original QA not PASS')
    proof = equivalence(bridge.work, meta['original'], active['head'])
    base_proof = equivalence(bridge.work, meta['base'], active['base'])
    need(proof['before'] == meta['tree'] and proof['reusable'] and base_proof['reusable'],
         'runtime/policy/base dependencies changed; fresh QA required')
    proof['base_projection'] = base_proof
    return result, meta, proof


def eligible(bridge, active):
    if not active.get('qa_origin'): return False
    try: origin(bridge, active, active['qa_origin'])
    except (Refused, OSError, ValueError, KeyError, TypeError, UnicodeError): return False
    return True


def try_reuse(bridge, active, atomic):
    filename = active.get('qa_origin')
    if not filename: return False
    try:
        result, meta, projection = origin(bridge, active, filename)
    except (Refused, OSError, ValueError, KeyError, TypeError, UnicodeError):
        return False  # Addressed QA, never global disabled or invented equivalence.
    proofname = name(active) + '.equivalence.json'
    proof = dict(schema='GB_QA_EQUIVALENCE_V1', origin=meta,
                 projection=projection, delta=None,
                 obligations=['exact_candidate_CI', 'integration', 'DEV_acceptance'])
    if projection['tests']:
        # Independent small test-delta review, after stage has verified new-SHA CI.
        delta_name = name(active) + '.delta.json'
        p = bridge.c.state_dir / delta_name
        if p.exists(): delta = loads(raw(bridge.c.state_dir, delta_name))
        else:
            from content_identity import git
            diff = git(bridge.work, 'diff', '--no-ext-diff', '--no-textconv', meta['original'],
                       active['head'], '--', *projection['tests']).decode()
            delta = bridge.model('Independent TEST DELTA QA only. Runtime review remains at '
                + meta['original'] + '. Review changed tests for coverage, removed/weakened assertions, '
                'requirements and acceptance preservation. Do not waive any tests or lifecycle gates. '
                'Missing evidence means FAIL. Return verdict/findings/reviewed_sha for exact candidate '
                + active['head'] + '. TASK: ' + __import__('json').dumps(active['task'])
                + '\nTEST DIFF:\n' + diff, qa=True)
            immutable(bridge.c.state_dir, delta_name, delta, atomic)
        need(set(delta) == {'verdict','findings','reviewed_sha'} and delta['verdict'] in ('PASS','FAIL')
             and isinstance(delta['findings'], list) and len(delta['findings']) <= 100
             and all(isinstance(x,str) and len(x) <= 4000 for x in delta['findings'])
             and delta['reviewed_sha'] == active['head'],
             'invalid test delta review')
        if delta['verdict'] == 'FAIL':
            # A real delta finding follows the existing diagnosis/repair flow;
            # it cannot be erased by the old runtime PASS.
            bridge.store.phase('qa', qa=delta, qa_equivalence=None, test_delta_failure=delta_name)
            return True
        need(delta['findings'] == [], 'test delta PASS has findings')
        proof['delta'] = dict(receipt=delta_name,
                             sha256=hashlib.sha256(raw(bridge.c.state_dir, delta_name)).hexdigest())
    try:
        immutable(bridge.c.state_dir, proofname, proof, atomic)
    except (Refused, OSError, ValueError, KeyError, TypeError):
        return False  # A stale/forged proof never becomes a fresh QA PASS.
    bridge.store.phase('qa', qa=result, qa_equivalence=proofname)
    return True


def verify(bridge, active):
    proof = loads(raw(bridge.c.state_dir, active['qa_equivalence']))
    result, meta, projection = origin(bridge, active, proof['origin']['receipt'])
    need(proof == dict(schema='GB_QA_EQUIVALENCE_V1', origin=meta, projection=projection,
         delta=proof.get('delta'), obligations=['exact_candidate_CI','integration','DEV_acceptance'])
         and active['qa'] == result and projection['candidate'] == active['head'], 'forged QA equivalence')
    if projection['tests']:
        delta = proof['delta']
        receipt = raw(bridge.c.state_dir, delta['receipt'])
        value = loads(receipt)
        need(delta['receipt'] == name(active) + '.delta.json'
             and delta['sha256'] == hashlib.sha256(receipt).hexdigest()
             and value == dict(verdict='PASS', findings=[], reviewed_sha=active['head']), 'invalid test delta review')
    else: need(proof['delta'] is None, 'unexpected test delta evidence')
    return True

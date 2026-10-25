"""Offline full-canon vs scoped_v1 sizes for Cursor and Antigravity.

Uses the saved synthetic stage inputs in this directory and the accepted
ENGINEERING_OPERATING_MODEL.md bytes. No provider call, no network, no install.
Token counts stay not_exposed: this environment has no exact tokenizer, and
bytes/4 is not a measurement.
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT/'scripts/chatops/actions_train'))
import context_exchange as E

# Live grant pair technical_pm_product_analyst / independent_qa. The canon has
# no GB_CONTEXT_V1:analyst marker. independent_qa extracts the qa capsule.
# analyst extracts the planner capsule (Technical PM). The research capsule
# says "исследователь/аналитик" and is a different role; it is not this package.
CAPSULE_FOR_ROLE = {'analyst': 'planner', 'independent_qa': 'qa'}
PROVIDERS = ('cursor', 'agy')
OUTSIDE_CAPSULE_MARKER = 'Поправка SR0'
RULES_PATH = 'docs/rules/ENGINEERING_OPERATING_MODEL.md'
DATA_MARK = b'\nSAVED_STAGE_DATA\n'


def _load_replay():
    path = HERE/'offline_replay.py'
    spec = importlib.util.spec_from_file_location('context_exchange_offline_replay', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _git_show(root, commit, path):
    completed = subprocess.run(
        ['git', '-C', str(root), 'show', commit + ':' + path],
        check=True, capture_output=True, timeout=30)
    return completed.stdout


def _tokenizer_status():
    """Presence of a generic BPE does not become a Cursor or Antigravity token count."""
    considered = ('tiktoken', 'tokenizers')
    return dict(
        input_tokens='not_exposed',
        output_tokens='not_exposed',
        cache_read_tokens='not_exposed',
        cache_write_tokens='not_exposed',
        reasoning_tokens='not_exposed',
        tokenizer='not_exposed',
        tokenizer_modules_considered=list(considered),
        generic_bpe_used=False,
        bytes_div_4='not_used',
        reason='No exact Cursor or Antigravity tokenizer or provider usage field is read. A generic BPE is not that accounting.',
    )


def measure(root=None):
    root = Path(root) if root else ROOT
    rules_path = root/RULES_PATH
    raw = rules_path.read_bytes()
    text = raw.decode('utf-8')
    sha = hashlib.sha256(raw).hexdigest()
    index = json.loads((root/'docs/rules/CONTEXT_SOURCES.json').read_text(encoding='utf-8'))
    accepted = index['accepted_operating_model']
    if (accepted.get('sha256') != sha or accepted.get('bytes') != len(raw)
            or accepted.get('path') != RULES_PATH or accepted.get('revision') != '1.4'):
        raise RuntimeError('working tree canon does not match CONTEXT_SOURCES accepted EOM 1.4')
    commit = accepted['commit']
    pinned = _git_show(root, commit, RULES_PATH)
    if pinned != raw:
        raise RuntimeError('accepted rules commit blob differs from the working tree file')
    replay = _load_replay()
    task, value, cache = replay.saved_stage_inputs()
    original = (json.dumps(task, sort_keys=True), json.dumps(value, sort_keys=True),
                json.dumps(cache, sort_keys=True))
    view = E.diagnosis_view({'task': task}, value, cache)
    if (json.dumps(task, sort_keys=True), json.dumps(value, sort_keys=True),
            json.dumps(cache, sort_keys=True)) != original:
        raise RuntimeError('saved stage inputs were mutated')
    if view['inputs']['failure'] != value['failure'] or view['inputs']['evidence'] != value['evidence']:
        raise RuntimeError('saved findings or evidence were dropped')
    data = E.encoded(view)
    for marker in ('preserve malformed-input failures', 'wrong behavior', 'old issue', 'minimal root cause'):
        if marker not in data.decode('utf-8'):
            raise RuntimeError('saved stage marker missing from the data section: ' + marker)
    reference = dict(path=RULES_PATH, revision=commit, sha256=sha, bytes=len(raw))
    tokens = _tokenizer_status()
    if tokens['tokenizer'] != 'not_exposed' or tokens['bytes_div_4'] != 'not_used' or tokens['generic_bpe_used'] is not False:
        raise RuntimeError('token accounting drifted away from not_exposed')
    rows = []
    for provider in PROVIDERS:
        for operational, capsule in CAPSULE_FOR_ROLE.items():
            full_prefix, full_metrics = E.rules_prefix(
                text=text, metadata=dict(commit=commit, sha256=sha, bytes=len(raw)),
                role=capsule, compact=False)
            def probe(ref, expected=reference):
                return ref == expected
            scoped_prefix, scoped_metrics = E.rules_prefix(
                text=text, metadata=dict(commit=commit, sha256=sha, bytes=len(raw)),
                role=capsule, compact=True, full_rules_reference=reference,
                verified_access=probe)
            if scoped_metrics['policy_profile'] != 'scoped_v1' or full_metrics['policy_profile'] != 'full':
                raise RuntimeError('size probe did not produce the requested profiles')
            if OUTSIDE_CAPSULE_MARKER not in full_prefix or OUTSIDE_CAPSULE_MARKER in scoped_prefix:
                raise RuntimeError('scoped package did not stay inside the capsule markers')
            capsule_text = E.compile_capsule(text, capsule, sha)
            if capsule_text not in scoped_prefix or text not in full_prefix:
                raise RuntimeError('package lost its rules body')
            full_package = full_prefix.encode('utf-8') + DATA_MARK + data
            scoped_package = scoped_prefix.encode('utf-8') + DATA_MARK + data
            rows.append(dict(
                provider=provider,
                operational_role=operational,
                capsule_role=capsule,
                capsule_marker='GB_CONTEXT_V1:' + capsule,
                full_canon_bytes=len(raw),
                full_prefix_bytes=full_metrics['prefix_bytes'],
                full_delivered_policy_bytes=full_metrics['delivered_policy_bytes'],
                scoped_capsule_bytes=len(capsule_text.encode('utf-8')),
                scoped_prefix_bytes=scoped_metrics['prefix_bytes'],
                scoped_delivered_policy_bytes=scoped_metrics['delivered_policy_bytes'],
                saved_stage_data_bytes=len(data),
                full_package_bytes=len(full_package),
                scoped_package_bytes=len(scoped_package),
                package_byte_delta=len(full_package) - len(scoped_package),
                full_prefix_sha256=full_metrics['prefix_sha256'],
                scoped_prefix_sha256=scoped_metrics['prefix_sha256'],
                full_package_sha256=hashlib.sha256(full_package).hexdigest(),
                scoped_package_sha256=hashlib.sha256(scoped_package).hexdigest(),
                scoped_size_probe='synthetic_reference_equality_not_a_recipient',
                scoped_selected_for_delivery=False,
            ))
    identical = len({(row['operational_role'], row['full_package_sha256'], row['scoped_package_sha256'])
                     for row in rows}) == len(CAPSULE_FOR_ROLE)
    # Same capsule compiled twice, once per provider, must match. A provider-specific
    # compiler change has to show up as a hash difference rather than a copied row.
    by_role = {}
    for row in rows:
        by_role.setdefault(row['operational_role'], []).append(row['scoped_package_sha256'])
    if any(len(set(hashes)) != 1 or len(hashes) != len(PROVIDERS) for hashes in by_role.values()):
        identical = False
    if not identical:
        raise RuntimeError('Cursor and Antigravity packages diverged; refusing to publish a mixed matrix')
    import context_policy as C
    return dict(
        schema='GB_STAGE5_CURSOR_AGY_OFFLINE_COMPARE_V1',
        status='OFFLINE_VERIFIED_NOT_RUNTIME_VERIFIED',
        authority='measurement_only_not_admission_or_scoped_qualification',
        provider_calls=0,
        live_mutations=0,
        rules=dict(
            path=RULES_PATH,
            revision=accepted['revision'],
            commit=commit,
            sha256=sha,
            bytes=len(raw),
            encoding='utf-8',
            identity='VERIFIED',
            source='working tree file matched CONTEXT_SOURCES and git show of the accepted commit',
        ),
        installed_runtime_pin=dict(
            path=RULES_PATH,
            revision='1.3',
            commit=C.RULES_COMMIT,
            sha256=C.RULES_SHA256,
            bytes=C.RULES_SIZE,
            changed_by_this_comparison=False,
            note='Cursor and Antigravity still receive this pin through context_policy.inject full profile. It is not the scoped comparison canon.',
        ),
        saved_inputs=dict(
            path='docs/workbench/context-exchange-20261023/offline_replay.py',
            function='saved_stage_inputs',
            task_sha256=E.digest(task),
            stage_data_sha256=hashlib.sha256(data).hexdigest(),
            stage_data_bytes=len(data),
            stage_data='diagnosis_view of the saved synthetic task, failure, 24k evidence excerpt and three prior receipts',
            mutated=False,
        ),
        role_mapping=dict(
            analyst='planner',
            independent_qa='qa',
            analyst_marker_in_canon=False,
            research_capsule='not_selected',
            reason='No GB_CONTEXT_V1:analyst marker. independent_qa is the qa capsule. analyst is the planner capsule because the live role paired with independent_qa is technical_pm_product_analyst. The research capsule is a different role.',
        ),
        package_definition='utf-8 rules_prefix + newline SAVED_STAGE_DATA newline + canonical JSON of the saved diagnosis view',
        providers_byte_identical='VERIFIED' if identical else 'MISMATCH',
        rows=rows,
        tokens=tokens,
        not_measured=['latency', 'cost', 'cache_hit', 'missed_findings', 'provider_usage',
                      'actual_recipient_rules_read', 'role_canary'],
        scoped_delivery='NOT_ENABLED',
        byte_delta_is_not_cost_or_latency=True,
    )


def main():
    report = measure()
    destination = HERE/'STAGE5_CURSOR_AGY_COMPARE.json'
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(wrote=str(destination), provider_calls=report['provider_calls'],
                          rows=len(report['rows']), tokens=report['tokens']['input_tokens']),
                     ensure_ascii=False))


if __name__ == '__main__':
    main()

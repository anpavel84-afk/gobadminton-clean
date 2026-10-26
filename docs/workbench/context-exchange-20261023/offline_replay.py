"""Reproduce byte measurements locally; no network/providers/runtime writes."""
import copy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'scripts/chatops/actions_train'))
import context_exchange as E


def saved_stage_inputs():
    """Exact synthetic stage inputs saved with the 23.10.2026 offline replay.

    Callers get a fresh copy. The values are the measurement fixture, not a
    new scenario and not a provider transcript.
    """
    task={'goal':'bounded regression','acceptance':'preserve malformed-input failures','allowed_paths':['apps/x.py']}
    value={'head':'b'*40,'attempt':2,
           'failure':{'kind':'qa','result':{'verdict':'FAIL','findings':['wrong behavior'],'reviewed_sha':'b'*40}},
           'evidence':[{'head':'b'*40,'log':{'excerpt':'assertion context\n'+'x'*24000}}],
           'history':[{'head':'a'*40,'qa':{'verdict':'FAIL','findings':['old issue']}}]}
    cache={'receipts':{str(i)*64:{'status':'ready' if i<3 else 'pending','inputs':copy.deepcopy(value),
           'brief_hash':'c'*64,'brief':{'diagnosis':'minimal root cause','tests':['edge case']} if i<3 else None}
           for i in (1,2,3)}}
    return task, value, cache


def replay(root=None):
    root = Path(root) if root else ROOT
    rules=(root/'docs/rules/ENGINEERING_OPERATING_MODEL.md').read_text()
    sha=hashlib.sha256(rules.encode()).hexdigest()
    task, value, cache = saved_stage_inputs()
    original=copy.deepcopy((value,cache,task))
    old=len(E.encoded(dict(task=task,inputs=value,previous=cache['receipts'])))
    new=E.diagnosis_view({'task':task},value,cache)
    assert new['inputs']['failure']==value['failure']
    assert new['inputs']['evidence']==value['evidence']
    assert (value,cache,task)==original
    size=len(E.encoded(new))
    return {'full_rules_bytes':len(rules.encode()),'rules_sha256':sha,
            'role_policy_bytes':{role:len(E.compile_capsule(rules,role,sha).encode()) for role in sorted(E.ROLES)},
            'synthetic_diagnosis_bytes':{'old':old,'new':size,'saved_percent':round(100*(1-size/old),2)},
            'provider_calls':0,'token_or_latency_savings':'NOT_MEASURED'}


def main():
    print(json.dumps(replay(),ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()

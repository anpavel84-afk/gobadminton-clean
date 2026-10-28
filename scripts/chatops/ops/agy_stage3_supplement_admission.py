#!/usr/bin/python3
"""Exact one-off Stage3 supplemental admission; NOT a new runner or budget reset.

Only use after approved independent source QA, hosted CI, installed-controller
backup/rollback and a real UID978 native-tool availability preflight.
No automatic replay: a pre-existing receipt requires manual exact recovery.
"""
import copy
import fcntl
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
import receiver as R
import antigravity_qa_recovery as Q
import native_antigravity as N
import installer as I
from core import digest, need

ROOT=R.STATE
RECEIPT=ROOT/'antigravity-stage3-supplement-admission.json'
LEDGER=ROOT/Q.SUPPLEMENT_LEDGER
ORIGINAL=ROOT/Q.ADDRESSED_LEDGER
BUDGET=Path('/etc/gobadminton-slots/budgets.json')
OLD_OP='aa17df106db0de1aa816bae35111b16d0f0bb6f3788c35eade2f22f9bab244ee'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def grant(role,controller):
    from context_policy import RULES_SHA256
    g=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,
           owner_comment=Q.SUPPLEMENT_OWNER_COMMENT,role=role,
           controller_revision=controller,cli_sha256=N.AGY_SHA256,
           rules_sha256=RULES_SHA256,
           base=Q.FRESH_SOURCE_BASE,head=Q.FRESH_SOURCE_HEAD,
           input_revision=Q.FRESH_SOURCE_HEAD,input_path=Q.ANALYSIS_INPUT,
           input_sha256=Q.ANALYSIS_INPUT_SHA256,
           timeout=1800,max_output_bytes=N.MAX_OUT,
           permission_mode=N.PERMISSION_MODE,input_transport='stream-json',ceiling=1)
    if role=='independent_qa':
        g.update(input_revision=Q.FRESH_QA_INPUT_REVISION,
                 input_path=Q.FRESH_QA_INPUT_PATH,
                 input_sha256=Q.FRESH_QA_INPUT_SHA256)
    return Q.validate_addressed_grant(g)


def plan():
    need(os.geteuid()==0,'root-only supplemental admission')
    p=R.read(R.POLICY,0)
    need(p['mode']=='active' and p.get('controller_sha')
         and len(p['controller_sha'])==40,'reviewed installed controller required')
    need(R.read(ROOT/'antigravity-stage3-policy-facade.json',0)['phase']=='active',
         'prior controller installation receipt missing')
    for name,generation,uid in (('slot1',62,1002),('slot2',94,978)):
        j=R.journal(name);state,_=R.checkpoint(name)
        need(j['pending'] is None and j['generation']==generation and
             state['active'] is None,'slots not at exact pre-supplement checkpoint')
        R.no_models(uid,name)
        R.free_lock(R.AUTONOMY/'slots'/name/'worker.lock')
        R.free_lock(R.AUTONOMY/'locks'/(name+'.lease'))
    R.units_quiet(R.UNITS)
    j=R.journal('slot2')
    Q.addressed_history(R,j)
    old=Q.supplemental_baseline(R)
    need(old['used_calls']==3 and len(old['grants'])==3,'historical 3/4 changed')
    need(not RECEIPT.exists() and not LEDGER.exists(),
         'supplement already prepared or interrupted: inspect, never replay')
    marker=R.read(N.MARKER,0)
    q=marker['qualification']
    need(marker['phase']=='canary' and q['qualification_grant']['owner_comment']==
         Q.FRESH_OWNER_COMMENT and
         q['qualification_grant']['role']=='technical_pm_product_analyst' and
         q['task_sha256'] in
         {v['task_hash'] for v in j['operations'].values()},
         'old spent native analysis marker not exactly retained')
    previous=j['operations'][OLD_OP]['result']
    need(previous['status']=='confirmed' and previous['analysis_complete'] is False
         and previous['analysis']['completion']=='INCOMPLETE',
         'original analysis evidence must remain INCOMPLETE')
    a=grant('technical_pm_product_analyst',p['controller_sha'])
    q=grant('independent_qa',p['controller_sha'])
    for g in (a,q):
        # Read-only restricted native git under executor UID978 before any
        # protected writes. No model invocation.
        Q.addressed_input(N.QUALIFICATION_WORK,g,installer=True)
    ledger=dict(schema=Q.SUPPLEMENT_SCHEMA,owner_comment=Q.SUPPLEMENT_OWNER_COMMENT,
                ceiling=2,used_calls=0,legacy_used_calls=3,
                grants={digest(g):dict(grant=g,operation=None) for g in (a,q)})
    Q.supplemental_ledger(ledger)
    next_marker=copy.deepcopy(marker)
    analysis=N.qualification_task(a['base'],a['head'],
                                   adapter_revision=p['controller_sha'],
                                   qualification_grant=a)
    next_marker.update(
        adapter_revision=p['controller_sha'],
        qualification=dict(issue=29,base=a['base'],head=a['head'],
                           work=str(N.QUALIFICATION_WORK),
                           adapter_revision=p['controller_sha'],
                           qualification_grant=a,task_sha256=digest(analysis)),
        canary_task_sha256=digest(analysis),
        modules={'native_antigravity.py':I.sha(Path(N.__file__)),
                 'native_guard.py':I.sha(Path(N.__file__).with_name('native_guard.py'))})
    need(N.qualification_descriptor(next_marker)==next_marker['qualification'],
         'new qualification descriptor is invalid')
    next_slot=copy.deepcopy(j);next_slot['generation']=95
    need(next_slot['operations']==j['operations'] and next_slot['pending'] is None,
         'historical operation mutation')
    return (p,j,marker,old,next_marker,next_slot,ledger)


def execute(apply=False):
    fd=os.open(ROOT/'controller.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        p,oldslot,marker,old,mark2,slot2,ledger=plan()
        paths={str(N.MARKER):mark2,str(LEDGER):ledger,
               str(ROOT/'slot2.json'):slot2}
        hash_before={str(N.MARKER):sha(N.MARKER),
                     str(ROOT/'slot2.json'):sha(ROOT/'slot2.json')}
        preserved={str(ORIGINAL):sha(ORIGINAL),str(BUDGET):sha(BUDGET)}
        before={str(N.MARKER):marker,str(ROOT/'slot2.json'):oldslot}
        proposal=dict(schema='GB_AGY_STAGE3_SUPPLEMENT_ADMISSION_V1',
            phase='intent',owner_comment=Q.SUPPLEMENT_OWNER_COMMENT,
            controller_sha=p['controller_sha'],generation_before=94,
            generation_after=95,legacy_ledger_sha256=preserved[str(ORIGINAL)],
            before=before,hashes=hash_before,preserved=preserved,
            supplement=ledger,changes=paths)
        if not apply:
            return dict(dry=True,controller=p['controller_sha'],
                legacy_used_calls=old['used_calls'],supplement_ceiling=2,
                new_roles=['technical_pm_product_analyst','independent_qa'])
        R.atomic(RECEIPT,proposal)
        for target,obj,mode in ((N.MARKER,mark2,0o644),
                                 (LEDGER,ledger,0o600),
                                 (ROOT/'slot2.json',slot2,0o600)):
            if target!=LEDGER:
                need(sha(target)==hash_before[str(target)],
                     'protected target changed after intent')
            R.atomic(target,obj,mode=mode)
        need(sha(ORIGINAL)==preserved[str(ORIGINAL)] and
             sha(BUDGET)==preserved[str(BUDGET)],
             'historical ledger or global budget changed')
        need(R.journal('slot2')['generation']==95 and
             R.journal('slot2')['pending'] is None,
             'scheduling after-state mismatch')
        need(R.read(LEDGER,0)==ledger and R.read(N.MARKER,0)==mark2,
             'admission destination mismatch')
        R.atomic(RECEIPT,dict(proposal,phase='complete'))
        return dict(phase='complete',new_model_calls=0,legacy='3/4 unchanged',
                    supplement='0/2 unspent',generation=95,
                    controller=p['controller_sha'])
    finally:
        os.close(fd)


if __name__=='__main__':
    need(len(sys.argv)==2 and sys.argv[1] in ('dry-run','apply'),
         'expected exact dry-run/apply action')
    print(json.dumps(execute(apply=sys.argv[1]=='apply'),sort_keys=True))

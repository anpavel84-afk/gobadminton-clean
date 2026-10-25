#!/usr/bin/env python3
"""One authenticated, closed #29 Owner authorization -> existing canary and ledger.

Executed by trusted root OPS with receiver.lock. No model process/QA dispatch.
Authorization is an immutable GitHub Issue #29 comment by its actual Owner.
"""
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request

sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as R
import native_antigravity as N
import antigravity_qa_recovery as Q
from core import digest, need

PREFIX='GOBADMINTON_AGY_PACKAGE_V1\n'
OWNER_ID=318610566
REPO_ID=1416250340
ISSUE_URL='https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/29'
RECEIPT_PREFIX='antigravity-29-owner-package-admission-'
HIST=Q.OWNER_PACKAGE_OLD_ADDRESS_SHA
SUP=Q.OWNER_PACKAGE_OLD_SUPPLEMENT_SHA
BUDGET='8f6752295c2ee65924b5a95ddc42bb9774f8f73ce146481e52aaf200e142ed8d'
SOURCE_BASE=Q.FRESH_SOURCE_BASE
SOURCE_HEAD=Q.FRESH_SOURCE_HEAD
# Checked-in document pin. Installed controller C5 keeps Q.INSTALLED_C5_RULES
# (comment 6396105635) until a separate reviewed install. Do not point that
# admission at this value when the document hash moves.
RULES='8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5'
EXPECTED_PINS={
 'technical_pm_product_analyst':(SOURCE_HEAD,Q.ANALYSIS_INPUT,Q.ANALYSIS_INPUT_SHA256),
 'independent_qa':(Q.FRESH_QA_INPUT_REVISION,Q.FRESH_QA_INPUT_PATH,Q.FRESH_QA_INPUT_SHA256),
}

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def owner_comment(comment_id):
    need(type(comment_id) is int and comment_id>0,'invalid owner comment')
    url='https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/comments/'+str(comment_id)
    req=urllib.request.Request(url,headers={
        'Accept':'application/vnd.github+json',
        'User-Agent':'GoBadminton-owner-package-admission-v1'})
    with urllib.request.urlopen(req,timeout=15) as response:
        need(response.status==200,'Owner comment HTTP validation failed')
        raw=response.read(32769)
    need(len(raw)<=32768,'Owner comment too large')
    data=json.loads(raw)
    need(data.get('id')==comment_id
         and data.get('issue_url')==ISSUE_URL
         and data.get('user',{}).get('id')==OWNER_ID
         and data.get('user',{}).get('login')=='anpavel84-afk'
         and data.get('author_association') in ('OWNER','MEMBER','COLLABORATOR'),
         'authenticated repository Owner Issue #29 comment required')
    body=data.get('body')
    need(type(body) is str and body.startswith(PREFIX),'missing strict Owner package prefix')
    content=body[len(PREFIX):]
    value=json.loads(content)
    # Reject extra whitespace or trick encodings; exact canonical JSON.
    need(json.dumps(value,sort_keys=True,separators=(',',':'))==content,
         'Owner package JSON not canonical')
    return body,value

def admission_pins(comment_id, controller):
    """C5's issued comment keeps its installed pins. Other packages use the document pin."""
    if comment_id == Q.INSTALLED_C5_COMMENT:
        need(controller == Q.INSTALLED_C5_CONTROLLER,
             'installed C5 controller pin is unchanged')
        return Q.INSTALLED_C5_CONTROLLER, Q.INSTALLED_C5_RULES
    return controller, RULES


def installed_rules_ok(controller, installed_sha):
    """Quiescent rules check. A newer document pin does not replace the C5 file hash."""
    from context_policy import RULES_SHA256
    if controller == Q.INSTALLED_C5_CONTROLLER:
        need(installed_sha == Q.INSTALLED_C5_RULES,
             'installed C5 rules pin is unchanged')
        return
    need(RULES_SHA256 == RULES and installed_sha == RULES, 'installed rules changed')


def authorize(comment_id,controller):
    body,v=owner_comment(comment_id)
    controller_pin, rules_pin = admission_pins(comment_id, controller)
    need(type(v) is dict and set(v)=={
         'schema','issue','repo_id','controller_sha','rules_sha256','source_base',
         'source_head','model','calls','max_calls','owner_comment'},
         'unexpected Owner authorization fields')
    need(v['schema']==Q.OWNER_PACKAGE_SCHEMA and v['issue']==29 and
         v['repo_id']==REPO_ID and v['owner_comment']==comment_id and
         v['controller_sha']==controller_pin and v['rules_sha256']==rules_pin and
         (v['source_base'],v['source_head'])==(SOURCE_BASE,SOURCE_HEAD) and
         v['model']==N.MODEL and v['max_calls']==2,
         'Owner exact controller/source/rules/call budget drift')
    need(type(v['calls']) is list and len(v['calls'])==2,'Owner authorizes exactly two one-use roles')
    need([row.get('role') for row in v['calls']]==[
       'technical_pm_product_analyst','independent_qa'],
       'analysis first then independent QA only')
    grants={}
    for row in v['calls']:
        role=row['role']
        need(type(row) is dict and set(row)=={'role','input_revision','input_path','input_sha256'},
             'unexpected role authorization')
        need((row['input_revision'],row['input_path'],row['input_sha256'])==EXPECTED_PINS[role],
             'source/QA immutable fixtures drift')
        grant=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,
          owner_comment=comment_id,role=role,controller_revision=controller_pin,
          cli_sha256=N.AGY_SHA256,rules_sha256=rules_pin,
          base=SOURCE_BASE,head=SOURCE_HEAD,input_revision=row['input_revision'],
          input_path=row['input_path'],input_sha256=row['input_sha256'],
          timeout=1800,max_output_bytes=N.MAX_OUT,
          permission_mode=N.PERMISSION_MODE,input_transport='stream-json',ceiling=1)
        Q.validate_addressed_grant(grant,enrollment=True)
        # Require the installed candidate real immutable source, not a guessed SHA.
        Q.addressed_input(N.QUALIFICATION_WORK,grant,installer=True)
        grants[digest(grant)]=dict(grant=grant,operation=None)
    ledger=dict(schema=Q.OWNER_PACKAGE_SCHEMA,owner_comment=comment_id,
         owner_id=OWNER_ID,issue=29,controller_sha=controller_pin,rules_sha256=rules_pin,
         source_base=SOURCE_BASE,source_head=SOURCE_HEAD,
         body_sha256=hashlib.sha256(body.encode()).hexdigest(),
         ceiling=2,used_calls=0,grants=grants,
         previous_addressed_sha256=HIST,previous_supplement_sha256=SUP)
    Q.owner_package_ledger(ledger)
    return ledger

def quiescent(controller):
    policy=R.read(R.POLICY,0)
    need(policy.get('mode') in ('active','disabled') and policy.get('controller_sha')==controller,
         'controller must be ACTIVE and exact')
    R.units_quiet(R.UNITS)
    for slot,uid in (('slot1',1002),('slot2',978)):
        j=R.journal(slot);st,_=R.checkpoint(slot)
        need(j['pending'] is None and st['active'] is None,'slot occupied')
        R.no_models(uid,slot)
        R.free_lock(R.AUTONOMY/'slots'/slot/'worker.lock')
        R.free_lock(R.AUTONOMY/'locks'/(slot+'.lease'))
    s=R.journal('slot2')
    need(s['generation']>=96 and
         digest(s['operations'][Q.OWNER_PACKAGE_ORIGINAL_UNKNOWN])==
              Q.OWNER_PACKAGE_ORIGINAL_UNKNOWN_DIGEST,
         'original UNKNOWN/slot generation drift')
    need(sha(R.STATE/Q.ADDRESSED_LEDGER)==HIST and
         sha(R.STATE/Q.SUPPLEMENT_LEDGER)==SUP and
         sha(R.BUDGET)==BUDGET,'historical paid ledgers/budget drift')
    need(not (R.STATE/'integration.json').exists(),'integration in flight')
    installed_rules_ok(controller, sha('/usr/local/lib/gb-actions-train/accepted-engineering-rules.md'))
    return s

def exact_qualification(grant, controller):
    """Construct existing addressed task under root pre-enrollment validation.

    Runtime still calls native_antigravity.qualification_descriptor after the
    atomic marker write, with its full ordinary strict validation.
    """
    Q.validate_addressed_grant(grant,enrollment=True)
    task=dict(schema='GB_ANTIGRAVITY_29_ADDRESSED_TASK_V1',issue=29,
        role=grant['role'],slot='slot2',base=SOURCE_BASE,head=SOURCE_HEAD,
        model=N.MODEL,max_calls=1,adapter_revision=controller,
        qualification_grant=grant)
    q=dict(issue=29,base=SOURCE_BASE,head=SOURCE_HEAD,
        work=str(N.QUALIFICATION_WORK),adapter_revision=controller,
        qualification_grant=grant,task_sha256=digest(task))
    return q


def qa_ready(slot, ledger):
    """One confirmed, tool-supported analysis before any QA marker transition."""
    Q.owner_package_ledger(ledger)
    need(ledger['used_calls']==1,'QA transition requires one spent analysis')
    roles={row['grant']['role']:row for row in ledger['grants'].values()}
    analysis=roles['technical_pm_product_analyst']
    need(analysis['operation'] is not None and roles['independent_qa']['operation'] is None,
         'QA requires exact unspent QA grant')
    op=slot['operations'].get(analysis['operation'],{})
    result=op.get('result') or {}
    native=result.get('native_receipt') or {}
    need(result.get('status')=='confirmed' and result.get('analysis_complete') is True
         and result.get('analysis',{}).get('completion')=='COMPLETE'
         and {'view_file','run_command'} <= set(native.get('tool_names') or [])
         and len(result.get('analysis',{}).get('source_reads') or [])==2,
         'independent QA cannot start before real native analysis COMPLETE')


def transition_plan(action,comment_id,controller,slot,marker,package):
    """Finite occupancy/marker effect only; no grant consumption or provider call."""
    roles={row['grant']['role']:row for row in package['grants'].values()}
    role='technical_pm_product_analyst' if action=='analysis' else 'independent_qa'
    grant=roles[role]['grant']
    if action=='qa':
        qa_ready(slot,package)
        need(marker.get('qualification',{}).get('qualification_grant')==
             roles['technical_pm_product_analyst']['grant'],
             'QA transition must follow this package analysis marker')
    else:
        need(package['used_calls']==0 and
             all(row['operation'] is None for row in package['grants'].values()),
             'analysis package must be unspent')
    q=exact_qualification(grant,controller)
    need(q['task_sha256'] not in {x.get('task_hash') for x in slot['operations'].values()},
         'qualification task already used')
    nextmark=copy.deepcopy(marker)
    nextmark.update(phase='canary',adapter_revision=controller,
        canary_task_sha256=q['task_sha256'],qualification=q,modules={
            'native_antigravity.py':sha(Path(N.__file__)),
            'native_guard.py':sha(Path(N.__file__).with_name('native_guard.py'))})
    nextslot=copy.deepcopy(slot)
    nextslot['generation']+=1
    need(set(nextslot)==set(slot) and nextslot['pending'] is None and
         nextslot['operations']==slot['operations'] and
         all(nextslot[k]==slot[k] for k in slot if k!='generation'),
         'transition would modify more than generation')
    return q,nextmark,nextslot


def encoded(value):
    return json.dumps(value,sort_keys=True).encode()


def safe_put(path, value, before_sha, after_sha, *, mode=0o600):
    """Idempotent exact-before/exact-after write. Any third value fails closed."""
    now=sha(path) if path.exists() else None
    need(now in (before_sha,after_sha),'admission target drift before write')
    if now==before_sha:
        R.atomic(path,value,mode=mode)
    need(sha(path)==after_sha,'admission target write readback mismatch')


def main():
    need(os.geteuid()==0 and len(sys.argv)==3 and
         sys.argv[1] in ('--dry-run','--apply','--qa'),
         'one root authenticated package enrollment or post-COMPLETE QA transition')
    action='qa' if sys.argv[1]=='--qa' else 'analysis'
    comment_id=int(sys.argv[2])
    R.trusted_tree(Path(__file__).resolve())
    fd=os.open(R.STATE/'controller.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        policy=R.read(R.POLICY,0)
        controller=policy['controller_sha']
        receipt=R.STATE/(RECEIPT_PREFIX+str(comment_id)+
                         ('-qa.json' if action=='qa' else '.json'))
        path=R.STATE/(Q.OWNER_PACKAGE_LEDGER_PREFIX+str(comment_id)+'.json')
        oldreceipt=R.STATE/(RECEIPT_PREFIX+str(comment_id)+'.json')
        ledger_authorized=authorize(comment_id,controller)
        if action=='qa':
            need(oldreceipt.exists() and R.read(oldreceipt,0)['phase']=='complete',
                 'original package enrollment not complete')
            package=Q.owner_package_ledger(R.read(path,0))
            need(package['body_sha256']==ledger_authorized['body_sha256'] and
                 package['controller_sha']==controller and
                 set(package['grants'])==set(ledger_authorized['grants']),
                 'QA transition package origin drift')
        else:
            package=ledger_authorized
        existing=R.read(receipt,0) if receipt.exists() else None
        if existing is not None:
            need(existing.get('schema')=='GB_AGY_29_OWNER_PACKAGE_TRANSACTION_V2'
                 and existing.get('action')==action and
                 existing.get('owner_comment')==comment_id and
                 existing.get('controller_sha')==controller and
                 existing.get('body_sha256')==package['body_sha256'] and
                 existing.get('phase') in ('intent','complete'),
                 'unknown or changed admission intent')
        slot=quiescent(controller)
        marker=R.read(N.MARKER,0)
        need(marker.get('phase')=='canary' and marker.get('executor_uid')==978,
             'existing isolated canary marker required')
        if existing:
            # Recovery computes the same reviewed operation from write-ahead
            # snapshots, not from whichever half-written state happens to exist.
            prior_slot=json.loads(existing['slot_before_raw'])
            prior_marker=existing['marker_before']
            if action=='analysis':
                need((sha(path) if path.exists() else None) in (None,existing['package_sha256']),
                     'partial package ledger changed')
            q,newmarker,newslot=transition_plan(
                action,comment_id,controller,prior_slot,prior_marker,package)
            need(existing['slot_before_sha256']==hashlib.sha256(
                 existing['slot_before_raw'].encode()).hexdigest()
                 and existing['slot_after_sha256']==hashlib.sha256(encoded(newslot)).hexdigest()
                 and existing['marker_before_sha256']==hashlib.sha256(encoded(prior_marker)).hexdigest()
                 and existing['marker_after_sha256']==hashlib.sha256(encoded(newmarker)).hexdigest()
                 and existing['task_sha256']==q['task_sha256'],
                 'intent/changed target drift')
        else:
            need(policy['mode']=='active','new registration requires active controller')
            if action=='analysis':
                need(not path.exists(),'new Owner package already registered')
            q,newmarker,newslot=transition_plan(
                action,comment_id,controller,slot,marker,package)
        expected_slot_before=sha(R.STATE/'slot2.json') if not existing else existing['slot_before_sha256']
        expected_marker_before=sha(N.MARKER) if not existing else existing['marker_before_sha256']
        expected_package=hashlib.sha256(encoded(package)).hexdigest() if action=='analysis' else sha(path)
        if existing is None:
            before_raw=(R.STATE/'slot2.json').read_bytes()
            transaction=dict(schema='GB_AGY_29_OWNER_PACKAGE_TRANSACTION_V2',
                 phase='intent',action=action,owner_comment=comment_id,
                 controller_sha=controller,body_sha256=package['body_sha256'],
                 slot_before_raw=before_raw.decode(),
                 slot_before_sha256=expected_slot_before,
                 slot_after_sha256=hashlib.sha256(encoded(newslot)).hexdigest(),
                 marker_before=marker,marker_before_sha256=expected_marker_before,
                 marker_after_sha256=hashlib.sha256(encoded(newmarker)).hexdigest(),
                 task_sha256=q['task_sha256'],package_sha256=expected_package,
                 policy_before=policy,historic_sha256=HIST,
                 supplement_sha256=SUP,budget_sha256=BUDGET,
                 charged_calls=0,role=q['qualification_grant']['role'])
        else:transaction=existing
        # Ordinary runtime has never been given a new authorization while the
        # complete signed admission receipt is missing.
        now_slot=sha(R.STATE/'slot2.json')
        now_marker=sha(N.MARKER)
        need(now_slot in (transaction['slot_before_sha256'],
                          transaction['slot_after_sha256'])
             and now_marker in (transaction['marker_before_sha256'],
                                transaction['marker_after_sha256']),
             'foreign change during admission')
        if policy['mode']=='active' and existing and existing['phase']=='intent':
            need(now_slot==transaction['slot_before_sha256'] and
                 now_marker==transaction['marker_before_sha256'] and
                 (action=='qa' or not path.exists()),
                 'incomplete active admission with exposed new grants')
        if sys.argv[1]=='--dry-run':
            need(not existing,'dry-run cannot resume real intent')
            print(json.dumps(dict(status='DRY_RUN_PASS',owner_comment=comment_id,
                 action=action,controller=controller,generation_before=slot['generation'],
                 generation_after=newslot['generation'],task_sha256=q['task_sha256'],
                 grants=2,provider_calls=0,protected_writes=0),sort_keys=True))
            return
        if existing is None:
            R.atomic(receipt,transaction)
        if policy['mode']=='active' and existing and existing['phase']=='complete':
            need(now_slot==transaction['slot_after_sha256'] and
                 now_marker==transaction['marker_after_sha256'],
                 'completed admission runtime mismatch')
            print(json.dumps(dict(status='ALREADY_COMPLETE',action=action,
                 controller=controller,owner_comment=comment_id,model_calls=0)))
            return
        if policy['mode']=='active':
            R.atomic(R.POLICY,dict(policy,mode='disabled'),mode=0o644)
        # No dispatch while any of the three protected files is half-written.
        if action=='analysis':
            safe_put(path,package,None,transaction['package_sha256'])
        safe_put(N.MARKER,newmarker,
                 transaction['marker_before_sha256'],
                 transaction['marker_after_sha256'],mode=0o644)
        safe_put(R.STATE/'slot2.json',newslot,
                 transaction['slot_before_sha256'],transaction['slot_after_sha256'])
        need(N.qualification_descriptor(R.read(N.MARKER,0))==q,
             'post-enrollment native descriptor rejected')
        check=Q.owner_package_ledger(R.read(path,0))
        need(check==package,'per-role grants/ledger changed during admission')
        need(sha(R.STATE/Q.ADDRESSED_LEDGER)==HIST and
             sha(R.STATE/Q.SUPPLEMENT_LEDGER)==SUP and
             sha(R.BUDGET)==BUDGET,'historical grants or budget modified')
        R.atomic(receipt,dict(transaction,phase='complete'))
        R.atomic(R.POLICY,dict(transaction['policy_before'],mode='active'),mode=0o644)
        need(R.read(R.POLICY,0)['mode']=='active'
             and R.read(R.POLICY,0)['controller_sha']==controller,
             'controller could not reactivate after complete admission')
        print(json.dumps(dict(status='ADMITTED',action=action,
             owner_comment=comment_id,controller=controller,
             generation=newslot['generation'],
             task_sha256=q['task_sha256'],
             receipt=str(receipt),models_started=0),sort_keys=True))
    finally:
        os.close(fd)


if __name__=='__main__':main()

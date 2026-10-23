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
RULES='38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c'
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

def authorize(comment_id,controller):
    body,v=owner_comment(comment_id)
    need(type(v) is dict and set(v)=={
         'schema','issue','repo_id','controller_sha','rules_sha256','source_base',
         'source_head','model','calls','max_calls','owner_comment'},
         'unexpected Owner authorization fields')
    need(v['schema']==Q.OWNER_PACKAGE_SCHEMA and v['issue']==29 and
         v['repo_id']==REPO_ID and v['owner_comment']==comment_id and
         v['controller_sha']==controller and v['rules_sha256']==RULES and
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
          owner_comment=comment_id,role=role,controller_revision=controller,
          cli_sha256=N.AGY_SHA256,rules_sha256=RULES,
          base=SOURCE_BASE,head=SOURCE_HEAD,input_revision=row['input_revision'],
          input_path=row['input_path'],input_sha256=row['input_sha256'],
          timeout=1800,max_output_bytes=N.MAX_OUT,
          permission_mode=N.PERMISSION_MODE,input_transport='stream-json',ceiling=1)
        Q.validate_addressed_grant(grant,enrollment=True)
        # Require the installed candidate real immutable source, not a guessed SHA.
        Q.addressed_input(N.QUALIFICATION_WORK,grant,installer=True)
        grants[digest(grant)]=dict(grant=grant,operation=None)
    ledger=dict(schema=Q.OWNER_PACKAGE_SCHEMA,owner_comment=comment_id,
         owner_id=OWNER_ID,issue=29,controller_sha=controller,rules_sha256=RULES,
         source_base=SOURCE_BASE,source_head=SOURCE_HEAD,
         body_sha256=hashlib.sha256(body.encode()).hexdigest(),
         ceiling=2,used_calls=0,grants=grants,
         previous_addressed_sha256=HIST,previous_supplement_sha256=SUP)
    Q.owner_package_ledger(ledger)
    return ledger

def quiescent(controller):
    policy=R.read(R.POLICY,0)
    need(policy.get('mode')=='active' and policy.get('controller_sha')==controller,
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
    from context_policy import RULES_SHA256
    need(RULES_SHA256==RULES and sha('/usr/local/lib/gb-actions-train/accepted-engineering-rules.md')==RULES,
         'installed rules changed')
    return s

def main():
    need(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1] in ('--dry-run','--apply'),
         'one root authenticated package admission only')
    comment_id=int(sys.argv[2])
    R.trusted_tree(Path(__file__).resolve())
    fd=os.open(R.STATE/'controller.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        controller=R.read(R.POLICY,0)['controller_sha']
        before=quiescent(controller)
        ledger=authorize(comment_id,controller)
        path=R.STATE/(Q.OWNER_PACKAGE_LEDGER_PREFIX+str(comment_id)+'.json')
        receipt=R.STATE/(RECEIPT_PREFIX+str(comment_id)+'.json')
        need(not path.exists() and not receipt.exists(),'Owner package already admitted')
        marker=R.read(N.MARKER,0)
        need(marker.get('phase')=='canary' and marker['executor_uid']==978,
             'existing canary marker changed')
        analysis=next(row['grant'] for row in ledger['grants'].values()
                      if row['grant']['role']=='technical_pm_product_analyst')
        q=dict(issue=29,base=SOURCE_BASE,head=SOURCE_HEAD,
              work=str(N.QUALIFICATION_WORK),adapter_revision=controller,
              qualification_grant=analysis)
        q['task_sha256']=digest(N.qualification_task(SOURCE_BASE,SOURCE_HEAD,
                adapter_revision=controller,qualification_grant=analysis))
        need(q['task_sha256'] not in {x.get('task_hash') for x in before['operations'].values()},
             'duplicate exact analysis task')
        newmarker=copy.deepcopy(marker)
        newmarker.update(adapter_revision=controller,canary_task_sha256=q['task_sha256'],
          qualification=q,modules={
            'native_antigravity.py':sha(Path(N.__file__)),
            'native_guard.py':sha(Path(N.__file__).with_name('native_guard.py'))})
        newslot=copy.deepcopy(before)
        newslot['generation']+=1
        # validate marker after root authoritative file exists only; offline structure check here.
        need(set(newslot)==set(before) and newslot['operations']==before['operations']
             and newslot['pending'] is None,'foreign slot changes')
        if sys.argv[1]=='--dry-run':
            print(json.dumps(dict(status='DRY_RUN_PASS',owner_comment=comment_id,
                  bound_controller=controller,old_generation=before['generation'],
                  new_generation=newslot['generation'],model_calls=0,
                  grant_digests=list(ledger['grants']),ledger_count=2),sort_keys=True))
            return
        original=dict(marker=marker,slot=before)
        evidence=dict(schema='GB_AGY_29_OWNER_PACKAGE_ADMISSION_V1',phase='intent',
             comment_id=comment_id,body_sha256=ledger['body_sha256'],
             controller_sha=controller,prior=original,
             changed={'marker':sha(N.MARKER),'slot':sha(R.STATE/'slot2.json')},
             historic_sha256=HIST,supplement_sha256=SUP,budget_sha256=BUDGET,
             package_ledger_sha256=hashlib.sha256(json.dumps(ledger,sort_keys=True).encode()).hexdigest())
        R.atomic(receipt,evidence)
        R.atomic(path,ledger)
        R.atomic(N.MARKER,newmarker,mode=0o644)
        R.atomic(R.STATE/'slot2.json',newslot)
        need(N.qualification_descriptor(R.read(N.MARKER,0))==q,'new dynamic canary rejected')
        need(Q.owner_package_read(R,analysis)['used_calls']==0,'new package ledger readback failed')
        need(R.journal('slot2')['generation']==newslot['generation'],'slot generation drift')
        quiescent(controller)
        R.atomic(receipt,dict(evidence,phase='complete'))
        print(json.dumps(dict(status='ADMITTED',owner_comment=comment_id,
          generation=newslot['generation'],controller=controller,
          grant_digests=list(ledger['grants']),new_model_calls=0),sort_keys=True))
    finally:
        os.close(fd)

if __name__=='__main__':main()

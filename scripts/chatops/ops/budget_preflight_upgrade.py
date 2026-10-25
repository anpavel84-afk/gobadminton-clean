#!/usr/bin/python3
"""OPS211 follow-up. Exactly two library files, stopped pre-call QA, no history rewind."""
import argparse,copy,importlib.util,json,os,pathlib,re,sys,time
sys.path.insert(0,'/usr/local/lib/gb-actions-train')
import receiver,installer
STATE=receiver.STATE
JOURNAL=STATE/'budget-preflight-211.json'
BACKUP=STATE/'budget-preflight-211-backup'
OLD='a731fc9434495e33a5cb300deebb818154d0c2cc'
UNLIMITED='c6213357f461ef63884dc8f25759bddb8cae09c13526e9e72777f04e4747cdbf'
TARGETS={pathlib.Path('/usr/local/lib/gb-actions-train')/p for p in ('receiver.py','qa_recovery.py')}

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def execute(action,bundle,manifest,controller,stage_hash,dispatch_hash,run=None):
    receiver.need(os.geteuid()==0,'root integrator only')
    receiver.trusted_tree(bundle)
    u=load('_reviewed_cost_upgrade',bundle/'scripts/chatops/ops/cost_policy_upgrade.py')
    u.quiet()
    def preserved():
        result=u.preserved()
        for p in (u.BUDGET,STATE/'cost-policy-211.json'):result[str(p)]=installer.sha(p)
        return result
    p=receiver.read(receiver.POLICY,0)
    if action=='activate':
        j=receiver.read(JOURNAL,0)
        receiver.need(j['phase']=='installed-disabled' and p['mode']=='disabled' and p['controller_sha']==j['controller'],'wrong activation boundary')
        receiver.need(preserved()==j['preserved'],'authoritative state changed')
        receiver.need(all(installer.sha(pathlib.Path(k))==v['after'] for k,v in j['changes'].items()),'installed code drift')
        evidence=u.probe(run,j)
        receiver.atomic(receiver.POLICY,p|{'mode':'active'},mode=0o644)
        j.update(phase='active',shadow=evidence);receiver.atomic(JOURNAL,j)
        receiver.publish_monitor(p|{'mode':'active'})
        return {'phase':'active','shadow':evidence,'state_preserved':True}
    if action=='rollback':
        j=receiver.read(JOURNAL,0)
        receiver.need(p['mode']=='disabled' and j['phase'] in ('backing-up','applying','installed-disabled'),'rollback boundary')
        receiver.need(preserved()==j['preserved'],'never rewind task/history/usage')
        for i,(name,value) in enumerate(sorted(j['changes'].items())):
            target=pathlib.Path(name);current=installer.sha(target)
            receiver.need(current in (value['before'],value['after']),'foreign target drift')
            if current!=value['before']:
                source=BACKUP/str(i);receiver.need(installer.sha(source)==value['before'],'backup drift');installer.put(source,target,0o644)
        receiver.atomic(STATE/'backup.json',j['record_before'])
        receiver.atomic(receiver.POLICY,j['policy_before'],mode=0o644)
        j['phase']='rolled-back';receiver.atomic(JOURNAL,j)
        return {'phase':'rolled-back','state_preserved':True}
    receiver.need(action in ('dry','apply'),'invalid action')
    items=installer.payload(bundle,manifest);record=receiver.read(STATE/'backup.json',0)
    receiver.need(p['controller_sha']==OLD and p['mode'] in ('active','disabled'),'baseline controller differs')
    receiver.need(all(installer.sha(pathlib.Path(k))==v for k,v in record['after'].items()),'baseline drift')
    changed={target:source for target,source in items.items() if installer.sha(target)!=installer.sha(source)}
    receiver.need(set(changed)==TARGETS and installer.sha(u.BUDGET)==UNLIMITED,'unexpected targets/budget')
    receiver.need(re.fullmatch('[a-f0-9]{40}',controller or ''),'immutable source required')
    wf=bundle/'.github/workflows/train-stage.yml';dispatcher=bundle/'.github/workflows/train-dispatch.yml'
    receiver.need(installer.sha(wf)==stage_hash and installer.sha(dispatcher)==dispatch_hash
                  and wf.read_bytes().count(('ref: '+controller).encode())==2
                  and dispatcher.read_bytes().count(('ref: '+controller).encode())==2,'workflow/pin mismatch')
    q=load('_reviewed_qa_preflight',bundle/'scripts/chatops/actions_train/qa_recovery.py')
    budget=receiver.read(u.BUDGET,0,16384);eligible={}
    for slot in ('slot1','slot2'):
        op=receiver.journal(slot);state,_=receiver.checkpoint(slot)
        receiver.need(q.preflight_candidate(op,state,receiver.alive) and q.preflight_unlimited(op,budget),'not a proven unused QA preflight')
        eligible[slot]=op['pending']
    snapshot=preserved()
    changes={str(k):{'before':installer.sha(k),'after':installer.sha(v)} for k,v in changed.items()}
    if action=='dry':return {'dry':True,'changes':changes,'eligible':eligible,'preserved_files':len(snapshot)}
    receiver.need(not JOURNAL.exists() and not BACKUP.exists(),'prior install journal exists')
    j={'phase':'backing-up','installed_at':int(time.time()),'controller':controller,'dispatch_sha256':dispatch_hash,
       'changes':changes,'preserved':snapshot,'policy_before':p,'record_before':record,'eligible':eligible}
    receiver.atomic(JOURNAL,j)  # write-ahead BEFORE backups or any code replacement
    receiver.atomic(receiver.POLICY,p|{'mode':'disabled'},mode=0o644)
    BACKUP.mkdir(mode=0o700)
    for i,(name,value) in enumerate(sorted(changes.items())):installer.put(pathlib.Path(name),BACKUP/str(i),0o600)
    j['phase']='applying';receiver.atomic(JOURNAL,j)
    for target,source in changed.items():installer.put(source,target,0o644)
    receiver.need(preserved()==snapshot,'authoritative state changed')
    record=copy.deepcopy(record);record['manifest']=manifest
    for target,source in items.items():record['after'][str(target)]=installer.sha(source)
    receiver.atomic(STATE/'backup.json',record)
    policy=copy.deepcopy(p);policy.update(mode='disabled',controller_sha=controller,stage_workflow_sha256=stage_hash)
    policy['recovery']['source_sha']=controller
    receiver.atomic(receiver.POLICY,policy,mode=0o644)
    j['phase']='installed-disabled';receiver.atomic(JOURNAL,j)
    return {'phase':'installed-disabled','preserved_files':len(snapshot),'counter_reset':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=('dry','apply','activate','rollback'))
    p.add_argument('--bundle',type=pathlib.Path,required=True);p.add_argument('--manifest',required=True)
    p.add_argument('--controller',required=True);p.add_argument('--stage-hash',required=True);p.add_argument('--dispatch-hash',required=True);p.add_argument('--run',type=int)
    a=p.parse_args();lock=receiver.locked(STATE/'controller.lock')
    try:print(json.dumps(execute(a.action,a.bundle,a.manifest,a.controller,a.stage_hash,a.dispatch_hash,a.run),sort_keys=True))
    finally:os.close(lock)
if __name__=='__main__':main()

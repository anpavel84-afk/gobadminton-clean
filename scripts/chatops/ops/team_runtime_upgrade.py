"""Prospective team upgrade functions; caller supplies the existing authenticated API.

No runtime proof/baseline is guessed. This module has no auto-install entrypoint.
Use only a reviewed root caller with an exact proof after AGY is actually ready.
Reuses existing quiescence, payload, shadow and rollback primitives; no services.

Activation ordering: the reviewed caller first disables policy under the existing
controller lock/quiescence, before posting the immutable NEW #230 admission.
Then bind its exact comment in proof, apply while disabled, complete the hosted
disabled shadow, and activate. Do not admit #230 while the old active router and
#225-bound Cursor marker can select a fallback. This helper never posts admission.
"""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as r
import installer as i
from core import digest, loads

STATE = r.STATE
INSTALL = Path('/usr/local/lib/gb-actions-train')
JOURNAL = STATE/'team-runtime-218.json'
BACKUP = STATE/'team-runtime-218-backup'
AGY = Path('/etc/gobadminton-slots/antigravity-qa.json')
CURSOR = Path('/etc/gobadminton-slots/cursor-author.json')
WATCHDOG = Path('/home/agentagency-dev/.local/libexec/gobadminton-train-watchdog.py')
WATCHDOG_BEFORE = 'b557ad3743ec41464d000a7a4b49627ebabcd4121f29cc588bd17acf8e179811'
MODELS = ['claude-sonnet-5-5-medium','claude-sonnet-5-5-high','claude-opus-5-5-high']
HELPERS = {'context_stability_upgrade.py':'26f9032e6a47e478f45666be9a73004d6b415e85358908e02e9b495316dc408f',
           'cost_policy_upgrade.py':'781c89f8fac0b234a5aefc81dd10c6df10b91adc080d703bd7fb2d458a7e7094'}
ALLOWED = {INSTALL/n for n in ('context_policy.py','core.py','cost_policy.py','failure_diagnosis.py',
    'live/autonomous_issues.py','monitor.py','monitor_extension.js','receiver.py','recovery.py',
    'recovery_admission.py','stage.py','native_antigravity.py')}
ALLOWED |= {Path('/usr/local/lib/gb-ops-monitor/web/app.js')}
PROOF_KEYS = {'schema','reviewed','baseline_controller','baseline_record_sha256','controller',
    'manifest_sha256','stage_workflow_sha256','dispatch_workflow_sha256','changes',
    'agy_marker_sha256','cursor_marker_sha256','agy_operation','agy_operation_sha256',
    'task','task_sha256','admission_comment','release_revision'}


def encoded(value):
    return json.dumps(value,sort_keys=True).encode()


def helpers(bundle):
    result=[]
    for name,sha in HELPERS.items():
        path=bundle/'scripts/chatops/ops'/name
        r.trusted_tree(path);r.need(i.sha(path)==sha,'reviewed OPS helper drift')
        spec=importlib.util.spec_from_file_location('_team218_'+name[:-3],path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);result.append(module)
    return result


def preserved(C,u):
    result=C.preserved(u)
    # Include installation/qualification/lineage journals and marker history.
    # Planning export is observational and changes during the existing shadow probe.
    for path in STATE.rglob('*'):
        if path.is_file() and path not in (JOURNAL,STATE/'backup.json',STATE/'planning.json') and BACKUP not in path.parents:
            r.need(not path.is_symlink(),'untrusted state history link')
            result[str(path)]=i.sha(path)
    for path in (AGY,CURSOR):
        result.pop(str(path),None)  # Exact reversible marker changes are separately journaled.
    return result


def validate_proof(proof,baseline):
    r.need(type(proof) is dict and set(proof)==PROOF_KEYS
           and proof['schema']=='GB_TEAM_RUNTIME_218_PROOF_V2' and proof['reviewed'] is True,
           'exact reviewed team proof required')
    r.need(isinstance(baseline,str) and re.fullmatch('[a-f0-9]{40}',baseline)
           and proof['baseline_controller']==baseline
           and re.fullmatch('[a-f0-9]{40}',proof['controller'])
           and proof['controller']!=baseline
           and type(proof['release_revision']) is str
           and re.fullmatch('[a-f0-9]{40}',proof['release_revision'])
           and proof['release_revision']!=proof['controller'],'explicit future AGY-ready baseline required')
    for key in ('baseline_record_sha256','manifest_sha256','stage_workflow_sha256',
                'dispatch_workflow_sha256','agy_marker_sha256','cursor_marker_sha256',
                'agy_operation_sha256','task_sha256'):
        r.need(isinstance(proof[key],str) and re.fullmatch('[a-f0-9]{64}',proof[key]),'invalid proof digest')
    r.need(isinstance(proof['agy_operation'],str) and re.fullmatch('[a-f0-9]{64}',proof['agy_operation']),
           'missing actual accepted AGY operation')
    changes=proof['changes']
    r.need(type(changes) is dict and changes,'exact reviewed target deltas required')
    for name,row in changes.items():
        r.need(type(name) is str and type(row) is dict and set(row)=={'before','after'}
               and (row['before'] is None or re.fullmatch('[a-f0-9]{64}',row['before']))
               and isinstance(row['after'],str) and re.fullmatch('[a-f0-9]{64}',row['after']),
               'invalid reviewed target delta')
    task=proof['task']
    required={'schema','target','kind','goal','acceptance','allowed_paths','max_attempts'}
    optional={'depends_on','locks','model','effort','work_kind','risk','author_routes','qa_routes',
              'routing_policy','failure_diagnosis'}
    r.need(type(task) is dict and required<=set(task)<=required|optional,'unsupported task fields')
    r.need(type(task) is dict and digest(task)==proof['task_sha256']
           and task.get('schema')=='GOBADMINTON_AUTONOMY_V1'
           and task.get('kind')=='source_only' and task.get('target')=='dev'
           and type(task.get('max_attempts')) is int and 1<=task['max_attempts']<=3
           and type(task.get('author_routes')) is list and task['author_routes']
           and task['author_routes'][0]=='cursor:auto',
           'new bounded source task required')
    diagnosis=task.get('failure_diagnosis')
    r.need(type(diagnosis) is dict and set(diagnosis)=={'schema','route','max_calls'}
           and diagnosis['schema']=='GB_FAILURE_DIAGNOSIS_218_V1'
           and diagnosis['route']=='codex:gpt-6-astra:high'
           and type(diagnosis['max_calls']) is int and 1<=diagnosis['max_calls']<=3,
           'explicit finite diagnosis policy required')
    comment=proof['admission_comment']
    r.need(type(comment) is dict and set(comment)=={'id','fingerprint'} and type(comment['id']) is int
           and comment['id']>0 and re.fullmatch('[a-f0-9]{64}',comment['fingerprint']),
           'exact new admission comment required')


def admission(api,proof):
    """The marker never replaces ordinary claim-time admission validation."""
    r.need(api is not None,'existing authenticated admission reader required')
    api.identity()
    a,_=r.live()
    a.patterns(proof['task']['allowed_paths']);a.check_links(proof['task'],230)
    issue=api('issues/230')
    r.need(issue.get('number')==230 and issue.get('user',{}).get('id')==318610566
           and issue.get('state')=='open' and 'pull_request' not in issue
           and not (issue.get('body') or '').startswith(a.MARKER+'\n'),'wrong or duplicate task230 admission')
    comments=[c for c in api.pages('issues/230/comments') if c.get('user',{}).get('id')==318610566
              and (c.get('body') or '').startswith(a.MARKER+'\n')]
    r.need(len(comments)==1,'sole immutable Owner admission required')
    c=comments[0]
    r.need(c.get('id')==proof['admission_comment']['id']
           and c.get('issue_url')=='https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/230'
           and c.get('created_at')==c.get('updated_at') and c.get('created_at')
           and a.comment_fingerprint(c)==proof['admission_comment']['fingerprint']
           and loads(c['body'].partition('\n')[2])==proof['task'],'new admission bytes/identity changed')
    created=dt.datetime.fromisoformat(c['created_at'].replace('Z','+00:00'))
    now=dt.datetime.now(dt.timezone.utc)
    r.need(created<=now and now-created<=dt.timedelta(days=7),'new admission is stale')
    for slot in ('slot1','slot2'):
        state,parked=r.checkpoint(slot);j=r.journal(slot)
        r.need(230 not in state['done'] and 230 not in parked
               and (state.get('active') or {}).get('issue')!=230
               and all(o.get('binding',{}).get('issue')!=230 for o in j['operations'].values())
               and all(e.get('issue')!=230 for e in j.get('deferred',[])),
               'task230 already used; never rebind a spent task')
    for path in (STATE/'history').rglob('*.json'):
        r.need(r.read(path,0).get('binding',{}).get('issue')!=230,'archived task230 operation already exists')


def markers(proof,module_hashes):
    oldagy=r.read(AGY,0);oldcursor=r.read(CURSOR,0)
    r.need(i.sha(AGY)==proof['agy_marker_sha256'] and i.sha(CURSOR)==proof['cursor_marker_sha256'],
           'baseline marker drift')
    accepted=oldagy.get('accepted_canary',{})
    op=r.journal('slot2')['operations'].get(proof['agy_operation'])
    r.need(oldagy.get('schema')=='GB_ANTIGRAVITY_QA_29_V1' and oldagy.get('phase')=='ready'
           and oldagy.get('slot')=='slot2' and oldagy.get('executor_uid')==978
           and accepted.get('operation')==proof['agy_operation']
           and op and digest(op)==proof['agy_operation_sha256'],'actual AGY-ready acceptance required')
    result=op.get('result',{});receipt=result.get('native_receipt',{});q=oldagy.get('qualification',{})
    from antigravity_qa_recovery import acceptance_match
    r.need(acceptance_match(op,q),'accepted bounded successor receipt mismatch')
    for marker in (oldagy,oldcursor):
        r.need(marker.get('modules') and all(i.sha(INSTALL/name)==sha for name,sha in marker['modules'].items()),
               'baseline native module pins changed')
    r.need(result.get('status')=='confirmed' and result.get('qualification_passed') is True
           and result.get('checkpoint_changed') is False and op.get('before')==op.get('after')
           and op.get('finished_at') and accepted.get('run')==op.get('run')
           and result.get('qa',{}).get('verdict')=='PASS'
           and receipt.get('qualification_passed') is True and receipt.get('charged_calls')==1
           and receipt.get('effective_model')==MODELS[0]
           and receipt.get('source_sha')==q.get('head')==accepted.get('source_sha')
           and receipt.get('qualification_task_sha256')==q.get('task_sha256')==accepted.get('task_sha256'),
           'missing exact accepted native receipt')
    r.need(oldcursor.get('schema')=='GB_CURSOR_AUTHOR_211_V1'
           and oldcursor.get('phase')=='canary' and oldcursor.get('successor',{}).get('issue')==225,
           'exact historical Cursor successor marker required')
    agy=copy.deepcopy(oldagy)
    agy['modules']={name:module_hashes[name] for name in ('native_antigravity.py','native_guard.py')}
    agy['admitted_models']=list(MODELS)
    cursor=copy.deepcopy(oldcursor)
    cursor['phase']='canary';cursor['canary_task_sha256']=proof['task_sha256']
    cursor['modules']={name:module_hashes[name] for name in ('native_cursor.py','native_guard.py')}
    return {AGY:agy,CURSOR:cursor}


def watchdog_parent(target):
    r.need(target==WATCHDOG,'unexpected user libexec target')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in target.parent.parts[1:]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child;info=os.fstat(fd)
            r.need(info.st_uid in (0,1002) and not info.st_mode&0o022,'untrusted watchdog ancestor')
        result=fd;fd=None;return result
    finally:
        if fd is not None:os.close(fd)


def put(source,target,mode,uid=0,gid=0):
    if target!=WATCHDOG:
        i.put(source,target,mode);return
    # Existing user libexec only, held directory fd; never follow a swapped HOME path.
    parent=watchdog_parent(target);tmp='.'+target.name+'.team218'
    try:
        fd=os.open(target.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        try:
            info=os.fstat(fd)
            r.need(stat.S_ISREG(info.st_mode) and info.st_uid==1002 and info.st_nlink==1
                   and info.st_uid==uid and info.st_gid==gid and stat.S_IMODE(info.st_mode)==mode,
                   'watchdog metadata drift')
        finally:os.close(fd)
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
        with os.fdopen(fd,'wb') as out:
            out.write(source.read_bytes());os.fchown(out.fileno(),uid,gid);os.fchmod(out.fileno(),mode)
            out.flush();os.fsync(out.fileno())
        os.replace(tmp,target.name,src_dir_fd=parent,dst_dir_fd=parent);os.fsync(parent)
    finally:
        try:os.unlink(tmp,dir_fd=parent)
        except FileNotFoundError:pass
        os.close(parent)


PROTOCOL_PROBE = r"""
import sys,json,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'scripts/chatops/actions_train'))
import core
A,S=core.live()
task=json.loads(sys.argv[2]);now=dt.datetime.now(dt.timezone.utc);stamp=now.isoformat()
issue=dict(number=230,user={'id':core.OWNER},state='open',created_at=stamp,updated_at=stamp,
           body=A.MARKER+'\n'+json.dumps(task))
assert A.validate_issue(issue,now-dt.timedelta(days=1))==task
head='a'*40
active=dict(issue=230,task=task,phase='qa',head=head,base='b'*40,attempt=1,
            qa=dict(verdict='FAIL',findings=['AssertionError: timeout cleanup'],reviewed_sha=head))
assert core.next_stage(active)=='failure_diagnosis'
active.update(phase='ci',qa=None,ci_failure={'head':head})
assert core.next_stage(active)=='failure_diagnosis'
request=dict(action='train',stage='failure_diagnosis',phase='ci',head=head,attempt=1,
             generation=0,slot='slot2',issue=230,profile='codex',run=1,run_attempt=1,
             gh_token='offline-protocol-placeholder')
core.request(request)
card=dict(active=active,done=[],parked=[],owned=True,pending=None,generation=0,last=None)
assert core.plan(A,S,{'slots':{'slot2':card}},[])[0]['stage']=='failure_diagnosis'
print(json.dumps({'admission':True,'request':True,'qa_fail':True,'ci_fail':True,'plan':True}))
"""


def protocol_probe(bundle,task):
    """Deterministic probe of the reviewed, provenance-checked payload, never a model.

    Root drops to the existing QA executor UID before importing source. No tokens,
    HOME, installed imports, services or provider are supplied to this process.
    """
    def drop():
        if os.geteuid()==0:
            os.setgroups([]);os.setgid(978);os.setuid(978)
    done=subprocess.run(['/usr/bin/python3','-I','-B','-c',PROTOCOL_PROBE,str(bundle),json.dumps(task)],
        cwd=bundle,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/nonexistent'},
        capture_output=True,timeout=30,preexec_fn=drop)
    r.need(done.returncode==0 and len(done.stdout)<=4096 and len(done.stderr)<=4096,
           'pinned payload protocol probe failed')
    value=loads(done.stdout)
    r.need(value==dict(admission=True,request=True,qa_fail=True,ci_fail=True,plan=True),
           'incomplete pinned payload protocol proof')
    return value


def verify_release(bundle,proof):
    """C contains implementation; R contains only the four real checkout refs.

    Compare every installed manifest blob to C, not merely ref counts. A local,
    immutable reviewed repository is required; no fetch or guessed future SHA.
    """
    from native_antigravity import git
    bundle=Path(bundle)
    r.need(git(bundle,'rev-parse','HEAD').decode().strip()==proof['release_revision'],
           'release checkout is not exact reviewed R')
    manifest_path='scripts/chatops/actions_train/manifest.json'
    raw=git(bundle,'show',proof['controller']+':'+manifest_path)
    r.need(hashlib.sha256(raw).hexdigest()==proof['manifest_sha256']
           and raw==(bundle/manifest_path).read_bytes(),'C manifest/release payload mismatch')
    manifest=loads(raw)
    r.need(manifest.get('schema')=='GB_ACTIONS_TRAIN_INSTALL_V1','pinned manifest schema mismatch')
    for name,sha in manifest['files'].items():
        r.need(type(name) is str and '..' not in name.split('/') and name.startswith('scripts/chatops/'),
               'pinned manifest path invalid')
        pinned=git(bundle,'show',proof['controller']+':'+name,limit=4<<20)
        r.need(hashlib.sha256(pinned).hexdigest()==sha and pinned==(bundle/name).read_bytes(),
               'pinned C payload provenance mismatch')
    for name,key in (('train-stage.yml','stage_workflow_sha256'),('train-dispatch.yml','dispatch_workflow_sha256')):
        path='.github/workflows/'+name;wf=(bundle/path).read_bytes()
        r.need(git(bundle,'show',proof['release_revision']+':'+path)==wf
               and hashlib.sha256(wf).hexdigest()==proof[key], 'reviewed R workflow mismatch')
        # Match actual checkout steps and their ref, not unrelated ref-like strings.
        refs=re.findall(rb'uses: actions/checkout@[^\n]+\n[ \t]+with:\n[ \t]+ref: ([a-f0-9]{40})[ \t]*\n',wf)
        r.need(len(refs)==2 and all(ref.decode()==proof['controller'] for ref in refs),
               'all four hosted checkouts must pin reviewed C')
        before=git(bundle,'show',proof['controller']+':'+path)
        pattern=rb'(uses: actions/checkout@[^\n]+\n[ \t]+with:\n[ \t]+ref: )[a-f0-9]{40}([ \t]*\n)'
        expected,count=re.subn(pattern,lambda m:m[1]+proof['controller'].encode()+m[2],before)
        r.need(count==2 and expected==wf,'R may change only existing checkout refs')
    changed=set(git(bundle,'diff','--name-only',proof['controller'],proof['release_revision']).decode().splitlines())
    r.need(changed=={'.github/workflows/train-stage.yml','.github/workflows/train-dispatch.yml'},
           'R must only release the reviewed implementation C')
    return True


def plan(bundle,proof,baseline,C,u,api):
    validate_proof(proof,baseline);C.quiet()
    policy=r.read(r.POLICY,0);record=r.read(STATE/'backup.json',0)
    r.need(policy['mode']=='disabled' and policy['controller_sha']==baseline
           and i.sha(STATE/'backup.json')==proof['baseline_record_sha256'],'future ready baseline drift')
    r.need(all(i.sha(Path(k))==v for k,v in record['after'].items()),'baseline code drift')
    items=i.payload(bundle,proof['manifest_sha256'])
    for source in items.values():r.trusted_tree(source)
    verify_release(bundle,proof)
    protocol_probe(bundle,proof['task'])
    changed={target:source for target,source in items.items() if i.sha(target)!=i.sha(source)}
    r.need(changed and set(changed)<=ALLOWED,'out-of-scope team payload')
    watchdog=bundle/'scripts/chatops/train_watchdog.py';r.trusted_tree(watchdog)
    info=WATCHDOG.lstat()
    r.need(stat.S_ISREG(info.st_mode) and info.st_uid==1002 and info.st_nlink==1
           and not info.st_mode&0o022,'untrusted existing watchdog')
    r.need(i.sha(WATCHDOG)==WATCHDOG_BEFORE,'existing watchdog baseline changed')
    changed[WATCHDOG]=watchdog
    admission(api,proof)
    virtual=markers(proof,{name:i.sha(bundle/'scripts/chatops/actions_train'/name)
                          for name in ('native_antigravity.py','native_guard.py','native_cursor.py')})
    changes={str(t):dict(before=i.sha(t),after=i.sha(s)) for t,s in changed.items()}
    for target,value in virtual.items():changes[str(target)]=dict(before=i.sha(target),after=hashlib.sha256(encoded(value)).hexdigest())
    r.need(changes==proof['changes'],'reviewed exact target deltas differ')
    metadata={}
    for target in changed:
        info=target.lstat() if target.exists() else None
        metadata[str(target)]=dict(mode=stat.S_IMODE(info.st_mode) if target==WATCHDOG else 0o644,
                                  uid=info.st_uid if target==WATCHDOG else 0,
                                  gid=info.st_gid if target==WATCHDOG else 0)
    return policy,record,items,changed,virtual,changes,metadata,preserved(C,u)


def activate(C,u,j,policy,run_id):
    r.need(j['phase'] in ('installed-disabled','activating','active'),'invalid activation phase')
    r.need(all(i.sha(Path(k))==v['after'] for k,v in j['changes'].items()),'installed team drift')
    if j['phase']=='installed-disabled':
        C.quiet();r.need(preserved(C,u)==j['preserved'],'history changed before activation')
        r.need(policy==j['policy_after'],'wrong disabled team policy')
        shadow=u.probe(run_id,j)
        j.update(phase='activating',activation_intent=dict(disabled=copy.deepcopy(policy),
            active=policy|{'mode':'active'},shadow=shadow))
        r.atomic(JOURNAL,j)
    intent=j['activation_intent']
    r.need(intent['active']==intent['disabled']|{'mode':'active'} and intent['disabled']==j['policy_after'],
           'activation intent drift')
    if policy==intent['disabled']:
        r.need(j['phase']=='activating','completed activation rewound')
        C.quiet();r.need(preserved(C,u)==j['preserved'],'history changed before activation')
        r.atomic(r.POLICY,intent['active'],mode=0o644)
    else:r.need(policy==intent['active'],'foreign policy drift')
    if j['phase']!='active':j.update(phase='active',shadow=intent['shadow']);r.atomic(JOURNAL,j)
    r.publish_monitor(intent['active'])
    return dict(phase='active',shadow=intent['shadow'],history_preserved=True)


def rollback(C,u,j,policy):
    C.quiet()
    r.need(j['phase'] in ('backing-up','applying','installed-disabled') and policy['mode']=='disabled'
           and policy['controller_sha'] in (j['controller'],j['baseline'])
           and preserved(C,u)==j['preserved'],'rollback boundary changed; never rewind state')
    for n,(name,row) in enumerate(sorted(j['changes'].items())):
        target=Path(name);actual=i.sha(target)
        r.need(actual in (row['before'],row['after']),'foreign target drift')
        if actual==row['before']:continue
        if row['before'] is None:target.unlink(missing_ok=True);C.sync_directory(target.parent)
        else:
            source=BACKUP/str(n);r.need(i.sha(source)==row['before'],'backup missing/drift')
            put(source,target,**j['metadata'][name])
    r.atomic(STATE/'backup.json',j['record_before'])
    r.atomic(r.POLICY,j['policy_before']|{'mode':'disabled'},mode=0o644)
    j.update(phase='rolled-back-disabled');r.atomic(JOURNAL,j)
    return dict(phase=j['phase'],history_preserved=True)


def _execute(action,bundle,proof_path,proof_sha256,baseline,*,api=None,run_id=None):
    r.need(os.geteuid()==0,'reviewed root integrator required')
    bundle=Path(bundle);r.trusted_tree(bundle);r.trusted_tree(proof_path)
    r.need(re.fullmatch('[a-f0-9]{64}',proof_sha256 or '') and i.sha(proof_path)==proof_sha256,
           'unreviewed proof file')
    proof=loads(Path(proof_path).read_bytes());validate_proof(proof,baseline)
    C,u=helpers(bundle)
    if action in ('activate','rollback'):
        j=r.read(JOURNAL,0)
        r.need(j['proof_sha256']==proof_sha256 and j['baseline']==baseline
               and j['controller']==proof['controller'],'team release identity changed')
        return activate(C,u,j,r.read(r.POLICY,0),run_id) if action=='activate' else rollback(C,u,j,r.read(r.POLICY,0))
    r.need(action in ('dry','apply'),'unknown team upgrade action')
    policy,record,items,changed,virtual,changes,metadata,snapshot=plan(bundle,proof,baseline,C,u,api)
    if action=='dry':return dict(dry=True,changes=changes,preserved_files=len(snapshot),issue=230)
    r.need(not JOURNAL.exists() and not BACKUP.exists(),'prior team journal/backup; inspect instead of replay')
    for target in virtual:metadata[str(target)]=dict(mode=0o644,uid=0,gid=0)
    nextpolicy=copy.deepcopy(policy)
    nextpolicy.update(mode='disabled',controller_sha=proof['controller'],stage_workflow_sha256=proof['stage_workflow_sha256'])
    nextpolicy['recovery']['source_sha']=proof['controller']
    j=dict(schema='GB_TEAM_RUNTIME_218_UPGRADE_V1',phase='backing-up',installed_at=int(time.time()),
        baseline=baseline,controller=proof['controller'],dispatch_sha256=proof['dispatch_workflow_sha256'],
        changes=changes,metadata=metadata,preserved=snapshot,proof_sha256=proof_sha256,
        policy_before=policy,policy_after=nextpolicy,record_before=record)
    r.atomic(JOURNAL,j)
    BACKUP.mkdir(mode=0o700);C.sync_directory(BACKUP.parent)
    for n,(name,row) in enumerate(sorted(changes.items())):
        if row['before'] is not None:i.put(Path(name),BACKUP/str(n),0o600)
    C.sync_directory(BACKUP);j['phase']='applying';r.atomic(JOURNAL,j)
    r.need(all(i.sha(Path(k))==v['before'] for k,v in changes.items()),'targets changed during backup')
    for target,source in changed.items():put(source,target,**metadata[str(target)])
    for target,value in virtual.items():r.atomic(target,value,mode=0o644)
    r.need(all(i.sha(Path(k))==v['after'] for k,v in changes.items()),'installed verification failed')
    r.need(preserved(C,u)==snapshot,'authoritative state drift')
    nextrecord=copy.deepcopy(record);nextrecord['manifest']=proof['manifest_sha256']
    for target,source in items.items():nextrecord['after'][str(target)]=i.sha(source)
    r.atomic(STATE/'backup.json',nextrecord);r.atomic(r.POLICY,nextpolicy,mode=0o644)
    j['phase']='installed-disabled';r.atomic(JOURNAL,j)
    return dict(phase=j['phase'],history_preserved=True,issue=230)


def execute(action,bundle,proof_path,proof_sha256,baseline,*,api=None,run_id=None):
    """Functions only; acquire the existing controller lock, never launch a provider."""
    r.need(os.geteuid()==0,'reviewed root integrator required')
    lock=r.locked(STATE/'controller.lock')
    try:
        return _execute(action,bundle,proof_path,proof_sha256,baseline,api=api,run_id=run_id)
    finally:os.close(lock)

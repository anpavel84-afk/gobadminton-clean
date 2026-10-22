#!/usr/bin/python3
"""Reviewed #216 context/quarantine upgrade. Fixed scope, no task/history rewind."""
import argparse,copy,fcntl,hashlib,importlib.util,json,os,pathlib,re,subprocess,sys,time,tomllib
sys.path.insert(0,'/usr/local/lib/gb-actions-train')
import receiver as r, installer as i
import stat
COST_HELPER_SHA256='781c89f8fac0b234a5aefc81dd10c6df10b91adc080d703bd7fb2d458a7e7094'
STATE=r.STATE
JOURNAL=STATE/'context-stability-216.json'
BACKUP=STATE/'context-stability-216-backup'
OLD='0f769e3e053c79621c5dae9c27b3772a0f84678d'
INSTALL=pathlib.Path('/usr/local/lib/gb-actions-train')
TARGETS={INSTALL/n for n in ('context_policy.py','core.py','receiver.py','stage.py','live/autonomous_issues.py')}
CONFIG=pathlib.Path('/home/agentagency-dev/.codex/config.toml')
SYSTEM=pathlib.Path('/etc/systemd/system')
PIPE=pathlib.Path('/var/lib/gb-pipeline/pipeline')
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def run(*args):
    return subprocess.run(args,check=True,capture_output=True,text=True,timeout=20).stdout
def quiet():
    r.need(r.read(r.POLICY,0)['mode']=='disabled','new launches must be restricted')
    r.units_quiet(r.UNITS)
    for slot in ('slot1','slot2'):
        j=r.journal(slot);s,_=r.checkpoint(slot)
        if j['pending']:
            op=j['operations'][j['pending']]
            # Preserve UNKNOWN verbatim. This grants no recovery or repeat.
            r.need(not r.alive(op.get('process')) and op.get('finished_at')
                   and op.get('before')==op.get('after')
                   and op.get('result',{}).get('status')=='unknown'
                   and op['binding']['stage']=='author'
                   and op.get('result',{}).get('reason')=='no bounded exact CI assertion/log evidence',
                   'unresolved operation not proven stopped before effects')
        i.safe_state(slot,activation=True)
    r.need(not (STATE/'integration.json').exists(),'integration in flight')
    r.need(not any(v['status'].endswith('_pending') for v in r.recovery_journal()['receipts'].values()),
           'recovery in flight')
def preserved(u):
    result=u.preserved()
    for p in (u.BUDGET,STATE/'cost-policy-211.json',STATE/'budget-preflight-211.json'):
        result[str(p)]=i.sha(p)
    return result
def trim_config(raw,prefixes):
    before=tomllib.loads(raw.decode())
    keys=[k for k in before.get('projects',{}) if k.startswith(prefixes)]
    # Preserve every unrelated byte/setting; refuse unfamiliar TOML layout.
    chunks=re.split(r'(?m)(?=^\[)',raw.decode())
    out=[]
    removed=[]
    for chunk in chunks:
        header=chunk.splitlines()[0] if chunk else ''
        match=re.fullmatch(r'\[projects\.("(?:[^"\\]|\\.)*")\]',header)
        key=json.loads(match[1]) if match else None
        if key in keys:removed.append(key)
        else:out.append(chunk)
    r.need(sorted(removed)==sorted(keys),'unrecognized legacy trust layout')
    desired=copy.deepcopy(before)
    for key in keys:del desired['projects'][key]
    result=''.join(out).encode()
    r.need(tomllib.loads(result.decode())==desired,'unrelated settings changed')
    return result,sorted(keys)
def units(C):
    raw=run('/usr/bin/systemctl','show',*C.LEGACY_UNITS,
            '--property=Id,ActiveState,MainPID,UnitFileState')
    return C.unit_states(raw)
def pipeline_empty():
    r.need(i.sha(pathlib.Path('/usr/local/lib/gb-pipeline/worker.py'))==
           'c73fe47f359356ee1b13ec7e31d238d0211c0f65b0386ead15122914046e2f1c','pipeline code drift')
    cfg=r.read(pathlib.Path('/etc/gb-pipeline/config.json'),0)
    r.need(cfg.get('executor_lock') is None,'pipeline executor enabled')
    for name in ('inbox','installs','done'):
        d=PIPE/name
        r.need(d.is_dir() and not list(d.iterdir()),'legacy queue not empty')
    r.need(not (PIPE.parent/'journal.json').exists(),'legacy journal needs review')
    status=r.read(PIPE/'status.json',0)
    r.need(status.get('runs')==[],'legacy operation present')
def source_state(path):
    if path.is_symlink():
        r.need(os.readlink(path)=='/dev/null','unknown unit symlink')
        return {'kind':'link','link':'/dev/null'}
    if not path.exists():return {'kind':'absent'}
    s=path.stat();r.need(path.is_file() and s.st_uid==0 and not s.st_mode&0o022,'untrusted unit')
    return {'kind':'file','sha256':i.sha(path),'mode':s.st_mode&0o777,'uid':s.st_uid,'gid':s.st_gid}
def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def mask(path):
    temp=path.with_name('.'+path.name+'.216-'+str(os.getpid()))
    os.symlink('/dev/null',temp)
    try:os.replace(temp,path);sync_directory(path.parent)
    finally:temp.unlink(missing_ok=True)
def config_parent():
    # Fixed user settings target; do not weaken installer.trusted_tree for root code.
    r.need(CONFIG==pathlib.Path('/home/agentagency-dev/.codex/config.toml'),'unexpected config target')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for name in CONFIG.parent.parts[1:]:
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child;s=os.fstat(fd)
            r.need(s.st_uid in (0,1002) and not s.st_mode&0o022,'untrusted settings ancestor')
        return fd
    except BaseException:os.close(fd);raise
def config_read_at(parent):
    fd=os.open(CONFIG.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
    try:
        s=os.fstat(fd)
        r.need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==1002
               and not s.st_mode&0o022 and s.st_size<=65536,'untrusted settings')
        raw=os.read(fd,65537);r.need(len(raw)==s.st_size,'settings read changed')
        return raw,dict(sha256=hashlib.sha256(raw).hexdigest(),uid=s.st_uid,gid=s.st_gid,mode=s.st_mode&0o777)
    finally:os.close(fd)
def config_read():
    parent=config_parent()
    try:return config_read_at(parent)
    finally:os.close(parent)
def config_write(raw,expected,info):
    parent=config_parent();name='.config.toml.216-'+str(os.getpid())
    try:
        _,current=config_read_at(parent);r.need(current['sha256']==expected,'settings changed since backup')
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
        try:
            with os.fdopen(fd,'wb') as out:
                out.write(raw);os.fchown(out.fileno(),info['uid'],info['gid'])
                os.fchmod(out.fileno(),info['mode']);out.flush();os.fsync(out.fileno())
            _,current=config_read_at(parent);r.need(current['sha256']==expected,'concurrent settings change')
            os.replace(name,CONFIG.name,src_dir_fd=parent,dst_dir_fd=parent);os.fsync(parent)
            actual,_=config_read_at(parent);r.need(actual==raw,'settings write verification failed')
        finally:
            try:os.unlink(name,dir_fd=parent)
            except FileNotFoundError:pass
    finally:os.close(parent)
def execute(action,bundle,manifest,controller,stage_hash,dispatch_hash,run_id=None):
    r.need(os.geteuid()==0,'root reviewed integrator only');r.trusted_tree(bundle)
    manifest_path=bundle/'scripts/chatops/actions_train/manifest.json'
    r.need(i.sha(manifest_path)==manifest,'unreviewed manifest')
    hashes=json.loads(manifest_path.read_text())['files']
    context_source=bundle/'scripts/chatops/actions_train/context_policy.py'
    cost_source=bundle/'scripts/chatops/ops/cost_policy_upgrade.py'
    r.trusted_tree(context_source);r.trusted_tree(cost_source)
    r.need(i.sha(context_source)==hashes['scripts/chatops/actions_train/context_policy.py']
           and i.sha(cost_source)==COST_HELPER_SHA256,'unreviewed imported helper')
    C=load('_context216',context_source)
    u=load('_cost216',cost_source)
    quiet();p=r.read(r.POLICY,0)
    if action in ('activate','rollback'):
        j=r.read(JOURNAL,0)
        r.need(preserved(u)==j['preserved'],'authoritative state changed; never rewind')
        if action=='activate':
            r.need(j['phase']=='installed-disabled' and p['controller_sha']==j['controller'],'activation boundary')
            r.need(all(i.sha(pathlib.Path(k))==v['after'] for k,v in j['changes'].items()),'installed code drift')
            C.preflight();proof=u.probe(run_id,j)
            r.atomic(r.POLICY,p|{'mode':'active'},mode=0o644)
            j.update(phase='active',shadow=proof);r.atomic(JOURNAL,j)
            r.publish_monitor(p|{'mode':'active'})
            return {'phase':'active','shadow':proof,'preserved_files':len(j['preserved'])}
        r.need(j['phase'] in ('backing-up','applying','installed-disabled'),'rollback after activation refused')
        # Restore only own code/config/unit-file edits, never restart legacy writers.
        for n,(name,v) in enumerate(sorted(j['changes'].items())):
            path=pathlib.Path(name);current=i.sha(path)
            r.need(current in (v['before'],v['after']),'foreign code drift')
            if current!=v['before']:
                if v['before'] is None:path.unlink(missing_ok=True)
                else:
                    backup=BACKUP/('code-'+str(n));r.need(i.sha(backup)==v['before'],'missing exact backup')
                    i.put(backup,path,0o644)
        if i.sha(CONFIG)!=j['config_before']['sha256']:
            r.need(i.sha(CONFIG)==j['config_after'],'foreign settings drift')
            backup=BACKUP/'codex-config';r.need(i.sha(backup)==j['config_before']['sha256'],'missing settings backup')
            config_write(backup.read_bytes(),j['config_after'],j['config_before'])
        for name,before in j['units_before'].items():
            path=SYSTEM/name;now=source_state(path)
            r.need(now==before or now=={'kind':'link','link':'/dev/null'},'foreign unit drift')
            if now!=before:
                if before['kind']=='absent':path.unlink()
                elif before['kind']=='file':
                    backup=BACKUP/('unit-'+name);r.need(i.sha(backup)==before['sha256'],'missing unit backup')
                    i.put(backup,path,before['mode'])
        run('/usr/bin/systemctl','daemon-reload')
        r.atomic(STATE/'backup.json',j['record_before'])
        r.atomic(r.POLICY,j['policy_before']|{'mode':'disabled'},mode=0o644)
        j['phase']='rolled-back-disabled';r.atomic(JOURNAL,j)
        return {'phase':j['phase'],'legacy_restarted':False}
    r.need(action in ('dry','apply'),'unknown action')
    r.need(p['controller_sha']==OLD,'baseline controller differs')
    record=r.read(STATE/'backup.json',0)
    r.need(all(i.sha(pathlib.Path(k))==v for k,v in record['after'].items()),'baseline code drift')
    items=i.payload(bundle,manifest)
    changed={k:v for k,v in items.items() if i.sha(k)!=i.sha(v)}
    r.need(set(changed)==TARGETS,'unexpected runtime changes')
    rules=bundle/'docs/rules/ENGINEERING_OPERATING_MODEL.md'
    r.need(i.sha(rules)==C.RULES_SHA256 and rules.stat().st_size==C.RULES_SIZE,'accepted rules mismatch')
    changed[C.RULES_PATH]=rules
    r.need(re.fullmatch('[a-f0-9]{40}',controller or ''),'immutable source required')
    wf=bundle/'.github/workflows/train-stage.yml';dispatcher=bundle/'.github/workflows/train-dispatch.yml'
    r.need(i.sha(wf)==stage_hash and i.sha(dispatcher)==dispatch_hash
           and wf.read_bytes().count(('ref: '+controller).encode())==2
           and dispatcher.read_bytes().count(('ref: '+controller).encode())==2,'workflow/pin drift')
    us=units(C)
    for name,v in us.items():
        if name=='gb-pipeline.service':
            r.need(v.get('ActiveState') in ('active','inactive') and v.get('MainPID') in ('0','77391'),'pipeline changed')
        else:r.need(v.get('ActiveState')=='inactive' and v.get('MainPID','0')=='0','legacy operation active')
    pipeline_empty()
    config_raw,config_info=config_read();config_new,removed=trim_config(config_raw,C.LEGACY_TRUST_PREFIXES)
    before={name:source_state(SYSTEM/name) for name in C.LEGACY_UNITS}
    changes={str(k):{'before':i.sha(k),'after':i.sha(v)} for k,v in changed.items()}
    snapshot=preserved(u)
    if action=='dry':return {'dry':True,'changes':changes,'legacy_units':len(before),'legacy_trust_removed':removed,
                              'preserved_files':len(snapshot)}
    r.need(not JOURNAL.exists() and not BACKUP.exists(),'prior journal exists; inspect/rollback')
    j={'schema':'GB_CONTEXT_UPGRADE_216_V1','phase':'backing-up','installed_at':int(time.time()),
       'controller':controller,'dispatch_sha256':dispatch_hash,'changes':changes,'preserved':snapshot,
       'policy_before':p,'record_before':record,'units_before':before,
       'config_before':config_info,
       'config_after':hashlib.sha256(config_new).hexdigest(),'legacy_trust_removed':removed}
    r.atomic(JOURNAL,j) # write-ahead before ALL backups and changes
    BACKUP.mkdir(mode=0o700)
    for n,(name,v) in enumerate(sorted(changes.items())):
        if v['before'] is not None:i.put(pathlib.Path(name),BACKUP/('code-'+str(n)),0o600)
    config_backup=BACKUP/'codex-config';config_backup.write_bytes(config_raw);os.chmod(config_backup,0o600)
    with config_backup.open('rb') as saved:os.fsync(saved.fileno())
    sync_directory(BACKUP)
    for name,v in before.items():
        if v['kind']=='file':i.put(SYSTEM/name,BACKUP/('unit-'+name),0o600)
    j['phase']='applying';r.atomic(JOURNAL,j)
    pipeline_empty()
    # Polite stop only after proven empty. No force/kill/restart.
    run('/usr/bin/systemctl','stop','gb-pipeline.service')
    pipefd=os.open('/run/gb-pipeline.lock',os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(pipefd,fcntl.LOCK_EX|fcntl.LOCK_NB);pipeline_empty()
        v=units(C)['gb-pipeline.service']
        r.need(v.get('ActiveState')=='inactive' and v.get('MainPID')=='0','pipeline did not drain')
        for name,b in before.items():
            r.need(source_state(SYSTEM/name)==b,'unit changed since backup')
            mask(SYSTEM/name)
        run('/usr/bin/systemctl','daemon-reload')
        config_write(config_new,config_info['sha256'],config_info)
        for target,source in changed.items():i.put(source,target,0o644)
        r.need(preserved(u)==snapshot,'authoritative state drift')
        nextrecord=copy.deepcopy(record);nextrecord['manifest']=manifest
        for target,source in changed.items():nextrecord['after'][str(target)]=i.sha(source)
        r.atomic(STATE/'backup.json',nextrecord)
        policy=copy.deepcopy(p);policy.update(mode='disabled',controller_sha=controller,stage_workflow_sha256=stage_hash)
        policy['recovery']['source_sha']=controller;r.atomic(r.POLICY,policy,mode=0o644)
        C.preflight()
        j['phase']='installed-disabled';r.atomic(JOURNAL,j)
    finally:os.close(pipefd)
    return {'phase':j['phase'],'preserved_files':len(snapshot),'legacy_units_masked':len(before),
            'legacy_trust_removed':len(removed),'history_reset':False}
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=('dry','apply','activate','rollback'))
    parser.add_argument('--bundle',type=pathlib.Path,required=True)
    for name in ('manifest','controller','stage-hash','dispatch-hash'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--run',type=int);a=parser.parse_args()
    lock=r.locked(STATE/'controller.lock')
    try:print(json.dumps(execute(a.action,a.bundle,a.manifest,a.controller,a.stage_hash,a.dispatch_hash,a.run),sort_keys=True))
    finally:os.close(lock)
if __name__=='__main__':main()

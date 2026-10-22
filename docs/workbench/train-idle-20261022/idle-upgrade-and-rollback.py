from pathlib import Path
import sys,json,hashlib,os,fcntl,stat,urllib.request,base64
sys.path.insert(0,'/usr/local/lib/gb-actions-train')
import installer,receiver
R=Path('/var/lib/gb-idle-install-20261022');B=R/'bundle';STATE=receiver.STATE
CONTROL='6f48c999a09c9a4102692cf98780269ce8174f22';OLD_CONTROL='1dc7f0e51ed10ef9b529c2ab846c126549e08a07'
OLD_MANIFEST='f434bb707a694f67141beb465fda6ceac2fec7a08cfc9cdb5a7cdcd338fe73a1'
STAGE_HASH='06414b3edc28034478c190cbf318f99e34960085f40ec8c026db3f1aa1918760'
def need(ok,reason):
 if not ok:raise RuntimeError(reason)
def hashfile(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def states():return {str(p):hashfile(p) for slot in ('slot1','slot2') for p in (receiver.AUTONOMY/'slots'/slot/'state.json',receiver.AUTONOMY/'slots'/slot/'actions-deferred.json',receiver.AUTONOMY/'outbox'/slot/'ledger.json')}
def quiet():
 receiver.units_quiet(receiver.UNITS)
 for slot in ('slot1','slot2'):
  need(not receiver.journal(slot)['pending'],'pending operation; no install')
  receiver.free_lock(receiver.AUTONOMY/'slots'/slot/'worker.lock');receiver.free_lock(receiver.AUTONOMY/'locks'/(slot+'.lease'))
  a=receiver.checkpoint(slot)[0]['active'];need(not a or a['phase']=='done','source task still active')
need(os.geteuid()==0 and sys.argv[1:] and sys.argv[1] in ('dry','apply','resume','rollback'),'closed root operation')
for p in (R,STATE,receiver.POLICY):receiver.trusted_tree(p)
fd=os.open(STATE/'controller.lock',os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
quiet();policy=receiver.read(receiver.POLICY,0);record=receiver.read(STATE/'backup.json',0)
manifest=B/'scripts/chatops/actions_train/manifest.json';new_manifest=hashfile(manifest)
files=installer.payload(B,new_manifest);new_after={str(p):hashfile(s) for p,s in files.items()}
op=sys.argv[1]
if op in ('dry','apply'):
 need(policy['mode']=='active' and policy['controller_sha']==OLD_CONTROL,'unexpected active control')
 need(record['manifest']==OLD_MANIFEST and all(hashfile(Path(p))==h for p,h in record['after'].items()),'live payload drift')
 changes={p for p,h in new_after.items() if record['after'].get(p)!=h}
 expected={'/usr/local/lib/gb-actions-train/'+x for x in ('core.py','client.py','receiver.py','monitor.py','queue_diagnostics.py')}
 need(changes==expected,'unexpected payload scope');need(set(record['after'])<=set(new_after),'payload removal prohibited')
 report={'source':CONTROL,'old_manifest':OLD_MANIFEST,'new_manifest':new_manifest,'changes':{p:{'before':hashfile(Path(p)),'after':new_after[p]} for p in sorted(changes)},'state_hashes':states(),'policy_before':policy,'record_before':record,'phase':'prepared'}
 if op=='dry':print(json.dumps({'dry':True,**{k:report[k] for k in ('source','new_manifest','changes','state_hashes')}}));sys.exit()
 need(not (R/'journal.json').exists(),'existing upgrade; reconcile')
 for i,p in enumerate(sorted(changes)):
  src=Path(p)
  if src.exists():receiver.trusted_tree(src);(R/'backup'/str(i)).write_bytes(src.read_bytes());os.chmod(R/'backup'/str(i),0o600)
 receiver.atomic(R/'journal.json',report)
 receiver.atomic(receiver.POLICY,policy|{'mode':'disabled'},mode=0o644)
 try:
  for p in sorted(changes):installer.put(files[Path(p)],Path(p),0o644)
  updated=json.loads(json.dumps(record));updated['manifest']=new_manifest;updated['after']=new_after
  for p in sorted(changes):
   if p not in updated['before']:updated['before'][p]=None;updated['targets'].append(p)
  receiver.atomic(STATE/'backup.json',updated)
  need(all(hashfile(Path(p))==h for p,h in new_after.items()),'post-install hash mismatch')
  need(states()==report['state_hashes'],'task/budget state changed')
  report['phase']='installed-disabled';receiver.atomic(R/'journal.json',report)
 except BaseException:
  for i,p in enumerate(sorted(changes)):
   if report['changes'][p]['before'] is None:Path(p).unlink(missing_ok=True)
   else:installer.put(R/'backup'/str(i),Path(p),0o644)
  receiver.atomic(STATE/'backup.json',record);receiver.atomic(receiver.POLICY,policy|{'mode':'disabled'},mode=0o644)
  report['phase']='rolled-back-disabled';receiver.atomic(R/'journal.json',report);raise
 print(json.dumps({'installed':True,'mode':'disabled','manifest':new_manifest,'preserved_history_attempts_budget':True}))
elif op=='resume':
 need(len(sys.argv)==3 and sys.argv[2].isdigit(),'successful hosted probe run required')
 j=receiver.read(R/'journal.json',0);need(j['phase']=='installed-disabled','wrong upgrade phase')
 need(policy['mode']=='disabled' and policy['owned']==j['policy_before']['owned'],'ownership drift')
 need(record['manifest']==new_manifest and all(hashfile(Path(p))==h for p,h in new_after.items()),'new payload drift')
 need(states()==j['state_hashes'],'task state drift')
 run=int(sys.argv[2]);base='https://api.github.com/repos/anpavel84-afk/gobadminton-clean/'
 def api(path):return json.load(urllib.request.urlopen(urllib.request.Request(base+path,headers={'User-Agent':'GB-PMA-queue-upgrade'}),timeout=20))
 r=api('actions/runs/'+str(run));need(r['path']=='.github/workflows/train-dispatch.yml' and r['head_branch']=='dev' and r['conclusion']=='success','hosted probe failed')
 d=api('contents/.github/workflows/train-dispatch.yml?ref='+r['head_sha']);raw=base64.b64decode(d['content']);need(('ref: '+CONTROL).encode() in raw,'probe uses old controller')
 h=api('git/ref/heads/dev')['object']['sha'];f=api('contents/.github/workflows/train-stage.yml?ref='+h);raw=base64.b64decode(f['content']);need(hashlib.sha256(raw).hexdigest()==STAGE_HASH and ('ref: '+CONTROL).encode() in raw,'stage workflow pin mismatch')
 need(hashfile(B/'.github/workflows/train-stage.yml')==STAGE_HASH,'source workflow drift')
 newpolicy=policy|{'mode':'active','controller_sha':CONTROL,'stage_workflow_sha256':STAGE_HASH}
 receiver.atomic(receiver.POLICY,newpolicy,mode=0o644);j.update(phase='active',probe_run=run);receiver.atomic(R/'journal.json',j)
 print(json.dumps({'activated':True,'controller_sha':CONTROL,'probe_run':run,'preserved_history_attempts_budget':True}))
else:
 need(policy['mode']=='disabled','pause new dispatch before rollback')
 j=receiver.read(R/'journal.json',0);need(j['phase']=='installed-disabled','rollback needs exact paused upgrade')
 for p,hs in j['changes'].items():need(hashfile(Path(p)) in (hs['before'],hs['after']),'rollback drift')
 for i,p in enumerate(sorted(j['changes'])):
  if j['changes'][p]['before'] is None:Path(p).unlink(missing_ok=True)
  else:need(hashfile(R/'backup'/str(i))==j['changes'][p]['before'],'backup checksum');installer.put(R/'backup'/str(i),Path(p),0o644)
 receiver.atomic(STATE/'backup.json',j['record_before']);receiver.atomic(receiver.POLICY,j['policy_before']|{'mode':'disabled'},mode=0o644)
 j['phase']='rolled-back-disabled';receiver.atomic(R/'journal.json',j);print('ROLLED_BACK_RUNTIME_ONLY; scheduling disabled; task history preserved')

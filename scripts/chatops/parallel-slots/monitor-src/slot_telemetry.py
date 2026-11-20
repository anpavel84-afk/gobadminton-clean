#!/usr/bin/python3
"""Own-UID, read-only checkpoint telemetry. No network, credentials or task mutation."""
import os, sys, json, stat, time, re, pwd, tempfile, subprocess
from pathlib import Path
USERS={'slot1':'agentagency-dev','slot2':'gb-slot2'}
PHASES={'claimed','developing','candidate','pr_wait','qa','ci','integrating','promoting','dev_wait','done','blocked'}
def number(v):
 return v if type(v) is int and 0<=v<10**14 else None
def sha(v):
 return v if isinstance(v,str) and re.fullmatch('[0-9a-f]{40}',v) else None
def read(path,uid):
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
 try:
  parts=Path(path).parts[1:]
  for p in parts[:-1]:
   n=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=n
  f=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
  try:
   s=os.fstat(f)
   if not stat.S_ISREG(s.st_mode) or s.st_uid!=uid or s.st_nlink!=1 or s.st_mode&0o022 or not 2<=s.st_size<=2097152: raise ValueError('metadata')
   return json.loads(os.read(f,2097153)),int(s.st_mtime)
  finally: os.close(f)
 finally: os.close(fd)
def project(a):
 if not isinstance(a,dict) or not a: return None
 if number(a.get('issue')) is None or a.get('phase') not in PHASES: raise ValueError('task')
 head=sha(a.get('head')); q=a.get('qa') or {}; ci=a.get('ci') or {}; task=a.get('task') or {}
 if not all(isinstance(x,dict) for x in (q,ci,task)): raise ValueError('evidence')
 # Integration has no exact new candidate gates yet; prior source evidence stays private.
 if a['phase']=='integrating': q={};ci={}
 qsha=sha(q.get('reviewed_sha')); verdict=q.get('verdict')
 if verdict not in ('PASS','FAIL','BLOCKED'): verdict=None
 if verdict=='PASS' and (not head or qsha!=head): verdict='MISMATCH'
 jobs=ci.get('jobs'); counts=None
 if isinstance(jobs,list) and 0<len(jobs)<=40 and all(isinstance(j,dict) for j in jobs):
  passed=sum(j.get('conclusion')=='success' for j in jobs)
  failed=sum(j.get('conclusion') in ('failure','cancelled','timed_out','action_required') for j in jobs)
  counts={'total':len(jobs),'passed':passed,'failed':failed,'pending':len(jobs)-passed-failed,
          'sha':sha(ci.get('sha')),'run_id':number(ci.get('id'))}
  counts['result']='MISMATCH' if not head or counts['sha']!=head else ('FAIL' if failed else 'PASS' if passed==len(jobs) else 'RUNNING')
 model=task.get('model'); effort=task.get('effort')
 return {'issue':a['issue'],'phase':a['phase'],'attempt':number(a.get('attempt')),'pr':number(a.get('pr')),
         'head_sha':head,'base_sha':sha(a.get('base')),'resume_phase':a.get('resume_phase') if a.get('resume_phase') in PHASES else None,
         'qa':{'verdict':verdict,'reviewed_sha':qsha},'ci':counts,
         'requested_model':model if model=='gpt-6.1-sol' else None,
         'requested_effort':effort if effort in ('medium','high') else None}
def validate(v,slot):
 if not isinstance(v,dict) or set(v)!={'schema','slot','at','checkpoint_at','checkpoint_status','process','task'}: raise ValueError('schema')
 if v['schema']!='GB_SLOT_TELEMETRY_V1' or v['slot']!=slot or number(v['at']) is None: raise ValueError('identity')
 if v['checkpoint_at'] is not None and number(v['checkpoint_at']) is None: raise ValueError('timestamp')
 if v['checkpoint_status'] not in ('OK','ABSENT','INVALID'): raise ValueError('checkpoint')
 p=v['process']
 if not isinstance(p,dict) or set(p)!={'active','sub','pid'} or p['active'] not in ('active','inactive','failed','activating','deactivating','unknown') or p['sub'] not in ('running','dead','failed','start','stop','auto-restart','unknown') or number(p['pid']) is None: raise ValueError('process')
 a=v['task']
 if a is not None:
  if not isinstance(a,dict) or set(a)!={'issue','phase','attempt','pr','head_sha','base_sha','qa','ci','requested_model','requested_effort','resume_phase'}: raise ValueError('task fields')
  mapped={'issue':a['issue'],'phase':a['phase'],'attempt':a['attempt'],'pr':a['pr'],'head':a['head_sha'],'base':a['base_sha'],'resume_phase':a['resume_phase'],'qa':a['qa'],'task':{'model':a['requested_model'],'effort':a['requested_effort']}}
  clean=project(mapped)
  for k in a:
   if k not in ('ci','qa') and a[k]!=clean[k]: raise ValueError('task value')
  q=a['qa']
  if not isinstance(q,dict) or set(q)!={'verdict','reviewed_sha'} or q['verdict'] not in (None,'PASS','FAIL','BLOCKED','MISMATCH') or q['reviewed_sha']!=sha(q['reviewed_sha']): raise ValueError('qa')
  if q['verdict']=='PASS' and (not a['head_sha'] or q['reviewed_sha']!=a['head_sha']): raise ValueError('qa sha')
  ci=a['ci']
  if a['phase']=='integrating' and (q['verdict'] is not None or q['reviewed_sha'] is not None or ci is not None): raise ValueError('integration gates pending')
  if ci is not None:
   if not isinstance(ci,dict) or set(ci)!={'total','passed','failed','pending','sha','run_id','result'}: raise ValueError('ci')
   if any(type(ci[k]) is not int or not 0<=ci[k]<=40 for k in ('total','passed','failed','pending')) or ci['total']!=ci['passed']+ci['failed']+ci['pending']: raise ValueError('counts')
   if ci['sha']!=sha(ci['sha']) or ci['run_id']!=number(ci['run_id']) or ci['result'] not in ('PASS','FAIL','RUNNING','MISMATCH'): raise ValueError('ci values')
   if ci['result']=='PASS' and (not a['head_sha'] or ci['sha']!=a['head_sha'] or ci['passed']!=ci['total'] or not ci['total']): raise ValueError('ci sha')
 return v
def collect(slot):
 uid=pwd.getpwnam(USERS[slot]).pw_uid
 if os.getuid()!=uid: raise ValueError('must run as own slot UID')
 v={'schema':'GB_SLOT_TELEMETRY_V1','slot':slot,'at':int(time.time()),'checkpoint_at':None,
    'checkpoint_status':'ABSENT','process':{'active':'unknown','sub':'unknown','pid':0},'task':None}
 try:
  state,mtime=read('/var/lib/gobadminton-autonomy/slots/'+slot+'/state.json',uid)
  if not isinstance(state,dict) or not isinstance(state.get('done'),list): raise ValueError('state')
  v.update(checkpoint_at=mtime,checkpoint_status='OK',task=project(state.get('active')))
 except FileNotFoundError: pass
 except (OSError,ValueError,TypeError,KeyError,RecursionError): v['checkpoint_status']='INVALID'
 try:
  result=subprocess.run(['/usr/bin/systemctl','show','gobadminton-slot@'+slot+'.service','--property=ActiveState,SubState,MainPID'],capture_output=True,text=True,timeout=5,check=True)
  props=dict(l.split('=',1) for l in result.stdout.splitlines() if '=' in l)
  active=props.get('ActiveState'); sub=props.get('SubState')
  v['process']={'active':active if active in ('active','inactive','failed','activating','deactivating') else 'unknown',
                'sub':sub if sub in ('running','dead','failed','start','stop','auto-restart') else 'unknown','pid':number(int(props.get('MainPID','0'))) or 0}
 except (OSError,ValueError,subprocess.SubprocessError): pass
 return validate(v,slot)
def main():
 slot=sys.argv[1]
 if slot not in USERS: raise ValueError('slot')
 v=collect(slot); folder=Path('/var/lib/gobadminton-autonomy/outbox')/slot
 s=folder.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o022: raise ValueError('outbox')
 fd,tmp=tempfile.mkstemp(prefix='.telemetry-',dir=folder)
 try:
  with os.fdopen(fd,'w') as f:
   os.fchmod(f.fileno(),0o644);json.dump(v,f,sort_keys=True);f.flush();os.fsync(f.fileno())
  os.replace(tmp,folder/'telemetry.json')
 finally:
  if os.path.exists(tmp): os.unlink(tmp)
if __name__=='__main__': main()

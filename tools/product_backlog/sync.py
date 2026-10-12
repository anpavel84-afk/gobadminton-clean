#!/usr/bin/env python3
"""Read-only GitHub → last-known-good public registry mirror. No Codex/Runner writes."""
import argparse,fcntl,json,subprocess,sys
from pathlib import Path
from core import load,atomic,validate,public_snapshot,now,SCHEMA,PROJECT

def git(repo,*args):
 return subprocess.check_output(['git','-c','gc.auto=0','-C',str(repo),*args],stderr=subprocess.PIPE,timeout=45)
def sync(repo,state,fetch=True):
 state.mkdir(parents=True,exist_ok=True)
 with (state/'sync.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:
   if fetch:git(repo,'fetch','--no-tags','--filter=blob:none','--depth=1','origin','main')
   sha=git(repo,'rev-parse','refs/remotes/origin/main').decode().strip()
   raw=git(repo,'show',sha+':docs/product/backlog/registry.json')
   if len(raw)>4_000_000:raise ValueError('Registry exceeds size cap')
   reg=json.loads(raw)
   previous=load(state/'last-good-registry.json') if (state/'last-good-registry.json').exists() else None
   counts=validate(reg,previous)
   archive=json.loads(git(repo,'show',sha+':docs/product/backlog/technical-history.json'))
   if archive.get('project')!=PROJECT:raise ValueError('Wrong archival project')
   if len(archive['records'])!=reg['coverage']['technical_count']:raise ValueError('Archive coverage count mismatch')
   tids=[x['Task ID'] for x in archive['records']]
   if len(tids)!=len(set(tids)):raise ValueError('Duplicate archival task identifiers')
   previous_ids=load(state/'last-good-technical-ids.json') if (state/'last-good-technical-ids.json').exists() else []
   if not set(previous_ids)<=set(tids):raise ValueError('Historical task removed')
   product_ids={t['id'] for t in reg['tasks']}
   if any(not set(r.get('product_ids',[]))<=product_ids for r in archive['records']):raise ValueError('Unknown archival link')
   snap=public_snapshot(reg,sha)
   if len(json.dumps(snap,ensure_ascii=False).encode())>900_000:raise ValueError('Public registry exceeds 900KB cap')
   # Validated complete snapshots only. Network/parse/schema failure never overwrites these.
   atomic(state/'public.json',snap)
   atomic(state/'last-good-registry.json',reg)
   atomic(state/'last-good-technical-ids.json',tids)
   atomic(state/'status.json',{'ok':True,'at':now(),'source_sha':sha,**counts})
   print('PRODUCT_BACKLOG_SYNC_OK',sha,counts['tasks'],'NO_MODEL_NO_QUEUE_MUTATION')
  except Exception as exc:
   # No paths, credentials, git remote error output or private snippets in public status.
   atomic(state/'status.json',{'ok':False,'at':now(),'error_type':type(exc).__name__,'last_good_retained':(state/'public.json').exists()})
   print('PRODUCT_BACKLOG_SYNC_FAILED',type(exc).__name__,'LAST_GOOD_RETAINED',file=sys.stderr);raise
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--no-fetch',action='store_true');a=p.parse_args();sync(a.repo,a.state,not a.no_fetch)

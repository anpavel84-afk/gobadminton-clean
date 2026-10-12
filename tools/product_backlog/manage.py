#!/usr/bin/env python3
"""Human-readable product ledger transactions. Does not dispatch Runner or deploy."""
import argparse, copy, fcntl, json
from pathlib import Path
from core import *

TRANSITIONS={
 'new':{'accepted','verification_needed','deferred','duplicate','cancelled'},
 'accepted':{'queued','in_progress','verification_needed','blocked','deferred','duplicate','cancelled'},
 'queued':{'in_progress','blocked','deferred','cancelled'},
 'in_progress':{'qa','verification_needed','blocked','deferred'},
 'qa':{'ready_to_deploy','in_progress','blocked'},
 'verification_needed':{'accepted','in_progress','qa','ready_to_deploy','deployed','owner_review','blocked','deferred','duplicate'},
 'ready_to_deploy':{'deploying','blocked','in_progress'},
 'deploying':{'deployed','blocked','ready_to_deploy'},
 'deployed':{'owner_review','blocked','in_progress'},
 'owner_review':{'confirmed','in_progress','blocked'},
 'confirmed':{'in_progress','blocked','verification_needed'},
 'blocked':{'accepted','queued','in_progress','qa','verification_needed','deferred','cancelled'},
 'deferred':{'accepted','verification_needed','cancelled'},
 'duplicate':{'accepted'},'cancelled':{'accepted'}}
ALLOWED={
 'new':ROLES,'accepted':{'owner','pm'},'queued':{'pm'},'in_progress':{'pm','implementation'},
 'qa':{'pm','implementation','qa'},'verification_needed':{'pm','advisor','qa'},
 'ready_to_deploy':{'pm','qa'},'deploying':{'release'},'deployed':{'release'},
 'owner_review':{'pm','release'},'confirmed':{'owner'},'blocked':ROLES,
 'deferred':{'owner','pm'},'duplicate':{'owner','pm'},'cancelled':{'owner'}}

def apply(reg,patch,role,proof,reason,expected_revision):
 if reg['revision']!=expected_revision:raise ValueError('Конфликт ревизии: прочитайте свежий реестр, затем повторите изменение')
 old=copy.deepcopy(reg)
 if role not in ROLES:raise ValueError('Неизвестная роль')
 tid=patch.get('id')
 if not tid:
  if role not in {'owner','pm','feedback','advisor'}:raise ValueError('Регистрация только через входящий продуктовый запрос')
  tid=f"GB-{reg['next_number']:03}";reg['next_number']+=1
  task={'id':tid,'revision':1,'created_at':now(),'title':patch['title'],'area':patch['area'],
   'request':patch['request'],'acceptance':patch['acceptance'],'status':'new','priority':'P2',
   'priority_origin':'PM triage','responsible_role':'pm','commitment':'needs_triage',
   'sources':patch['sources'],'depends_on':[],'next_action':'PM: уточнить объём и критерии; не запускать автоматически.',
   'blocker':'','target_release':'Не назначен','code':{'state':'unknown'},'qa':{'state':'not_verified','evidence':None},
   'deployment':{'state':'not_deployed'},'owner_verification':{'state':'not_reviewed','evidence':None},
   'technical_refs':[],'tags':[]}
  reg['tasks'].append(task);event(reg,task,role,'registered',reason,proof)
 else:
  task=next((t for t in reg['tasks'] if t['id']==tid),None)
  if task is None:raise ValueError('Неизвестный продуктовый номер')
  before=copy.deepcopy(task)
  allowed={'title','request','acceptance','status','area','priority','priority_origin','responsible_role','commitment','sources','depends_on','next_action','blocker','target_release','code','qa','deployment','owner_verification','technical_refs','tags','duplicate_of','disposition_proof'}
  if set(patch)-allowed-{'id'}:raise ValueError('Неизвестное поле; номер, историю и созданную дату менять нельзя')
  new=patch.get('status',task['status'])
  if new!=task['status']:
   if new not in TRANSITIONS.get(task['status'],set()):raise ValueError('Неподдерживаемый переход статуса')
   if role not in ALLOWED[new]:raise ValueError('Недостаточная роль для перехода')
  if 'owner_verification' in patch and role!='owner':raise ValueError('Приёмку Owner не меняет PM/QA')
  if 'qa' in patch and role!='qa':raise ValueError('Заключение QA меняет только независимая QA')
  if 'deployment' in patch and role!='release':raise ValueError('Факт выпуска вносит ответственный за релиз')
  if 'sources' in patch and any(s not in patch['sources'] for s in task['sources']):raise ValueError('Источники нельзя удалять')
  task.update({k:v for k,v in patch.items() if k!='id'});task['revision']+=1
  event(reg,task,role,'updated',reason,proof,before)
 validate(reg,old);return tid

def main():
 p=argparse.ArgumentParser(description='Постоянный продуктовый бэклог GoBadminton')
 p.add_argument('--registry',type=Path,default=Path('docs/product/backlog/registry.json'))
 p.add_argument('--check',action='store_true');p.add_argument('--base-registry',type=Path)
 p.add_argument('--patch',type=Path);p.add_argument('--role',choices=sorted(ROLES))
 p.add_argument('--evidence');p.add_argument('--reason');p.add_argument('--expected-revision',type=int)
 args=p.parse_args()
 if args.check:
  print(json.dumps(validate(load(args.registry),load(args.base_registry) if args.base_registry else None),ensure_ascii=False));return
 if not all([args.patch,args.role,args.evidence,args.reason,args.expected_revision is not None]):p.error('Нужны --patch --role --evidence --reason --expected-revision')
 lock=args.registry.with_suffix('.lock');lock.parent.mkdir(parents=True,exist_ok=True)
 with lock.open('a') as f:
  fcntl.flock(f,fcntl.LOCK_EX)
  reg=load(args.registry);validate(reg)
  tid=apply(reg,load(args.patch),args.role,args.evidence,args.reason,args.expected_revision)
  atomic(args.registry,reg)
 print(json.dumps({'id':tid,'revision':reg['revision'],'saved_local':True,'github_published':False},ensure_ascii=False))
 print('Создана локальная транзакция. Git commit + проверка свежего main + обычный fast-forward push обязательны.')
if __name__=='__main__':main()

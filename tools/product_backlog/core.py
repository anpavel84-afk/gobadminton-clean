"""GoBadminton product obligations. No task dispatch, model, deployment or credentials."""
from __future__ import annotations
import copy, datetime as dt, hashlib, json, os, re, tempfile
from pathlib import Path

PROJECT = 'GoBadminton'
SCHEMA = 'gobadminton.product-backlog.v1'
STATES = {
 'new':'Зафиксировано','accepted':'Принято в бэклог','queued':'В очереди',
 'in_progress':'В разработке','qa':'На независимой QA',
 'verification_needed':'Нужна проверка','ready_to_deploy':'Готово к публикации',
 'deploying':'Публикуется','deployed':'Опубликовано','owner_review':'Ждёт проверки Owner',
 'confirmed':'Принято Owner','blocked':'Заблокировано','deferred':'Отложено',
 'cancelled':'Отменено Owner','duplicate':'Объединено с другой задачей'}
CODE = {'unknown':'Нет подтверждения','not_implemented':'Не реализовано','design':'Дизайн / постановка',
 'in_progress':'В разработке','source_present':'Код есть, приёмка не доказана',
 'qa_pass':'Независимая QA принята','source_merged':'Принято в main','source_rejected':'Кандидат отклонён',
 'policy':'Продуктовое правило'}
DEPLOY = {'unverified':'Публикация не подтверждена','not_deployed':'Не опубликовано',
 'source_only':'Только исходники','test_site':'На тестовом сайте','partial':'Опубликовано частично',
 'disabled':'Код установлен, функция выключена','internal_only':'Только внутренняя часть',
 'deploying':'Публикуется','rolled_back':'Возвращена предыдущая версия','not_applicable':'Не требует выкладки'}
ROLES = {'owner','pm','feedback','advisor','architect','design','implementation','qa','release'}
ID = re.compile(r'^GB-[0-9]{3,6}$')
SHA = re.compile(r'^[0-9a-f]{40}$')

def now(): return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
def canonical(obj): return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def digest(obj): return hashlib.sha256(canonical(obj)).hexdigest()
def task_digest(task): return digest(task)
def load(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def atomic(p,data):
 p=Path(p); p.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.'+p.name+'.',dir=p.parent)
 try:
  with os.fdopen(fd,'wb') as out: out.write(json.dumps(data,ensure_ascii=False,indent=2).encode()+b'\n');out.flush();os.fsync(out.fileno())
  os.chmod(tmp,0o644);os.replace(tmp,p)
  d=os.open(p.parent,os.O_RDONLY);os.fsync(d);os.close(d)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def event(reg, task, role, action, reason, proof, before=None):
 if role not in ROLES: raise ValueError('Неизвестная роль')
 if not reason.strip() or not proof.strip(): raise ValueError('Нужны причина и ссылка/идентификатор доказательства')
 changes={k:v for k,v in task.items() if not before or before.get(k)!=v}
 # Full old versions remain in Git. Events contain a tamper-evident chain and field summary.
 e={'sequence':len(reg['events'])+1,'task_id':task['id'],'revision':task['revision'],
    'at':now(),'role':role,'action':action,'reason':reason,'proof':proof,
    'from':before.get('status') if before else None,'to':task['status'],
    'changed_fields':sorted(changes),'task_sha256':task_digest(task),
    'previous_hash':reg['events'][-1]['hash'] if reg['events'] else '0'*64}
 e['hash']=digest(e);reg['events'].append(e)
 reg['revision']=len(reg['events']);reg['updated_at']=e['at']
 return e

def validate(reg, previous=None):
 errors=[]
 def ck(test,msg):
  if not test:errors.append(msg)
 ck(reg.get('project')==PROJECT,'Неверный проект')
 ck(reg.get('schema')==SCHEMA,'Неверная схема')
 tasks=reg.get('tasks',[]);events=reg.get('events',[]);ids=[t.get('id') for t in tasks]
 ck(isinstance(tasks,list) and bool(tasks),'Пустой реестр запрещён')
 ck(len(ids)==len(set(ids)),'Повторяющиеся номера')
 latest={};prev='0'*64;revisions={}
 for n,e in enumerate(events,1):
  body={k:v for k,v in e.items() if k!='hash'}
  ck(e.get('hash')==digest(body),f'Изменено событие {n}')
  ck(e.get('previous_hash')==prev,f'Разрыв истории {n}')
  ck(e.get('sequence')==n,f'Порядок истории {n}')
  ck(e.get('role') in ROLES,f'Роль события {n}')
  ck(bool(e.get('reason')) and bool(e.get('proof')),f'Нет причины/доказательства {n}')
  tid=e.get('task_id');rev=revisions.get(tid,0)+1
  ck(e.get('revision')==rev,f'Номер редакции {tid}')
  revisions[tid]=rev;latest[tid]=e;prev=e.get('hash')
 for t in tasks:
  tid=t.get('id','');ck(bool(ID.fullmatch(tid)),f'Номер {tid}')
  ck(t.get('status') in STATES,f'Статус {tid}')
  ck(t.get('responsible_role') in ROLES,f'Ответственный {tid}')
  ck(t.get('priority') in {'P0','P1','P2','P3'},f'Приоритет {tid}')
  ck(bool(t.get('title')) and len(t['title'])<=180,f'Заголовок {tid}')
  ck(bool(t.get('request')) and len(t['request'])<=3000,f'Запрос {tid}')
  ck(bool(t.get('acceptance')) and all(isinstance(x,str) and x.strip() for x in t['acceptance']),f'Критерии {tid}')
  ck(bool(t.get('sources')),f'Источник {tid}')
  ck(t.get('code',{}).get('state') in CODE,f'Статус кода {tid}')
  dep=t.get('deployment',{});ck(dep.get('state') in DEPLOY,f'Статус выкладки {tid}')
  owner=t.get('owner_verification',{})
  ck(owner.get('state') in {'not_reviewed','accepted','changes_requested'},f'Приёмка Owner {tid}')
  if dep.get('state') in {'test_site','partial','internal_only','disabled'}:
   ck(bool(dep.get('evidence')) and bool(dep.get('observed_at')),f'Нет доказательства выкладки {tid}')
  if t.get('status') in {'deployed','owner_review','confirmed'}:
   ck(dep.get('state') in {'test_site','partial','internal_only','not_applicable'},f'Неопубликованное нельзя считать проверяемым результатом {tid}')
  if t.get('status')=='confirmed':
   ck(owner.get('state')=='accepted' and bool(owner.get('evidence')),f'Нет явного согласия Owner {tid}')
   ck(latest.get(tid,{}).get('role')=='owner',f'Закрыть может только Owner {tid}')
  if t.get('status')=='cancelled': ck(bool(t.get('disposition_proof')) and latest.get(tid,{}).get('role')=='owner',f'Отмена без Owner {tid}')
  if t.get('status')=='duplicate': ck(t.get('duplicate_of') in ids and t.get('duplicate_of')!=tid,f'Неверное объединение {tid}')
  if t.get('status')=='blocked': ck(bool(t.get('blocker')) and bool(t.get('next_action')),f'Блокер без действия {tid}')
  if t.get('status')=='ready_to_deploy': ck(t.get('qa',{}).get('state')=='passed' and bool(t.get('qa',{}).get('evidence')),f'Готовность без QA {tid}')
  ck(latest.get(tid,{}).get('task_sha256')==task_digest(t),f'Изменение без события {tid}')
  ck(revisions.get(tid)==t.get('revision'),f'Редакция задачи {tid}')
  ck(all(x in ids and x!=tid for x in t.get('depends_on',[])),f'Неверная зависимость {tid}')
  for source in t.get('sources',[]):
   ck(source.get('kind') in {'audit','owner_chat','github','feedback','library','pm_record'},f'Вид источника {tid}')
   ck(bool(source.get('label')) and bool(source.get('ref')),f'Пустой источник {tid}')
 ck(set(latest)==set(ids),'История и задачи не совпадают')
 ck(reg.get('revision')==len(events),'Ревизия реестра')
 ck(reg.get('next_number',0)>max((int(x[3:]) for x in ids if ID.fullmatch(x)),default=0),'Счётчик номеров')
 for item in reg.get('coverage',{}).get('audit_crosswalk',[]):ck(item.get('product_id') in ids,'Потеря аудиторской строки')
 feedback=reg.get('coverage',{}).get('feedback_crosswalk',{})
 for k in range(1,18):ck(bool(feedback.get(f'{k:03}')) and all(i in ids for i in feedback.get(f'{k:03}',[])),f'Потеря Feedback {k:03}')
 if previous:
  old={t['id']:t for t in previous['tasks']}
  ck(set(old)<=set(ids),'Удаление зарегистрированных задач запрещено')
  ck(reg.get('next_number',0)>=previous['next_number'],'Перенумерация запрещена')
  ck(events[:len(previous['events'])]==previous['events'],'История не append-only')
  ck(reg.get('revision',0)>=previous['revision'],'Откат ревизии реестра')
  for tid,t in old.items():
   current=next((x for x in tasks if x['id']==tid),None)
   if current: ck(current.get('created_at')==t.get('created_at'),'Изменён первичный номер/время '+tid)
 # Dependencies must form a DAG, including across deferred cards.
 graph={t['id']:t.get('depends_on',[]) for t in tasks};visiting=set();seen=set()
 def walk(t):
  if t in visiting: errors.append('Цикл зависимостей '+t);return
  if t in seen:return
  visiting.add(t)
  for d in graph.get(t,[]):walk(d)
  visiting.remove(t);seen.add(t)
 for tid in graph:walk(tid)
 if errors:raise ValueError('\n'.join(errors[:40]))
 return {'tasks':len(tasks),'events':len(events),'revision':reg['revision']}

def public_snapshot(reg, sha, sync_at=None):
 validate(reg)
 out={'schema':SCHEMA,'project':PROJECT,'registry_revision':reg['revision'],
      'registry_updated_at':reg['updated_at'],'synced_at':sync_at or now(),
      'source_sha':sha,'source_url':'https://github.com/anpavel84-afk/gobadminton/blob/'+sha+'/docs/product/backlog/registry.json',
      'statuses':STATES,'code_states':CODE,'deployment_states':DEPLOY,
      'coverage':{k:v for k,v in reg['coverage'].items() if k!='legacy_records'},
      'releases':reg.get('releases',[]),'tasks':[]}
 hist={}
 for e in reg['events']:
  hist.setdefault(e['task_id'],[]).append({k:e.get(k) for k in ['at','role','action','from','to','reason','proof']})
 for task in reg['tasks']:
  item=copy.deepcopy(task)
  item.pop('audit_raw',None);item.pop('sensitive_notes',None)
  links=item.get('technical_refs',[])
  item['technical_count']=len(links);item['technical_refs']=links[:12]
  item['history']=hist.get(task['id'],[])[-20:]
  out['tasks'].append(item)
 return out

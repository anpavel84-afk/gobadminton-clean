"""One-time provenance enrichment from a newer Advisor audit; no Owner acceptance."""
from pathlib import Path
import sys,csv,io,json,copy,subprocess
from core import load,atomic,validate,event,public_snapshot
from manage import apply
w=Path(sys.argv[1]);reg=load(w/'docs/product/backlog/registry.json');before=copy.deepcopy(reg)
if reg['coverage'].get('audit_v002_sha'):raise SystemExit('Already imported')
sha='44efa326ef628b711c4a3b3a5a1dd4a20be8cd1b';prefix='docs/workbench/audit/2026-10-10-global-reconciliation/'
def rows(name):
 text=subprocess.check_output(['git','-C',str(w),'show',sha+':'+prefix+name],text=True)
 return list(csv.DictReader(io.StringIO(text.lstrip('\ufeff'))))
review=rows('PRODUCT_BACKLOG_102_OWNER_REVIEW_V002.csv');assert len(review)==102
url='https://github.com/anpavel84-afk/gobadminton/blob/'+sha+'/'+prefix+'PRODUCT_BACKLOG_102_OWNER_REVIEW_V002.csv'
for item in review:
 tid='GB-'+item['ID'].split('-')[-1];task=next(t for t in reg['tasks'] if t['id']==tid);old=copy.deepcopy(task)
 task['request']=item['Что должно работать в итоге']
 task['sources'].append({'kind':'audit','label':'Advisor v002: '+item['Как появилась задача'][:360],'ref':url,'legacy_id':item['ID'],'confidence':item['Уверенность в происхождении']})
 task['tags']=list(dict.fromkeys(task['tags']+['audit-v002',item['ID']]))
 task['revision']+=1;event(reg,task,'advisor','provenance_enriched','Подключён новый первоисточник; статус и приёмка не изменены.',url,old)
newrows=rows('CANDIDATES_NOT_IN_102_V002.csv');assert len(newrows)==10
url2='https://github.com/anpavel84-afk/gobadminton/blob/'+sha+'/'+prefix+'CANDIDATES_NOT_IN_102_V002.csv'
cross={};existing={'NEW-003':'GB-016','NEW-005':'GB-119','NEW-008':'GB-107','NEW-009':'GB-108','NEW-010':'GB-126'}
titles={'NEW-001':'Показывать стоимость игры и кому оплачивать участие','NEW-002':'Показывать отмену игры и прекращать набор участников','NEW-004':'Помочь новичку выбрать понятный уровень и подходящую игру','NEW-006':'Отмечать состоявшееся занятие и повторное участие игрока','NEW-007':'Не допускать вытеснения частных игр однотипными клубными событиями'}
for item in newrows:
 cid=item['Candidate ID'];source={'kind':'audit','label':cid+': '+item['Откуда возникло'],'ref':url2,'legacy_id':cid}
 if cid in existing:
  tid=existing[cid];task=next(t for t in reg['tasks'] if t['id']==tid);old=copy.deepcopy(task);task['sources'].append(source);task['revision']+=1
  event(reg,task,'advisor','provenance_enriched','Новый кандидат сопоставлен с постоянным номером.',url2,old)
 else:
  tid=apply(reg,{'title':titles[cid],'area':item['Группа'],'request':item['Что должно быть'],'acceptance':[item['Что должно быть']],'sources':[source]},'pm',url2,'Историческая гипотеза для решения Owner; не разрешение на исполнение.',reg['revision'])
 cross[cid]=tid
reg['coverage']['audit_v002_sha']=sha;reg['coverage']['additional_candidates_count']=10;reg['coverage']['additional_candidates_crosswalk']=cross
validate(reg,before);atomic(w/'docs/product/backlog/registry.json',reg)
raw=json.dumps(public_snapshot(reg,sha),ensure_ascii=False,separators=(',',':')).encode()
print('FINAL_TASKS',len(reg['tasks']),'REVISION',reg['revision'],'PUBLIC_BYTES',len(raw),'CROSSWALK',cross)

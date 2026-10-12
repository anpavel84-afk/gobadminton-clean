'use strict';
(()=>{
const $=id=>document.getElementById(id);
let data=null,mode='all',page=1,current=null,poll=null;
const SIZE=24,roleNames={owner:'Owner',pm:'PM',feedback:'Feedback Manager',advisor:'Адвайзер / Supervisor',architect:'Архитектор',design:'Дизайн',implementation:'Разработка',qa:'Независимая QA',release:'Ответственный за релиз'};
const published=new Set(['test_site','partial','internal_only']);
const retired=new Set(['duplicate','cancelled']);
const safeUrl=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['github.com','gobadminton.ru','dev.gobadminton.ru'].includes(u.hostname)?u.href:null;}catch{return null;}};
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined&&text!==null)el.textContent=String(text);if(cls)el.className=cls;return el;};
function addLink(parent,label,url){const safe=safeUrl(url);if(!safe){parent.append(node('span',label,'source-note'));return;}const a=node('a',label);a.href=safe;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}
function date(value){if(!value)return 'Дата не подтверждена';const d=new Date(value);return Number.isNaN(+d)?'Дата не подтверждена':d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
function color(t){if(t.status==='confirmed')return 'green';if(t.status==='blocked')return 'red';if(['owner_review','deployed','ready_to_deploy'].includes(t.status))return 'blue';if(['verification_needed','qa'].includes(t.status))return 'yellow';return '';}
function deploymentColor(t){return t.deployment.state==='test_site'?'green':t.deployment.state==='disabled'?'red':['partial','internal_only'].includes(t.deployment.state)?'yellow':'';}
function isReview(t){return !retired.has(t.status)&&t.owner_verification.state!=='accepted'&&(published.has(t.deployment.state)||t.status==='owner_review');}
function isTodo(t){return !retired.has(t.status)&&t.status!=='confirmed'&&t.status!=='deferred'&&!published.has(t.deployment.state);}
function matches(t){
 if(mode==='todo'&&!isTodo(t))return false;
 if(mode==='review'&&!isReview(t))return false;
 if(mode==='confirmed'&&t.status!=='confirmed')return false;
 if(mode==='deployed'&&!published.has(t.deployment.state))return false;
 if(mode==='future'&&t.status!=='deferred')return false;
 if(mode==='history'&&!retired.has(t.status))return false;
 if($('area').value&&t.area!==$('area').value)return false;
 if($('status').value&&t.status!==$('status').value)return false;
 if($('priority').value&&t.priority!==$('priority').value)return false;
 const q=$('search').value.trim().toLocaleLowerCase('ru');if(!q)return true;
 return [t.id,t.title,t.request,t.area,t.next_action,...(t.tags||[]),...(t.sources||[]).map(x=>x.label+' '+(x.legacy_id||'')),...(t.technical_refs||[]).map(x=>x.id)].join(' ').toLocaleLowerCase('ru').includes(q);
}
function pill(label,tone){return node('span',label,'pill '+tone);}
function chooseQuick(value){mode=value;page=1;document.querySelectorAll('.filter-tabs [data-quick]').forEach(x=>{x.classList.toggle('selected',x.dataset.quick===mode);x.setAttribute('aria-pressed',String(x.dataset.quick===mode));});render();}
function render(){
 if(!data)return;
 const all=data.tasks;
 $('count-all').textContent=all.length;$('count-todo').textContent=all.filter(isTodo).length;$('count-review').textContent=all.filter(isReview).length;$('count-confirmed').textContent=all.filter(x=>x.status==='confirmed').length;
 const found=all.filter(matches);const pages=Math.max(1,Math.ceil(found.length/SIZE));page=Math.min(page,pages);
 const slice=found.slice((page-1)*SIZE,page*SIZE);$('task-list').replaceChildren();
 if(!slice.length)$('task-list').append(node('p','По выбранным фильтрам задач нет. Они не удалены — сбрось фильтры, чтобы увидеть полный реестр.','empty'));
 for(const t of slice){
  const row=node('button',null,'task-row');row.type='button';row.dataset.id=t.id;row.setAttribute('aria-label',t.id+'. '+t.title+'. '+data.statuses[t.status]+'. Открыть карточку');
  const name=node('span',null,'task-name');const top=node('span',null,'task-meta');top.append(node('span',t.id,'mono'),node('span',t.priority,'priority '+t.priority),node('span',t.area));name.append(top,node('span',t.title,'task-title'));
  if(t.tags?.includes('feedback17')){const fb=t.sources.find(x=>x.legacy_id);name.append(node('span',fb?.legacy_id||'Замечание Owner','task-meta'));}
  row.append(name);
  const work=node('span',null,'cell');work.append(pill(data.statuses[t.status],color(t)),node('span','Следующая роль: '+(roleNames[t.responsible_role]||t.responsible_role),'small'));row.append(work);
  const dep=node('span',null,'cell');dep.append(pill(data.deployment_states[t.deployment.state],deploymentColor(t)));
  dep.append(node('span',t.deployment.state==='test_site'?(t.deployment.environment+' · '+date(t.deployment.observed_at)):t.deployment.state==='disabled'?'Включение отдельно от установки кода':t.deployment.state==='internal_only'?'Не пользовательская функция':t.target_release==='Не назначен'?'Релиз не назначен':t.target_release,'small'));row.append(dep);
  const owner=node('span',null,'cell');owner.append(node('span',t.owner_verification.state==='accepted'?'✓ Принято':t.owner_verification.state==='changes_requested'?'Нужны исправления':'Не подтверждено','owner-pending'));row.append(owner,node('span','↗','arrow'));
  row.addEventListener('click',()=>openTask(t.id));$('task-list').append(row);
 }
 $('visible-count').textContent=found.length+' из '+all.length;
 $('page-info').textContent=found.length?`${(page-1)*SIZE+1}–${Math.min(page*SIZE,found.length)} из ${found.length} · страница ${page} / ${pages}`:'Ничего не найдено';
 $('prev-page').disabled=page===1;$('next-page').disabled=page===pages;
 $('task-list').setAttribute('aria-busy','false');
}
function section(title,text){const wrap=node('section');wrap.append(node('h3',title));if(text)wrap.append(node('p',text));return wrap;}
function openTask(id){
 const t=data?.tasks.find(x=>x.id===id);if(!t)return;current=t;$('detail-id').textContent=t.id+' · '+t.area;$('detail-title').textContent=t.title;
 const out=$('detail-body');out.replaceChildren();
 const facts=node('div',null,'facts');
 const factsData=[['Работа',data.statuses[t.status],data.code_states[t.code.state]],['Публикация',data.deployment_states[t.deployment.state],t.deployment.note||t.deployment.environment||'Факт выпуска не подтверждён'],['Приёмка Owner',t.owner_verification.state==='accepted'?'Принято':t.owner_verification.state==='changes_requested'?'Нужны изменения':'Ожидается',t.owner_verification.evidence||'Реализация и QA не принимают результат за Owner']];
 for(const [label,value,note] of factsData){const f=node('div',null,'fact');f.append(node('span',label,'label'),node('strong',value,'value'),node('p',note));facts.append(f);}out.append(facts);
 out.append(section('Что требуется',t.request));
 const acceptance=section('Как поймём, что готово');const ul=node('ul');for(const criterion of t.acceptance)ul.append(node('li',criterion));acceptance.append(ul,node('p',t.criteria_origin||'Критерии уточняются при разборе запроса.','source-note'));out.append(acceptance);
 if(t.blocker)out.append(section('Что мешает',t.blocker));
 const next=section('Следующее действие',t.next_action);next.append(node('p','Ответственная роль: '+(roleNames[t.responsible_role]||t.responsible_role)+'. Приоритет '+t.priority+' — '+t.priority_origin+'.','source-note'));out.append(next);
 if(t.duplicate_of){const sec=section('Задача объединена, но не удалена');const b=node('button','Открыть '+t.duplicate_of);b.type='button';b.onclick=()=>openTask(t.duplicate_of);sec.append(b);out.append(sec);}
 if(t.depends_on?.length){const sec=section('Зависимости');for(const id of t.depends_on){const linked=data.tasks.find(x=>x.id===id);const b=node('button',id+' · '+(linked?.title||'Проверить связь'));b.type='button';b.onclick=()=>openTask(id);sec.append(b);}out.append(sec);}
 const provenance=section('Откуда взялась задача');provenance.classList.add('proof-list');
 for(const s of t.sources){addLink(provenance,s.label,s.ref);if(!safeUrl(s.ref))provenance.append(node('p',s.ref,'source-note'));}out.append(provenance);
 if(t.deployment.evidence){const dep=section('Доказательство публикации');addLink(dep,'Отчёт о версии / установке',t.deployment.evidence);if(t.deployment.url)addLink(dep,'Открыть окружение',t.deployment.url);const release=data.releases?.find(x=>x.id===t.deployment.release_id);if(release)dep.append(node('p',`Web ${release.web_sha?.slice(0,8)} · API ${release.api_sha?.slice(0,8)} · схема ${release.schema}`,'source-note'));out.append(dep);}
 const hist=section('История постоянного номера');const timeline=node('div',null,'history');for(const h of t.history||[]){const entry=node('div');entry.append(node('small',date(h.at)+' · '+(roleNames[h.role]||h.role)),node('p',h.reason));if(h.from)entry.append(node('p',(data.statuses[h.from]||h.from)+' → '+(data.statuses[h.to]||h.to),'source-note'));timeline.append(entry);}hist.append(timeline);out.append(hist);
 const technical=node('details',null,'technical');technical.append(node('summary',`Технические связи: ${t.technical_count||0}. Не заменяют продуктовую приёмку`));
 for(const x of t.technical_refs||[]){addLink(technical,x.id,x.source);technical.append(node('p',x.label+' · История: '+(x.historical_status||'не установлено'),'source-note'));}
 if((t.technical_count||0)>(t.technical_refs||[]).length)technical.append(node('p','Показаны первые 12. Полный архив всех связей сохранён в GitHub.','source-note'));
 addLink(technical,'Полный архив технических заданий',`https://github.com/anpavel84-afk/gobadminton/blob/${data.source_sha}/docs/product/backlog/technical-history.json`);out.append(technical);
 const ownerBody=`Продуктовая задача: ${t.id}\nНазвание: ${t.title}\nПроверенная версия / адрес: ${t.deployment.url||'указать'}\n\nРешение Owner (выбрать и дополнить):\n[ ] Принимаю результат\n[ ] Требуется исправление\n\nКомментарий:\n\nЭто явная обратная связь, а не автоматическая приёмка. PM: сохранить доказательство и обновить существующий ${t.id}, не создавать дубликат.`;
 $('owner-accept').href=issueUrl(`[Owner review] ${t.id} · ${t.title}`,ownerBody);
 history.replaceState(null,'','#'+id);if(!$('task-dialog').open)$('task-dialog').showModal();
}
function issueUrl(title,body){return 'https://github.com/anpavel84-afk/gobadminton/issues/new?'+new URLSearchParams({title:title.slice(0,220),body:body.slice(0,5800)});}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,5000);}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Скопировано. Это ещё не изменение реестра.');}catch{toast('Браузер запретил буфер обмена. Выдели номер и скопируй вручную.');}}
function requestText(){return `GoBadminton · продуктовый запрос\n${$('capture-name').value.trim()}\n\n${$('capture-description').value.trim()}\n\nСвязанный номер: ${$('capture-related').value.trim()||'PM проверит дубликаты'}\nPM: сначала зарегистрировать/дополнить постоянную карточку GB, затем сообщить номер. Это не запуск Runner.`;}
function coverage(){const c=data.coverage;$('coverage-short').textContent=`${c.audit_count}/102 пунктов · ${c.feedback_count}/17 замечаний · ${c.technical_count} записей`;const out=$('coverage-body');out.replaceChildren(node('p',c.scope_note));out.append(node('p',`Сверка технической истории: ${c.technical_unmapped} записей без точной продуктовой связи сохранены в GB-135. Остальные связи по теме — подсказки для PM, а не доказательства приёмки.`));for(const source of c.sources||[])addLink(out,source.label,source.url);out.append(node('p','Все исходные 102 строки сохранены. Совпадающие просьбы могут быть связаны как дубликаты; номера и история не удаляются. Ноль принятых Owner задач означает отсутствие записанного подтверждения, а не отсутствие выполненного кода.'));}
function release(){const r=data.releases?.[0];if(!r)return;$('release-strip').hidden=false;$('release-strip').replaceChildren();const info=node('div');info.append(node('strong','Последний подтверждённый выпуск: '+date(r.deployed_at)),node('p',`Web ${r.web_sha.slice(0,8)} · API ${r.api_sha.slice(0,8)} · база ${r.schema}. ${r.verification}`));$('release-strip').append(info);addLink($('release-strip'),'Открыть тестовый сайт ↗',r.url);}
let inflight=false;
async function refresh(){
 if(inflight)return;inflight=true;
 try{
  const response=await fetch('../api/product-backlog',{cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('HTTP '+response.status);
  const next=await response.json();if(next.project!=='GoBadminton'||next.schema!=='gobadminton.product-backlog.v1'||!Array.isArray(next.tasks)||!next.tasks.length)throw new Error('Неполные данные');
  if(data&&next.registry_revision<data.registry_revision)throw new Error('Сервер вернул старую ревизию');
  const changed=!data||next.source_sha!==data.source_sha||next.registry_revision!==data.registry_revision;
  data=next;
  const age=Date.now()-new Date(data.synced_at).getTime();const stale=!Number.isFinite(age)||age>10*60*1000;
  $('sync-dot').className='dot '+(stale?'bad':'ok');
  $('sync-text').textContent=`GitHub ${data.source_sha.slice(0,8)} · реестр r${data.registry_revision} · синхронизация ${date(data.synced_at)}`;
  $('source-link').href=data.source_url;$('source-link').hidden=false;
  $('sync-warning').hidden=!stale;if(stale)$('sync-warning').textContent='Последняя синхронизация старше 10 минут. Показана сохранённая версия; не считать её свежим состоянием исполнения.';
  if(changed){
   const areaValue=$('area').value,statusValue=$('status').value;
   $('area').replaceChildren(new Option('Все разделы',''));for(const area of [...new Set(data.tasks.map(t=>t.area))].sort((a,b)=>a.localeCompare(b,'ru')))$('area').add(new Option(area,area));$('area').value=areaValue;
   $('status').replaceChildren(new Option('Все статусы',''));for(const [id,label] of Object.entries(data.statuses))$('status').add(new Option(label,id));$('status').value=statusValue;
   render();coverage();release();const hash=location.hash.slice(1);if(/^GB-\d+$/.test(hash)&&!$('task-dialog').open)openTask(hash);
  }
 }catch(error){$('sync-dot').className='dot bad';$('sync-warning').hidden=false;$('sync-warning').textContent='Не удалось получить свежий реестр. '+(data?'Сохранённые задачи остаются на экране; ничего не удалено.':'Данные ещё не загружены. Повтори обновление.')+' '+String(error.message).slice(0,90);if(!data)$('task-list').replaceChildren(node('p','Реестр временно недоступен. Это не пустой бэклог.','empty'));}
 finally{inflight=false;}
}
$('reload').onclick=refresh;
$('search').addEventListener('input',()=>{page=1;render();});for(const id of ['area','status','priority'])$(id).addEventListener('change',()=>{page=1;render();});
document.querySelectorAll('[data-quick]').forEach(b=>b.addEventListener('click',()=>chooseQuick(b.dataset.quick)));
$('reset').onclick=()=>{$('search').value='';$('area').value='';$('status').value='';$('priority').value='';chooseQuick('all');};
$('prev-page').onclick=()=>{page=Math.max(1,page-1);render();$('list-title').scrollIntoView({block:'start'});};$('next-page').onclick=()=>{page++;render();$('list-title').scrollIntoView({block:'start'});};
for(const id of ['task-dialog','capture-dialog']){const dlg=$(id);dlg.addEventListener('click',e=>{if(e.target===dlg&&e.clientX&&(e.clientX<dlg.getBoundingClientRect().left||e.clientX>dlg.getBoundingClientRect().right||e.clientY<dlg.getBoundingClientRect().top||e.clientY>dlg.getBoundingClientRect().bottom))dlg.close();});dlg.addEventListener('close',()=>{if(id==='task-dialog')history.replaceState(null,'',location.pathname+location.search);});}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('copy-id').onclick=()=>current&&copy(current.id+' · '+current.title);
$('copy-feedback').onclick=()=>current&&copy(`GoBadminton · ${current.id}\n${current.title}\n\nПроверяю на ${current.deployment.url||'указать адрес/версию'}\nЧто вижу:\nКак должно быть:\n\nPM: дополнить существующую карточку, сохранить номер и исходные доказательства.`);
$('new-task').onclick=()=>$('capture-dialog').showModal();$('copy-request').onclick=()=>copy(requestText());
$('capture-form').onsubmit=e=>{e.preventDefault();if(!$('capture-form').reportValidity())return;window.open(issueUrl('[Product request] '+$('capture-name').value,requestText()),'_blank','noopener,noreferrer');toast('Открыт GitHub. Запись сохранится только после отправки Issue и регистрации PM.');};
$('export').onclick=()=>{if(!data)return;const selected=data.tasks.filter(matches);const lines=['GoBadminton · продуктовый бэклог','Ревизия '+data.registry_revision+' · '+data.source_sha,'Экспорт не меняет статусы и не подтверждает выполнение.','',...selected.map(t=>`${t.id} · ${t.title}\nРабота: ${data.statuses[t.status]}\nПубликация: ${data.deployment_states[t.deployment.state]}\nПриёмка Owner: ${t.owner_verification.state==='accepted'?'Принято':'Не подтверждено'}\nДалее: ${t.next_action}\n`)];const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));const a=node('a');a.href=url;a.download='GoBadminton-product-backlog.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
refresh();poll=setInterval(()=>{if(!document.hidden)refresh();},60000);window.addEventListener('focus',refresh);window.addEventListener('hashchange',()=>{if(data&&/^#GB-\d+$/.test(location.hash))openTask(location.hash.slice(1));});
})();

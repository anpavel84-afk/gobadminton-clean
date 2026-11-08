"use client";
import { useEffect, useRef, useState } from "react";
import { AdminError, adminRequest, type Session } from "../lib/admin-client";
import { AttendanceDisputes } from "./AttendanceDisputes";
import { RoleReputationCases } from "./RoleReputationCases";
import { VenueCommunityCases } from "./VenueCommunityCases";
import { VenueReviewCases } from "./VenueReviewCases";
type Case = {id:string;status:keyof typeof statuses;version:number;assignedTo:string|null;roleReputation?:{pendingKind:string;role:string;slotStatus:string;intakeStatus:string};venueReview?:{pendingKind:string;slotStatus:string;intakeStatus:string}};
type Link = {id:string;sourceKind:"report"|"game";sourceId:string;targetKind?:string};
type Detail = Case & {links:Link[];history:{id:string;version:number;action:string;noteCode:string|null;createdAt:string}[];nextHistoryBeforeVersion:number|null};
type Report = {id:string;targetKind?:string;reasonCode:string;state:string;caseId:string|null};
type Evidence = {id:string;linkId:string;kind:string;readable:boolean;expiresAt:string};
type ReviewSource = {
  reportId:string;
  reviewId:string;
  version:number;
  peerRating:string|null;
  comment:string|null;
  tags:string[];
  reasonCode:string;
  recordedAt:string;
};
type MessageSource = {
  reportId:string;
  messageId:string;
  conversationId:string;
  conversationKind:string;
  gameId:string|null;
  seq:string;
  sourceAvailable:boolean;
  unavailableReason:string|null;
  text:string|null;
  reasonCode:string;
  recordedAt:string;
};
type Page<T> = {items:T[];nextBeforeId:string|null};
const statuses={open:"Открыто",in_review:"На проверке",resolved:"Решено",closed:"Закрыто"};
const notes={review_started:"Проверка начата",awaiting_information:"Ожидаем сведения",information_checked:"Сведения проверены",escalated:"Передано на рассмотрение",resolution_recorded:"Решение зафиксировано"};
const actions={status:"Изменить статус",note:"Добавить заметку",assign:"Назначить сотрудника",link_report:"Связать жалобу",link_game:"Связать игру",capture_evidence:"Сохранить материал"};
const peerLabels:Record<string,string>={play_again:"Сыграл бы снова",neutral:"Нейтрально",difficulties:"Были трудности"};
const unavailableCopy:Record<string,string>={
  purged:"Исходное сообщение очищено и больше недоступно.",
  tombstoned:"Исходное сообщение недоступно.",
  null_expiry:"Срок хранения исходного сообщения не задан — точный текст недоступен.",
  expired:"Срок доступности исходного сообщения истёк.",
  empty_body:"Текст исходного сообщения отсутствует.",
  fingerprint_mismatch:"Содержимое исходного сообщения изменилось и недоступно.",
};
const uuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
function reportLinkLabel(targetKind?:string){
  if(targetKind==="game_review")return "Жалоба на отзыв";
  if(targetKind==="message")return "Жалоба на сообщение";
  if(targetKind==="venue_community")return "Сообщество площадки";
  return "Жалоба";
}
export function Cases({session,busy,fresh,run,stepup}:{session:Session;busy:boolean;fresh:boolean;run:(work:()=>Promise<void>)=>Promise<void>;stepup:()=>Promise<void>}) {
 const manager=session.roles.some(r=>["superadmin","moderator"].includes(r));
 const [cases,setCases]=useState<Page<Case>|null>(null),[reports,setReports]=useState<Page<Report>|null>(null),[target,setTarget]=useState(""),[reportId,setReportId]=useState(""),[detail,setDetail]=useState<Detail|null>(null);
 const [action,setAction]=useState<keyof typeof actions>("note"),[status,setStatus]=useState<keyof typeof statuses>("in_review"),[note,setNote]=useState<keyof typeof notes>("review_started"),[value,setValue]=useState(""),[linkId,setLinkId]=useState("");
 const [reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState(""),[uncertain,setUncertain]=useState(false),[evidence,setEvidence]=useState<Page<Evidence>|null>(null),[payload,setPayload]=useState<Record<string,unknown>|null>(null);
 const [reviewSource,setReviewSource]=useState<(ReviewSource&{caseId:string})|null>(null);
 const [messageSource,setMessageSource]=useState<(MessageSource&{caseId:string})|null>(null);
 const [communityReportId,setCommunityReportId]=useState<string|null>(null);
 const pending=useRef<{path:string;key:string;body:object}|null>(null);
 const reviewReadGen=useRef(0);
 const messageReadGen=useRef(0);
 const reviewScope=useRef({fresh,caseId:null as string|null,version:null as number|null,assignedTo:null as string|null});
 const assignedTo=detail?.assignedTo??null;
 reviewScope.current={fresh,caseId:detail?.id??null,version:detail?.version??null,assignedTo};
 function dropReviewSource(){reviewReadGen.current+=1;setReviewSource(null);}
 function dropMessageSource(){messageReadGen.current+=1;setMessageSource(null);}
 function dropCommunityPanel(){setCommunityReportId(null);}
 function dropPrivateSources(){dropReviewSource();dropMessageSource();dropCommunityPanel();}
 function sourceReadCurrent(gen:number,genRef:number,caseId:string,version:number,assignee:string|null){
  const scope=reviewScope.current;
  return gen===genRef&&scope.fresh&&scope.caseId===caseId&&scope.version===version&&scope.assignedTo===assignee;
 }
 useEffect(()=>{
  if(!detail || busy || uncertain)return;
  let active=true;
  const update=async()=>{
   try {
    const next=await adminRequest<Detail>(`cases/${detail.id}`);
    if(active){
     if(next.version!==detail.version)setConfirmed(false);
     // Clear sensitive private payload on poll/reassign/case change.
     if(next.assignedTo!==assignedTo || next.version!==detail.version){dropPrivateSources();setPayload(null);}
     setDetail(old=>old?{...next,history:old.version===next.version?old.history:next.history}:old);
    }
   }
   catch {if(active){setDetail(null);setEvidence(null);setPayload(null);dropPrivateSources();setCases(null);}}
  };
  const timer=setInterval(()=>void update(),15000);
  window.addEventListener("focus",update);
  return ()=>{active=false;clearInterval(timer);window.removeEventListener("focus",update);};
 },[detail?.id,detail?.version,assignedTo,busy,uncertain]);
 useEffect(()=>{if(!fresh){setPayload(null);dropPrivateSources();}},[fresh]);
 // Invalidate in-flight private source reads on case change / reassignment / unmount.
 useEffect(()=>{dropPrivateSources();return()=>{reviewReadGen.current+=1;messageReadGen.current+=1;};},[detail?.id,detail?.version,assignedTo]);
 function reset(){setConfirmed(false);pending.current=null;setUncertain(false);setEvidence(null);setPayload(null);dropPrivateSources();}
 async function open(id:string){setDetail(null);setCases(null);setReports(null);reset();setNotice("");setDetail(await adminRequest<Detail>(`cases/${id}`));setTarget(id);}
 async function list(more=false){await run(async()=>{const next=await adminRequest<Page<Case>>(`cases${more&&cases?.nextBeforeId?`?beforeId=${cases.nextBeforeId}`:""}`);setCases(more&&cases?{...next,items:[...cases.items,...next.items]}:next);});}
 async function queue(more=false){await run(async()=>{const next=await adminRequest<Page<Report>>(`reports${more&&reports?.nextBeforeId?`?beforeId=${reports.nextBeforeId}`:""}`);setReports(more&&reports?{...next,items:[...reports.items,...next.items]}:next);});}
 async function submit(create=false,retry=false){await run(async()=>{
  const request=retry?pending.current:{path:create?"cases":`cases/${detail!.id}/commands`,key:crypto.randomUUID(),body:create?{reportId:reportId.trim(),reasonCode:reason}:{action,expectedVersion:detail!.version,reasonCode:reason,...(action==="status"?{status}:action==="note"?{noteCode:note}:action==="assign"?{principalId:value.trim()||null}:action==="link_report"?{reportId:value.trim()}:action==="link_game"?{gameId:value.trim()}:{linkId})}};
  if(!request)return;pending.current=request;setPayload(null);dropPrivateSources();setNotice("");
  try {const result=await adminRequest<{id:string}>(request.path,request.body,session.csrfToken,request.key);await open(result.id);setReason("");setNotice("Действие сохранено.");}
  catch(cause){
   if(cause instanceof AdminError&&cause.status<500){reset();if(cause.code==="CASE_VERSION_CONFLICT"&&detail)await open(detail.id);if([401,403,404].includes(cause.status)){setDetail(null);setCases(null);setReports(null);}}
   else setUncertain(true);
   throw cause;
  }
 });}
 async function materials(more=false){await run(async()=>{setPayload(null);setEvidence(null);try{const next=await adminRequest<Page<Evidence>>(`cases/${detail!.id}/evidence${more&&evidence?.nextBeforeId?`?beforeId=${evidence.nextBeforeId}`:""}`);setEvidence(more&&evidence?{...next,items:[...evidence.items,...next.items]}:next);}catch(cause){dropPrivateSources();if(cause instanceof AdminError&&[401,403,404].includes(cause.status))setDetail(null);throw cause;}});}
 async function read(id:string){await run(async()=>{setPayload(null);dropPrivateSources();try{const result=await adminRequest<{payload:Record<string,unknown>}>(`cases/${detail!.id}/evidence/${id}`);setPayload(result.payload);}catch(cause){setEvidence(null);dropPrivateSources();if(cause instanceof AdminError&&[401,403,404].includes(cause.status))setDetail(null);throw cause;}});}
 async function readReviewReport(linkedReportId:string){await run(async()=>{
  const caseId=detail!.id,version=detail!.version,assignee=detail!.assignedTo??null;
  setPayload(null);setReviewSource(null);setMessageSource(null);
  const gen=++reviewReadGen.current;
  try{
   const result=await adminRequest<ReviewSource>(`cases/${caseId}/review-reports/${linkedReportId}`);
   if(!sourceReadCurrent(gen,reviewReadGen.current,caseId,version,assignee))return;
   setReviewSource({
    caseId,
    reportId:result.reportId,
    reviewId:result.reviewId,
    version:result.version,
    peerRating:result.peerRating,
    comment:result.comment,
    tags:Array.isArray(result.tags)?result.tags:[],
    reasonCode:result.reasonCode,
    recordedAt:result.recordedAt,
   });
  }catch(cause){
   // Late errors for a superseded read must not clear an unrelated new case/selection.
   if(gen!==reviewReadGen.current||reviewScope.current.caseId!==caseId||reviewScope.current.version!==version||reviewScope.current.assignedTo!==assignee)throw cause;
   setReviewSource(null);
   if(cause instanceof AdminError&&[401,403,404].includes(cause.status)){setDetail(null);setEvidence(null);}
   throw cause;
  }
 });}
 async function readMessageReport(linkedReportId:string){await run(async()=>{
  const caseId=detail!.id,version=detail!.version,assignee=detail!.assignedTo??null;
  setPayload(null);setReviewSource(null);setMessageSource(null);
  const gen=++messageReadGen.current;
  try{
   const result=await adminRequest<MessageSource>(`cases/${caseId}/message-reports/${linkedReportId}`);
   if(!sourceReadCurrent(gen,messageReadGen.current,caseId,version,assignee))return;
   setMessageSource({
    caseId,
    reportId:result.reportId,
    messageId:result.messageId,
    conversationId:result.conversationId,
    conversationKind:result.conversationKind,
    gameId:result.gameId,
    seq:result.seq,
    sourceAvailable:result.sourceAvailable,
    unavailableReason:result.unavailableReason,
    text:result.text,
    reasonCode:result.reasonCode,
    recordedAt:result.recordedAt,
   });
  }catch(cause){
   if(gen!==messageReadGen.current||reviewScope.current.caseId!==caseId||reviewScope.current.version!==version||reviewScope.current.assignedTo!==assignee)throw cause;
   setMessageSource(null);
   if(cause instanceof AdminError&&[401,403,404].includes(cause.status)){setDetail(null);setEvidence(null);}
   throw cause;
  }
 });}
 const locked=busy||uncertain,validReason=/^[a-z][a-z0-9_]{2,63}$/.test(reason);
 const transitions=detail?({open:["in_review","resolved","closed"],in_review:["resolved","closed"],resolved:["closed","open"],closed:["open"]} as Record<string,string[]>)[detail.status]:[];
 const validCommand=action==="status"?transitions?.includes(status):action==="note"?true:action==="assign"?(!value.trim()||uuid(value.trim())):action==="capture_evidence"?Boolean(linkId)&&fresh:uuid(value.trim());
 return <>
  <h2>Обращения</h2><p>{manager?"Проверяйте жалобы и ведите обращения.":"Здесь доступны назначенные вам обращения."}</p>
  <AttendanceDisputes session={session} busy={busy} fresh={fresh} run={run} stepup={stepup} />
  <RoleReputationCases session={session} busy={busy} fresh={fresh} run={run} stepup={stepup} />
  <VenueReviewCases session={session} busy={busy} fresh={fresh} run={run} stepup={stepup} />
  <div className="actions"><button className="button outline" disabled={locked} onClick={()=>void list()}>Обновить обращения</button>{manager&&<button className="button outline" disabled={locked} onClick={()=>void queue()}>Очередь жалоб</button>}</div>
  {cases&&(cases.items.length?<ul className="events">{cases.items.map(item=><li key={item.id}><button className="game-row" disabled={locked} onClick={()=>void run(()=>open(item.id))}><strong>{statuses[item.status]}</strong><small>{item.id}</small></button></li>)}</ul>:<div className="notice">Обращений пока нет.</div>)}
  {cases?.nextBeforeId&&<button className="button outline" disabled={locked} onClick={()=>void list(true)}>Ещё обращения</button>}
  <form onSubmit={e=>{e.preventDefault();void run(()=>open(target.trim()));}}><label className="form-field"><span>Идентификатор обращения</span><input value={target} maxLength={36} disabled={locked} onChange={e=>{setTarget(e.target.value);setDetail(null);reset();}} /></label><button className="button outline" disabled={locked||!uuid(target.trim())}>Открыть обращение</button></form>
  {reports&&<><h3>Жалобы</h3>{reports.items.length?<ul className="events">{reports.items.map(item=><li key={item.id}><strong>{item.reasonCode}</strong>{item.targetKind==="game_review"?<small>отзыв · {item.id}</small>:item.targetKind==="message"?<small>сообщение · {item.id}</small>:item.targetKind==="venue_community"?<small>Сообщество площадки · {item.id}</small>:<small>{item.id}</small>}<button className="button outline" disabled={locked} onClick={()=>item.caseId?void run(()=>open(item.caseId!)):(setReportId(item.id),setConfirmed(false))}>{item.caseId?"Открыть связанное обращение":"Выбрать жалобу"}</button></li>)}</ul>:<div className="notice">Жалоб пока нет.</div>}{reports.nextBeforeId&&<button className="button outline" disabled={locked} onClick={()=>void queue(true)}>Ещё жалобы</button>}</>}
  {manager&&!detail&&<form onSubmit={e=>{e.preventDefault();void submit(true);}}><h3>Новое обращение по жалобе</h3><label className="form-field"><span>Идентификатор жалобы</span><input value={reportId} maxLength={36} disabled={locked} onChange={e=>{setReportId(e.target.value);setConfirmed(false);}} /></label><label className="form-field"><span>Код причины</span><input value={reason} maxLength={64} disabled={locked} onChange={e=>{setReason(e.target.value);setConfirmed(false);}} /></label><label className="confirmation"><input type="checkbox" checked={confirmed} disabled={locked} onChange={e=>setConfirmed(e.target.checked)} />Подтверждаю создание обращения</label><button className="button" disabled={locked||!validReason||!confirmed||!uuid(reportId.trim())}>Создать обращение</button></form>}
  {notice&&<div className="notice" role="status">{notice}</div>}
  {uncertain&&<div className="notice danger"><p>Ответ не получен. Проверим результат того же действия.</p><button className="button outline" disabled={busy} onClick={()=>void submit(false,true)}>Повторить проверку действия</button></div>}
  {detail&&<>
   <h3>Текущее состояние</h3><dl><dt>Обращение</dt><dd>{detail.id}</dd><dt>Статус</dt><dd>{statuses[detail.status]}</dd><dt>Версия</dt><dd>{detail.version}</dd><dt>Ответственный</dt><dd>{detail.assignedTo??"Не назначен"}</dd>{detail.roleReputation?<>
    <dt>Отзыв о роли</dt><dd>{detail.roleReputation.pendingKind} · {detail.roleReputation.role} · {detail.roleReputation.slotStatus}</dd>
   </>:null}{detail.venueReview?<>
    <dt>Отзыв о площадке</dt><dd>{detail.venueReview.pendingKind} · {detail.venueReview.slotStatus}</dd>
   </>:null}</dl>
   <h3>Действие</h3><form onSubmit={e=>{e.preventDefault();void submit();}}>
    <label className="form-field"><span>Действие по обращению</span><select aria-label="Действие по обращению" value={action} disabled={locked} onChange={e=>{setAction(e.target.value as keyof typeof actions);setConfirmed(false);setValue("");}}>{Object.entries(actions).filter(([id])=>manager||["status","note","capture_evidence"].includes(id)).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    {action==="status"&&<label className="form-field"><span>Новый статус</span><select aria-label="Новый статус" value={status} disabled={locked} onChange={e=>{setStatus(e.target.value as keyof typeof statuses);setConfirmed(false);}}>{Object.entries(statuses).map(([id,label])=><option key={id} value={id} disabled={!transitions?.includes(id)}>{label}</option>)}</select></label>}
    {action==="note"&&<label className="form-field"><span>Заметка</span><select aria-label="Заметка" value={note} disabled={locked} onChange={e=>{setNote(e.target.value as keyof typeof notes);setConfirmed(false);}}>{Object.entries(notes).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}
    {["assign","link_report","link_game"].includes(action)&&<label className="form-field"><span>{action==="assign"?"Идентификатор сотрудника (пусто — снять назначение)":action==="link_report"?"Связать жалобу по идентификатору":"Связать игру по идентификатору"}</span><input value={value} maxLength={36} disabled={locked} onChange={e=>{setValue(e.target.value);setConfirmed(false);}} /></label>}
    {action==="capture_evidence"&&<><p>Сохраняется краткое состояние связанной жалобы или игры. Текст приватного отзыва или сообщения сюда не копируется.</p><label className="form-field"><span>Связанный источник</span><select aria-label="Связанный источник" value={linkId} disabled={locked} onChange={e=>{setLinkId(e.target.value);setConfirmed(false);}}><option value="">Выберите источник</option>{detail.links.map(item=><option key={item.id} value={item.id}>{item.sourceKind==="report"?reportLinkLabel(item.targetKind):"Игра"} · {item.sourceId}</option>)}</select></label>{!fresh&&<button type="button" className="button outline" disabled={busy} onClick={()=>void stepup()}>Подтвердить вход</button>}</>}
    <label className="form-field"><span>Код причины</span><input value={reason} maxLength={64} disabled={locked} onChange={e=>{setReason(e.target.value);setConfirmed(false);}} /></label><label className="confirmation"><input type="checkbox" checked={confirmed} disabled={locked} onChange={e=>setConfirmed(e.target.checked)} />Подтверждаю действие для этого обращения</label><button className="button" disabled={locked||!validCommand||!confirmed||!validReason||(detail.status==="closed"&&!(action==="status"&&status==="open"))}>Сохранить действие</button>
   </form>
   <h3>Связи</h3><ul className="events">{detail.links.map(item=><li key={item.id}><strong>{item.sourceKind==="report"?reportLinkLabel(item.targetKind):"Игра"}</strong><small>{item.sourceId}</small>{item.sourceKind==="report"&&item.targetKind==="game_review"?<button className="button outline" disabled={locked||!fresh||detail.assignedTo!==session.principalId} onClick={()=>{dropCommunityPanel();void readReviewReport(item.sourceId);}}>Открыть источник отзыва</button>:null}{item.sourceKind==="report"&&item.targetKind==="message"?<button className="button outline" disabled={locked||!fresh||detail.assignedTo!==session.principalId} onClick={()=>{dropCommunityPanel();void readMessageReport(item.sourceId);}}>Открыть источник сообщения</button>:null}{item.sourceKind==="report"&&item.targetKind==="venue_community"?<button className="button outline" disabled={locked} onClick={()=>{dropReviewSource();dropMessageSource();setCommunityReportId(item.sourceId);}}>Открыть источник сообщества</button>:null}</li>)}</ul>
   {communityReportId&&detail?<VenueCommunityCases session={session} busy={busy} fresh={fresh} run={run} stepup={stepup} caseId={detail.id} caseStatus={detail.status} caseVersion={detail.version} assignedTo={detail.assignedTo} reportId={communityReportId} onCaseMutated={async(id)=>{const next=await adminRequest<Detail>(`cases/${id}`);setDetail(old=>old&&old.id===id?{...next,history:old.version===next.version?old.history:next.history}:old);}} />:null}
   <h3>Материалы</h3>{!fresh&&<div className="notice"><p>Подтвердите вход для просмотра материалов.</p><button className="button outline" disabled={busy} onClick={()=>void stepup()}>Подтвердить вход</button></div>}<button className="button outline" disabled={locked||!fresh} onClick={()=>void materials()}>Посмотреть материалы</button>
   {evidence&&(evidence.items.length?<ul className="events">{evidence.items.map(item=><li key={item.id}><strong>{item.kind==="report_summary"?"Сводка жалобы":"Состояние игры"}</strong><small>Доступно до {new Date(item.expiresAt).toLocaleString("ru-RU")}</small><button className="button outline" disabled={locked||!fresh||!item.readable} onClick={()=>void read(item.id)}>Открыть материал</button></li>)}</ul>:<div className="notice">Материалов пока нет.</div>)}{evidence?.nextBeforeId&&<button className="button outline" disabled={locked||!fresh} onClick={()=>void materials(true)}>Ещё материалы</button>}
   {payload&&<dl>{Object.entries(payload).map(([key,val])=><div key={key}><dt>{{id:"Источник",status:"Статус игры",state:"Статус жалобы",targetKind:"Тип объекта",targetPublicPlayerId:"Идентификатор игрока",reasonCode:"Причина жалобы",createdAt:"Создано",lifecycleVersion:"Версия игры",moderationState:"Состояние модерации",requestsLocked:"Заявки закрыты",moderationVersion:"Версия модерации"}[key]??"Сведения"}</dt><dd>{String(val)}</dd></div>)}</dl>}
   {reviewSource&&fresh&&detail.id===reviewSource.caseId?<div className="notice"><h3>Источник отзыва (согласованная редакция)</h3><dl>
    <div><dt>Версия</dt><dd>{reviewSource.version}</dd></div>
    <div><dt>Оценка</dt><dd>{reviewSource.peerRating?peerLabels[reviewSource.peerRating]??reviewSource.peerRating:"—"}</dd></div>
    <div><dt>Текст</dt><dd>{reviewSource.comment??"—"}</dd></div>
    {reviewSource.tags.length>0?<div><dt>Теги</dt><dd>{reviewSource.tags.join(", ")}</dd></div>:null}
    <div><dt>Причина жалобы</dt><dd>{reviewSource.reasonCode}</dd></div>
    <div><dt>Зафиксировано</dt><dd>{new Date(reviewSource.recordedAt).toLocaleString("ru-RU")}</dd></div>
   </dl></div>:null}
   {messageSource&&fresh&&detail.id===messageSource.caseId?<div className="notice"><h3>Источник сообщения (согласованная жалоба)</h3>
    {messageSource.sourceAvailable&&messageSource.text!=null?<dl>
      <div><dt>Текст</dt><dd>{messageSource.text}</dd></div>
      <div><dt>Причина жалобы</dt><dd>{messageSource.reasonCode}</dd></div>
      <div><dt>Зафиксировано</dt><dd>{new Date(messageSource.recordedAt).toLocaleString("ru-RU")}</dd></div>
    </dl>:<p role="status">{unavailableCopy[messageSource.unavailableReason??""]??"Точный текст исходного сообщения сейчас недоступен. Обычная жалоба на игрока по-прежнему возможна отдельно."}</p>}
   </div>:null}
   <h3>История</h3><ol className="events">{detail.history.map(item=><li key={item.id}><strong>{item.action==="create"?"Обращение создано":actions[item.action as keyof typeof actions]}</strong>{item.noteCode&&<span>{notes[item.noteCode as keyof typeof notes]}</span>}<small>{new Date(item.createdAt).toLocaleString("ru-RU")}</small></li>)}</ol>{detail.nextHistoryBeforeVersion&&<button className="button outline" disabled={locked} onClick={()=>void run(async()=>{const next=await adminRequest<Detail>(`cases/${detail.id}?beforeVersion=${detail.nextHistoryBeforeVersion}`);setDetail({...next,history:[...detail.history,...next.history]});setPayload(null);dropPrivateSources();})}>Более ранние действия</button>}
  </>}
 </>;
}

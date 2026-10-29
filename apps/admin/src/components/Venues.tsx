"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminRequest, AdminError, errorMessage, type Session } from "../lib/admin-client";
import { VenuePhoto } from "./VenuePhoto";
import { VenueProfileFields } from "./VenueProfileFields";
import { initializeVenueProfile, validateVenueProfile, type VenueProfileSource } from "../lib/venue-profile-form";
type Venue=VenueProfileSource & {id:string;cityId:string;cityName?:string;name:string;address:string;timezone:string;latitude:number;longitude:number;identityDiscriminator:string;lifecycleState:string;version:number;canonicalVenueId:string|null;reviewRequired?:boolean;history?:{version:number;action:string}[]};
type Page={items:Venue[];nextBeforeId:string|null};
type Duplicate={id:string;leftVenueId:string;rightVenueId:string;version:number};
const blank={cityId:"",name:"",address:"",timezone:"Europe/Moscow",latitude:55.75,longitude:37.62,identityDiscriminator:""};
const states:Record<string,string>={unverified:"На проверке",verified:"Проверена",retired:"Архив",merged:"Объединена"};
export function Venues({session,onAuthorityLoss,stepup}:{session:Session;onAuthorityLoss:()=>void;stepup:()=>Promise<void>}) {
 const [page,setPage]=useState<Page>({items:[],nextBeforeId:null}),[status,setStatus]=useState("unverified"),[venue,setVenue]=useState<Venue|null>(null),[fields,setFields]=useState(blank),[editing,setEditing]=useState(false),[creating,setCreating]=useState(false),[reason,setReason]=useState("address_verified"),[targetId,setTargetId]=useState(""),[target,setTarget]=useState<Venue|null>(null),[duplicates,setDuplicates]=useState<Duplicate[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[uncertain,setUncertain]=useState(false);
 const [associated,setAssociated]=useState<{items:{id:string;title:string;status:string}[];nextBeforeId:string|null}>({items:[],nextBeforeId:null});
 const [photoBusy,setPhotoBusy]=useState(false);
 const [profileDraft,setProfileDraft]=useState(()=>initializeVenueProfile({}));
 const [refreshRequired,setRefreshRequired]=useState(false),[authorityBlocked,setAuthorityBlocked]=useState(false);
 const operationBusy=useRef(false),photoBusyRef=useRef(false),needsRefresh=useRef(false),authorityLost=useRef(false),selection=useRef(0);
 const editBase=useRef<{id:string;version:number}|null>(null);
 const onPhotoBusy=useCallback((value:boolean)=>{photoBusyRef.current=value;setPhotoBusy(value);},[]);
 const selectedCard=useRef<HTMLDivElement>(null);
 const [cursor,setCursor]=useState<string|undefined>();
 const pending=useRef<{path:string;body:unknown;key:string;result?:Venue}|null>(null);
 const fail=useCallback((e:unknown)=>{
  if(e instanceof AdminError && [401,403].includes(e.status) && e.code!=="ADMIN_STEP_UP_REQUIRED"){
   authorityLost.current=true;setAuthorityBlocked(true);onAuthorityLoss();
  }
  if(e instanceof AdminError && e.status===409){needsRefresh.current=true;setRefreshRequired(true);}
  setError(e instanceof AdminError && e.status===409?"Данные изменились. Откройте площадку заново и подтвердите новое действие.":errorMessage(e));
 },[onAuthorityLoss]);
 const load=useCallback(async(beforeId?:string)=>{setCursor(beforeId);const p=await adminRequest<Page>("venues?limit=20"+(status?"&status="+status:"")+(beforeId?"&beforeId="+beforeId:""));setPage(p);},[status]);
 useEffect(()=>{void load().catch(fail);},[load,fail]);
 async function read(id:string){
  if(operationBusy.current||photoBusyRef.current||pending.current||authorityLost.current)return;
  operationBusy.current=true;
  const selected=++selection.current;
  editBase.current=null;setEditing(false);setCreating(false);setVenue(null);
  setProfileDraft(initializeVenueProfile({}));setBusy(true);setError("");setNotice("");
  try{
   const detail=await adminRequest<Venue>("venues/"+id);
   if(selected!==selection.current)return;
   setVenue(detail);setAssociated({items:[],nextBeforeId:null});setTarget(null);
   needsRefresh.current=false;setRefreshRequired(false);
   requestAnimationFrame(()=>selectedCard.current?.scrollIntoView({block:"start",behavior:"smooth"}));
  }catch(e){fail(e);}finally{operationBusy.current=false;setBusy(false);}
 }
 async function send(path?:string,body?:unknown){
  // The synchronous latch also covers two clicks before React commits busy state.
  if(operationBusy.current||photoBusyRef.current||authorityLost.current)return;
  if(pending.current&&path)return;
  if(!pending.current){
   if(!path||needsRefresh.current)return;
   pending.current={path,body,key:crypto.randomUUID()};
  }
  const p=pending.current;
  operationBusy.current=true;setBusy(true);setError("");setNotice("");
  try{
   // A confirmed command followed by a failed GET only retries the GET, never
   // the mutation. Unknown command outcomes require an explicit same-key replay.
   if(!p.result)p.result=await adminRequest<Venue>(p.path,p.body,session.csrfToken,p.key);
   const result=p.result;
   const detail=result.lifecycleState?await adminRequest<Venue>("venues/"+result.id):null;
   await load(cursor);
   if(p.path.includes("/dismiss"))setDuplicates((await adminRequest<{items:Duplicate[]}>("venues/duplicates")).items);
   if(detail){setVenue(detail);needsRefresh.current=false;setRefreshRequired(false);}
   editBase.current=null;setEditing(false);setCreating(false);
   pending.current=null;setUncertain(false);
   setNotice(result.reviewRequired?"Совпадение направлено на проверку. Данные площадки сохранены без изменений.":"Действие сохранено.");
  }catch(e){
   // Rate limiting runs before receipt lookup, so even a throttled replay
   // cannot resolve the original outcome. Keep its exact body/key and lock.
   const definite=e instanceof AdminError&&e.status<500&&e.status!==408&&e.status!==429&&e.code!=="ADMIN_UPSTREAM_UNAVAILABLE"&&e.code!=="ADMIN_STEP_UP_REQUIRED";
   if(!p.result&&definite){pending.current=null;setUncertain(false);}
   else setUncertain(true);
   // CREATE identity collisions reject this draft; there is no selected
   // version to refresh. Existing-venue 409s still require an explicit read.
   if(p.path==="venues"&&e instanceof AdminError&&e.status===409&&e.code==="VENUE_IDENTITY_CONFLICT"){
    setError("Такая площадка уже существует. Проверьте каталог или измените данные новой площадки.");
   }else fail(e);
  }finally{operationBusy.current=false;setBusy(false);}
 }
 function beginEdit(){
  if(!venue||operationBusy.current||photoBusyRef.current||pending.current||needsRefresh.current||authorityLost.current||editBase.current)return;
  editBase.current={id:venue.id,version:venue.version};
  setFields({cityId:venue.cityId,name:venue.name,address:venue.address,timezone:venue.timezone,latitude:venue.latitude,longitude:venue.longitude,identityDiscriminator:venue.identityDiscriminator});
  setProfileDraft(initializeVenueProfile(venue));setEditing(true);setCreating(false);setNotice("");
 }
 const locked=busy||uncertain||photoBusy||authorityBlocked;
 const selectionVersion=selection.current;
 const profileValidation=validateVenueProfile(profileDraft);
 const profileValid=creating||Object.keys(profileValidation.errors).length===0;
 function submit(){
  if(locked||!valid||!profileValid||!reason||!fields.cityId||needsRefresh.current)return;
  if(creating){void send('venues',{...fields,reasonCode:reason});return;}
  const base=editBase.current;
  if(!editing||!base||venue?.id!==base.id)return;
  void send('venues/'+base.id+'/commands',{action:'edit',fields:{...fields,...profileValidation.patch},expectedVersion:base.version,reasonCode:reason});
 }
 const valid=fields.name.trim().length>0&&fields.name.length<=160&&fields.address.trim().length>0&&fields.address.length<=500&&fields.identityDiscriminator.length<=80&&Number.isFinite(fields.latitude)&&Math.abs(fields.latitude)<=90&&Number.isFinite(fields.longitude)&&Math.abs(fields.longitude)<=180&&(()=>{try{new Intl.DateTimeFormat("ru",{timeZone:fields.timezone});return true;}catch{return false;}})();
 const form=<div className="panel"><h3>{creating?"Новая проверенная площадка":"Редактировать площадку"}</h3>{creating?<label className="form-field"><span>Идентификатор города (создание)</span><input value={fields.cityId} disabled={locked} onChange={e=>setFields({...fields,cityId:e.target.value})}/></label>:<p>Город: {venue?.cityName??venue?.cityId}</p>}{([['name','Название'],['address','Адрес'],['timezone','Часовой пояс'],['identityDiscriminator','Зал / помещение']] as const).map(([key,label])=><label className="form-field" key={key}><span>{label}</span><input value={fields[key]} disabled={locked} onChange={e=>setFields({...fields,[key]:e.target.value})}/></label>)}{(['latitude','longitude'] as const).map((key)=><label className="form-field" key={key}><span>{key==='latitude'?'Широта':'Долгота'}</span><input type="number" step="any" value={fields[key]} disabled={locked} onChange={e=>setFields({...fields,[key]:Number(e.target.value)})}/></label>)}{!creating&&<VenueProfileFields draft={profileDraft} errors={profileValidation.errors} disabled={locked||refreshRequired} onChange={setProfileDraft}/>}<button className="button" disabled={locked||refreshRequired||!reason||!valid||!profileValid||!fields.cityId} onClick={submit}>Подтвердить сохранение</button><button className="button outline" disabled={locked} onClick={()=>{editBase.current=null;setEditing(false);setCreating(false);setProfileDraft(initializeVenueProfile({}));}}>Отмена</button>{!valid&&<p role="status">Заполните название и адрес, укажите действующий часовой пояс и координаты: широта −90…90, долгота −180…180.</p>}</div>;
 return <><h2>Площадки</h2><p>Проверьте адрес и отдельный зал перед подтверждением или объединением.</p>{error&&<div role="alert" className="notice danger">{error}</div>}{notice&&<div role="status" className="notice">{notice}</div>}{uncertain&&<div className="notice"><p>Ответ или обновлённые данные не получены. Проверьте результат: неподтверждённое действие будет повторено с прежним ключом.</p><button className="button" disabled={busy||authorityBlocked||photoBusy} onClick={()=>void send()}>Проверить результат</button></div>}
 <div ref={selectedCard} className="venue-selected panel" aria-live="polite">{busy&&<p role="status">Загрузка / сохранение…</p>}<button className="button outline" disabled={busy||photoBusy||authorityBlocked} onClick={()=>void stepup().catch(fail)}>Подтвердить вход</button> {refreshRequired&&venue&&<div className="notice"><p>Для нового действия загрузите текущие данные. Черновик будет сброшен.</p><button className="button outline" disabled={locked} onClick={()=>void read(venue.id)}>Обновить выбранную площадку</button></div>}{(editing||creating)&&form}
 {venue&&!creating&&<section><h3>{venue.name}</h3><p>{venue.address}</p><dl><dt>Состояние</dt><dd>{states[venue.lifecycleState]}</dd><dt>Город / часовой пояс</dt><dd>{venue.cityName??venue.cityId} · {venue.timezone}</dd><dt>Зал / помещение</dt><dd>{venue.identityDiscriminator||"Не указан"}</dd><dt>Координаты</dt><dd>{venue.latitude}, {venue.longitude}</dd><dt>Версия</dt><dd>{venue.version}</dd><dt>Площадка</dt><dd>{venue.id}</dd></dl>{venue.canonicalVenueId&&<button className="button outline" disabled={locked} onClick={()=>void read(venue.canonicalVenueId!)}>Открыть основную площадку</button>}
 {["unverified","verified"].includes(venue.lifecycleState)&&<fieldset className="venue-photo-lock" disabled={busy||uncertain||editing||creating||refreshRequired||authorityBlocked}><VenuePhoto key={venue.id+":"+venue.version} id={venue.id} session={session} authorityLoss={onAuthorityLoss} onBusy={onPhotoBusy} stepup={stepup} changed={async()=>{if(selectionVersion!==selection.current||editBase.current)return;const detail=await adminRequest<Venue>("venues/"+venue.id);if(selectionVersion!==selection.current||editBase.current)return;setVenue(detail);await load(cursor);setNotice("Фото выбранной площадки сохранено.");}}/></fieldset>}{venue.lifecycleState!=="merged"&&<><div className="actions"><button className="button outline" disabled={locked||refreshRequired||editing} onClick={beginEdit}>Редактировать данные</button>{(venue.lifecycleState==='retired'?['restore']:['verify','retire']).map(action=><button key={action} className="button outline" disabled={locked||refreshRequired||!reason} onClick={()=>void send('venues/'+venue.id+'/commands',{action,expectedVersion:venue.version,reasonCode:reason})}>{{verify:'Подтвердить проверку',retire:'Перенести в архив',restore:'Вернуть на проверку'}[action]}</button>)}</div><h3>Объединение</h3><p>Игры и прежние ссылки перейдут на основную площадку. Разные залы объединять нельзя.</p><label className="form-field"><span>Идентификатор основной площадки</span><input value={targetId} disabled={locked} onChange={e=>{setTargetId(e.target.value);setTarget(null);}}/></label><button className="button outline" disabled={locked||!targetId} onClick={()=>void adminRequest<Venue>('venues/'+targetId).then(setTarget).catch(fail)}>Проверить основную площадку</button>{target&&<div className="notice"><strong>{target.name}</strong><p>{target.address}</p><button className="button" disabled={locked||refreshRequired||!reason||target.id===venue.id} onClick={()=>void send('venues/'+venue.id+'/commands',{action:'merge',expectedVersion:venue.version,targetId:target.id,expectedTargetVersion:target.version,reasonCode:reason})}>Подтвердить объединение</button></div>}</>}
 <h3>Связанные игры</h3><button className="button outline" disabled={locked} onClick={()=>void adminRequest<typeof associated>("venues/"+venue.id+"/games"+(associated.nextBeforeId?"?beforeId="+associated.nextBeforeId:"")).then(setAssociated).catch(fail)}>{associated.nextBeforeId?"Следующие игры":"Показать игры"}</button><ul className="events">{associated.items.map(g=><li key={g.id}><strong>{g.title}</strong><small>{g.status}</small></li>)}</ul><h3>История</h3><ul className="events">{venue.history?.map(h=><li key={h.version}>Версия {h.version} · {h.action}</li>)}</ul></section>}</div>
 <label className="form-field"><span>Фильтр списка по состоянию</span><select value={status} disabled={locked} onChange={e=>setStatus(e.target.value)}><option value="">Все</option>{Object.entries(states).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><div className="actions"><button className="button outline" disabled={locked||refreshRequired} onClick={()=>{editBase.current=null;setCreating(true);setEditing(false);setProfileDraft(initializeVenueProfile({}));setFields(blank);}}>Создать площадку</button><button className="button outline" disabled={locked} onClick={()=>void adminRequest<{items:Duplicate[]}>("venues/duplicates").then(p=>setDuplicates(p.items)).catch(fail)}>Проверить совпадения</button></div>
 <ul className="events">{page.items.map(v=><li key={v.id}><button className="button outline" disabled={locked} onClick={()=>void read(v.id)}>{v.name} · Открыть / Редактировать</button><p>{v.address}</p><span className="badge">{states[v.lifecycleState]}</span></li>)}</ul>{!page.items.length&&<div className="notice">Площадок в этой выборке нет.</div>}{page.nextBeforeId&&<button className="button outline" disabled={locked} onClick={()=>void load(page.nextBeforeId!).catch(fail)}>Следующие площадки</button>}
 <label className="form-field"><span>Причина действия (сохраняется в аудите)</span><select value={reason} disabled={locked} onChange={e=>setReason(e.target.value)}><option value="address_verified">Данные площадки проверены</option><option value="catalog_correction">Исправление каталога</option><option value="duplicate_review">Проверка совпадений</option></select></label>
 {duplicates.map(d=><div className="panel" key={d.id}><h3>Возможное совпадение</h3><div className="actions"><button className="button outline" disabled={locked} onClick={()=>void read(d.leftVenueId)}>Открыть первую</button><button className="button outline" disabled={locked} onClick={()=>void read(d.rightVenueId)}>Открыть вторую</button><button className="button outline" disabled={locked||refreshRequired||!reason} onClick={()=>void send('venues/duplicates/'+d.id+'/dismiss',{expectedVersion:d.version,reasonCode:reason})}>Подтвердить: разные площадки</button></div></div>)}
</>;
}

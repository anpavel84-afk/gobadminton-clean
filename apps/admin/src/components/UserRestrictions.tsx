"use client";
import { useRef, useState } from "react";
import { AdminError, adminRequest, type Session } from "../lib/admin-client";
const capabilities = {
  "account.access":"Доступ к аккаунту", "game.create":"Создание игр", "participation.request":"Новые заявки и принятие приглашений",
  "profile.public":"Публичный профиль", "social.directory":"Каталог игроков", "social.radar":"Radar", "social.dm_send":"Отправка личных сообщений", "social.game_chat_send":"Отправка в чат игры",
} as const;
type Capability = keyof typeof capabilities;
type Restriction = {id:string;capability:Capability;reasonCode:string;startsAt:string;expiresAt:string;revokedAt:string|null;revokeReasonCode:string|null;version:number;status:"active"|"expired"|"revoked"};
type History = {id:string;action:string;reasonCode:string;createdAt:string;auditId:string};
type Detail = {userId:string;version:number;restrictions:Restriction[];history:History[];nextHistoryBeforeVersion:number|null};
type Result = Omit<Detail,"history"|"nextHistoryBeforeVersion"> & {revokedCount:number|null};
const actions = {restrict:"Добавить ограничение",revoke_restriction:"Снять выбранное ограничение",revoke_consumer_sessions:"Завершить сессии пользователя"} as const;
const effectiveState = (item: Restriction) => item.status === "active" && Date.parse(item.expiresAt) <= Date.now() ? "expired" : item.status;
const states = {active:"Действует",expired:"Истекло",revoked:"Снято"};
export function UserRestrictions({session,busy,fresh,run,stepup}:{session:Session;busy:boolean;fresh:boolean;run:(work:()=>Promise<void>)=>Promise<void>;stepup:()=>Promise<void>}) {
  const [target,setTarget]=useState(""); const [detail,setDetail]=useState<Detail|null>(null);
  const [action,setAction]=useState<keyof typeof actions>("restrict");const [capability,setCapability]=useState<Capability>("game.create");
  const [restrictionId,setRestrictionId]=useState("");const [reason,setReason]=useState("");const [expiry,setExpiry]=useState("");
  const [confirmed,setConfirmed]=useState(false);const [notice,setNotice]=useState("");const [uncertain,setUncertain]=useState(false);
  const pending=useRef<{key:string;userId:string;body:object}|null>(null);
  function reset(){setConfirmed(false);setRestrictionId("");setReason("");pending.current=null;setUncertain(false);}
  async function load(){await run(async()=>{setDetail(null);setNotice("");reset();const data=await adminRequest<Detail>(`users/${target.trim()}/restrictions`);setDetail(data);});}
  async function submit(retry=false){await run(async()=>{
    if(!detail)return;
    const command=retry?pending.current:{key:crypto.randomUUID(),userId:detail.userId,body:{action,expectedVersion:detail.version,reasonCode:reason,...(action==="restrict"?{capability,expiresAt:new Date(expiry).toISOString()}:action==="revoke_restriction"?{restrictionId}:{})}};
    if(!command)return;pending.current=command;setNotice("");
    try {
      const result=await adminRequest<Result>(`users/${command.userId}/restrictions/commands`,command.body,session.csrfToken,command.key);
      // Fetch current state: a lost response/replay may represent an older command outcome.
      const current=await adminRequest<Detail>(`users/${command.userId}/restrictions`);setDetail(current);reset();
      setNotice(result.revokedCount===null?"Действие сохранено.":`Сессии завершены: ${result.revokedCount}. Новое ограничение не добавлено.`);
    } catch(cause) {
      if(cause instanceof AdminError&&cause.status<500){reset();if(cause.code==="RESTRICTION_VERSION_CONFLICT"||cause.code==="RESTRICTION_ALREADY_REVOKED")setDetail(await adminRequest<Detail>(`users/${command.userId}/restrictions`));}
      else setUncertain(true);
      throw cause;
    }
  });}
  async function more(){await run(async()=>{if(!detail?.nextHistoryBeforeVersion)return;const next=await adminRequest<Detail>(`users/${detail.userId}/restrictions?beforeVersion=${detail.nextHistoryBeforeVersion}`);setDetail({...next,history:[...detail.history,...next.history]});});}
  return <>
    <h2>Ограничения пользователя</h2><p>Откройте конкретную учётную запись по её идентификатору.</p>
    <form onSubmit={event=>{event.preventDefault();void load();}}><label className="form-field"><span>Идентификатор пользователя</span><input value={target} maxLength={36} disabled={busy||uncertain} onChange={event=>{setTarget(event.target.value);setDetail(null);setNotice("");reset();}} /></label><button className="button outline" disabled={busy||uncertain||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target.trim())}>Открыть пользователя</button></form>
    {notice&&<div className="notice" role="status">{notice}</div>}
    {detail&&<>
      <h3>Текущее состояние</h3><dl><dt>Учётная запись</dt><dd>{detail.userId}</dd><dt>Версия ограничений</dt><dd>{detail.version}</dd></dl>
      {detail.restrictions.length?<ul className="events">{detail.restrictions.map(item=><li key={item.id}><strong>{capabilities[item.capability]}</strong><span>{states[effectiveState(item)]} · {item.reasonCode}</span><small>До {new Date(item.expiresAt).toLocaleString("ru-RU")}</small>{item.revokeReasonCode&&<small>Причина снятия: {item.revokeReasonCode}</small>}{item.status!=="revoked"&&<button className="button outline" disabled={busy||uncertain} onClick={()=>{setAction("revoke_restriction");setRestrictionId(item.id);setConfirmed(false);}}>Выбрать для снятия</button>}</li>)}</ul>:<div className="notice">Ограничений пока нет.</div>}
      <h3>Действие</h3><div className="notice"><p>Ограничение действует до указанного срока. Его снятие не меняет роли, настройки и согласия. Завершение сессий — отдельное действие; повторный вход остаётся доступен, если доступ к аккаунту не ограничен.</p>{!fresh&&<><p>Подтвердите вход для выполнения действия.</p><button className="button outline" disabled={busy} onClick={()=>void stepup()}>Подтвердить вход</button></>}</div>
      {uncertain&&<div className="notice danger"><p>Ответ не получен. Проверим результат того же действия.</p><button className="button outline" disabled={busy||!fresh} onClick={()=>void submit(true)}>Повторить проверку действия</button></div>}
      <form onSubmit={event=>{event.preventDefault();void submit();}}>
        <label className="form-field"><span>Действие</span><select aria-label="Действие" value={action} disabled={busy||uncertain} onChange={event=>{setAction(event.target.value as keyof typeof actions);setConfirmed(false);}}>{Object.entries(actions).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        {action==="restrict"&&<><label className="form-field"><span>Возможность</span><select aria-label="Возможность" value={capability} disabled={busy||uncertain} onChange={event=>{setCapability(event.target.value as Capability);setConfirmed(false);}}>{Object.entries(capabilities).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label className="form-field"><span>Ограничение до</span><input type="datetime-local" value={expiry} disabled={busy||uncertain} onChange={event=>{setExpiry(event.target.value);setConfirmed(false);}} /></label><p>Укажите будущую дату в пределах 30 дней.</p></>}
        {action==="revoke_restriction"&&<label className="form-field"><span>Ограничение для снятия</span><select aria-label="Ограничение для снятия" value={restrictionId} disabled={busy||uncertain} onChange={event=>{setRestrictionId(event.target.value);setConfirmed(false);}}><option value="">Выберите ограничение</option>{detail.restrictions.filter(item=>item.status!=="revoked").map(item=><option value={item.id} key={item.id}>{capabilities[item.capability]} · {states[effectiveState(item)]} · {item.reasonCode}</option>)}</select></label>}
        <label className="form-field"><span>Код причины</span><input value={reason} maxLength={64} disabled={busy||uncertain} onChange={event=>{setReason(event.target.value);setConfirmed(false);}} /></label>
        <label className="confirmation"><input type="checkbox" checked={confirmed} disabled={busy||uncertain} onChange={event=>setConfirmed(event.target.checked)} /><span>Подтверждаю действие для выбранной учётной записи</span></label>
        <button className="button" disabled={busy||uncertain||!fresh||!confirmed||!/^[a-z][a-z0-9_]{2,63}$/.test(reason)||(action==="restrict"&&!Number.isFinite(Date.parse(expiry)))||(action==="revoke_restriction"&&!restrictionId)}>{busy?"Сохраняем…":"Выполнить действие"}</button>
      </form>
      <h3>История действий</h3>{detail.history.length?<ol className="events">{detail.history.map(item=><li key={item.id}><strong>{actions[item.action as keyof typeof actions]}</strong><span>{item.reasonCode}</span><small>{new Date(item.createdAt).toLocaleString("ru-RU")}</small><small>Событие журнала: {item.auditId}</small></li>)}</ol>:<div className="notice">Действий пока нет.</div>}
      {detail.nextHistoryBeforeVersion&&<button className="button outline" disabled={busy||uncertain} onClick={()=>void more()}>Более ранние действия</button>}
    </>}
  </>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { AdminError, adminRequest, type Session } from "../lib/admin-client";
type Projection = {state:"clear"|"hidden"|"taken_down";requestsLocked:boolean;version:number;lastActionId:string|null};
type Game = {id:string;title:string;status:string;visibility:string;gameVersion:number;moderation:Projection};
type History = {id:string;action:string;reasonCode:string;createdAt:string;auditId:string;after:{status:string;moderation:Projection}};
type Detail = Game & {history:History[];nextHistoryCursor:string|null};
type Page = {items:Game[];nextCursor:string|null};
const actions = {hide:"Скрыть из поиска",takedown:"Закрыть публичный доступ",lock_requests:"Закрыть новые заявки",restore_moderation:"Восстановить доступ",force_cancel:"Отменить игру"} as const;
type Action = keyof typeof actions;
const states = {clear:"Без ограничений модерации",hidden:"Скрыта из поиска",taken_down:"Публичный доступ закрыт"};
const statuses:Record<string,string> = {draft:"Черновик",published:"Опубликована",cancelled:"Отменена",completed:"Завершена"};
export function GameModeration({session,busy,fresh,run,stepup}:{session:Session;busy:boolean;fresh:boolean;run:(work:()=>Promise<void>)=>Promise<void>;stepup:()=>Promise<void>}) {
  const [page,setPage]=useState<Page|null>(null),[detail,setDetail]=useState<Detail|null>(null);
  const [action,setAction]=useState<Action>("hide"),[reason,setReason]=useState("");
  const [confirmed,setConfirmed]=useState(false),[uncertain,setUncertain]=useState(false),[notice,setNotice]=useState("");
  const alive=useRef(false),requestGeneration=useRef(0);
  const pending=useRef<{gameId:string;key:string;body:object}|null>(null);
  useEffect(()=>{
    alive.current=true;const gen=++requestGeneration.current;
    void run(async()=>{const result=await adminRequest<Page>("games");if(alive.current&&requestGeneration.current===gen)setPage(result);});
    return()=>{alive.current=false;requestGeneration.current++;pending.current=null;};
    // Parent run is an event helper; one load per mounted authorized section.
  },[]);
  async function load(gameId:string) {
    await run(async()=>{const gen=++requestGeneration.current;setDetail(null);setNotice("");
      const data=await adminRequest<Detail>("games/"+gameId);
      if(alive.current&&requestGeneration.current===gen){setDetail(data);setConfirmed(false);setReason("");}
    });
  }
  async function submit() {
    if(!detail&&!pending.current)return;
    await run(async()=>{
      setNotice("");
      if(!pending.current){
        if(!detail||!confirmed||!/^[a-z][a-z0-9_]{2,63}$/.test(reason))return;
        pending.current={gameId:detail.id,key:crypto.randomUUID(),body:{action,expectedModerationVersion:detail.moderation.version,reasonCode:reason,...(action==="force_cancel"?{expectedGameVersion:detail.gameVersion}:{})}};
      }
      const saved=pending.current;
      try {
        await adminRequest<Game>(`games/${saved.gameId}/moderation/commands`,saved.body,session.csrfToken,saved.key);
      } catch(cause) {
        if(cause instanceof AdminError&&cause.status<500){pending.current=null;setUncertain(false);setConfirmed(false);
          if(cause.status===409){const current=await adminRequest<Detail>("games/"+saved.gameId);if(alive.current)setDetail(current);}
        } else {if(alive.current)setUncertain(true);}
        throw cause;
      }
      pending.current=null;setUncertain(false);
      const data=await adminRequest<Detail>("games/"+saved.gameId);
      if(alive.current){setDetail(data);setConfirmed(false);setNotice("Действие сохранено в истории.");}
    });
  }
  async function moreHistory() {
    if(!detail?.nextHistoryCursor)return;
    await run(async()=>{const data=await adminRequest<Detail>(`games/${detail.id}?historyCursor=${encodeURIComponent(detail.nextHistoryCursor!)}`);
      if(alive.current)setDetail(old=>old?{...data,history:[...old.history,...data.history]}:data);
    });
  }
  return <><h2>Модерация игр</h2><p>Скрытие и восстановление меняют доступ к игре. Отмена завершает игру и не отменяется восстановлением доступа.</p>
    {notice&&<div className="notice" role="status">{notice}</div>}
    {uncertain&&<div className="notice" role="status"><strong>Ответ не получен</strong><p>Проверьте результат повтором того же действия.</p><button className="button outline" disabled={busy} onClick={()=>void submit()}>Проверить результат</button></div>}
    {!detail?<>{page?page.items.length?<ul className="events">{page.items.map(game=><li key={game.id}><button className="game-row" disabled={busy||uncertain} onClick={()=>void load(game.id)}><strong>{game.title}</strong><span>{statuses[game.status]??game.status} · {states[game.moderation.state]}</span><small>{game.id}</small></button></li>)}</ul>:<div className="notice">Игр пока нет.</div>:<p role="status">Загружаем игры…</p>}
      {page?.nextCursor&&<button className="button outline" disabled={busy} onClick={()=>void run(async()=>{const next=await adminRequest<Page>("games?cursor="+page.nextCursor);if(alive.current)setPage(next);})}>Следующие игры</button>}
    </>:<><button className="button outline" disabled={busy||uncertain} onClick={()=>{setDetail(null);void run(async()=>{const next=await adminRequest<Page>("games");if(alive.current)setPage(next);});}}>К списку игр</button>
      <h3>{detail.title}</h3><dl><dt>Состояние игры</dt><dd>{statuses[detail.status]??detail.status}</dd><dt>Доступ</dt><dd>{states[detail.moderation.state]}{detail.moderation.requestsLocked?" · Новые заявки закрыты":""}</dd><dt>Версии игры и модерации</dt><dd>{detail.gameVersion} / {detail.moderation.version}</dd></dl>
      <form onSubmit={event=>{event.preventDefault();void submit();}}>
        <label className="form-field"><span>Действие</span><select aria-label="Действие" value={action} disabled={busy||uncertain} onChange={event=>{setAction(event.target.value as Action);setConfirmed(false);}}>{Object.entries(actions).map(([key,label])=><option key={key} value={key} disabled={key==="force_cancel"&&!["draft","published"].includes(detail.status)}>{label}</option>)}</select></label>
        <label className="form-field"><span>Код причины</span><input value={reason} disabled={busy||uncertain} maxLength={64} pattern="[a-z][a-z0-9_]{2,63}" required onChange={event=>setReason(event.target.value)} /><small>От 3 до 64 символов: латинские буквы, цифры и подчёркивание.</small></label>
        {action==="force_cancel"&&<div className="notice danger">Отмена завершит активные заявки и приглашения и закроет чат. История сохранится. Восстановление доступа не вернёт игру.</div>}
        {action==="restore_moderation"&&<div className="notice">Восстановится только доступ и приём новых заявок. Состояние игры и прежние решения об участии сохранятся.</div>}
        {["takedown","force_cancel"].includes(action)&&!fresh&&<div className="notice"><p>Для этого действия подтвердите вход.</p><button type="button" className="button outline" disabled={busy} onClick={()=>void stepup()}>Подтвердить вход ключом</button></div>}
        <label className="confirmation"><input type="checkbox" checked={confirmed} disabled={busy||uncertain} onChange={event=>setConfirmed(event.target.checked)} /> Подтверждаю выбранное действие</label>
        <div className="actions"><button className="button" disabled={busy||uncertain||(action==="force_cancel"&&!["draft","published"].includes(detail.status))||!confirmed||!/^[a-z][a-z0-9_]{2,63}$/.test(reason)||(["takedown","force_cancel"].includes(action)&&!fresh)}>{busy?"Сохраняем…":"Выполнить действие"}</button></div>
      </form>
      <h3>История модерации</h3>{detail.history.length?<ol className="events">{detail.history.map(item=><li key={item.id}><strong>{actions[item.action as Action]??item.action}</strong><span>{item.reasonCode} · {statuses[item.after.status]??item.after.status}</span><small>{new Date(item.createdAt).toLocaleString("ru-RU")}</small><small>Событие журнала: {item.auditId}</small></li>)}</ol>:<div className="notice">Действий модерации пока нет.</div>}
      {detail.nextHistoryCursor&&<button className="button outline" disabled={busy} onClick={()=>void moreHistory()}>Более ранние действия</button>}
    </>}
  </>;
}

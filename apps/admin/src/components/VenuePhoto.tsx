"use client";
import { useEffect, useRef, useState } from "react";
import { adminPath } from "../lib/admin-path";
import { AdminError, errorMessage, type Session } from "../lib/admin-client";
import { preprocessAvatar } from "../lib/avatar-preprocess";
type Receipt = { version:number; hasCover:boolean; cover:{uploadedUrl:string|null} };
export function VenuePhoto({id,session,changed,authorityLoss,stepup,onBusy}:{id:string;session:Session;changed:()=>Promise<void>;authorityLoss:()=>void;stepup:()=>Promise<void>;onBusy:(busy:boolean)=>void}) {
 const preparation=useRef<AbortController|null>(null);
 const [readAttempt,setReadAttempt]=useState(0),[reading,setReading]=useState(true);
 useEffect(()=>()=>preparation.current?.abort(),[]);
 const [receipt,setReceipt]=useState<Receipt|null>(null),[blob,setBlob]=useState<Blob|null>(null),[preview,setPreview]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[confirm,setConfirm]=useState(false);
 const [pending,setPending]=useState<{method:"PUT"|"DELETE";body:Blob|string;key:string;version:number}|null>(null);
 useEffect(()=>{onBusy(busy||reading||!!pending);return()=>onBusy(false);},[busy,reading,pending,onBusy]);
 useEffect(()=>{if(!blob){setPreview("");return;}const url=URL.createObjectURL(blob);setPreview(url);return()=>URL.revokeObjectURL(url);},[blob]);
 function fail(e:unknown){if(e instanceof AdminError&&[401,403].includes(e.status)&&e.code!=="ADMIN_STEP_UP_REQUIRED")authorityLoss();setError(errorMessage(e));}
 useEffect(()=>{
  const controller=new AbortController();
  // One bounded GET per mount or explicit retry; no automatic retry loop.
  const timeout=setTimeout(()=>controller.abort(new DOMException("Read timed out","TimeoutError")),20000);
  let active=true;
  setReading(true);setError("");
  void fetch(adminPath(`/v1/admin/venues/${id}/cover`),{credentials:"same-origin",cache:"no-store",signal:controller.signal}).then(async r=>{
   if(!r.ok){const p=await r.json().catch(()=>({}));throw new AdminError(p.code??"ADMIN_REQUEST_FAILED",r.status);}
   const next:Receipt=await r.json();if(active)setReceipt(next);
  }).catch(e=>{if(active)fail(e);}).finally(()=>{clearTimeout(timeout);if(active)setReading(false);});
  return()=>{active=false;clearTimeout(timeout);controller.abort();};
 // The component is keyed by venue and version by its parent.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[id,readAttempt]);
 async function confirmAccess(){
  if(busy||reading||pending)return;
  setBusy(true);setError("");
  try{await stepup();setReadAttempt(attempt=>attempt+1);}catch(e){fail(e);}finally{setBusy(false);}
 }
 async function select(file:File){setBusy(true);setError("");setBlob(null);try{const controller=new AbortController();preparation.current=controller;setBlob(await preprocessAvatar(file,controller.signal,{x:.5,y:.5}));}catch(e){setError(e instanceof Error?e.message:errorMessage(e));}finally{setBusy(false);}}
 async function save(method:"PUT"|"DELETE"){
  if(busy||reading||!receipt)return;
  const operation=pending??{method,body:method==="PUT"?blob!:JSON.stringify({expectedVersion:receipt.version}),key:crypto.randomUUID(),version:receipt.version};
  if(!operation.body)return;
  setBusy(true);setPending(operation);setError("");setNotice("");
  try{
   const response=await fetch(adminPath(`/v1/admin/venues/${id}/cover`),{method:operation.method,credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(20000),headers:{"Content-Type":operation.body instanceof Blob?operation.body.type:"application/json","X-CSRF-Token":session.csrfToken,"Idempotency-Key":operation.key,"X-Venue-Version":String(operation.version)},body:operation.body});
   if(!response.ok){const p=await response.json().catch(()=>({}));throw new AdminError(p.code??"ADMIN_REQUEST_FAILED",response.status);}
   setReceipt(await response.json());setBlob(null);setConfirm(false);setPending(null);setNotice("Фото сохранено.");await changed();
  }catch(e){if(e instanceof AdminError)setPending(null);fail(e);}finally{setBusy(false);}
 }
 return <div className="panel"><h3>Фото этой площадки</h3>{error&&<div className="notice danger" role="alert">{error}<p>При ошибке проверки изображения прежнее фото сохраняется. Можно повторить попытку.</p><button className="button outline" disabled={busy||reading||!!pending} onClick={()=>void confirmAccess()}>Подтвердить вход</button></div>}{notice&&<p role="status">{notice}</p>}
 {!receipt&&!reading&&<button className="button outline" disabled={busy||!!pending} onClick={()=>setReadAttempt(attempt=>attempt+1)}>Повторить загрузку фото</button>}
 {receipt?.cover.uploadedUrl?<img className="venue-cover" src={receipt.cover.uploadedUrl} alt="Текущее фото площадки"/>:<div className="notice">{receipt?"Нет опубликованного фото — используется стандартная обложка.":reading?"Загрузка текущего фото…":"Текущее фото не загружено. Повторите загрузку."}</div>}
 <label className="form-field"><span>Выбрать JPEG, PNG или WebP (до 10 МБ)</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||reading||!!pending||!receipt} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void select(file);}}/></label>
 {preview&&<><img className="venue-cover" src={preview} alt="Предпросмотр нового фото"/><p>Предпросмотр. Публикация — после проверки изображения сервером.</p></>}
 {reading&&<p role="status">Загрузка текущего фото…</p>}{busy&&<p role="status">Подготовка, подтверждение входа или сохранение фото…</p>}
 <div className="actions"><button className="button" disabled={busy||reading||!blob||!!pending} onClick={()=>void save("PUT")}>Загрузить / заменить</button><button className="button outline" disabled={busy||reading||!blob||!!pending} onClick={()=>setBlob(null)}>Отменить выбор</button><button className="button outline" disabled={busy||reading||!receipt?.hasCover||!!pending} onClick={()=>setConfirm(true)}>Удалить фото</button></div>
 {confirm&&<div className="notice"><p>Удалить фото именно этой площадки? Будет использоваться стандартная обложка.</p><div className="actions"><button className="button" disabled={busy} onClick={()=>void save("DELETE")}>Подтвердить удаление</button><button className="button outline" disabled={busy} onClick={()=>setConfirm(false)}>Отмена</button></div></div>}
 {pending&&!busy&&<div className="notice"><p>Ответ не получен. Повторите то же действие для получения результата.</p><button className="button" onClick={()=>void save(pending.method)}>Повторить то же действие</button></div>}
 </div>;
}

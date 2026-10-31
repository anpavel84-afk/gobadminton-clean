"use client";
import { useEffect, useRef, useState } from "react";
import { adminPath } from "../lib/admin-path";
import { AdminError, errorMessage, type Session } from "../lib/admin-client";
import { preprocessAvatar } from "../lib/avatar-preprocess";

type GalleryItem = {
  id: string;
  position: number;
  isMain: boolean;
  kind: "photo" | "logo" | "illustration";
  uploadedUrl: string | null;
  credit: { kind: "photo" | "logo" | "illustration"; text: string; url: string | null };
  sourceUrl: string | null;
  sourceAuthor: string | null;
  permissionBasis: string;
  sourceFingerprint: string | null;
};
type Receipt = { version: number; items: GalleryItem[] };
type Pending =
  | { method: "POST"; path: string; body: Blob; key: string; version: number; headers: Record<string, string> }
  | { method: "PUT"; path: string; body: Blob; key: string; version: number; headers: Record<string, string> }
  | { method: "DELETE" | "POST"; path: string; body: string; key: string; version: number; headers: Record<string, string> };

const MAX = 8;
const emptyEvidence = {
  creditKind: "illustration" as const,
  creditText: "Иллюстрация",
  creditUrl: "",
  sourceUrl: "",
  sourceAuthor: "",
  permissionBasis: "",
  sourceFingerprint: "",
};

export function VenuePhoto({id,session,changed,authorityLoss,stepup,onBusy}:{id:string;session:Session;changed:()=>Promise<void>;authorityLoss:()=>void;stepup:()=>Promise<void>;onBusy:(busy:boolean)=>void}) {
 const preparation=useRef<AbortController|null>(null);
 const [readAttempt,setReadAttempt]=useState(0),[reading,setReading]=useState(true);
 useEffect(()=>()=>preparation.current?.abort(),[]);
 const [receipt,setReceipt]=useState<Receipt|null>(null);
 const [queue,setQueue]=useState<Blob[]>([]);
 const [evidence,setEvidence]=useState(emptyEvidence);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [confirmId,setConfirmId]=useState<string|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);
 const [preview,setPreview]=useState("");
 useEffect(()=>{onBusy(busy||reading||!!pending||queue.length>0);return()=>onBusy(false);},[busy,reading,pending,queue.length,onBusy]);
 useEffect(()=>{
  if(!queue[0]){setPreview("");return;}
  const url=URL.createObjectURL(queue[0]);setPreview(url);return()=>URL.revokeObjectURL(url);
 },[queue]);
 function fail(e:unknown){if(e instanceof AdminError&&[401,403].includes(e.status)&&e.code!=="ADMIN_STEP_UP_REQUIRED")authorityLoss();setError(errorMessage(e));}
 useEffect(()=>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new DOMException("Read timed out","TimeoutError")),20000);
  let active=true;
  setReading(true);setError("");
  void fetch(adminPath(`/v1/admin/venues/${id}/gallery`),{credentials:"same-origin",cache:"no-store",signal:controller.signal}).then(async r=>{
   if(!r.ok){const p=await r.json().catch(()=>({}));throw new AdminError(p.code??"ADMIN_REQUEST_FAILED",r.status);}
   const next:Receipt=await r.json();if(active)setReceipt(next);
  }).catch(e=>{if(active)fail(e);}).finally(()=>{clearTimeout(timeout);if(active)setReading(false);});
  return()=>{active=false;clearTimeout(timeout);controller.abort();};
 },[id,readAttempt]);
 async function confirmAccess(){
  if(busy||reading)return;
  setBusy(true);setError("");
  try{await stepup();if(!pending)setReadAttempt(attempt=>attempt+1);}catch(e){fail(e);}finally{setBusy(false);}
 }
 async function select(files:FileList|null){
  if(!files||!receipt)return;
  const remaining=MAX-receipt.items.length-queue.length;
  if(remaining<=0){setError("У площадки уже максимум 8 изображений.");return;}
  setBusy(true);setError("");
  try{
   const controller=new AbortController();preparation.current=controller;
   const next:Blob[]=[];
   for(const file of Array.from(files).slice(0,remaining)){
    next.push(await preprocessAvatar(file,controller.signal,{x:.5,y:.5}));
   }
   setQueue(current=>[...current,...next].slice(0,remaining+queue.length));
  }catch(e){setError(e instanceof Error?e.message:errorMessage(e));}finally{setBusy(false);}
 }
 function evidenceHeaders():Record<string,string>{
  const headers:Record<string,string>={
   "X-Gallery-Credit-Kind":evidence.creditKind,
   "X-Gallery-Credit-Text":evidence.creditText,
   "X-Gallery-Permission-Basis":evidence.permissionBasis.trim(),
  };
  if(evidence.creditUrl.trim())headers["X-Gallery-Credit-Url"]=evidence.creditUrl.trim();
  else headers["X-Gallery-Credit-Url"]="null";
  if(evidence.sourceUrl.trim())headers["X-Gallery-Source-Url"]=evidence.sourceUrl.trim();
  else headers["X-Gallery-Source-Url"]="null";
  if(evidence.sourceAuthor.trim())headers["X-Gallery-Source-Author"]=evidence.sourceAuthor.trim();
  else headers["X-Gallery-Source-Author"]="null";
  if(evidence.sourceFingerprint.trim())headers["X-Gallery-Source-Fingerprint"]=evidence.sourceFingerprint.trim().toLowerCase();
  else headers["X-Gallery-Source-Fingerprint"]="null";
  return headers;
 }
 async function run(operation:Pending){
  if(busy||reading||!receipt)return;
  setBusy(true);setPending(operation);setError("");setNotice("");
  try{
   const response=await fetch(adminPath(operation.path),{
    method:operation.method,credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(20000),
    headers:{
     "Content-Type":operation.body instanceof Blob?operation.body.type:"application/json",
     "X-CSRF-Token":session.csrfToken,
     "Idempotency-Key":operation.key,
     "X-Venue-Version":String(operation.version),
     ...operation.headers,
    },
    body:operation.body,
   });
   if(!response.ok){const p=await response.json().catch(()=>({}));throw new AdminError(p.code??"ADMIN_REQUEST_FAILED",response.status);}
   setReceipt(await response.json());setConfirmId(null);setPending(null);setNotice("Галерея сохранена.");
   if(operation.method==="POST"&&operation.path.endsWith("/gallery")&&operation.body instanceof Blob){
    setQueue(current=>current.slice(1));
   }
   await changed();
  }catch(e){
   if(e instanceof AdminError&&e.status<500&&e.status!==408&&e.code!=="ADMIN_UPSTREAM_UNAVAILABLE"&&e.code!=="ADMIN_STEP_UP_REQUIRED")setPending(null);
   fail(e);
  }finally{setBusy(false);}
 }
 async function uploadNext(){
  if(!receipt||!queue[0]||!evidence.permissionBasis.trim()){setError("Укажите основание права на изображение.");return;}
  const blob=queue[0];
  const operation:Pending={
   method:"POST",path:`/v1/admin/venues/${id}/gallery`,body:blob,key:crypto.randomUUID(),version:receipt.version,
   headers:evidenceHeaders(),
  };
  await run(operation);
 }
 async function remove(itemId:string){
  if(!receipt)return;
  await run({
   method:"DELETE",path:`/v1/admin/venues/${id}/gallery/${itemId}`,
   body:JSON.stringify({expectedVersion:receipt.version}),key:crypto.randomUUID(),version:receipt.version,headers:{},
  });
 }
 async function setMain(itemId:string){
  if(!receipt)return;
  await run({
   method:"POST",path:`/v1/admin/venues/${id}/gallery/${itemId}/main`,
   body:JSON.stringify({expectedVersion:receipt.version}),key:crypto.randomUUID(),version:receipt.version,headers:{},
  });
 }
 async function move(itemId:string,delta:-1|1){
  if(!receipt)return;
  const ordered=receipt.items.map(item=>item.id);
  const index=ordered.indexOf(itemId);
  const swap=index+delta;
  if(index<0||swap<0||swap>=ordered.length)return;
  const next=[...ordered];
  const temp=next[index]!;next[index]=next[swap]!;next[swap]=temp;
  await run({
   method:"POST",path:`/v1/admin/venues/${id}/gallery/reorder`,
   body:JSON.stringify({expectedVersion:receipt.version,orderedIds:next}),key:crypto.randomUUID(),version:receipt.version,headers:{},
  });
 }
 const remaining=receipt?Math.max(0,MAX-receipt.items.length-queue.length):0;
 return <div className="panel"><h3>Галерея площадки</h3>
 {error&&<div className="notice danger" role="alert">{error}<p>При ошибке проверки изображения прежние файлы сохраняются. Можно повторить попытку.</p><button className="button outline" disabled={busy||reading} onClick={()=>void confirmAccess()}>Подтвердить вход</button></div>}
 {notice&&<p role="status">{notice}</p>}
 {!receipt&&!reading&&<button className="button outline" disabled={busy||!!pending} onClick={()=>setReadAttempt(attempt=>attempt+1)}>Повторить загрузку галереи</button>}
 {receipt&&<ol className="venue-gallery-admin">{receipt.items.map(item=><li key={item.id}>
  {item.uploadedUrl?<img className="venue-cover" src={item.uploadedUrl} alt={item.credit.text}/>:<div className="notice">Нет опубликованного файла</div>}
  <p><strong>{item.isMain?"Основное · ":""}{item.kind==="photo"?"Фото":item.kind==="logo"?"Логотип":"Иллюстрация"}</strong></p>
  <p>{item.credit.text}{item.credit.url?` · ${item.credit.url}`:""}</p>
  <p>Источник: {item.sourceUrl??"не указан"}{item.sourceAuthor?` · ${item.sourceAuthor}`:""}</p>
  <p>Основание: {item.permissionBasis}</p>
  <div className="actions">
   <button type="button" className="button outline" disabled={busy||reading||!!pending||item.position===0} onClick={()=>void move(item.id,-1)}>↑</button>
   <button type="button" className="button outline" disabled={busy||reading||!!pending||item.position>=receipt.items.length-1} onClick={()=>void move(item.id,1)}>↓</button>
   <button type="button" className="button outline" disabled={busy||reading||!!pending||item.isMain} onClick={()=>void setMain(item.id)}>Сделать основным</button>
   <button type="button" className="button outline" disabled={busy||reading||!!pending} onClick={()=>setConfirmId(item.id)}>Удалить</button>
  </div>
  {confirmId===item.id&&<div className="notice"><p>Удалить это изображение площадки?</p><div className="actions"><button className="button" disabled={busy} onClick={()=>void remove(item.id)}>Подтвердить удаление</button><button className="button outline" disabled={busy} onClick={()=>setConfirmId(null)}>Отмена</button></div></div>}
 </li>)}</ol>}
 {receipt&&receipt.items.length===0&&<div className="notice">Нет изображений — используется стандартная обложка.</div>}
 <label className="form-field"><span>Выбрать JPEG, PNG или WebP (до {remaining} из 8)</span>
  <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy||reading||!!pending||!receipt||remaining<=0}
   onChange={e=>{const files=e.target.files;e.target.value="";void select(files);}}/></label>
 {preview&&<><img className="venue-cover" src={preview} alt="Предпросмотр нового изображения"/><p>В очереди: {queue.length}. Публикация — после проверки изображения сервером.</p></>}
 <fieldset className="venue-gallery-evidence" disabled={busy||reading||!!pending||!receipt}>
  <legend>Источник и основание права (без выдуманной лицензии)</legend>
  <label className="form-field"><span>Тип</span><select value={evidence.creditKind} onChange={e=>{
   const creditKind=e.target.value as typeof evidence.creditKind;
   setEvidence(current=>({...current,creditKind,creditText:creditKind==="illustration"?"Иллюстрация":creditKind==="photo"?"Фото: ": "Логотип: ",creditUrl:creditKind==="illustration"?"":current.creditUrl}));
  }}><option value="photo">Фото</option><option value="logo">Логотип</option><option value="illustration">Иллюстрация</option></select></label>
  <label className="form-field"><span>Подпись кредита</span><input value={evidence.creditText} onChange={e=>setEvidence({...evidence,creditText:e.target.value})}/></label>
  <label className="form-field"><span>URL кредита (HTTPS, для фото/логотипа)</span><input value={evidence.creditUrl} onChange={e=>setEvidence({...evidence,creditUrl:e.target.value})}/></label>
  <label className="form-field"><span>URL источника (HTTPS, обязателен для фото)</span><input value={evidence.sourceUrl} onChange={e=>setEvidence({...evidence,sourceUrl:e.target.value})}/></label>
  <label className="form-field"><span>Автор источника</span><input value={evidence.sourceAuthor} onChange={e=>setEvidence({...evidence,sourceAuthor:e.target.value})}/></label>
  <label className="form-field"><span>Основание права</span><input value={evidence.permissionBasis} onChange={e=>setEvidence({...evidence,permissionBasis:e.target.value})}/></label>
  <label className="form-field"><span>Отпечаток источника (sha256, необязательно)</span><input value={evidence.sourceFingerprint} onChange={e=>setEvidence({...evidence,sourceFingerprint:e.target.value})}/></label>
 </fieldset>
 {reading&&<p role="status">Загрузка текущей галереи…</p>}{busy&&<p role="status">Подготовка, подтверждение входа или сохранение…</p>}
 <div className="actions">
  <button className="button" disabled={busy||reading||!queue[0]||!!pending||!receipt} onClick={()=>void uploadNext()}>Загрузить следующее</button>
  <button className="button outline" disabled={busy||reading||queue.length===0||!!pending} onClick={()=>setQueue([])}>Очистить очередь</button>
 </div>
 {pending&&!busy&&<div className="notice"><p>Ответ не получен. Повторите то же действие для получения результата.</p><button className="button" onClick={()=>void run(pending)}>Повторить то же действие</button></div>}
 </div>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { preprocessAvatar } from "../../../lib/avatar-preprocess";
import { venueCoverRequest, VenueCoverError, type VenueCoverAccess, type VenueCoverReceipt } from "../../../lib/venue-cover-api";
import { Button } from "../Button";
import { VenueCover } from "./VenueCover";
/** The access response authorizes display; every write still checks server authority. */
export function VenueCoverEditor({venueId,onChange}:{venueId:string;onChange:(receipt:VenueCoverReceipt)=>void}) {
  const [access,setAccess]=useState<VenueCoverAccess|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [crop,setCrop]=useState({x:.5,y:.5});
  const [draft,setDraft]=useState<{blob:Blob;url:string}|null>(null);
  const [preparing,setPreparing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const [message,setMessage]=useState("");
  const pending=useRef<AbortController|null>(null);
  const locked=useRef(false);
  const mounted=useRef(false);
  const change=useRef(onChange); change.current=onChange;
  useEffect(()=>{
    mounted.current=true; const controller=new AbortController();pending.current=controller;
    const timer=setTimeout(()=>controller.abort(),15000);
    void venueCoverRequest<VenueCoverAccess>(venueId,"GET",controller.signal).then(value=>{
      if (!controller.signal.aborted) setAccess(value);
    }).catch(()=>{/* no controls for an unverified editor */}).finally(()=>clearTimeout(timer));
    return ()=>{mounted.current=false;controller.abort();pending.current?.abort();};
  },[venueId]);
  useEffect(()=>{
    if (!file) {setDraft(null);return;}
    const controller=new AbortController();let url:string|undefined;
    setDraft(null);setPreparing(true);setMessage("");
    void preprocessAvatar(file,controller.signal,crop).then(blob=>{
      if (controller.signal.aborted) return;
      url=URL.createObjectURL(blob);setDraft({blob,url});
    }).catch(()=>{if(!controller.signal.aborted)setMessage("Не удалось подготовить фото. Выберите JPEG, PNG или WebP до 10 МБ.");})
      .finally(()=>{if(!controller.signal.aborted)setPreparing(false);});
    return ()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
  },[file,crop]);
  async function run(action:"refresh"|"save"|"delete") {
    if (!access || locked.current || preparing || (action!=="refresh" && uncertain)) return;
    if (action === "save" && !draft) return;
    locked.current=true;setBusy(true);setMessage("");
    const controller=new AbortController();pending.current=controller;
    const timer=setTimeout(()=>controller.abort(),20000);
    try {
      if (action === "refresh") {
        const fresh=await venueCoverRequest<VenueCoverAccess>(venueId,"GET",controller.signal);
        if(!mounted.current)return;
        if(fresh.version < access.version)throw new Error("stale");
        setAccess(fresh);setUncertain(false);change.current(fresh);setMessage("Данные обновлены. Выбранное фото сохранено для подтверждения.");
      } else {
        const receipt=await venueCoverRequest<VenueCoverReceipt>(venueId,action==="save"?"PUT":"DELETE",controller.signal,access,action==="save"?draft?.blob:undefined);
        if(!mounted.current)return;
        setAccess({...receipt,csrfToken:access.csrfToken});change.current(receipt);setFile(null);setDraft(null);setMessage("Обложка сохранена.");
      }
    } catch(error) {
      if(!mounted.current)return;
      if(error instanceof VenueCoverError && [401,403,404].includes(error.status)){setAccess(null);setFile(null);setDraft(null);}
      else setUncertain(true);
      setMessage("Результат не подтверждён. Обновите данные перед повторным сохранением.");
    } finally { clearTimeout(timer);locked.current=false;if(mounted.current)setBusy(false); }
  }
  if(!access)return message?<p role="alert">Редактирование недоступно. Обновите страницу после проверки входа и прав.</p>:null;
  return <section className="gb-venue-editor" aria-label="Редактирование обложки" aria-busy={busy||preparing}>
    <h2>Обложка площадки</h2>
    <p>Фото будет публичным, в том числе в играх на этой площадке.</p>
    <label className="gb-game-field">Выберите JPEG, PNG или WebP<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setCrop({x:.5,y:.5});e.target.value="";}} /></label>
    {file && <>
      <label className="gb-game-field">По горизонтали<input type="range" min="0" max="1" step=".01" value={crop.x} disabled={busy} onChange={e=>setCrop({...crop,x:Number(e.target.value)})}/></label>
      <label className="gb-game-field">По вертикали<input type="range" min="0" max="1" step=".01" value={crop.y} disabled={busy} onChange={e=>setCrop({...crop,y:Number(e.target.value)})}/></label>
      <p>Предпросмотр: широкая обложка обрезается по центру внутри карточек.</p>
      <div className="gb-venue-media">{draft?<img src={draft.url} alt="Предпросмотр обложки" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<VenueCover/>}</div>
    </>}
    <p role="status">{busy?"Проверяем и сохраняем…":preparing?"Подготавливаем фото…":message}</p>
    <div className="gb-venue-editor__actions">
      <Button disabled={busy||preparing||uncertain||!draft} onClick={()=>void run("save")}>Подтвердить обложку</Button>
      <Button variant="outline" disabled={busy||preparing||uncertain||!access.cover.uploadedUrl} onClick={()=>void run("delete")}>Удалить обложку</Button>
      <Button variant="ghost" disabled={busy||preparing} onClick={()=>void run("refresh")}>Обновить данные</Button>
    </div>
  </section>;
}

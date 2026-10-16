"use client";
import { useEffect, useState } from "react";
import { preprocessAvatar } from "../../../lib/avatar-preprocess";
import { Button } from "../Button";
/** Bounded Forms + media/image composition; guide availability gap is in Issue47 handoff. */
export function GamePhotoSelection({onChange,onReady,disabled=false}:{onChange:(blob:Blob|null)=>void;onReady:(ready:boolean)=>void;disabled?:boolean}){
  const [file,setFile]=useState<File|null>(null);
  const [crop,setCrop]=useState({x:.5,y:.5});
  const [draft,setDraft]=useState<{blob:Blob;url:string}|null>(null);
  const [preparing,setPreparing]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    if(!file){setDraft(null);return;}
    const controller=new AbortController();let url:string|undefined;
    setPreparing(true);setDraft(null);
    void preprocessAvatar(file,controller.signal,crop).then(blob=>{
      if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setDraft({blob,url});
    }).catch(()=>{if(!controller.signal.aborted)setMessage("Не удалось подготовить фото. Выберите JPEG, PNG или WebP до 10 МБ и повторите.");})
      .finally(()=>{if(!controller.signal.aborted)setPreparing(false);});
    return ()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
  },[file,crop]);
  function invalidate(){onChange(null);onReady(false);setMessage("");}
  return <section className="gb-game-form-group" aria-label="Фото этой игры" aria-busy={preparing}>
    <h2 className="gb-game-form-group-title">Фото этой игры · необязательно</h2>
    <p>Без своего фото используется текущая одобренная обложка выбранной площадки, а если её нет — стандартная. Своё фото относится только к этой игре и не меняет площадку или другие игры.</p>
    <label className="gb-game-field">JPEG, PNG или WebP<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={e=>{const next=e.target.files?.[0];e.target.value="";if(next){invalidate();setFile(next);setCrop({x:.5,y:.5});}}}/></label>
    {file && <>
      <label className="gb-game-field">По горизонтали<input type="range" min="0" max="1" step=".01" value={crop.x} disabled={disabled} onChange={e=>{invalidate();setCrop({...crop,x:Number(e.target.value)});}}/></label>
      <label className="gb-game-field">По вертикали<input type="range" min="0" max="1" step=".01" value={crop.y} disabled={disabled} onChange={e=>{invalidate();setCrop({...crop,y:Number(e.target.value)});}}/></label>
      {draft && <div className="gb-venue-media"><img src={draft.url} alt="Предпросмотр фото игры" style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>}
      <p>В карточках будет показан широкий центральный фрагмент. Перед сохранением фото проверяется сервером.</p>
      <Button type="button" disabled={disabled||preparing||!draft} onClick={()=>{if(draft){onChange(draft.blob);onReady(true);setMessage("Фото выбрано. Оно будет проверено при сохранении игры.");}}}>Подтвердить выбор фото</Button>
    </>}
    <Button type="button" variant="outline" disabled={disabled} onClick={()=>{setFile(null);setDraft(null);onChange(null);onReady(true);setMessage("Используется текущая обложка площадки или стандартная.");}}>Без своего фото</Button>
    <p role="status">{preparing?"Подготавливаем фото…":message}</p>
  </section>;
}

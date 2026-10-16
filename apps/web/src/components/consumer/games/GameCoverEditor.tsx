"use client";
import { useEffect, useRef, useState } from "react";
import { gameCoverRequest, GameCoverError, type GameCoverReceipt } from "../../../lib/game-cover-api";
import { GamePhotoSelection } from "./GamePhotoSelection";
import { Button } from "../Button";
export function GameCoverEditor({gameId,csrfToken,onChange}:{gameId:string;csrfToken:string;onChange:()=>void}){
  const [access,setAccess]=useState<GameCoverReceipt|null>(null);
  const [blob,setBlob]=useState<Blob|null>(null),[ready,setReady]=useState(true),[busy,setBusy]=useState(false);
  const [uncertain,setUncertain]=useState(false),[message,setMessage]=useState("");
  const [generation,setGeneration]=useState(0);
  const pending=useRef<AbortController|null>(null),locked=useRef(false),mounted=useRef(false);
  useEffect(()=>{
    mounted.current=true;const c=new AbortController();pending.current=c;const timer=setTimeout(()=>c.abort(),15000);
    void gameCoverRequest(gameId,"GET",c.signal).then(setAccess).catch(()=>setMessage("Редактирование фото недоступно. Обновите страницу и проверьте вход.")).finally(()=>clearTimeout(timer));
    return ()=>{mounted.current=false;c.abort();pending.current?.abort();};
  },[gameId,csrfToken]);
  async function run(action:"refresh"|"save"|"delete"){
    if(!access||locked.current||(action!=="refresh"&&uncertain))return;
    locked.current=true;setBusy(true);setMessage("");const c=new AbortController();pending.current=c;const timer=setTimeout(()=>c.abort(),20000);
    try{
      const next=await gameCoverRequest(gameId,action==="refresh"?"GET":action==="save"?"PUT":"DELETE",c.signal,{version:access.version,csrfToken},action==="save"?blob??undefined:undefined);
      if(!mounted.current)return;
      setAccess(next);setUncertain(false);if(action!=="refresh")onChange();
      if(action!=="refresh"){setBlob(null);setReady(true);setGeneration(n=>n+1);}
      setMessage(action==="refresh"?"Данные обновлены. Можно повторить сохранение.":action==="delete"?"Своё фото удалено. Используется текущая обложка площадки или стандартная.":"Фото игры проверено и сохранено.");
    }catch(error){
      if(!mounted.current)return;
      if(error instanceof GameCoverError&&[401,403,404].includes(error.status)){setAccess(null);setBlob(null);}
      setUncertain(true);setMessage("Сохранение не подтверждено. Обновите данные перед повторной попыткой; игра не публикуется автоматически.");
    }finally{clearTimeout(timer);locked.current=false;if(mounted.current)setBusy(false);}
  }
  if(!access)return <p role="status">{message||"Проверяем право изменения фото…"}</p>;
  return <section aria-label="Управление фото игры" aria-busy={busy}>
    <GamePhotoSelection key={generation} onChange={setBlob} onReady={setReady} disabled={busy}/>
    <p role="status">{busy?"Проверяем и сохраняем фото…":message}</p>
    <Button disabled={busy||uncertain||!ready||!blob} onClick={()=>void run("save")}>Сохранить фото игры</Button>
    <Button variant="outline" disabled={busy||uncertain||!access.hasCover} onClick={()=>void run("delete")}>Удалить своё фото</Button>
    <Button variant="ghost" disabled={busy} onClick={()=>void run("refresh")}>Обновить данные</Button>
  </section>;
}

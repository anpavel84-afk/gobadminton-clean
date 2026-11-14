"use client";
import { useEffect, useRef, useState } from "react";
import { getMe } from "../../../lib/api-client";
import { nativeBridgeCommand } from "../../../lib/native-auth";
import { AuthChooser } from "./ProfileComposition";
import { Button } from "../Button";

type Account = { id: string; displayName: string; csrfToken: string };
export function NativeAuthBridge({ transactionId }: { transactionId: string | null }) {
  const [account,setAccount] = useState<Account|null>(null);
  const [status,setStatus] = useState<"loading"|"ready"|"error"|"cancelled"|"returned">("loading");
  const [chooser,setChooser] = useState(false);
  const [busy,setBusy] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const pending=useRef(false), generation=useRef(0);
  useEffect(()=>{
    const epoch=++generation.current;
    async function load() {
      setStatus("loading");setAccount(null);
      if (!transactionId) { setStatus("error");return; }
      const bound=await nativeBridgeCommand(transactionId,"bind");
      if (epoch!==generation.current) return;
      if (!bound.ok) {setStatus("error");return;}
      // Invalidate stale SSR guest hints before reading the provider/email session.
      window.dispatchEvent(new Event("gb-session-changed"));
      const me=await getMe();
      if (epoch!==generation.current) return;
      if (me.ok) setAccount(me.data);
      else if (me.status!==401) {setStatus("error");return;}
      setStatus("ready");
    }
    void load();
    return ()=>{++generation.current;};
  },[transactionId,attempt]);
  async function command(action:"complete"|"cancel") {
    if (!transactionId || pending.current) return;
    pending.current=true;setBusy(true);
    const result=await nativeBridgeCommand<{callbackUrl?:string}>(transactionId,action,account?.csrfToken);
    if (!result.ok) {setStatus("error");setBusy(false);pending.current=false;return;}
    if (action==="cancel") {setStatus("cancelled");setBusy(false);return;}
    if (!result.data.callbackUrl) {setStatus("error");setBusy(false);return;}
    setStatus("returned");
    window.location.assign(result.data.callbackUrl);
  }
  return <main className="fr3"><section className="profile-section"><h1>Вход в приложение GoBadminton</h1>
    {status==="loading" && <p role="status">Проверяем запрос входа…</p>}
    {status==="error" && <><p role="alert">Не удалось продолжить. Запрос мог истечь или уже использован. Начните новый вход из приложения.</p><Button onClick={()=>setAttempt(n=>n+1)}>Проверить снова</Button></>}
    {status==="cancelled" && <p role="status">Вход отменён. Можно закрыть браузер и вернуться в приложение.</p>}
    {status==="returned" && <p role="status">Вход подтверждён. Вернитесь в приложение. Если переход не состоялся, начните новый вход.</p>}
    {status==="ready" && <>{account ? <><p>Продолжить в приложении как <strong>{account.displayName || "игрок"}</strong>?</p>
      <p>Подтвердите аккаунт перед возвратом в приложение.</p><Button disabled={busy} onClick={()=>void command("complete")}>Вернуться в приложение</Button></>
      : <><p>Войдите в аккаунт, затем подтвердите возврат в приложение.</p><Button disabled={busy} onClick={()=>setChooser(true)}>Войти</Button></>}
      <Button variant="outline" disabled={busy} onClick={()=>void command("cancel")}>Отменить вход</Button></>}
    {chooser && transactionId && <AuthChooser returnPath={`/auth/native?transactionId=${transactionId}`} nativeReturn onClose={()=>setChooser(false)}
      onNativeLogin={()=>{setChooser(false);setAttempt(n=>n+1);}} />}
  </section></main>;
}

"use client";
import { useRef, useState } from "react";
import { copyGameUrl, publicGameUrl, shareGameUrl, type GameShareResult } from "../../../lib/game-share";
import { ProfileDialog } from "../players/ProfileComposition";
import { Button } from "../Button";

export function GameShare({ gameId }: { gameId: string }) {
  const [result, setResult] = useState<GameShareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function act(copy = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setResult(null);
    try {
      const url = publicGameUrl(window.location.origin, gameId);
      setResult(await (copy ? copyGameUrl(url, navigator) : shareGameUrl(url, navigator)));
    } finally { lock.current = false; setBusy(false); }
  }
  return <span className="gb-game-share">
    <button type="button" className="gb-game-share__button" aria-label="Поделиться игрой" title="Поделиться игрой" disabled={busy} onClick={() => void act()}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" /></svg>
    </button>
    {(result === "copied" || result === "shared" || result === "cancelled") && <span className="gb-game-share__notice" role="status">{result === "copied" ? "Ссылка скопирована." : result === "shared" ? "Ссылка отправлена." : "Отправка отменена."}</span>}
    {(result === "fallback" || result === "copy_failed") && <ProfileDialog title="Поделиться игрой" onClose={() => { if (!busy) setResult(null); }}>
      <p role={result === "copy_failed" ? "alert" : "status"}>{result === "copy_failed" ? "Не удалось скопировать ссылку. Вы можете выделить её и скопировать вручную." : "Не удалось открыть отправку. Скопируйте ссылку на игру."}</p>
      <input className="gb-game-share__url" aria-label="Ссылка на игру" readOnly value={publicGameUrl(window.location.origin, gameId)} onFocus={event => event.currentTarget.select()} />
      <Button variant="outline" disabled={busy} onClick={() => void act(true)}>Скопировать ссылку</Button>
    </ProfileDialog>}
  </span>;
}

"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { AbuseReportReasonCode, Me } from "../../../lib/consumer-types";
import { REPORT_REASON_OPTIONS } from "../../../lib/player-presentation";
import { Button } from "../Button";
import { ProfileDialog } from "../players/ProfileComposition";
import { MutationNotice } from "./MessageComposition";
import { useSocialMutation } from "./useSocialMutation";
export function ConversationSafety({ playerId, me, onBlocked, overflow = false }: { playerId: string; me: Me; onBlocked: () => void; overflow?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const [dialog, setDialog] = useState<"block" | "report" | null>(null);
  const [reason, setReason] = useState<AbuseReportReasonCode>("harassment");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);
  const mutation = useSocialMutation<{ blocked?: boolean }>(`${me.id}:safety:${playerId}`, me.csrfToken, result => {
    setOpen(false); setDone(true); if (result.blocked) onBlocked();
  }, () => {});
  function choose(next: "block" | "report") { setOpen(false); trigger.current?.focus(); setDone(false); setDialog(next); }
  const locked = mutation.busy || mutation.pending;
  return <>{overflow ? <div className="conversation-overflow" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="conversation-menu" aria-label="Действия с игроком" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}><span aria-hidden="true">⋯</span></button>
    {open && <div ref={menu} id={menuId} className="conversation-overflow-menu" role="menu" aria-label="Действия с игроком" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index + items.length - 1) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    }}><button type="button" role="menuitem" aria-disabled={locked} className="danger" onClick={() => { if (!locked) choose("block"); }}>Заблокировать</button><button type="button" role="menuitem" aria-disabled={locked} onClick={() => { if (!locked) choose("report"); }}>Пожаловаться</button>{mutation.pending && <button type="button" role="menuitem" aria-disabled={mutation.busy} onClick={() => { if (!mutation.busy) choose(mutation.pendingPath === "/v1/reports" ? "report" : "block"); }}>Проверить отправку</button>}</div>}
  </div> : <><Link href={`/players/${playerId}`}>Профиль</Link><button onClick={() => choose("block")}>Заблокировать</button><button onClick={() => choose("report")}>Пожаловаться</button></>}
    {dialog && <ProfileDialog title={dialog === "block" ? "Заблокировать игрока" : "Пожаловаться"} onClose={() => { if (!mutation.busy) setDialog(null); }}>
      {done ? <p role="status">{dialog === "block" ? "Игрок заблокирован." : "Жалоба отправлена."}</p> : <form onSubmit={e => { e.preventDefault(); if (dialog === "block") mutation.run(`/v1/me/blocks/${encodeURIComponent(playerId)}`, {}, "PUT"); else mutation.run("/v1/reports", { targetKind: "player", targetPublicPlayerId: playerId, reasonCode: reason, detail: detail.trim() || null }); }}>
        <p>Блокировка общения не отменяет участие в играх автоматически.</p>
        {dialog === "report" && <><label className="profile-field">Причина<select value={reason} disabled={mutation.pending || mutation.busy} onChange={e => setReason(e.target.value as AbuseReportReasonCode)}>{REPORT_REASON_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</select></label><label className="profile-field">Подробности<textarea rows={3} maxLength={1000} disabled={mutation.pending || mutation.busy} value={detail} onChange={e => setDetail(e.target.value)} /></label></>}
        <Button type="submit" variant="dark" disabled={mutation.busy || mutation.pending}>Подтвердить</Button>
      </form>}<MutationNotice mutation={mutation} />
    </ProfileDialog>}
  </>;
}

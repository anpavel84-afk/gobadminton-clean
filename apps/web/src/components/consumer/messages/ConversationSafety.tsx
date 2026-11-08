"use client";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AbuseReportReasonCode, Me } from "../../../lib/consumer-types";
import { REPORT_REASON_OPTIONS } from "../../../lib/player-presentation";
import { Button } from "../Button";
import { ProfileDialog } from "../players/ProfileComposition";
import { MutationNotice } from "./MessageComposition";
import { useSocialMutation } from "./useSocialMutation";

export type ReportableMessage = {
  id: string;
  text: string | null;
  contentState: "live" | "tombstoned" | "purged";
  createdAt: string;
  authorPublicPlayerId: string | null;
};

export type MessageReportContext =
  | { kind: "direct"; conversationId: string }
  | { kind: "game"; gameId: string };

export function ConversationSafety({
  playerId,
  me,
  onBlocked,
  overflow = false,
  messages = [],
  reportContext,
}: {
  playerId: string;
  me: Me;
  onBlocked: () => void;
  overflow?: boolean;
  /** Already-loaded conversation history only — never fetched here. */
  messages?: ReportableMessage[];
  reportContext?: MessageReportContext;
}) {
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
  const [reportMode, setReportMode] = useState<"player" | "message">("player");
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [shareConsent, setShareConsent] = useState(false);
  const [done, setDone] = useState(false);
  const selectable = useMemo(
    () =>
      messages.filter(
        (m) =>
          m.authorPublicPlayerId === playerId &&
          m.contentState === "live" &&
          typeof m.text === "string" &&
          m.text.trim().length > 0,
      ),
    [messages, playerId],
  );
  const selected = selectable.find((m) => m.id === selectedMessageId) ?? null;
  const mutation = useSocialMutation<{ blocked?: boolean }>(`${me.id}:safety:${playerId}`, me.csrfToken, result => {
    setOpen(false); setDone(true); if (result.blocked) onBlocked();
  }, () => {});
  function choose(next: "block" | "report") {
    setOpen(false);
    trigger.current?.focus();
    setDone(false);
    setReportMode("player");
    setSelectedMessageId("");
    setShareConsent(false);
    setDialog(next);
  }
  const locked = mutation.busy || mutation.pending;
  const messageModeReady =
    reportMode === "message" &&
    Boolean(reportContext) &&
    Boolean(selected) &&
    shareConsent;
  const canSubmitReport =
    reportMode === "player" || messageModeReady;
  function submitReport() {
    if (reportMode === "message" && reportContext && selected) {
      mutation.run("/v1/reports", {
        targetKind: "message",
        messageId: selected.id,
        reasonCode: reason,
        detail: detail.trim() || null,
        shareMessageWithSupport: true as const,
        ...(reportContext.kind === "direct"
          ? { conversationId: reportContext.conversationId }
          : { gameId: reportContext.gameId }),
      });
      return;
    }
    mutation.run("/v1/reports", {
      targetKind: "player",
      targetPublicPlayerId: playerId,
      reasonCode: reason,
      detail: detail.trim() || null,
    });
  }
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
      {done ? <p role="status">{dialog === "block" ? "Игрок заблокирован." : "Жалоба отправлена."}</p> : <form onSubmit={e => { e.preventDefault(); if (dialog === "block") mutation.run(`/v1/me/blocks/${encodeURIComponent(playerId)}`, {}, "PUT"); else if (canSubmitReport) submitReport(); }}>
        <p>Блокировка общения не отменяет участие в играх автоматически.</p>
        {dialog === "report" && <>
          <fieldset className="profile-field">
            <legend>Тип жалобы</legend>
            <label className="confirmation">
              <input type="radio" name="report-mode" checked={reportMode === "player"} disabled={mutation.pending || mutation.busy} onChange={() => { setReportMode("player"); setSelectedMessageId(""); setShareConsent(false); }} />
              На игрока
            </label>
            <label className="confirmation">
              <input type="radio" name="report-mode" checked={reportMode === "message"} disabled={mutation.pending || mutation.busy || !reportContext || selectable.length === 0} onChange={() => { setReportMode("message"); setShareConsent(false); }} />
              На выбранное сообщение
            </label>
          </fieldset>
          {reportMode === "message" && reportContext ? (
            selectable.length === 0 ? (
              <p role="status">В загруженной переписке нет входящих сообщений этого игрока для точной жалобы. Можно отправить обычную жалобу на игрока.</p>
            ) : (
              <>
                <label className="profile-field">
                  Сообщение
                  <select
                    value={selectedMessageId}
                    disabled={mutation.pending || mutation.busy}
                    onChange={(e) => {
                      setSelectedMessageId(e.target.value);
                      setShareConsent(false);
                    }}
                  >
                    <option value="">Выберите одно сообщение</option>
                    {selectable.map((m) => (
                      <option key={m.id} value={m.id}>
                        {new Date(m.createdAt).toLocaleString("ru-RU")} · {(m.text ?? "").slice(0, 80)}
                        {(m.text ?? "").length > 80 ? "…" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selected ? (
                  <p className="profile-field" data-testid="selected-message-preview">
                    <strong>Выбрано:</strong> {selected.text}
                  </p>
                ) : null}
                <label className="confirmation">
                  <input
                    type="checkbox"
                    checked={shareConsent}
                    disabled={mutation.pending || mutation.busy || !selected}
                    onChange={(e) => setShareConsent(e.target.checked)}
                  />
                  Разрешаю назначенному специалисту прочитать выбранное сообщение только для разбора обращения
                </label>
              </>
            )
          ) : null}
          <label className="profile-field">Причина<select value={reason} disabled={mutation.pending || mutation.busy} onChange={e => setReason(e.target.value as AbuseReportReasonCode)}>{REPORT_REASON_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</select></label>
          <label className="profile-field">Подробности<textarea rows={3} maxLength={1000} disabled={mutation.pending || mutation.busy} value={detail} onChange={e => setDetail(e.target.value)} /></label>
        </>}
        <Button type="submit" variant="dark" disabled={mutation.busy || mutation.pending || (dialog === "report" && !canSubmitReport)}>Подтвердить</Button>
      </form>}<MutationNotice mutation={mutation} />
    </ProfileDialog>}
  </>;
}

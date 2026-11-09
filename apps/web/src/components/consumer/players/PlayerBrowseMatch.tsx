"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PlayInterestReceipt } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import type { ApiResult } from "../../../lib/api-client";
import type { ContactState } from "../../../lib/messaging-types";
import { getContactState } from "../../../lib/messaging-api";
import { foregroundUpdates, privateActor } from "../../../lib/foreground-updates";
import { privateViews } from "../../../lib/private-view";
import { isValidConfirmedPlayInterestReceipt } from "../../../lib/play-interests";
import { contactAction } from "./ContactAction";
import { ProfileDialog } from "./ProfileComposition";
import { CloseButton } from "../CloseButton";
import { MessageGlyph } from "../NavIcon";

export type MatchPlayer = { publicPlayerId: string; displayName: string };
/** Only the two admitted mutation paths create this short-lived notification. */
export type BrowseMatchConfirmation = {
  actor: string;
  privateGeneration: number;
  token: string;
  admittedAt: number;
  peer: MatchPlayer;
  self: MatchPlayer;
  receipt: PlayInterestReceipt;
};

/** Called by the page, never by a card: one ephemeral result and no deferred queue. */
export function usePlayerBrowseMatch(me: Me | null, active: boolean) {
  const actor = me ? privateActor(me) : "";
  const [match, setMatch] = useState<BrowseMatchConfirmation | null>(null);
  const suspended = useRef(false);
  const retiredAt = useRef(-1);
  const previousActive = useRef(active);
  if (active !== previousActive.current) {
    previousActive.current = active;
    if (active) suspended.current = false;
  }
  const current = useRef({ actor, active });
  current.current = { actor, active: active && !suspended.current };
  const visibleMatch = useRef<BrowseMatchConfirmation | null>(null);
  const seen = useRef(new Set<string>());
  const live = useRef(false);
  const dismiss = useCallback(() => { visibleMatch.current = null; setMatch(null); }, []);
  const suspend = useCallback(() => { retiredAt.current = performance.now(); suspended.current = true; current.current.active = false; dismiss(); }, [dismiss]);
  useEffect(() => {
    live.current = true;
    const hidden = () => { if (document.visibilityState === "hidden") { retiredAt.current = performance.now(); dismiss(); } };
    window.addEventListener("gb-session-changed", dismiss);
    window.addEventListener("gb-private-expired", dismiss);
    // Leaving this history entry consumes the result; returning cannot reopen it.
    window.addEventListener("popstate", suspend);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      live.current = false;
      visibleMatch.current = null;
      window.removeEventListener("gb-session-changed", dismiss);
      window.removeEventListener("gb-private-expired", dismiss);
      window.removeEventListener("popstate", suspend);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [dismiss, suspend]);
  useEffect(() => { dismiss(); }, [actor, active, dismiss]);
  const receive = useCallback((value: BrowseMatchConfirmation) => {
    if (!live.current || !isValidConfirmedPlayInterestReceipt(value.receipt) || value.receipt.outcome !== "mutual"
      || !value.token || !value.peer.publicPlayerId || !value.self.publicPlayerId
      || !value.peer.displayName || !value.self.displayName || value.actor !== current.current.actor
      || value.privateGeneration !== privateViews.currentGeneration) return;
    const key = JSON.stringify([value.actor, value.privateGeneration, value.receipt.interestId, value.receipt.version, value.peer.publicPlayerId]);
    if (seen.current.has(key)) return;
    seen.current.add(key); // Suppression consumes the receipt too.
    if (!current.current.active || document.visibilityState === "hidden" || visibleMatch.current
      || !Number.isFinite(value.admittedAt) || value.admittedAt <= retiredAt.current
      || document.querySelector('dialog[open]:not([data-surface="player-browse-mobile-fs"])')) return;
    const captured = { ...value, receipt: { ...value.receipt }, peer: { ...value.peer }, self: { ...value.self } };
    visibleMatch.current = captured;
    setMatch(captured);
  }, []);
  const valid = match && active && match.actor === actor && match.privateGeneration === privateViews.currentGeneration;
  return { match: valid ? match : null, receive, dismiss, suspend };
}

export function matchTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const surface = event.currentTarget.querySelector(".pb-match-shell");
  const controls = [...(surface ?? event.currentTarget).querySelectorAll<HTMLElement>("button:not(:disabled),a[href]")];
  const first = controls[0], last = controls[controls.length - 1];
  if (!first || !last) return;
  const active = document.activeElement as HTMLElement;
  if (event.shiftKey && (active === first || !controls.includes(active))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !controls.includes(active))) { event.preventDefault(); first.focus(); }
}

/** Shared dialog shell on desktop; mobile renders the content in its existing finder dialog. */
export function PlayerBrowseMatchDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { content.current?.querySelector<HTMLElement>(".pb-match-title")?.focus({ preventScroll: true }); }, []);
  return <ProfileDialog title="Дружеский матч" className="pb-match-dialog" describedBy="pb-match-lead" lockBodyScroll onClose={onClose}>
    <div ref={content} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else matchTab(event);
    }}>{children}</div>
  </ProfileDialog>;
}

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] ?? "").join("").toUpperCase(); }

/** Approved Astra composition. Contact permission is an independent, fresh read. */
export function PlayerBrowseMatch({ match, me, onDismiss }: { match: BrowseMatchConfirmation; me: Me; onDismiss: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  const [contact, setContact] = useState<ApiResult<ContactState> | null>(null);
  const [retry, setRetry] = useState(0);
  const contactGeneration = useRef(-1);
  const identity = useRef({ match, actor: privateActor(me) });
  identity.current = { match, actor: privateActor(me) };
  useLayoutEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    setContact(null);
    let live = true;
    const actor = privateActor(me);
    if (match.actor !== actor || match.privateGeneration !== privateViews.currentGeneration) return;
    foregroundUpdates.session(actor);
    const foregroundGeneration = foregroundUpdates.currentGeneration;
    contactGeneration.current = foregroundGeneration;
    let missing: ApiResult<ContactState> | null = null;
    let permitted = false;
    // Unique subscription avoids borrowing a cached permission from the profile/card.
    // The existing foreground owner supplies timeout, cancellation and Retry-After bounds.
    const unsubscribe = foregroundUpdates.subscribe(`contact:${match.peer.publicPlayerId}:match:${match.token}:${retry}`, 15000,
      async ({ signal }) => {
        if (missing) return missing;
        const result = await getContactState(match.peer.publicPlayerId, signal);
        if (!signal.aborted && !result.ok && result.status === 404) missing = result;
        return result;
      }, result => {
        if (!live || identity.current.match !== match || identity.current.actor !== actor
          || match.privateGeneration !== privateViews.currentGeneration) return;
        if (foregroundGeneration !== foregroundUpdates.currentGeneration) { setContact(null); onDismiss(); return; }
        if (result.ok && result.data.targetPublicPlayerId !== match.peer.publicPlayerId) {
          setContact({ ok: false, status: 403, error: "Общение недоступно" });
          if (permitted) { contactGeneration.current = -1; onDismiss(); }
          return;
        }
        const allowed = result.ok && Boolean(contactAction(result.data).href);
        // A permission revoked while this result is visible retires its private payload.
        if (permitted && !allowed && (result.ok || [401, 403, 404].includes(result.status))) {
          contactGeneration.current = -1; setContact(null); onDismiss(); return;
        }
        permitted = allowed;
        setContact(result);
      });
    return () => { live = false; contactGeneration.current = -1; unsubscribe(); };
  }, [match, me.id, me.csrfToken, retry, onDismiss]);
  const valid = match.actor === privateActor(me) && match.privateGeneration === privateViews.currentGeneration
    && contactGeneration.current === foregroundUpdates.currentGeneration;
  const data = valid && contact?.ok && contact.data.targetPublicPlayerId === match.peer.publicPlayerId ? contact.data : null;
  const action = data ? contactAction(data) : null;
  const href = action?.href;
  const pending = data?.state === "pending_incoming" || data?.state === "pending_outgoing";
  const unavailable = Boolean(data && !href) || Boolean(contact && !contact.ok && [401, 403, 404, 429].includes(contact.status));
  const error = Boolean(contact && !contact.ok && !unavailable);
  const label = href ? pending ? "Открыть запрос" : "Написать" : error ? "Повторить проверку" : unavailable ? "Общение недоступно" : "Проверяем…";
  const note = href ? data?.state === "pending_outgoing" ? "Ваш запрос на общение ещё ждёт ответа."
    : data?.state === "pending_incoming" ? "У вас есть запрос на общение от этого игрока."
      : "Начните с приветствия и удобного времени."
    : error ? "Не удалось проверить возможность общения." : unavailable ? "Сейчас написать этому игроку нельзя." : "Проверяем, можно ли начать переписку.";
  const buttonContent = <><MessageGlyph /><span>{label}</span><span className="pb-match-arrow" aria-hidden="true">↗</span></>;
  return <div className="pb-match-shell" data-surface="player-browse-match">
    <header className="pb-match-top"><span>ДАВАЙ СЫГРАЕМ</span><CloseButton aria-label="Закрыть дружеский матч" onClick={onDismiss} /></header>
    <section className="pb-match-intro">
      <div className="pb-match-pill"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Партнёр найден</div>
      <h2 ref={title} id="pb-match-title" className="pb-match-title" tabIndex={-1}>Дружеский<br /><em>матч</em></h2>
      <p id="pb-match-lead">Вы оба хотите сыграть в бадминтон.</p>
    </section>
    <div className="pb-match-stage">
      <svg className="pb-match-court" viewBox="0 0 500 230" preserveAspectRatio="none" aria-hidden="true"><rect x="24" y="30" width="452" height="170" rx="10" /><path d="M24 65h452M24 165h452M56 30v170M444 30v170M250 30v170M24 115h452" /><path className="pb-match-rally" d="M113 158C160 17 319 9 391 114" /></svg>
      <div className="pb-match-pair">
        <div className="pb-match-player"><div className="pb-match-avatar pb-match-self" aria-hidden="true">{initials(match.self.displayName)}</div><span>Это вы</span><strong>{match.self.displayName}</strong></div>
        <div className="pb-match-shuttle" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="m14 28 1-18 9 2 12 9-11 14Z" fill="currentColor" opacity=".16" /><path d="m14 28 1-18 9 2 12 9-11 14M15 10l10 25m-1-23-4 19m16-10-14 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="m14 28 11 7-4 5a7 7 0 0 1-11-8Z" fill="currentColor" /></svg></div>
        <div className="pb-match-player"><div className="pb-match-avatar pb-match-peer" aria-hidden="true">{initials(match.peer.displayName)}</div><span>Ваш партнёр</span><strong>{match.peer.displayName}</strong></div>
      </div>
    </div>
    <section className="pb-match-actions" aria-label="Следующий шаг"><p className="pb-match-status" role="status">{note}</p>
      {href ? <Link className="pb-match-primary" href={href} onClick={event => {
        if (match.actor !== identity.current.actor || match.privateGeneration !== privateViews.currentGeneration || contactGeneration.current !== foregroundUpdates.currentGeneration || document.visibilityState === "hidden") event.preventDefault();
        else onDismiss();
      }}>{buttonContent}</Link> : <button className="pb-match-primary" type="button" disabled={!error} aria-busy={!contact} onClick={() => { setContact(null); setRetry(n => n + 1); }}>{buttonContent}</button>}
      <button className="pb-match-continue" type="button" onClick={onDismiss}>Продолжить поиск <span aria-hidden="true">→</span></button>
      <p className="pb-match-footnote">Матч не добавляет вас в друзья.<br />Первое сообщение — только по вашему решению.</p>
    </section>
  </div>;
}

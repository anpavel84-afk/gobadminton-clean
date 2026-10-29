"use client";
import { useEffect, useState } from "react";
import type { Me } from "../../../lib/consumer-types";
import type { ApiResult } from "../../../lib/api-client";
import type { ContactState } from "../../../lib/messaging-types";
import { getContactState } from "../../../lib/messaging-api";
import { foregroundUpdates, privateActor } from "../../../lib/foreground-updates";
import { Button } from "../Button";
import { MessageGlyph } from "../NavIcon";
import { AuthEntry, ProfileState } from "./ProfileComposition";

export function contactAction(contact: ContactState): { label: string; href?: string; note?: string } {
  const peer = encodeURIComponent(contact.targetPublicPlayerId);
  switch (contact.state) {
    case "none": return contact.canRequestContact === true ? { label: "Написать", href: `/messages?to=${peer}`, note: "До принятия запроса можно отправить одно первое сообщение." } : { label: "Общение сейчас недоступно" };
    case "accepted": return { label: "К переписке", href: `/messages?conversation=${encodeURIComponent(contact.conversationId)}` };
    case "pending_incoming": return { label: "Ответить на запрос", href: `/messages?conversation=${encodeURIComponent(contact.conversationId)}`, note: "Продолжить общение можно после принятия запроса." };
    case "pending_outgoing": return { label: "Открыть запрос", href: `/messages?conversation=${encodeURIComponent(contact.conversationId)}`, note: "Запрос отправлен. Дождитесь ответа игрока." };
    default: return { label: "Общение сейчас недоступно" };
  }
}

export function useContactState(me: Me | null, auth: string, peer: string) {
  const actor = me ? privateActor(me) : "";
  const [loaded, setLoaded] = useState<{ actor: string; peer: string; result: ApiResult<ContactState> } | null>(null);
  useEffect(() => {
    setLoaded(null);
    if (!actor || auth !== "ready") return;
    let live = true;
    foregroundUpdates.session(actor);
    let missing: ApiResult<ContactState> | null = null;
    const unsubscribe = foregroundUpdates.subscribe(`contact:${peer}`, 15000, async ({ signal }) => {
      if (missing) return missing;
      const result = await getContactState(peer, signal);
      // Missing capability stays unavailable for this subscription/session. Never
      // synthesize a relationship or keep polling an absent legacy route.
      if (!signal.aborted && !result.ok && result.status === 404) missing = result;
      return result;
    }, result => { if (live) setLoaded({ actor, peer, result }); });
    return () => { live = false; unsubscribe(); };
  }, [actor, auth, peer]);
  return auth === "ready" && loaded?.actor === actor && loaded.peer === peer ? loaded.result : null;
}

export function ContactAction({ result, auth, peer, canInvite, retryAuth }: { retryAuth: () => void; result: ApiResult<ContactState> | null; auth: string; peer: string; canInvite: boolean }) {
  if (auth === "guest") return <AuthEntry returnPath={`/messages?to=${encodeURIComponent(peer)}`}>Войти, чтобы написать</AuthEntry>;
  if (auth === "ready" && result && !result.ok) {
    if (result.status === 404) return <ProfileState title="Общение сейчас недоступно" state="unavailable">Можно вернуться к списку игроков или открыть сообщения.</ProfileState>;
    if (result.status === 403) return <ProfileState title="Нет доступа к общению с этим игроком" state="unavailable" />;
    if (result.status === 429) return <ProfileState title="Попробуйте проверить общение немного позже" state="unavailable" />;
    if (result.status === 409) return <ProfileState title="Возможность общения изменилась" state="error" retry={() => foregroundUpdates.invalidate(`contact:${peer}`)} />;
  }
  if (auth === "error" || (result && !result.ok && result.status !== 401)) return <ProfileState title="Не удалось проверить возможность общения" state="error" retry={() => { if (auth === "error") retryAuth(); else foregroundUpdates.invalidate(`contact:${peer}`); }} />;
  if (result && !result.ok && result.status === 401) return <AuthEntry returnPath={`/messages?to=${encodeURIComponent(peer)}`}>Войти, чтобы написать</AuthEntry>;
  if (!result || !result.ok || auth !== "ready") return <Button variant="dark" disabled>Проверяем…</Button>;
  if (result.data.targetPublicPlayerId !== peer) return <span role="status">Общение сейчас недоступно</span>;
  const action = contactAction(result.data);
  return <div className="player-contact-row" data-surface="contact-status-actions">
    {result.data.state === "pending_outgoing" && <span className="player-contact-row__status" role="status">Запрос отправлен</span>}
    {action.href
      ? <Button variant="dark" href={action.href}><MessageGlyph />{action.label}</Button>
      : <span className="player-contact-row__status" role="status">{action.label}</span>}
    {canInvite && action.href && <Button href={`/messages?to=${encodeURIComponent(peer)}&action=invite`}>Пригласить на игру</Button>}
  </div>;
}

export function ContactNote({ result }: { result: ApiResult<ContactState> | null }) {
  if (!result?.ok) return null;
  const note = contactAction(result.data).note;
  return note ? <div className="first-contact-note"><MessageGlyph /><span><strong>{result.data.state === "none" ? "Первый контакт ограничен" : "Запрос на общение"}</strong><p>{note}</p></span></div> : null;
}

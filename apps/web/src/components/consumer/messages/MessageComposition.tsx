"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "../Button";
import { Avatar } from "../players/ProfileComposition";
import type { Conversation, DirectMessage, GameInvitation } from "../../../lib/messaging-types";
import type { Game, PlayerAvatar } from "../../../lib/consumer-types";
import { canDecideRequest, invitationCopy, messageTime, requestCopy } from "../../../lib/messaging-presentation";
import { profileFromConversationPath } from "../../../lib/profile-return";

export function InboxRow({ avatar, name, preview, time, unread, attention, kind, selected, href }: { avatar?: PlayerAvatar; name: string; preview: string; time: string; unread?: number; attention?: boolean; kind: "dm" | "request" | "invitation" | "game"; selected: boolean; href: string }) {
  return <Link href={href} className={`inbox-row inbox-row--${kind} ${selected ? "is-selected" : ""}`} aria-current={selected ? "true" : undefined}>
    <Avatar avatar={avatar} name={name} tone={kind === "invitation" ? "purple" : "lime"} /><span><strong>{name}</strong><small>{preview}</small></span><span className="inbox-row__meta"><time dateTime={time}>{new Date(time).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</time>{!!unread && <b aria-label={`${unread} непрочитанных`}>{unread}</b>}{attention && <i className="inbox-attention" aria-label="Требует ответа" />}</span>
  </Link>;
}
export function ConversationHeader({ avatar, name, subtitle, playerId, conversationId, children }: { avatar?: PlayerAvatar; name: string; subtitle: string; playerId?: string; conversationId?: string; children?: ReactNode }) {
  const identity = <><Avatar avatar={avatar} name={name} tone="yellow" /><span className="conversation-identity"><strong>{name}</strong><small>{subtitle}</small></span></>;
  return <header className="conversation-header"><Link className="conversation-back" href="/messages" aria-label="Назад к сообщениям">←</Link>{playerId ? <Link className="conversation-profile" href={conversationId ? profileFromConversationPath(playerId, conversationId) : `/players/${encodeURIComponent(playerId)}`} aria-label={`Профиль игрока: ${name}`}>{identity}</Link> : <div className="conversation-profile">{identity}</div>}{children}</header>;
}
export function MessageBubble({ message, peerId }: { message: DirectMessage; peerId: string }) {
  const own = message.authorPublicPlayerId !== null && message.authorPublicPlayerId !== peerId;
  return <div className={`message-bubble message-bubble--${own ? "own" : "peer"}`}><p>{message.contentState === "live" ? message.text : "Сообщение недоступно"}</p><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time></div>;
}
export function RequestCard({ conversation, text, disabled, decide }: { conversation: Conversation; text?: string | null; disabled: boolean; decide: (action: "accept" | "decline") => void }) {
  return <section className="contact-request"><div><Avatar avatar={conversation.peer.avatar} name={conversation.peer.displayName} /><span><small>{requestCopy[conversation.requestState]}</small><strong>{conversation.peer.displayName}</strong></span></div>{text && <p>{text}</p>}
    {canDecideRequest(conversation) ? <><p>Примите запрос, чтобы продолжить переписку.</p><div><Button disabled={disabled} onClick={() => decide("accept")}>Принять</Button><Button variant="outline" disabled={disabled} onClick={() => decide("decline")}>Отклонить</Button></div></> : <p>{conversation.requestState === "pending" ? "Запрос отправлен. Дождитесь ответа, прежде чем отправлять новые сообщения." : "Новые сообщения в этой переписке недоступны."}</p>}
  </section>;
}
export function InvitationCard({ invitation, game, unavailable = false, confirmed = false, children }: { invitation: GameInvitation; game?: Game | null; unavailable?: boolean; confirmed?: boolean; children?: ReactNode }) {
  const cancelled = invitation.status === "cancelled_by_game" || game?.status === "cancelled";
  const state = cancelled ? "cancelled" : unavailable ? "unavailable" : invitation.status;
  const copy = cancelled ? invitationCopy.cancelled_by_game : unavailable ? ["Участие сейчас недоступно", "Место не подтверждено. Проверьте актуальные условия игры."] : invitationCopy[invitation.status];
  return <section className={`invitation-card invitation-card--${state}`} data-invitation-state={state}><small>Приглашение в игру</small><h2>{game?.title || "Игра"}</h2>{game && <p>{new Date(game.startsAt).toLocaleString("ru-RU", { timeZone: game.timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · {game.venue.name}</p>}<strong>{copy[0]}</strong><p>{copy[1]}</p>{confirmed && <p className="participation-confirmed" role="status">Участие подтверждено.</p>}<div className="message-actions">{children}</div></section>;
}
export function MutationNotice({ mutation }: { mutation: { notice: string; pending: boolean; busy: boolean; retry: () => void } }) {
  return mutation.notice || mutation.pending ? <div className="message-notice" role="status"><p>{mutation.notice || "Проверяем результат…"}</p>{mutation.pending && <Button variant="outline" disabled={mutation.busy} onClick={mutation.retry}>Проверить отправку</Button>}</div> : null;
}

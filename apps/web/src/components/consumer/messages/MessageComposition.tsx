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
  return <Link href={href} className={`inbox-row inbox-row--${kind} ${selected ? "is-selected" : ""}`} aria-current={selected ? "true" : undefined} title={name}>
    <Avatar avatar={avatar} name={name} tone={kind === "invitation" ? "purple" : "lime"} /><span><strong title={name}>{name}</strong><small>{preview}</small></span><span className="inbox-row__meta"><time dateTime={time}>{new Date(time).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</time>{!!unread && <b aria-label={`${unread} непрочитанных`}>{unread}</b>}{attention && <i className="inbox-attention" aria-label="Требует ответа" />}</span>
  </Link>;
}
export function ConversationHeader({ avatar, name, subtitle, playerId, conversationId, children }: { avatar?: PlayerAvatar; name: string; subtitle: string; playerId?: string; conversationId?: string; children?: ReactNode }) {
  const identity = <><Avatar avatar={avatar} name={name} tone="yellow" /><span className="conversation-identity"><strong title={name}>{name}</strong><small>{subtitle}</small></span></>;
  return <header className="conversation-header"><Link className="conversation-back" href="/messages" aria-label="Назад к сообщениям">←</Link>{playerId ? <Link className="conversation-profile" href={conversationId ? profileFromConversationPath(playerId, conversationId) : `/players/${encodeURIComponent(playerId)}`} aria-label={`Профиль игрока: ${name}`} title={name}>{identity}</Link> : <div className="conversation-profile">{identity}</div>}{children}</header>;
}
export function MessageBubble({ message, peerId }: { message: DirectMessage; peerId: string }) {
  const own = message.authorPublicPlayerId !== null && message.authorPublicPlayerId !== peerId;
  return <div className={`message-bubble message-bubble--${own ? "own" : "peer"}`}><p>{message.contentState === "live" ? message.text : "Сообщение недоступно"}</p><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time></div>;
}
/** Status/decision strip for pending and closed requests; no profile card. */
export function RequestDecision({ conversation, disabled, decide }: { conversation: Conversation; disabled: boolean; decide: (action: "accept" | "decline") => void }) {
  if (canDecideRequest(conversation)) {
    return <div className="request-decision"><p className="request-decision__prompt">Принять запрос на общение?</p><div className="message-actions"><Button disabled={disabled} onClick={() => decide("accept")}>Принять</Button><Button variant="outline" disabled={disabled} onClick={() => decide("decline")}>Отклонить</Button></div></div>;
  }
  if (conversation.requestState === "pending") {
    return <div className="request-decision request-decision--sent" role="status"><strong>Запрос отправлен</strong><p>Дождитесь ответа, прежде чем отправлять новые сообщения.</p></div>;
  }
  return <div className="request-decision" role="status"><strong>{requestCopy[conversation.requestState]}</strong><p>Новые сообщения в этой переписке недоступны.</p></div>;
}
/** Compatibility projection: optional first-message text + decision/status; no repeated peer card. */
export function RequestCard({ conversation, text, disabled, decide }: { conversation: Conversation; text?: string | null; disabled: boolean; decide: (action: "accept" | "decline") => void }) {
  return <section className="contact-request contact-request--compact">{text ? <p>{text}</p> : null}<RequestDecision conversation={conversation} disabled={disabled} decide={decide} /></section>;
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

export function InviteGameButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return <Button variant="outline" className="conversation-invite" aria-label="Пригласить на игру" title="Пригласить на игру" disabled={disabled} onClick={onClick}>
    <span className="conversation-invite-label">Пригласить на игру</span>
    <span className="conversation-invite-icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2v3M16 2v3M3.5 9h17M6 5.5h12A2.5 2.5 0 0 1 20.5 8v11A2.5 2.5 0 0 1 18 21.5H6A2.5 2.5 0 0 1 3.5 19V8A2.5 2.5 0 0 1 6 5.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 12v5M9.5 14.5H14.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></svg>
    </span>
  </Button>;
}

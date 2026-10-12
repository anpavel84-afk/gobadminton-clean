"use client";
import { foregroundUpdates, privateActor } from "../../../lib/foreground-updates";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch, getGame, getMySocialProfile } from "../../../lib/api-client";
import { gameChatPath, getGameChat, listGameChatMembers, listGameChatMessages } from "../../../lib/messaging-api";
import { mergeMessages, messageTime } from "../../../lib/messaging-presentation";
import type { Game, Me } from "../../../lib/consumer-types";
import type { DirectMessage, GameChat, GameChatMember, SendReceipt } from "../../../lib/messaging-types";
import { Button } from "../Button";
import { AuthEntry, ProfileDialog, ProfileState } from "../players/ProfileComposition";
import { ConversationSafety } from "./ConversationSafety";
import { MutationNotice } from "./MessageComposition";
import { useSocialMutation } from "./useSocialMutation";

export function GameAccessLoss() {
  return <div className="chat-access-loss" role="status"><span>Чат игры недоступен</span><strong>Доступ к переписке закрыт</strong><p>Чат доступен организаторам и подтверждённым участникам до завершения игры. После выхода, отмены или завершения игры переписка недоступна.</p><p>Заявка на участие не открывает доступ к чату.</p></div>;
}
export function GameMessage({ message, members, ownId }: { message: DirectMessage; members: GameChatMember[]; ownId: string | null }) {
  const author = members.find(m => m.publicPlayerId === message.authorPublicPlayerId);
  return <div className={`message-bubble message-bubble--${ownId && ownId === message.authorPublicPlayerId ? "own" : "peer"}`}><b className="game-message-author">{author?.displayName ?? "Игрок"}{author?.role === "manager" ? " · организатор" : ""}</b><p>{message.contentState === "live" ? message.text : "Сообщение недоступно"}</p><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time></div>;
}
export function GameConversation({ id, me, changed }: { id: string; me: Me; changed: () => void }) {
  const [chat, setChat] = useState<GameChat | null>(null), [game, setGame] = useState<Game | null>(null);
  const [members, setMembers] = useState<GameChatMember[]>([]), [messages, setMessages] = useState<DirectMessage[]>([]);
  const [ownId, setOwnId] = useState<string | null>(null), [state, setState] = useState("loading");
  const [cursor, setCursor] = useState<string | null>(null), [olderBusy, setOlderBusy] = useState(false), [olderError, setOlderError] = useState(false);
  const [reload, setReload] = useState(0), [text, setText] = useState(""), [showMembers, setShowMembers] = useState(false);
  const epoch = useRef(0), readSeq = useRef("0"), initialRead = useRef<string | null>(null), historyLoaded = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  function clearAccess(next: string) { ++epoch.current; historyLoaded.current = false; setChat(null); setGame(null); setMessages([]); setMembers([]); setCursor(null); setShowMembers(false); setText(""); setState(next); }
  const mutation = useSocialMutation<SendReceipt>(`${me.id}:game-chat:${id}`, me.csrfToken, () => { setText(""); setReload(n => n + 1); changed(); }, () => { clearAccess("loading"); setReload(n => n + 1); changed(); });
  const mutating = useRef(false); mutating.current = mutation.busy;
  useEffect(() => {
    let live = true;
    foregroundUpdates.session(privateActor(me));
    const dispose = foregroundUpdates.subscribe(`game:${id}`, 15000, async ({ signal }) => {
      const [header, page, people, context, profile] = await Promise.all([getGameChat(id, signal), listGameChatMessages(id, undefined, signal), listGameChatMembers(id, signal), getGame(id), getMySocialProfile()]);
      const fail = !header.ok ? header : !page.ok ? page : !people.ok ? people : null;
      if (fail) return fail;
      if (!header.ok || !page.ok || !people.ok) return { ok: false, status: 0, error: "Не удалось загрузить чат" };
      return { ok: true, status: 200, data: { header: header.data, page: page.data, people: people.data, context, profile } };
    }, result => {
      if (!live || mutating.current) return;
      if (!result.ok) { clearAccess(result.status === 401 ? "guest" : result.status === 403 || result.status === 404 ? "unavailable" : "error"); return; }
      const { header, page, people, context, profile } = result.data;
      if (header.lifecycleState !== "active") { clearAccess("unavailable"); return; }
      setChat(header); setGame(context.ok ? context.data : null); setMembers(people.items); setOwnId(profile.ok ? profile.data.publicPlayerId : null);
      setMessages(old => mergeMessages(old, page.items));
      if (!historyLoaded.current) { setCursor(page.nextCursor); historyLoaded.current = true; }
      initialRead.current ??= header.readThroughSeq;
      setState("ready");
    });
    return () => { live = false; ++epoch.current; dispose(); };
  }, [id, me.id, me.csrfToken]);
  useEffect(() => { foregroundUpdates.invalidate(`game:${id}`); }, [id, reload]);
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }); }, [messages.at(-1)?.id]);
  useEffect(() => {
    const last = messages.at(-1);
    if (state !== "ready" || !last || BigInt(last.seq) <= BigInt(readSeq.current) || document.visibilityState === "hidden") return;
    let live = true;
    void apiFetch<{ readThroughSeq: string }>(`${gameChatPath(id)}/read`, { method: "POST", csrfToken: me.csrfToken, headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ throughSeq: last.seq }) }).then(r => {
      if (!live) return;
      if (r.ok) { readSeq.current = r.data.readThroughSeq; changed(); }
      else if (r.status === 401 || r.status === 403 || r.status === 404) clearAccess(r.status === 401 ? "guest" : "unavailable");
    });
    return () => { live = false; };
  }, [id, me.csrfToken, messages, state, changed]);
  async function older() {
    if (!cursor || olderBusy) return;
    const generation = epoch.current;
    setOlderBusy(true); setOlderError(false);
    const r = await listGameChatMessages(id, cursor); setOlderBusy(false);
    if (generation !== epoch.current) return;
    if (r.ok) { setMessages(old => mergeMessages(old, r.data.items)); setCursor(r.data.nextCursor); }
    else if (r.status === 401 || r.status === 403 || r.status === 404) clearAccess(r.status === 401 ? "guest" : "unavailable");
    else setOlderError(true);
  }
  const firstUnread = messages.find(m => m.authorPublicPlayerId !== ownId && BigInt(m.seq) > BigInt(initialRead.current ?? "0"))?.id;
  const ready = state === "ready" && chat?.lifecycleState === "active";
  return <section className="conversation-panel game-conversation" aria-label="Чат игры">
    <div className="game-conversation-heading"><header className="conversation-header"><Link className="conversation-back" href="/messages" aria-label="Назад к сообщениям">←</Link><span className="conversation-identity"><small>Чат игры</small><strong>{game?.title ?? "Игра"}</strong>{game && <small>{new Date(game.startsAt).toLocaleString("ru-RU", { timeZone: game.timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</small>}</span><Link className="game-open" href={`/games/${encodeURIComponent(id)}`}>Открыть игру →</Link></header>
      {ready && <button className="game-chat__context" onClick={() => setShowMembers(true)}><img src="/canonical/users.svg" alt="" /><span><strong>Участники игры · {members.length}</strong><small>{members.slice(0, 3).map(m => `${m.displayName}${m.role === "manager" ? " · организатор" : ""}`).join(" · ")}{members.length > 3 ? ` · ещё ${members.length - 3}` : ""}</small></span></button>}
    </div>
    <div className="conversation-body" ref={body}>
      {state === "loading" && <ProfileState title="Загружаем чат…" state="loading" />}
      {state === "error" && <ProfileState title="Не удалось загрузить чат" state="error" retry={() => setReload(n => n + 1)} />}
      {state === "guest" && <ProfileState title="Войдите снова, чтобы открыть чат"><AuthEntry returnPath={`/messages?game=${id}`} /></ProfileState>}
      {state === "unavailable" && <GameAccessLoss />}
      {ready && <>{!game && <p className="system-message" role="status">Сведения об игре сейчас недоступны.</p>}{cursor && <Button variant="ghost" disabled={olderBusy} onClick={() => void older()}>Предыдущие сообщения</Button>}{olderError && <p role="alert">Не удалось загрузить историю. Попробуйте снова.</p>}{!messages.length && <ProfileState title="Начните общение">Обсудите с участниками встречу на площадке.</ProfileState>}{messages.map(m => <div key={m.id}>{m.id === firstUnread && <div className="unread-divider"><span>Новые сообщения</span></div>}<GameMessage message={m} members={members} ownId={ownId} /></div>)}</>}
      <MutationNotice mutation={mutation} />
    </div>
    {ready ? <form className="composer" onSubmit={e => { e.preventDefault(); if (text.trim() && !mutation.busy && !mutation.pending) { ++epoch.current; mutation.run(`${gameChatPath(id)}/messages`, { text: text.trim(), clientMessageId: crypto.randomUUID() }); } }}><input aria-label="Сообщение участникам" placeholder="Сообщение участникам" maxLength={2000} value={text} onChange={e => setText(e.target.value)} disabled={mutation.busy || mutation.pending} /><Button type="submit" variant="dark" disabled={!text.trim() || mutation.busy || mutation.pending}>Отправить</Button></form> : <div className="composer-restricted">Отправка сообщений недоступна.</div>}
    <div className="conversation-safety">{ready && <button onClick={() => setShowMembers(true)}>Участники и безопасность</button>}<Link href="/help">Помощь</Link></div>
    {showMembers && ready && <ProfileDialog title="Участники игры" onClose={() => setShowMembers(false)}><p>Блокировка личного общения не меняет участие в игре и доступ к общему чату.</p><div className="game-members">{members.map(member => <section key={member.publicPlayerId}><strong>{member.displayName}</strong><small>{member.role === "manager" ? "Организатор" : "Участник"}</small>{member.publicPlayerId !== ownId && <div className="conversation-safety"><ConversationSafety playerId={member.publicPlayerId} me={me} onBlocked={changed} /></div>}</section>)}</div></ProfileDialog>}
  </section>;
}

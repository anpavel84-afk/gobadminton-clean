"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api-client";
import { conversationPath } from "../../../lib/messaging-api";
import { canCompose, requestCopy } from "../../../lib/messaging-presentation";
import type { Me } from "../../../lib/consumer-types";
import type { Conversation, DirectMessage, SendReceipt } from "../../../lib/messaging-types";
import { DirectHistory } from "../../../lib/direct-history";
import { foregroundUpdates, privateActor } from "../../../lib/foreground-updates";
import { AuthEntry } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ProfileState } from "../players/ProfileComposition";
import { ConversationHeader, InviteGameButton, MessageBubble, MutationNotice } from "./MessageComposition";
import { ConversationSafety } from "./ConversationSafety";
import { InvitationChooser } from "./InvitationChooser";
import { useSocialMutation } from "./useSocialMutation";

export function DirectConversation({ id, me, changed, openInvitation, startInvite = false }: { id: string; me: Me; changed: () => void; openInvitation: (id: string) => void; startInvite?: boolean }) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [state, setState] = useState("loading");
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [reload, setReload] = useState(0);
  const [text, setText] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [chooser, setChooser] = useState(startInvite);
  const bodyRef = useRef<HTMLDivElement>(null);
  const history = useRef(new DirectHistory(id));
  const [contactAvailable, setContactAvailable] = useState(false);
  const nearBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const readBusy = useRef(false);
  const readKey = useRef({ seq: "", key: "" });
  const epoch = useRef(0);
  const readSeq = useRef("0");
  const initialRead = useRef<string | null>(null);
  const observed = useRef("");
  const mutation = useSocialMutation<Conversation | SendReceipt>(`${me.id}:thread:${id}`, me.csrfToken, () => {
    setText(""); setReload(n => n + 1); changed();
  }, () => { setConversation(null); setState("loading"); setReload(n => n + 1); changed(); });
  const mutating = useRef(false); mutating.current = mutation.busy;
  useEffect(() => {
    const generation = ++epoch.current;
    foregroundUpdates.session(privateActor(me));
    const dispose = foregroundUpdates.subscribe(`dm:${id}`, 3000, async cycle => {
      if (mutating.current) return { ok: false, status: 0, error: "Подтверждаем действие…" };
      const result = await history.current.cycle(cycle);
      if (result.ok && history.current.catchingUp) foregroundUpdates.invalidate(`dm:${id}`);
      return result;
    }, result => {
      if (generation !== epoch.current || (result.ok && mutating.current)) return;
      if (!result.ok) {
        setContactAvailable(false);
        if (result.status === 401 || result.status === 403 || result.status === 404) {
          history.current.clear(); readSeq.current = "0"; initialRead.current = null;
          setConversation(null); setMessages([]); setCursor(null);
        }
        setState(result.status === 401 ? "guest" : result.status === 403 || result.status === 404 ? "unavailable" : "error");
        return;
      }
      const snapshot = result.data;
      const last = snapshot.messages.at(-1)?.id ?? "";
      if (observed.current && observed.current !== last) changed();
      observed.current = last;
      setConversation(snapshot.conversation); setMessages(snapshot.messages); setCursor(snapshot.cursor); setContactAvailable(snapshot.contactAvailable);
      initialRead.current ??= snapshot.conversation.readThroughSeq;
      if (BigInt(snapshot.conversation.readThroughSeq) > BigInt(readSeq.current)) readSeq.current = snapshot.conversation.readThroughSeq;
      setState("ready");
    });
    return () => { ++epoch.current; dispose(); };
  }, [id, me.id, me.csrfToken, changed]);
  useEffect(() => { foregroundUpdates.invalidate(`dm:${id}`); }, [id, reload]);
  useEffect(() => {
    if (nearBottom.current) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages.at(-1)?.id]);
  useEffect(() => {
    const viewport = bodyRef.current?.getBoundingClientRect();
    const visibleSeq = [...(bodyRef.current?.querySelectorAll<HTMLElement>("[data-incoming-seq]") ?? [])].filter(node => { const rect = node.getBoundingClientRect(); return viewport && rect.bottom > viewport.top && rect.top < viewport.bottom; }).at(-1)?.dataset.incomingSeq;
    const incoming = messages.find(m => m.seq === visibleSeq);
    if (state !== "ready" || !incoming || !atBottom || readBusy.current || BigInt(incoming.seq) <= BigInt(readSeq.current) || document.visibilityState === "hidden" || navigator.onLine === false) return;
    const generation = epoch.current;
    readBusy.current = true;
    if (readKey.current.seq !== incoming.seq) readKey.current = { seq: incoming.seq, key: crypto.randomUUID() };
    void apiFetch<{ readThroughSeq: string }>(`${conversationPath(id)}/read`, { method: "POST", csrfToken: me.csrfToken, headers: { "Idempotency-Key": readKey.current.key }, body: JSON.stringify({ throughSeq: incoming.seq }) }).then(r => {
      readBusy.current = false;
      if (generation !== epoch.current) return;
      if (r.ok) { readSeq.current = r.data.readThroughSeq; changed(); }
      else if (r.status === 401 || r.status === 403 || r.status === 404) { setConversation(null); setMessages([]); setState(r.status === 401 ? "guest" : "unavailable"); }
    });
  }, [id, me.csrfToken, messages, state, changed, atBottom, conversation?.peer.publicPlayerId]);
  async function older() {
    if (!cursor || olderBusy) return;
    const generation = epoch.current, node = bodyRef.current, height = node?.scrollHeight ?? 0, top = node?.scrollTop ?? 0;
    setOlderBusy(true); setOlderError(false); nearBottom.current = false; setAtBottom(false);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    const r = await history.current.older(controller.signal); clearTimeout(timer);
    if (generation !== epoch.current) return;
    setOlderBusy(false);
    if (r.ok) {
      foregroundUpdates.publish(`dm:${id}`, r.data);
      requestAnimationFrame(() => { if (node) node.scrollTop = top + node.scrollHeight - height; });
    } else if (r.status === 401 || r.status === 403 || r.status === 404) { setMessages([]); setConversation(null); setCursor(null); setState(r.status === 401 ? "guest" : "unavailable"); }
    else setOlderError(true);
  }
  const restricted = !contactAvailable || blocked || mutation.code === "RESOURCE_UNAVAILABLE" || mutation.code === "401";
  const disabled = mutation.busy || mutation.pending || state !== "ready" || restricted;
  const firstUnread = messages.find(m => m.authorPublicPlayerId === conversation?.peer.publicPlayerId && BigInt(m.seq) > BigInt(initialRead.current ?? "0"))?.id;
  const first = messages[0];
  const pendingRequest = state === "ready" && conversation && conversation.requestState !== "accepted";
  const showComposer = canCompose(conversation) && !blocked && state !== "guest" && state !== "unavailable";
  return <section className="conversation-panel" aria-label="Личная переписка">
    <ConversationHeader playerId={conversation?.peer.publicPlayerId} conversationId={conversation?.id} avatar={conversation?.peer.avatar} name={conversation?.peer.displayName ?? "Переписка"} subtitle={conversation ? (conversation.requestState === "pending" ? "Переписка" : requestCopy[conversation.requestState]) : "Сообщения"}>{conversation && <InviteGameButton disabled={state !== "ready" || blocked || mutation.busy || mutation.pending} onClick={() => setChooser(true)} />}{conversation && <ConversationSafety overflow playerId={conversation.peer.publicPlayerId} me={me} onBlocked={() => { setBlocked(true); changed(); }} />}</ConversationHeader>
    <div className="conversation-body" ref={bodyRef} onScroll={() => { const node = bodyRef.current; const bottom = !!node && node.scrollHeight - node.scrollTop - node.clientHeight < 48; nearBottom.current = bottom; setAtBottom(bottom); }}>
      {state === "loading" && <ProfileState title="Загружаем переписку…" state="loading" />}
      {state === "error" && <ProfileState title="Не удалось обновить переписку" state="error" retry={() => setReload(n => n + 1)}>Отправка недоступна до обновления.</ProfileState>}
      {state === "guest" && <ProfileState title="Войдите снова, чтобы открыть переписку"><AuthEntry returnPath={`/messages?conversation=${encodeURIComponent(id)}`} /></ProfileState>}
      {state === "unavailable" && <ProfileState title="Переписка недоступна">Вернитесь к сообщениям.</ProfileState>}
      {state === "ready" && conversation && <>
        {cursor && <Button variant="ghost" disabled={olderBusy} onClick={() => void older()}>Ранние сообщения</Button>}{olderError && <p role="alert">Не удалось загрузить ранние сообщения. Попробуйте ещё раз.</p>}
        {pendingRequest ? first ? <div data-incoming-seq={first.authorPublicPlayerId === conversation.peer.publicPlayerId ? first.seq : undefined}>
          <div className="message-date">{new Date(first.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</div>
          <MessageBubble message={first} peerId={conversation.peer.publicPlayerId} />
        </div> : null : messages.map((message, index) => <div key={message.id} data-incoming-seq={message.authorPublicPlayerId === conversation.peer.publicPlayerId ? message.seq : undefined}>{(index === 0 || message.createdAt.slice(0, 10) !== messages[index - 1]?.createdAt.slice(0, 10)) && <div className="message-date">{new Date(message.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</div>}{message.id === firstUnread && <div className="unread-divider"><span>Новые сообщения</span></div>}<MessageBubble message={message} peerId={conversation.peer.publicPlayerId} /></div>)}
        {canCompose(conversation) && !messages.length && <ProfileState title="Начните переписку">Напишите первое сообщение.</ProfileState>}
      </>}
      <MutationNotice mutation={mutation} />
    </div>
    {showComposer ? <form className="composer" onSubmit={e => { e.preventDefault(); if (!disabled && text.trim()) mutation.run(`${conversationPath(id)}/messages`, { kind: "text", text: text.trim(), clientMessageId: crypto.randomUUID() }); }}><input aria-label="Сообщение" placeholder="Сообщение" maxLength={2000} value={text} disabled={disabled} onChange={e => setText(e.target.value)} /><Button type="submit" variant="dark" disabled={disabled || !text.trim()}>Отправить</Button></form>
      : <div className="composer-restricted">Отправка сейчас недоступна.</div>}
    {chooser && conversation && state === "ready" && !blocked && <InvitationChooser me={me} playerId={conversation.peer.publicPlayerId} onClose={() => setChooser(false)} onCreated={openInvitation} />}
  </section>;
}

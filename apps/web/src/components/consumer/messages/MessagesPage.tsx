"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getMe } from "../../../lib/api-client";
import { foregroundUpdates, privateActor } from "../../../lib/foreground-updates";
import { listInbox } from "../../../lib/messaging-api";
import { inboxRow } from "../../../lib/inbox-presentation";
import type { Me } from "../../../lib/consumer-types";
import type { InboxFilter, InboxPage } from "../../../lib/messaging-types";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { RootNav } from "../RootNav";
import { AuthEntry, ProfileState } from "../players/ProfileComposition";
import { InboxRow } from "./MessageComposition";
import { DirectConversation } from "./DirectConversation";
import { GameConversation } from "./GameConversation";
import { InvitationDetail } from "./InvitationDetail";
import { NewContact } from "./NewContact";
import { inboxSelection } from "./inboxSelection";
import { conversationWithInvitePath } from "../../../lib/invitation-continuation";
const splitPaneQuery = "(min-width: 721px)";
function subscribeSplitPane(changed: () => void) {
  const media = window.matchMedia(splitPaneQuery);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}
const getSplitPane = () => window.matchMedia(splitPaneQuery).matches;
const getServerSplitPane = () => false;

export function MessagesPage() {
  const params = useSearchParams(), router = useRouter();
  const target = params.get("to"), selected = !!(params.get("conversation") || params.get("invitation") || params.get("game") || target);
  const splitPane = useSyncExternalStore(subscribeSplitPane, getSplitPane, getServerSplitPane);
  const [me, setMe] = useState<Me | null>(null), [auth, setAuth] = useState("loading");
  const [reload, setReload] = useState(0), [filter, setFilter] = useState<InboxFilter>("all");
  const [page, setPage] = useState<InboxPage | null>(null), [state, setState] = useState("loading");
  const [moreBusy, setMoreBusy] = useState(false), [moreError, setMoreError] = useState(false);
  const epoch = useRef(0), pageRevision = useRef(0);
  const changed = useCallback(() => { window.dispatchEvent(new Event("gb-inbox-changed")); }, []);
  useEffect(() => {
    let live = true;
    void getMe().then(r => { if (live) { setMe(r.ok ? r.data : null); setAuth(r.ok ? "ready" : r.status === 401 ? "guest" : "error"); } });
    const expire = () => { live = false; setMe(null); setAuth("guest"); setPage(null); };
    const session = () => { expire(); setReload(n => n + 1); };
    window.addEventListener("gb-private-expired", expire); window.addEventListener("gb-session-changed", session);
    return () => { live = false; window.removeEventListener("gb-private-expired", expire); window.removeEventListener("gb-session-changed", session); };
  }, [reload]);
  useEffect(() => {
    if (!me) return;
    const generation = ++epoch.current;
    setMoreBusy(false);
    foregroundUpdates.session(privateActor(me));
    const dispose = foregroundUpdates.subscribe(`inbox:${filter}`, 15000, ({ signal }) => listInbox(filter, undefined, signal), r => {
      if (generation !== epoch.current) return;
      ++pageRevision.current; setMoreBusy(false);
      setPage(r.ok ? r.data : null); setState(r.ok ? "ready" : r.status === 404 ? "unavailable" : "error");
      if (r.ok) foregroundUpdates.publish("counts", r.data.counts);
      if (!r.ok && r.status === 401) { setMe(null); setAuth("guest"); }
    }, true);
    return () => { ++epoch.current; dispose(); };
  }, [me?.id, me?.csrfToken, filter]);
  async function more() {
    if (moreBusy || !page?.nextCursor) return;
    const generation = epoch.current, revision = pageRevision.current;
    setMoreBusy(true); setMoreError(false);
    const r = await listInbox(filter, page.nextCursor);
    if (generation !== epoch.current || revision !== pageRevision.current) return;
    setMoreBusy(false);
    if (r.ok) foregroundUpdates.publish(`inbox:${filter}`, { ...r.data, items: [...new Map([...page.items, ...r.data.items].map(i => [`${i.kind}:${i.id}`, i])).values()] });
    else { setMoreError(true); if (r.status === 401 || r.status === 404) { setPage(null); setState("unavailable"); } }
  }
  function chooseFilter(value: InboxFilter) { ++epoch.current; setMoreBusy(false); setMoreError(false); setPage(null); setState("loading"); setFilter(value); }
  const rows = (page?.items ?? []).map(inboxRow).filter(r => r !== null);
  const { conversationId, invitationId, gameId } = inboxSelection(params, rows, splitPane);
  return <ConsumerShell active="none" title="Сообщения" mode="focused"><div className={`fr3 fr4 messages-page ${selected ? "show-conversation" : ""}`}>
    <aside className="inbox-panel" aria-label="Входящие"><div className="inbox-header"><span><small>Личные и игровые</small><h1>Сообщения</h1></span></div>
      <div className="inbox-tabs" aria-label="Фильтры сообщений">{([["all", "Все"], ["unread", "Непрочитанные"], ["attention", "Требуют ответа"]] as const).map(([key, label]) => <button key={key} className={`chip ${filter === key ? "chip--active" : ""}`} aria-pressed={filter === key} onClick={() => { if (key !== filter) chooseFilter(key); }}>{label}</button>)}</div>
      <div className="inbox-list">
        {auth === "loading" && <ProfileState title="Загружаем сообщения…" state="loading" />}
        {auth === "guest" && <><ProfileState title="Войдите, чтобы общаться">Личные сообщения и чаты игр доступны после входа.</ProfileState><div className="message-auth"><AuthEntry returnPath={`/messages?${params}`} /></div></>}
        {auth === "error" && <ProfileState title="Не удалось проверить вход" state="error" retry={() => { setReload(n => n + 1); changed(); }} />}
        {auth === "ready" && <>{state === "loading" && <ProfileState title="Загружаем переписки…" state="loading" />}{state === "error" && <ProfileState title="Не удалось загрузить сообщения" state="error" retry={() => { setReload(n => n + 1); changed(); }} />}{state === "unavailable" && <ProfileState title="Сообщения пока недоступны" retry={() => { setReload(n => n + 1); changed(); }} />}
          {rows.map(row => <InboxRow {...row} key={row.key} selected={row.kind === "game" ? gameId === row.id : row.kind === "invitation" ? invitationId === row.id : conversationId === row.id} />)}
          {!rows.length && state === "ready" && <ProfileState title={filter === "all" ? "Пока нет сообщений" : "Здесь пока пусто"}>Здесь появятся переписки, приглашения и чаты ваших игр.</ProfileState>}
          {page?.nextCursor && <Button variant="ghost" disabled={moreBusy} onClick={() => void more()}>Ещё сообщения</Button>}{moreError && <p role="alert">Не удалось загрузить продолжение. Попробуйте снова.</p>}
        </>}
      </div>
    </aside>
    {me && auth === "ready" ? gameId ? <GameConversation key={`${me.id}:${me.csrfToken}:${gameId}`} id={gameId} me={me} changed={changed} /> : conversationId ? <DirectConversation key={`${me.id}:${me.csrfToken}:${conversationId}`} id={conversationId} me={me} changed={changed} startInvite={params.get("action") === "invite"} openInvitation={id => router.push(`/messages?invitation=${encodeURIComponent(id)}`)} /> : invitationId ? <InvitationDetail key={invitationId} id={invitationId} me={me} changed={changed} /> : target ? <NewContact key={`${me.id}:${me.csrfToken}:${target}`} playerId={target} invite={params.get("action") === "invite"} me={me} openConversation={id => router.push(conversationWithInvitePath(id, params.get("action") === "invite"))} openInvitation={id => router.push(`/messages?invitation=${encodeURIComponent(id)}`)} /> : <section className="conversation-panel conversation-empty"><ProfileState title="Выберите переписку">Здесь появятся сообщения и приглашения в игры.</ProfileState><Button href="/players" variant="outline">Найти игрока</Button></section> : <section className="conversation-panel conversation-empty"><Link className="conversation-back" href="/messages">←</Link><ProfileState title={auth === "guest" ? "Войдите, чтобы открыть сообщения" : "Загружаем…"} />{auth === "guest" && <AuthEntry returnPath={`/messages?${params}`} />}{auth === "error" && <Button onClick={() => setReload(n => n + 1)}>Повторить</Button>}</section>}
  </div><RootNav active="messages" /></ConsumerShell>;
}

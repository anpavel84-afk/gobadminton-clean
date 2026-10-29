"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FriendshipList } from "@gobadminton/contracts/friendship-types";
import { privateViews } from "../../../lib/private-view";
import { getMe } from "../../../lib/api-client";
import type { Me } from "../../../lib/consumer-types";
import { getSocialCapabilities, listFriends, type FriendsTab } from "../../../lib/friendships";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { AuthEntry, Avatar, ProfileState } from "../players/ProfileComposition";
import { FriendActions } from "../friends/FriendActions";

const tabs: Array<[FriendsTab, string]> = [["accepted", "Друзья"], ["incoming", "Входящие"], ["outgoing", "Исходящие"]];
export function FriendsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<FriendsTab>("accepted");
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<FriendshipList | null>(null);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  function refresh() { setPage(null); setCursor(null); setState("loading"); setReload(n => n + 1); }
  useEffect(() => {
    let live = true;
    setPage(null); setMe(null); setState("loading");
    const expire = () => { live = false; setPage(null); setMe(null); setState("guest"); };
    const session = () => { expire(); refresh(); };
    const foreground = () => { if (document.visibilityState === "visible") { live = false; refresh(); } };
    const release = privateViews.retain(privateViews.currentGeneration);
    window.addEventListener("gb-private-expired", expire);
    window.addEventListener("gb-session-changed", session);
    document.addEventListener("visibilitychange", foreground);
    void (async () => {
      const actor = await getMe();
      if (!live) return;
      if (!actor.ok) { setState(actor.status === 401 ? "guest" : "error"); return; }
      const capabilities = await getSocialCapabilities();
      if (!live) return;
      if (!capabilities.ok) { setState(capabilities.status === 401 ? "guest" : [403,404,503].includes(capabilities.status) ? "unavailable" : "error"); return; }
      if (!capabilities.data.friends) { setState("unavailable"); return; }
      const result = await listFriends(tab, cursor);
      if (!live) return;
      if (!result.ok) { setState(result.status === 401 ? "guest" : [403,404,503].includes(result.status) ? "unavailable" : "error"); return; }
      setMe(actor.data); setPage(result.data); setState("ready");
    })();
    return () => { live = false; release?.(); window.removeEventListener("gb-private-expired", expire); window.removeEventListener("gb-session-changed", session); document.removeEventListener("visibilitychange", foreground); };
  }, [tab, cursor, reload]);
  return <ConsumerShell active="players" title="Друзья" mode="local"><div className="fr3 player-profile-page">
    <header className="gb-page-local-header">
      <Link className="back-link" href="/profile">← Мой профиль</Link>
      <h1>Друзья</h1>
    </header>
    <div className="profile-form-actions" role="group" aria-label="Списки друзей">{tabs.map(([value, label]) => <Button key={value} variant={tab === value ? "dark" : "outline"} aria-pressed={tab === value} onClick={() => { setPage(null); setState("loading"); setTab(value); setCursor(null); setReload(n => n + 1); }}>{label}</Button>)}</div>
    {state === "loading" && <ProfileState title="Загружаем друзей…" state="loading" />}
    {state === "guest" && <section className="profile-section"><p>Войдите, чтобы увидеть друзей и запросы.</p><AuthEntry returnPath="/friends" /></section>}
    {state === "unavailable" && <ProfileState title="Друзья сейчас недоступны">Проверьте доступность игрового профиля и повторите попытку. Запрос на общение для дружбы не требуется.</ProfileState>}
    {state === "error" && <ProfileState title="Не удалось загрузить друзей" state="error" retry={refresh}>Обновите список перед следующими действиями.</ProfileState>}
    {state === "ready" && page && me && <>
      {!page.items.length && <ProfileState title="Здесь пока никого нет">Запрос можно отправить из публичного профиля игрока.</ProfileState>}
      {page.items.map((view, index) => <section className="profile-section" key={view.friendshipId ?? index}>
        {view.peer ? <Link className="player-card" href={`/players/${encodeURIComponent(view.peer.publicPlayerId)}`}><Avatar avatar={view.peer.avatar} name={view.peer.displayName} tone="yellow" /><div className="player-card__main"><div className="player-card__title"><h3>{view.peer.displayName}</h3></div></div><span className="player-card__arrow" aria-hidden="true">→</span></Link> : <h2>Игрок недоступен</h2>}
        <FriendActions me={me} view={view} peerId={view.peer?.publicPlayerId} refresh={refresh} />
      </section>)}
      <div className="profile-form-actions"><Button variant="outline" onClick={refresh}>Обновить список</Button>{page.nextCursor && <Button variant="outline" onClick={() => { setPage(null); setState("loading"); setCursor(page.nextCursor); }}>Следующая страница</Button>}</div>
    </>}
  </div></ConsumerShell>;
}

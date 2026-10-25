"use client";
import { useEffect, useState } from "react";
import type { FriendshipView } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import { privateViews } from "../../../lib/private-view";
import { getFriendState, getSocialCapabilities } from "../../../lib/friendships";
import { AuthEntry, ProfileState } from "../players/ProfileComposition";
import { FriendActions } from "./FriendActions";

export function ProfileFriendship({ me, peerId }: { me: Me; peerId: string }) {
  const [view, setView] = useState<FriendshipView | null>(null);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  function refresh() { setView(null); setState("loading"); setReload(n => n + 1); }
  useEffect(() => {
    let live = true;
    setView(null); setState("loading");
    const expire = () => { live = false; setView(null); setState("guest"); };
    const release = privateViews.retain(privateViews.currentGeneration);
    const foreground = () => { if (document.visibilityState === "visible") { live = false; refresh(); } };
    window.addEventListener("gb-private-expired", expire);
    document.addEventListener("visibilitychange", foreground);
    void (async () => {
      const capabilities = await getSocialCapabilities();
      if (!live) return;
      if (!capabilities.ok) { setState(capabilities.status === 401 ? "guest" : [403,404,503].includes(capabilities.status) ? "unavailable" : "error"); return; }
      if (!capabilities.data.friends) { setState("unavailable"); return; }
      const result = await getFriendState(peerId);
      if (!live) return;
      if (!result.ok) { setState(result.status === 401 ? "guest" : [403,404,503].includes(result.status) ? "unavailable" : "error"); return; }
      setView(result.data.items[0] ?? null); setState(result.data.items[0] ? "ready" : "unavailable");
    })();
    return () => { live = false; release?.(); window.removeEventListener("gb-private-expired", expire); document.removeEventListener("visibilitychange", foreground); };
  }, [me.id, peerId, reload]);
  return <section className="profile-section"><h2>Друзья</h2>
    {state === "loading" && <p role="status">Проверяем состояние дружбы…</p>}
    {state === "guest" && <AuthEntry returnPath={`/players/${peerId}`}>Войти для действий с друзьями</AuthEntry>}
    {state === "error" && <ProfileState title="Не удалось проверить дружбу" state="error" retry={refresh} />}
    {state === "unavailable" && <p role="status">Друзья сейчас недоступны. Проверьте настройки видимости профиля и запросов на общение.</p>}
    {state === "ready" && view && <FriendActions me={me} view={view} peerId={peerId} refresh={refresh} />}
  </section>;
}

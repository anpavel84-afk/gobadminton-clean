"use client";
import { useEffect, useRef, useState } from "react";
import { getGame, listMyManagedGames } from "../../../lib/api-client";
import type { ManagedGame, Me } from "../../../lib/consumer-types";
import type { GameInvitation } from "../../../lib/messaging-types";
import { Button } from "../Button";
import { ProfileDialog, ProfileState } from "../players/ProfileComposition";
import { MutationNotice } from "./MessageComposition";
import { useSocialMutation } from "./useSocialMutation";

export function InvitationChooser({ me, playerId, resultRef, onClose, onCreated }: { me: Me; playerId: string; resultRef?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [games, setGames] = useState<ManagedGame[]>([]);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState(false);
  const mutation = useSocialMutation<GameInvitation>(`${me.id}:invite:${playerId}`, me.csrfToken, r => onCreated(r.id), () => setReload(n => n + 1), !resultRef);
  useEffect(() => {
    let live = true;
    setState("loading"); setGames([]);
    void (async () => {
      const items: ManagedGame[] = []; let cursor: string | undefined;
      do {
        const r = await listMyManagedGames({ cursor, limit: 50 });
        if (!live) return;
        if (!r.ok) { setState("error"); return; }
        items.push(...r.data.items); cursor = r.data.nextCursor ?? undefined;
      } while (cursor);
      setGames(items.filter(g => g.status === "published")); setState("ready");
    })();
    return () => { live = false; };
  }, [reload]);
  async function invite(game: ManagedGame) {
    if (checking || mutation.busy || mutation.pending) return;
    setChecking(true);
    const fresh = await getGame(game.id);
    if (!live.current) return;
    setChecking(false);
    if (!fresh.ok) { mutation.setNotice("Игра сейчас недоступна. Обновите список."); setReload(n => n + 1); return; }
    mutation.run(`/v1/games/${encodeURIComponent(game.id)}/invitations`, { inviteePublicPlayerId: playerId, expectedGameVersion: fresh.data.version, ...(resultRef ? { discoveryProof: resultRef } : {}) });
  }
  return <ProfileDialog title="Пригласить на игру" onClose={() => { if (!checking && !mutation.busy) onClose(); }}><div className="invite-dialog-example"><small>Пригласить на игру</small><strong>Выберите вашу игру</strong><p>Приглашение не резервирует место.</p>
    {state === "loading" && <ProfileState title="Загружаем игры…" state="loading" />}
    {state === "error" && <ProfileState title="Не удалось загрузить игры" state="error" retry={() => setReload(n => n + 1)} />}
    {state === "ready" && games.length === 0 && <p>Пока нет опубликованных игр, которыми вы управляете.</p>}
    {games.map(g => <button key={g.id} disabled={checking || mutation.busy || mutation.pending} onClick={() => void invite(g)}><span>{g.title}<small>{new Date(g.startsAt).toLocaleString("ru-RU", { timeZone: g.timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</small></span><b aria-hidden="true">→</b></button>)}
    <Button variant="outline" href="/games/create">+ Создать новую игру</Button><MutationNotice mutation={mutation} /></div></ProfileDialog>;
}

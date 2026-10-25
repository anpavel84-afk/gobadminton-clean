"use client";
import { GameCover } from "../games/GameCover";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getGame, listAllMyParticipations, listMyManagedGames } from "../../../lib/api-client";
import type { Game, ManagedGame } from "../../../lib/consumer-types";
import { dominantParticipation, formatGameWhen } from "../../../lib/game-presentation";
import { Button } from "../Button";
import { ProfileState } from "./ProfileComposition";

export function OwnUpcomingGames() {
  const [rows, setRows] = useState<Array<{ game: Game; relation: string }>>([]);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setState("loading"); setRows([]);
    void (async () => {
      const parts = await listAllMyParticipations();
      if (!live) return;
      if (!parts.ok) { setState("error"); return; }
      const managed: ManagedGame[] = []; let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const result = await listMyManagedGames({ cursor, limit: 50 });
        if (!live) return;
        if (!result.ok) { setState("error"); return; }
        managed.push(...result.data.items); cursor = result.data.nextCursor ?? undefined;
        if (cursor && seen.has(cursor)) { setState("error"); return; }
        if (cursor) seen.add(cursor);
      } while (cursor);
      const ids = [...new Set(parts.data.map(p => p.gameId))].filter(id => dominantParticipation(parts.data, id)?.status === "confirmed" && !managed.some(g => g.id === id));
      const games = await Promise.all(ids.map(id => getGame(id)));
      if (!live) return;
      if (games.some(r => !r.ok && r.status !== 404)) { setState("error"); return; }
      const all = [...managed.map(game => ({ game, relation: "Организует" })), ...games.flatMap(r => r.ok ? [{ game: r.data, relation: "Участвует" }] : [])];
      setRows(all.filter(r => r.game.status === "published" && Date.parse(r.game.startsAt) > Date.now()).sort((a, b) => Date.parse(a.game.startsAt) - Date.parse(b.game.startsAt)).slice(0, 2)); setState("ready");
    })();
    return () => { live = false; };
  }, [reload]);
  return <section className="profile-upcoming-section own-upcoming-games" data-surface="op-07"><header className="profile-upcoming-header"><span><small>Подтверждённое участие и организация</small><h2>Мои ближайшие игры</h2></span><Link href="/my-games">Все мои игры →</Link></header>
    {state === "loading" && <p role="status">Загружаем игры…</p>}{state === "error" && <ProfileState title="Не удалось загрузить игры" state="error" retry={() => setReload(n => n + 1)} />}{state === "ready" && !rows.length && <p>Ближайших подтверждённых игр пока нет.</p>}
    {state === "ready" && rows.map(({ game, relation }) => <article className="upcoming-game-row" key={game.id}><GameCover game={game} /><div><span><span className={`status-badge status-badge--${game.activityKind === "trainer_led" ? "attention" : "past"}`}>{game.activityKind === "trainer_led" ? "С тренером" : "Обычная игра"}</span><span className="status-badge status-badge--confirmed">{relation}</span></span><h3>{game.title}</h3><strong>{formatGameWhen(game)}</strong><p>{game.venue.name}</p></div><Button variant="outline" href={`/games/${game.id}`}>Открыть игру</Button></article>)}
  </section>;
}

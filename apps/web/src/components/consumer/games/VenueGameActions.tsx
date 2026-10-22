"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getGame, getMe, listAllMyParticipations, requestParticipation } from "../../../lib/api-client";
import type { Game, Me, Participation } from "../../../lib/consumer-types";
import { canRequestParticipation, capacityStatusLabel, dominantParticipation, participationLabel } from "../../../lib/game-presentation";
import { AuthChooser } from "../players/ProfileComposition";
import { Button } from "../Button";
import { GameStatusBadge } from "./GameDetailComposition";
import { GameShare } from "./GameShare";

/**
 * The map's real game-detail surface uses the existing versioned participation API.
 * It must not pretend an in-app friend invitation exists: sharing sends a public link.
 */
export function VenueGameActions({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [account, setAccount] = useState<Me | null>(null);
  const [own, setOwn] = useState<Participation | null>(null);
  const [readable, setReadable] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);

  const reload = useCallback(async () => {
    const revision = ++generation.current;
    setState("loading"); setReadable(false); setGame(null); setOwn(null); setAccount(null);
    const latestGame = await getGame(gameId);
    if (revision !== generation.current) return;
    if (!latestGame.ok) { setState("error"); return; }
    setGame(latestGame.data);
    const latestMe = await getMe();
    if (revision !== generation.current) return;
    if (latestMe.ok) {
      setAccount(latestMe.data);
      const parts = await listAllMyParticipations();
      if (revision !== generation.current) return;
      if (parts.ok) { setOwn(dominantParticipation(parts.data, gameId)); setReadable(true); }
    } else if (latestMe.status === 401) {
      // Guests can open the existing authorization chooser. They cannot submit a mutation yet.
      setReadable(true);
    }
    setState("ready");
  }, [gameId]);

  useEffect(() => {
    void reload();
    return () => { generation.current++; };
  }, [reload]);

  async function onRequest() {
    if (!game || !readable || mutation.current || !canRequestParticipation(game, own)) return;
    if (!account) { setAuthOpen(true); return; }
    mutation.current = true; setBusy(true); setNotice(null);
    try {
      // A stale version is rejected server-side. Never retry a mutation automatically.
      const result = await requestParticipation(game.id, game.version, account.csrfToken);
      if (!result.ok) setNotice("Подтверждение заявки не получено. Проверяем состояние участия.");
      await reload();
    } finally {
      mutation.current = false; setBusy(false);
    }
  }

  const status = game?.status === "cancelled" ? "cancelled_by_game" : own?.status;
  return <section className="gb-venue-game-actions" aria-label="Действия с игрой">
    <div className="gb-venue-game-actions-primary">
      {state === "loading" ? <p role="status">Проверяем возможность участия…</p>
        : state === "error" ? <><p role="alert">Не удалось проверить игру.</p><Button variant="outline" onClick={() => void reload()}>Повторить</Button></>
        : !game ? <p role="status">Игра недоступна.</p>
        : !readable ? <><p role="status">Не удалось проверить участие. Заявка не отправлена.</p><Button variant="outline" onClick={() => void reload()}>Проверить участие</Button></>
        : status ? <div className="gb-venue-game-actions-status">
          <GameStatusBadge tone={status}>{participationLabel(status)}</GameStatusBadge>
          {status === "pending" && <Button variant="outline" href={`/games/${gameId}/review?intent=withdraw`}>Отозвать заявку</Button>}
          {status === "confirmed" && <p>Ваше участие подтверждено.</p>}
          {status === "withdrawn" && canRequestParticipation(game, own) && <Button disabled={busy} loading={busy} onClick={() => void onRequest()}>Оставить заявку снова</Button>}
        </div> : canRequestParticipation(game, own) ? <>
          <Button disabled={busy} loading={busy} onClick={() => void onRequest()}>{busy ? "Отправляем…" : "Оставить заявку"}</Button>
          <small>Организатор рассмотрит заявку; место после одобрения.</small>
        </> : <p role="status">{capacityStatusLabel(game)}. Новые заявки недоступны.</p>}
    </div>
    <GameShare gameId={gameId} label="Поделиться / отправить другу" />
    {notice && <p className="gb-venue-game-notice" role="status">{notice}</p>}
    {authOpen && <AuthChooser returnPath={`/games/${gameId}`} intent={{kind:"participate", gameId}} onClose={() => setAuthOpen(false)} />}
  </section>;
}

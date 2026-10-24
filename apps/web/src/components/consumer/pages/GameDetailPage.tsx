"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getGame, getMe, listAllMyParticipations, requestParticipation } from "../../../lib/api-client";
import { getGameChat } from "../../../lib/messaging-api";
import type { Game, GameDetail, Me, Participation } from "../../../lib/consumer-types";
import { canRequestParticipation, capacityStatusLabel, dominantParticipation, participationLabel, settlementTerms } from "../../../lib/game-presentation";
import { AuthChooser } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { GameHero, GameTerms, GameStatusBadge } from "../games/GameDetailComposition";
import { GameShare } from "../games/GameShare";
import { GameActionBar } from "../games/GameActionBar";
import { GameVenueContacts } from "../games/GameVenueContacts";

function ParticipationActions({ game, own, busy, notice, readable, onRequest, onReload }: {
  game: Game; own: Participation | null; busy: boolean; notice: string | null;
  readable: boolean; onRequest: () => void; onReload: () => void;
}) {
  const cancelled = game.status === "cancelled";
  const status = cancelled ? "cancelled_by_game" : own?.status;
  return <GameActionBar>
    {!readable ? <><strong>Не удалось проверить участие</strong><p>Обновите данные перед отправкой заявки.</p><Button variant="outline" disabled={busy} onClick={onReload}>Проверить участие</Button></>
      : status ? <>
        <GameStatusBadge tone={status}>{participationLabel(status)}</GameStatusBadge>
        {status === "pending" && <p>Ждём решения организатора. Место пока не подтверждено.</p>}
        {status === "confirmed" && <p>Ждём вас на игре. Условия расчёта указаны выше.</p>}
        {status === "pending" && <Button variant="outline" href={`/games/${game.id}/review?intent=withdraw`}>Отозвать заявку</Button>}
        {status === "confirmed" && <Button variant="outline" href={`/games/${game.id}/review?intent=refuse`}>Отказаться от участия</Button>}
        {status === "withdrawn" && canRequestParticipation(game, own) && <Button onClick={onRequest} disabled={busy}>Оставить заявку снова</Button>}
      </> : canRequestParticipation(game, own) ? <>
        <div><strong>Участие в игре</strong><p>Организатор рассмотрит заявку. Место — после одобрения.</p></div>
        <Button disabled={busy} loading={busy} onClick={onRequest}>{busy ? "Отправляем…" : "Оставить заявку"}</Button>
      </> : <><strong>{capacityStatusLabel(game)}</strong><p>Новые заявки сейчас недоступны.</p></>}
    {notice && <p className="gb-game-notice" role="status">{notice}</p>}
  </GameActionBar>;
}

export function GameDetailPage({ gameId }: { gameId: string }) {
  const [authOpen, setAuthOpen] = useState(false);
  const [game, setGame] = useState<GameDetail | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [own, setOwn] = useState<Participation | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [chatAvailable, setChatAvailable] = useState(false);
  const [readable, setReadable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setState("loading"); setGame(null); setChatAvailable(false); setReadable(false); setOwn(null); setMe(null);
    const result = await getGame(gameId);
    if (current !== generation.current) return;
    if (!result.ok) { setGame(null); setState("error"); return; }
    setGame(result.data);
    const account = await getMe();
    if (current !== generation.current) return;
    if (account.ok) {
      setMe(account.data);
      const [parts, chat] = await Promise.all([listAllMyParticipations(), getGameChat(gameId)]);
      if (current !== generation.current) return;
      setChatAvailable(chat.ok && chat.data.lifecycleState === "active");
      if (parts.ok) { setOwn(dominantParticipation(parts.data, gameId)); setReadable(true); }
    } else if (account.status === 401) { setReadable(true); }
    setState("ready");
  }, [gameId]);

  useEffect(() => {
    const refresh = () => { void reload(); };
    void reload();
    window.addEventListener("gb-session-changed", refresh);
    window.addEventListener("gb-private-expired", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      generation.current++;
      window.removeEventListener("gb-session-changed", refresh);
      window.removeEventListener("gb-private-expired", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);

  async function onRequest() {
    if (!game || !readable || mutation.current) return;
    mutation.current = true; setBusy(true); setNotice(null);
    try {
      if (!me) {
        setAuthOpen(true);
        return;
      }
      const result = await requestParticipation(game.id, game.version, me.csrfToken);
      // Unknown/conflict: reread both Game and own participation; never replay a mutation.
      if (!result.ok) setNotice("Не удалось получить подтверждение отправки. Проверяем состояние вашей заявки.");
      await reload();
    } finally { mutation.current = false; setBusy(false); }
  }

  return <ConsumerShell active="games" title="Игра" mode="page" hideHeading>
    <div className="gb-games-detail" data-surface="game-detail" data-sticky-cta="dr-08">
      <div className="gb-game-detail-actions"><Button variant="ghost" className="gb-game-back" href="/games">← Все игры</Button>{state === "ready" && game && <GameShare gameId={game.id} />}</div>
      {state === "loading" && <div className="gb-game-feedback" data-state="loading" role="status"><h1>Загружаем игру</h1><p>Скоро покажем место, время и условия.</p></div>}
      {state === "error" && <div className="gb-game-feedback" data-state="error"><h1>Игра недоступна</h1><p>Не удалось загрузить игру. Проверьте соединение и попробуйте ещё раз.</p><Button onClick={() => void reload()}>Обновить</Button></div>}
      {state === "ready" && game && game.id === gameId && <div data-state="ready">
        <GameHero game={game} />
        <div className="gb-game-detail-grid">
          <div><GameTerms game={game} />{me && <GameVenueContacts venue={game.venue} />}{chatAvailable && <Button variant="outline" href={`/messages?game=${encodeURIComponent(gameId)}`}>Чат игры →</Button>}</div>
          <aside className="gb-game-booking">
            <div className="gb-game-booking__terms"><strong>{capacityStatusLabel(game)}</strong><p>{settlementTerms(game.settlement)}</p><small>{game.venue.name}</small><p>{game.venue.address}</p></div>
            <ParticipationActions game={game} own={own} busy={busy} notice={notice} readable={readable} onRequest={() => void onRequest()} onReload={() => void reload()} />
          </aside>
        </div>
      </div>}
    </div>
    {authOpen && <AuthChooser returnPath={`/games/${gameId}`} intent={{ kind: "participate", gameId }} onClose={() => setAuthOpen(false)} />}
  </ConsumerShell>;
}

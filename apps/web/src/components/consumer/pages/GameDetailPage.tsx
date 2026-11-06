"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getGame, getMe, getMyManagedGame, listAllMyParticipations, requestParticipation } from "../../../lib/api-client";
import { getGameChat } from "../../../lib/messaging-api";
import type { Game, GameDetail, Me, Participation } from "../../../lib/consumer-types";
import { canRequestParticipation, capacityStatusLabel, dominantParticipation, participationLabel, settlementTerms } from "../../../lib/game-presentation";
import { AuthChooser } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { GameHero, GameTerms, GameStatusBadge } from "../games/GameDetailComposition";
import { GameShare } from "../games/GameShare";
import { GameRecommendationButton } from "../games/GameRecommendationButton";
import { GameActionBar } from "../games/GameActionBar";
import { GameVenueContacts } from "../games/GameVenueContacts";
import { GameCourtBookingPanel } from "../games/GameCourtBooking";
import { CommentsSection } from "../comments/CommentsSection";
import { isRecommendableGame } from "../../../lib/game-recommendations";

function ParticipationActions({ game, own, busy, notice, readable, checkingParticipation, onRequest, onReload }: {
  game: Game; own: Participation | null; busy: boolean; notice: string | null;
  readable: boolean; checkingParticipation: boolean; onRequest: () => void; onReload: () => void;
}) {
  const cancelled = game.status === "cancelled";
  const status = cancelled ? "cancelled_by_game" : own?.status;
  return <GameActionBar>
    {checkingParticipation ? <p role="status">Проверяем участие</p>
      : !readable ? <><strong>Не удалось проверить участие</strong><p>Обновите данные перед отправкой заявки.</p><Button variant="outline" disabled={busy} onClick={onReload}>Проверить участие</Button></>
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

/** Confirmed participant only — pending/terminal statuses are not private-surface membership. */
function isConfirmedMember(own: Participation | null): boolean {
  return own?.status === "confirmed";
}

/** Chat is available only for published games that have not ended yet. */
function isChatWindowOpen(game: GameDetail, now = Date.now()): boolean {
  if (game.status !== "published") return false;
  const ends = Date.parse(game.endsAt);
  return Number.isFinite(ends) && ends > now;
}

export function GameDetailPage({ gameId }: { gameId: string }) {
  const [authOpen, setAuthOpen] = useState(false);
  const [game, setGame] = useState<GameDetail | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [own, setOwn] = useState<Participation | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [chatAvailable, setChatAvailable] = useState(false);
  const [courtEligible, setCourtEligible] = useState(false);
  const [readable, setReadable] = useState(false);
  const [checkingParticipation, setCheckingParticipation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    // Clear private surfaces before any await so route/account switches never flash old actor data.
    setState("loading");
    setGame(null);
    setChatAvailable(false);
    setCourtEligible(false);
    setReadable(false);
    setCheckingParticipation(true);
    setOwn(null);
    setMe(null);

    const result = await getGame(gameId);
    if (current !== generation.current) return;
    if (!result.ok) { setGame(null); setCheckingParticipation(false); setState("error"); return; }
    setGame(result.data);
    // Public game is enough for the page body; private probes must not delay that paint.
    setState("ready");

    const account = await getMe();
    if (current !== generation.current) return;
    if (!account.ok) {
      // Guest 401 → normal auth CTA; other auth failures keep retry error after checking clears.
      if (account.status === 401) setReadable(true);
      setCheckingParticipation(false);
      return;
    }
    setMe(account.data);

    const parts = await listAllMyParticipations();
    if (current !== generation.current) return;
    let participation: Participation | null = null;
    if (parts.ok) {
      participation = dominantParticipation(parts.data, gameId);
      setOwn(participation);
      setReadable(true);
    }
    // Participation proof resolved (ok or failed) — clear checking before any private follow-ups.
    setCheckingParticipation(false);

    const confirmed = isConfirmedMember(participation);
    let managed = false;
    if (!confirmed) {
      // Authoritative owner/manager evidence — never guess from organizer.id / createdByMe.
      const managedResult = await getMyManagedGame(gameId);
      if (current !== generation.current) return;
      if (managedResult.ok && managedResult.data) managed = true;
      // Failed/unknown managed proof: leave private surfaces idle (no speculative GET).
    }

    const member = confirmed || managed;
    setCourtEligible(member);

    if (member && isChatWindowOpen(result.data)) {
      if (current !== generation.current) return;
      const chat = await getGameChat(gameId);
      if (current !== generation.current) return;
      setChatAvailable(chat.ok && chat.data.lifecycleState === "active");
    }
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
      <header className="gb-page-local-header gb-game-detail-header">
        <div className="gb-page-local-header__row">
          <Button variant="ghost" className="gb-game-back" href="/games">← Все игры</Button>
        </div>
      </header>
      {state === "loading" && <div className="gb-game-feedback" data-state="loading" role="status"><h1>Загружаем игру</h1><p>Скоро покажем место, время и условия.</p></div>}
      {state === "error" && <div className="gb-game-feedback" data-state="error"><h1>Игра недоступна</h1><p>Не удалось загрузить игру. Проверьте соединение и попробуйте ещё раз.</p><Button onClick={() => void reload()}>Обновить</Button></div>}
      {state === "ready" && game && game.id === gameId && <div data-state="ready">
        <GameHero game={game} />
        <section className="gb-game-detail-contextual" aria-label="Об этой игре">
          <div className="gb-game-detail-contextual__secondary">
            <h2>Об этой игре</h2>
            <div className="gb-game-detail-contextual__actions">
              {isRecommendableGame(game) && (
                <GameRecommendationButton gameId={game.id} me={me} eligible onLogin={() => setAuthOpen(true)} />
              )}
              <GameShare gameId={game.id} label="Поделиться" />
            </div>
            {isRecommendableGame(game) ? <small>Совет другу не резервирует место</small> : null}
          </div>
          <div className="gb-game-detail-contextual__primary">
            <div className="gb-game-booking__terms"><strong>{capacityStatusLabel(game)}</strong><p>{settlementTerms(game.settlement)}</p></div>
            <ParticipationActions game={game} own={own} busy={busy} notice={notice} readable={readable} checkingParticipation={checkingParticipation} onRequest={() => void onRequest()} onReload={() => void reload()} />
          </div>
        </section>
        <div className="gb-game-detail-grid">
          <div>
            <GameTerms
              game={game}
              csrfToken={me?.csrfToken ?? null}
              onLogin={() => setAuthOpen(true)}
            />
            {me && <GameVenueContacts venue={game.venue} />}
            {me && courtEligible && <GameCourtBookingPanel gameId={game.id} meId={me.id} csrfToken={me.csrfToken} />}
            {chatAvailable && (
              <section className="gb-game-chat-section" aria-label="Чат игры">
                <Button variant="outline" href={`/messages?game=${encodeURIComponent(gameId)}`}>Чат игры →</Button>
              </section>
            )}
            {game.status === "published" && game.visibility === "public" ? (
              <CommentsSection
                kind="game"
                entityId={game.id}
                me={me}
                parentPublic
                authReturnPath={`/games/${gameId}`}
                description="Вопросы об этой игре и короткий разговор до встречи"
              />
            ) : null}
          </div>
          <aside className="gb-game-booking gb-game-booking--note" aria-label="Перед встречей">
            <strong>Перед встречей</strong>
            <p>Проверьте время, место и условия участия.</p>
            <small>{game.venue.name}</small>
            <p>{game.venue.address}</p>
          </aside>
        </div>
      </div>}
    </div>
    {authOpen && <AuthChooser returnPath={`/games/${gameId}`} intent={{ kind: "participate", gameId }} onClose={() => setAuthOpen(false)} />}
  </ConsumerShell>;
}

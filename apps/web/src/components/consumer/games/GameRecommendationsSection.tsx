"use client";

import { useEffect, useState } from "react";
import type { SocialCapabilities } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import { getSocialCapabilities } from "../../../lib/friendships";
import {
  formatRecommendationWhen,
  hideGameRecommendationPath,
  listGameRecommendations,
  recommendationMutationScope,
  recommendationsUiEnabled,
  useGameRecommendationMutation,
  withdrawGameRecommendationPath,
  type GameRecommendation,
  type GameRecommendationReceipt,
  type GameRecommendationView,
} from "../../../lib/game-recommendations";
import { privateViews } from "../../../lib/private-view";
import { Button } from "../Button";
import { ProfileState } from "../players/ProfileComposition";
import { MutationNotice } from "../messages/MessageComposition";

type LoadState = "loading" | "ready" | "unavailable" | "error" | "guest";

/**
 * «Мои игры» inbox for received/sent recommendations.
 * Clears private content on logout/expiry/session switch; never invents empty success when gated off.
 */
export function GameRecommendationsSection({ me }: { me: Me }) {
  const [view, setView] = useState<GameRecommendationView>("received");
  const [items, setItems] = useState<GameRecommendation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [capabilities, setCapabilities] = useState<SocialCapabilities | null>(null);
  const [reload, setReload] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);

  const mutationScope = recommendationMutationScope(me.id, `game-rec:${view}`);
  const mutation = useGameRecommendationMutation<GameRecommendationReceipt>(
    mutationScope,
    me.id,
    me.csrfToken,
    () => {
      setActingId(null);
      setItems([]);
      setCursor(null);
      setState("loading");
      setReload((n) => n + 1);
    },
    () => {
      setActingId(null);
      setItems([]);
      setCursor(null);
      setState("loading");
      setReload((n) => n + 1);
    },
  );

  useEffect(() => {
    let live = true;
    setState("loading");
    if (!cursor) setItems([]);
    setNextCursor(null);
    const release = privateViews.retain(privateViews.currentGeneration);
    const clearPrivate = () => {
      live = false;
      setItems([]);
      setCapabilities(null);
      setNextCursor(null);
      setState("guest");
    };
    const onSession = () => {
      clearPrivate();
      setReload((n) => n + 1);
    };
    const onForeground = () => {
      if (document.visibilityState === "visible") {
        live = false;
        setItems([]);
        setCursor(null);
        setState("loading");
        setReload((n) => n + 1);
      }
    };
    window.addEventListener("gb-private-expired", clearPrivate);
    window.addEventListener("gb-session-changed", onSession);
    document.addEventListener("visibilitychange", onForeground);
    void (async () => {
      const caps = await getSocialCapabilities();
      if (!live) return;
      if (!caps.ok) {
        setState(caps.status === 401 ? "guest" : [403, 404, 503].includes(caps.status) ? "unavailable" : "error");
        return;
      }
      setCapabilities(caps.data);
      if (!recommendationsUiEnabled(caps.data)) {
        setItems([]);
        setState("unavailable");
        return;
      }
      const page = await listGameRecommendations(view, cursor);
      if (!live) return;
      if (!page.ok) {
        // Absent/failed list must not clear an UNKNOWN write pending in module Map.
        setState(page.status === 401 ? "guest" : [403, 404, 503].includes(page.status) ? "unavailable" : "error");
        return;
      }
      setItems((prev) => (cursor ? [...prev, ...page.data.items] : page.data.items));
      setNextCursor(page.data.nextCursor);
      setState("ready");
    })();
    return () => {
      live = false;
      release?.();
      window.removeEventListener("gb-private-expired", clearPrivate);
      window.removeEventListener("gb-session-changed", onSession);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [me.id, me.csrfToken, view, cursor, reload]);

  function switchView(next: GameRecommendationView) {
    if (next === view || mutation.busy || mutation.pending) return;
    setView(next);
    setCursor(null);
    setItems([]);
    setState("loading");
  }

  function act(item: GameRecommendation) {
    if (mutation.busy || mutation.pending || !recommendationsUiEnabled(capabilities)) return;
    setActingId(item.id);
    if (view === "received") {
      mutation.run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    } else if (item.state === "active") {
      mutation.run(withdrawGameRecommendationPath(item.id), { expectedVersion: item.version });
    }
  }

  const title = view === "received" ? "Вам советуют игру" : "Вы советовали игры";
  const locked = mutation.busy || mutation.pending;

  return (
    <section className="gb-personal-list" data-surface="game-recommendations" data-view={view}>
      <header className="gb-personal-list__heading">
        <div>
          <span className="gb-game-kicker">Рекомендации друзей</span>
          <h2>{title}</h2>
          <p className="gb-c23-helper">
            Совет не резервирует место и не создаёт приглашение организатора. Участие оформляется отдельно.
          </p>
        </div>
        {state === "ready" && (items.length > 0 || !nextCursor) ? <b>{items.length}</b> : null}
      </header>
      <div className="gb-game-segmented" role="group" aria-label="Рекомендации">
        <button type="button" aria-pressed={view === "received"} disabled={locked} onClick={() => switchView("received")}>
          Вам советуют
        </button>
        <button type="button" aria-pressed={view === "sent"} disabled={locked} onClick={() => switchView("sent")}>
          Вы советовали
        </button>
      </div>
      <MutationNotice mutation={mutation} />
      {mutation.pending ? (
        <div className="profile-form-actions">
          <Button variant="outline" disabled={mutation.busy} onClick={() => mutation.rereadOwnList()}>
            Обновить свой список
          </Button>
        </div>
      ) : null}
      {state === "loading" && <ProfileState title="Загружаем рекомендации…" state="loading" />}
      {state === "guest" && <ProfileState title="Войдите снова">Личные рекомендации скрыты после выхода или истечения сессии.</ProfileState>}
      {state === "unavailable" && (
        <ProfileState title="Рекомендации сейчас недоступны">Попробуйте позже.</ProfileState>
      )}
      {state === "error" && (
        <ProfileState
          title="Не удалось загрузить рекомендации"
          state="error"
          retry={() => {
            setCursor(null);
            setReload((n) => n + 1);
          }}
        >
          Обновите раздел перед действиями.
        </ProfileState>
      )}
      {state === "ready" && items.length === 0 && !nextCursor && (
        <ProfileState title={view === "received" ? "Пока нет советов" : "Вы ещё никому не советовали"}>
          {view === "received"
            ? "Когда друг посоветует публичную игру, она появится здесь."
            : "Совет другу можно отправить со страницы публичной будущей игры."}
        </ProfileState>
      )}
      {state === "ready" && items.length === 0 && nextCursor ? (
        <ProfileState title="Проверяем доступные советы">
          На этой странице нет видимых записей. Загрузите следующую — список ещё не исчерпан.
        </ProfileState>
      ) : null}
      {state === "ready" && items.length > 0 && (
        <div className="gb-personal-list-items">
          {items.map((item) => (
            <article key={item.id} className="gb-personal-card" data-recommendation-state={item.state}>
              <div className="gb-personal-card__status">
                <span className="gb-game-status" data-tone={item.state === "active" ? "confirmed" : "subtle"}>
                  {view === "received" ? "Совет друга" : item.state === "active" ? "Отправлено" : "Отозвано"}
                </span>
                <small>{view === "received" ? `От ${item.peer.displayName}` : `Для ${item.peer.displayName}`}</small>
              </div>
              <div className="gb-personal-card__body">
                <h3>{item.game.title}</h3>
                <strong>{formatRecommendationWhen(item.game)}</strong>
                <p>Место не зарезервировано. Откройте игру, чтобы оставить заявку при доступности.</p>
              </div>
              <div className="gb-personal-card__action profile-form-actions">
                <Button variant="outline" href={`/games/${encodeURIComponent(item.game.id)}`}>
                  Открыть игру
                </Button>
                {view === "received" ? (
                  <Button
                    variant="outline"
                    disabled={locked}
                    loading={locked && actingId === item.id}
                    onClick={() => act(item)}
                  >
                    Скрыть
                  </Button>
                ) : item.state === "active" ? (
                  <Button
                    variant="outline"
                    disabled={locked}
                    loading={locked && actingId === item.id}
                    onClick={() => act(item)}
                  >
                    Отозвать совет
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      {state === "ready" && nextCursor ? (
        <div className="profile-form-actions">
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => {
              setState("loading");
              setCursor(nextCursor);
            }}
          >
            Ещё
          </Button>
        </div>
      ) : null}
    </section>
  );
}

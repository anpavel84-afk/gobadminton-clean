"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { SocialCapabilities } from "@gobadminton/contracts/friendship-types";
import { getMySocialProfile } from "../../../lib/api-client";
import type { Me, OwnSocialProfile } from "../../../lib/consumer-types";
import { getSocialCapabilities } from "../../../lib/friendships";
import {
  formatRecommendationWhen,
  hideGameRecommendationPath,
  listGameRecommendations,
  recommendationMutationScope,
  recommendationsUiEnabled,
  useGameRecommendationMutation,
  withdrawGameRecommendationPath,
} from "../../../lib/game-recommendations";
import type { GameRecommendation, GameRecommendationReceipt, GameRecommendationView } from "../../../lib/game-recommendations";
import { privateViews } from "../../../lib/private-view";
import { Button } from "../Button";
import { ProfileState } from "../players/ProfileComposition";
import { MutationNotice } from "../messages/MessageComposition";

type LoadState = "loading" | "ready" | "unavailable" | "error" | "guest" | "prerequisite";

/** Own profile must be saved and publicly eligible before recommendation lists are admitted. */
function ownRecommendationsPrerequisite(profile: OwnSocialProfile): boolean {
  return profile.version < 1 || !profile.directoryVisible || !profile.socialEligible;
}

/**
 * «Мои игры» inbox for received/sent recommendations.
 * Clears private content on logout/expiry/session switch; never invents empty success when gated off.
 */
export function GameRecommendationsSection({
  me,
  initialView = "received",
  fixedView, compact = false, gameIds, renderWithGames, showEmpty = false,
}: {
  me: Me;
  /** Entry from send recovery (`/my-games?rec=sent`) — opens actor-owned sent list. */
  initialView?: GameRecommendationView;
  fixedView?: GameRecommendationView;
  compact?: boolean;
  showEmpty?: boolean;
  gameIds?: ReadonlySet<string>;
  renderWithGames?: (attached: ReadonlyMap<string, ReactNode>, secondary: ReactNode) => ReactNode;
}) {
  const [view, setView] = useState<GameRecommendationView>(fixedView ?? initialView);
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
    const generation = privateViews.currentGeneration;
    const release = privateViews.retain(generation);
    const current = () => live && generation === privateViews.currentGeneration;
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
      if (!current()) return;
      if (!caps.ok) {
        setState(caps.status === 401 ? "guest" : [403, 404, 503].includes(caps.status) ? "unavailable" : "error");
        return;
      }
      setCapabilities(caps.data);
      if (!recommendationsUiEnabled(caps.data)) {
        // Do not fetch private recommendation lists while capability is denied.
        setItems([]);
        const social = await getMySocialProfile();
        if (!current()) return;
        if (!social.ok) {
          setState(social.status === 401 ? "guest" : "error");
          return;
        }
        setState(ownRecommendationsPrerequisite(social.data) ? "prerequisite" : "unavailable");
        return;
      }
      const page = await listGameRecommendations(view, cursor);
      if (!current()) return;
      if (!page.ok) {
        if (page.status === 401 || page.status === 403 || page.status === 404) setItems([]);
        // Absent/failed list must not clear an UNKNOWN write pending in module Map.
        setState(page.status === 401 ? "guest" : [403, 404, 503].includes(page.status) ? "unavailable" : "error");
        return;
      }
      setItems((prev) => [...new Map((cursor ? [...prev, ...page.data.items] : page.data.items).map((item) => [item.id, item])).values()]);
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
    if (state !== "ready" || mutation.busy || mutation.pending || !privateViews.hasView(privateViews.currentGeneration) || !recommendationsUiEnabled(capabilities)) return;
    setActingId(item.id);
    if (view === "received") {
      mutation.run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    } else if (item.state === "active") {
      mutation.run(withdrawGameRecommendationPath(item.id), { expectedVersion: item.version });
    }
  }

  const title = view === "received" ? "Вам советуют игру" : "Вы советовали игры";
  const locked = mutation.busy || mutation.pending;

  function renderItem(item: GameRecommendation, attached = false) {
    const Tag = attached ? "div" : "article";
    return (
            <Tag key={item.id} className={attached ? "gb-my-game-subline gb-my-game-advice" : "gb-personal-card"} data-recommendation-state={item.state}>
              <div className="gb-personal-card__status">
                <span className="gb-game-status" data-tone={item.state === "active" ? "confirmed" : "subtle"}>
                  {view === "received" ? "Совет друга" : item.state === "active" ? "Отправлено" : "Отозвано"}
                </span>
                <small>{view === "received" ? `От ${item.peer.displayName}` : `Для ${item.peer.displayName}`}</small>
              </div>
              <div className="gb-personal-card__body">
                {!attached ? <h3>{item.game.title}</h3> : null}
                {!attached ? <strong>{formatRecommendationWhen(item.game)}</strong> : null}
                {!attached ? <p>Место не зарезервировано. Откройте игру, чтобы оставить заявку при доступности.</p> : null}
              </div>
              <div className="gb-personal-card__action profile-form-actions">
                {!attached ? <Button variant="outline" href={`/games/${encodeURIComponent(item.game.id)}`}>
                  Открыть игру
                </Button> : null}
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
            </Tag>
    );
  }
  const attached = new Map<string, ReactNode>();
  if (view === "received" && gameIds) {
    for (const id of gameIds) {
      const sameGame = items.filter((item) => item.game.id === id);
      if (sameGame.length) attached.set(id, <>{sameGame.map((item) => renderItem(item, true))}</>);
    }
  }
  const secondaryItems = view === "received" && gameIds ? items.filter((item) => !gameIds.has(item.game.id)) : items;
  const secondaryGroups = new Map<string, GameRecommendation[]>();
  for (const item of secondaryItems) {
    secondaryGroups.set(item.game.id, [...(secondaryGroups.get(item.game.id) ?? []), item]);
  }
  const hidden = compact && !showEmpty && state === "ready" && !secondaryItems.length && !nextCursor && !mutation.pending && !mutation.notice;
  const section = hidden ? null : (
    <section className="gb-personal-list gb-my-games-recommendations" data-surface="game-recommendations" data-view={view}>
      <header className="gb-personal-list__heading">
        <span className="gb-game-kicker">Рекомендации друзей</span>
        <div className="gb-personal-list__title">
          <h2>{title}</h2>
          {!compact && state === "ready" && (items.length > 0 || !nextCursor) ? <b>{items.length}{nextCursor ? "+" : ""}</b> : null}
        </div>
        <p className="gb-c23-helper">
          Совет не резервирует место и не создаёт приглашение организатора. Участие оформляется отдельно.
        </p>
      </header>
      {!fixedView ? <div className="gb-game-segmented" role="group" aria-label="Рекомендации">
        <button type="button" aria-pressed={view === "received"} disabled={locked} onClick={() => switchView("received")}>
          Вам советуют
        </button>
        <button type="button" aria-pressed={view === "sent"} disabled={locked} onClick={() => switchView("sent")}>
          Вы советовали
        </button>
      </div> : null}
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
      {state === "prerequisite" && (
        <ProfileState title="Сначала настройте свой профиль">
          Сохраните игровой профиль и включите видимость в каталоге. <Link href="/profile">Открыть профиль</Link>
        </ProfileState>
      )}
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
      {state === "ready" && secondaryItems.length === 0 && nextCursor ? (
        <ProfileState title="Проверяем доступные советы">
          На этой странице нет видимых записей. Загрузите следующую — список ещё не исчерпан.
        </ProfileState>
      ) : null}
      {secondaryItems.length > 0 && (
        <div className="gb-personal-list-items">
          {compact ? [...secondaryGroups].map(([id, group]) => {
            const firstItem = group[0];
            if (!firstItem) return null;
            return <article key={id} className="gb-personal-card" data-game-id={id}>
              <div className="gb-personal-card__body"><h3>{firstItem.game.title}</h3><strong>{formatRecommendationWhen(firstItem.game)}</strong><p>Совет не подтверждает участие или наличие мест.</p></div>
              <Button variant="outline" href={`/games/${encodeURIComponent(id)}`}>Открыть игру</Button>
              {group.map((item) => renderItem(item, true))}
            </article>;
          }) : secondaryItems.map((item) => renderItem(item))}
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
  return renderWithGames ? <>{renderWithGames(attached, section)}</> : section;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getGame,
  getMe,
  listAllMyManagedGames,
  listAllMyParticipations,
} from "../../../lib/api-client";
import type { Game, ManagedGame, Me, Participation } from "../../../lib/consumer-types";
import {
  isActiveCreatedGame,
  isParticipatingHistoryRow,
  managedGameRelationLabel,
  participationLabel,
} from "../../../lib/game-presentation";
import { AuthEntry } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { PersonalGameCard, GameStatusBadge } from "../games/GameDetailComposition";
import { GameRecommendationsSection } from "../games/GameRecommendationsSection";

type Relation = "participating" | "created";
type View = "upcoming" | "history";

type ParticipationRow = {
  participation: Participation;
  game: Game | null;
  gameError?: string;
};

export function MyGamesPage() {
  const router = useRouter();
  const search = useSearchParams();
  const relation: Relation =
    search.get("tab") === "created" ? "created" : "participating";
  const view: View = search.get("view") === "history" ? "history" : "upcoming";
  const recommendationsEntry = search.get("rec") === "sent" ? "sent" : "received";
  const [rows, setRows] = useState<ParticipationRow[]>([]);
  const [created, setCreated] = useState<ManagedGame[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error" | "auth">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    setRows([]);
    setCreated([]);
    setMe(null);
    const clearPrivate = () => {
      cancelled = true;
      setMe(null);
      setRows([]);
      setCreated([]);
      setState("auth");
    };
    const onSession = () => {
      clearPrivate();
      setReloadToken((token) => token + 1);
    };
    window.addEventListener("gb-private-expired", clearPrivate);
    window.addEventListener("gb-session-changed", onSession);
    void (async () => {
      const account = await getMe();
      if (cancelled) return;
      if (!account.ok) {
        setState(account.status === 401 ? "auth" : "error");
        setError("Не удалось проверить вход. Попробуйте ещё раз.");
        return;
      }
      setMe(account.data);

      if (relation === "created") {
        // Include owner + non-creator manager rows from /v1/me/games.
        const managed = await listAllMyManagedGames();
        if (cancelled) return;
        if (!managed.ok) {
          setMe(null);
          setState("error");
          setError("Не удалось загрузить управляемые игры.");
          return;
        }
        setCreated(managed.data);
        setState("ready");
        return;
      }

      const parts = await listAllMyParticipations();
      if (!parts.ok) {
        if (cancelled) return;
        setMe(null);
        setState("error");
        setError("Не удалось загрузить ваши заявки.");
        return;
      }
      const next: ParticipationRow[] = [];
      for (const participation of parts.data) {
        const game = await getGame(participation.gameId);
        next.push({
          participation,
          game: game.ok ? game.data : null,
          gameError: game.ok ? undefined : game.error,
        });
      }
      if (cancelled) return;
      setRows(next);
      setState("ready");
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("gb-private-expired", clearPrivate);
      window.removeEventListener("gb-session-changed", onSession);
    };
  }, [relation, reloadToken]);

  const visibleCreated = useMemo(() => {
    return created.filter((game) =>
      view === "history"
        ? !isActiveCreatedGame(game)
        : isActiveCreatedGame(game),
    );
  }, [created, view]);

  const visibleRows = useMemo(() => {
    return rows.filter(({ participation, game }) => {
      const history = isParticipatingHistoryRow(game, participation.status);
      return view === "history" ? history : !history;
    });
  }, [rows, view]);

  const returnPath =
      relation === "created"
        ? view === "history"
          ? "/my-games?tab=created&view=history"
          : "/my-games?tab=created"
        : view === "history"
          ? "/my-games?view=history"
          : "/my-games";


  function retry() {
    setReloadToken((token) => token + 1);
  }

  function go(nextRelation: Relation, nextView: View) {
    const params = new URLSearchParams();
    if (nextRelation === "created") params.set("tab", "created");
    if (nextView === "history") params.set("view", "history");
    const qs = params.toString();
    router.replace(qs ? `/my-games?${qs}` : "/my-games");
  }

  function setView(next: View) {
    go(relation, next);
  }

  const listCount =
    relation === "created" ? visibleCreated.length : visibleRows.length;

  return (
    <ConsumerShell active="my-games" title="Мои игры" hideHeading>
      <div className="gb-my-games" data-surface="my-games" data-view={view}>
        <header className="gb-my-games-header">
          <div>
            <h1>Мои игры</h1>
            <p>Заявки, участия и игры, которыми вы управляете.</p>
          </div>
          <Button href="/games/create">Создать игру</Button>
        </header>
        <section className="gb-relationship-bar" aria-label="Разделы моих игр">
          <div className="gb-game-segmented" role="group" aria-label="Отношение к играм">
            <button type="button" aria-pressed={relation === "participating" && view === "upcoming"} onClick={() => go("participating", "upcoming")}>Участвую</button>
            <button type="button" aria-pressed={relation === "created" && view === "upcoming"} onClick={() => go("created", "upcoming")}>Управляю</button>
            <button type="button" aria-pressed={view === "history"} onClick={() => go(relation, "history")}>История</button>
          </div>
        </section>
        <div className="gb-my-games-layout">
          <div className="gb-my-games-layout__main">
        {state === "ready" ? (
          <header className="gb-personal-list__heading gb-personal-list">
            <div>
              <span className="gb-game-kicker">
                {view === "history"
                  ? "Прошедшие и завершённые"
                  : relation === "created"
                    ? "Созданные мной и управляемые"
                    : "Ближайшие события"}
              </span>
              <h2>
                {view === "history"
                  ? relation === "created"
                    ? "История управляемых игр"
                    : "История участий"
                  : relation === "created"
                    ? "Игры под управлением"
                    : "Участие в играх"}
              </h2>
            </div>
            <b>{listCount}</b>
          </header>
        ) : null}
        {view === "history" && state === "ready" ? (
          <p className="gb-c23-helper" data-surface="history-disclaimer">
            История показывает исход заявки или статус управляемой игры. Это не
            подтверждает присутствие на площадке и не означает оплату.
          </p>
        ) : null}
        {state === "auth" ? (
          <div className="gb-game-feedback" data-state="auth">
            <h2>
              {relation === "created"
                ? "Войдите, чтобы видеть управляемые игры"
                : "Войдите, чтобы видеть свои заявки"}
            </h2>
            <p>
              {relation === "created"
                ? "Здесь будут игры, которые вы создали или которыми управляете."
                : "Здесь будут ваши заявки и участия."}
            </p>
            <AuthEntry returnPath={returnPath} />
            {error ? <p className="gb-game-helper">{error}</p> : null}
          </div>
        ) : null}

        {state === "loading" ? (
          <div className="gb-game-feedback" data-state="loading">
            <h2>
              {relation === "created"
                ? "Загружаем управляемые игры"
                : "Загружаем ваши игры"}
            </h2>
            <p>
              {relation === "created"
                ? "Ищем созданные вами и управляемые игры…"
                : "Ищем ваши заявки и участия…"}
            </p>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="gb-game-feedback" data-state="error">
            <h2>Не удалось загрузить</h2>
            <p>{error}</p>
            <Button variant="primary" onClick={retry}>
              Обновить
            </Button>
          </div>
        ) : null}

        {relation === "created" && state === "ready" && listCount === 0 ? (
          <div
            className="gb-game-feedback"
            data-state="empty"
            data-list="managed-by-me"
          >
            <h2>
              {view === "history"
                ? "В истории пока пусто"
                : "Пока нет игр под управлением"}
            </h2>
            <p>
              {view === "history"
                ? "Завершённые и отменённые созданные или управляемые игры появятся здесь из серверного списка."
                : "Создайте игру или получите роль менеджера — записи появятся здесь с пометкой «Создана мной» или «Управляю»."}
            </p>
            {view === "upcoming" ? (
              <Button variant="primary" href="/games/create">
                Создать игру
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setView("upcoming")}>
                К текущим управляемым
              </Button>
            )}
          </div>
        ) : null}

        {relation === "created" && state === "ready" && listCount > 0 ? (
          <div className="gb-personal-list-items" data-list="managed-by-me">
            {visibleCreated.map((game) => (
              <PersonalGameCard
                key={game.id}
                game={game}
                owned
                managementRelation={managedGameRelationLabel(game.management)}
              />
            ))}
          </div>
        ) : null}

        {relation === "participating" && state === "ready" && listCount === 0 ? (
          <div className="gb-game-feedback" data-state="empty">
            <h2>
              {view === "history" ? "В истории пока пусто" : "Пока нет участий"}
            </h2>
            <p>
              {view === "history"
                ? "Прошедшие игры и завершённые заявки появятся здесь из серверного списка."
                : "Найдите игру и оставьте заявку. Здесь появятся ответ организатора и информация об участии."}
            </p>
            {view === "history" ? (
              <Button variant="primary" onClick={() => setView("upcoming")}>
                К ближайшим
              </Button>
            ) : (
              <Button variant="primary" href="/games">
                К играм
              </Button>
            )}
          </div>
        ) : null}

        {relation === "participating" && state === "ready" && listCount > 0 ? (
          <div className="gb-personal-list-items">
            {visibleRows.map(({ participation, game }) =>
              game ? (
                <PersonalGameCard
                  key={participation.id}
                  game={game}
                  ownStatus={participation.status}
                />
              ) : (
                <div key={participation.id} className="gb-game-feedback">
                  <GameStatusBadge tone={participation.status}>
                    {participationLabel(participation.status)}
                  </GameStatusBadge>
                  <h3>Детали игры недоступны</h3>
                  <p>
                    Не удалось загрузить место и время. Ваша заявка сохранена.
                  </p>
                  <Button variant="outline" onClick={retry}>
                    Обновить
                  </Button>
                </div>
              ),
            )}
          </div>
        ) : null}
          </div>
          {state === "ready" && me && view === "upcoming" ? (
            <aside className="gb-my-games-layout__rail" aria-label="Советы и приглашения">
              <GameRecommendationsSection me={me} initialView={recommendationsEntry} />
              <section className="gb-my-games-invites">
                <h2>Приглашения</h2>
                <p>Приглашения в игру находятся в сообщениях.</p>
                <Button variant="outline" href="/messages">К сообщениям</Button>
              </section>
            </aside>
          ) : null}
        </div>
      </div>
    </ConsumerShell>
  );
}

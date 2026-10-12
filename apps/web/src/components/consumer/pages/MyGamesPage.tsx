"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getGame,
  getMe,
  listAllMyManagedGames,
  listAllMyParticipations,
} from "../../../lib/api-client";
import type { Game, ManagedGame, Participation } from "../../../lib/consumer-types";
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
  const [rows, setRows] = useState<ParticipationRow[]>([]);
  const [created, setCreated] = useState<ManagedGame[]>([]);
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
    void (async () => {
      const me = await getMe();
      if (cancelled) return;
      if (!me.ok) {
        setState(me.status === 401 ? "auth" : "error");
        setError("Не удалось проверить вход. Попробуйте ещё раз.");
        return;
      }

      if (relation === "created") {
        // Include owner + non-creator manager rows from /v1/me/games.
        const managed = await listAllMyManagedGames();
        if (cancelled) return;
        if (!managed.ok) {
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

  function setRelation(next: Relation) {
    const params = new URLSearchParams();
    if (next === "created") params.set("tab", "created");
    if (view === "history") params.set("view", "history");
    const qs = params.toString();
    router.replace(qs ? `/my-games?${qs}` : "/my-games");
  }

  function setView(next: View) {
    const params = new URLSearchParams();
    if (relation === "created") params.set("tab", "created");
    if (next === "history") params.set("view", "history");
    const qs = params.toString();
    router.replace(qs ? `/my-games?${qs}` : "/my-games");
  }

  const listCount =
    relation === "created" ? visibleCreated.length : visibleRows.length;

  return (
    <ConsumerShell active="my-games" title="Мои игры" hideHeading>
      <div className="gb-my-games" data-surface="my-games" data-view={view}>
        <header className="gb-my-games-header">
          <div>
            <span className="gb-game-kicker">Личный раздел</span>
            <h1>Мои игры</h1>
            <p>
              Заявки, подтверждённые игры и события, которые вы создали. История
              строится только из уже доступных серверных записей.
            </p>
          </div>
          <Button href="/games/create">+ Создать игру</Button>
        </header>
        <section className="gb-relationship-bar">
          <div
            className="gb-game-segmented"
            role="group"
            aria-label="Отношение к играм"
          >
            <button
              type="button"
              aria-pressed={relation === "participating"}
              onClick={() => setRelation("participating")}
            >
              Участвую
            </button>
            <button
              type="button"
              aria-pressed={relation === "created"}
              onClick={() => setRelation("created")}
            >
              Управляю
            </button>
          </div>
          <button
            type="button"
            className="gb-history-link"
            aria-pressed={view === "history"}
            data-active={view === "history" ? "true" : "false"}
            onClick={() =>
              setView(view === "history" ? "upcoming" : "history")
            }
          >
            {relation === "created"
              ? view === "history"
                ? "К текущим управляемым"
                : "История управляемых игр"
              : view === "history"
                ? "К ближайшим"
                : "История"}{" "}
            →
          </button>
        </section>
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
    </ConsumerShell>
  );
}

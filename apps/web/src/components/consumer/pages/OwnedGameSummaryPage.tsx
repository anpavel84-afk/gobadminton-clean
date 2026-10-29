"use client";
import { GameCoverEditor } from "../games/GameCoverEditor";
import { publishGame } from "../../../lib/api-client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmParticipation,
  getMe,
  getMyManagedGame,
  listAllGameParticipations,
  rejectParticipation,
  removeParticipation,
} from "../../../lib/api-client";
import type { ManagedGame, Me, Participation } from "../../../lib/consumer-types";
import { managedGameRelationLabel } from "../../../lib/game-presentation";
import {
  GameHero,
  GameTerms,
  GameStatusBadge,
} from "../games/GameDetailComposition";
import { ManagerApplicants } from "../games/ManagerApplicants";
import { AuthEntry } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";

/**
 * Managed Game summary + admitted participation manager controls.
 * Reachable for creator owners and non-creator managers from /v1/me/games.
 * Capacity / cancel / capacity-edit remain unavailable. Server enforces authz + seats.
 */
export function OwnedGameSummaryPage({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<ManagedGame | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [applicants, setApplicants] = useState<Participation[]>([]);
  const [state, setState] = useState<
    "loading" | "ready" | "error" | "auth" | "not-found"
  >("loading");
  const [applicantsState, setApplicantsState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mutation = useRef(false);
  const epoch = useRef(0);

  const loadApplicants = useCallback(async () => {
    const request = epoch.current;
    setApplicantsState("loading");
    const result = await listAllGameParticipations(gameId);
    if (request !== epoch.current) return;
    if (!result.ok) {
      setApplicants([]);
      setApplicantsState("error");
      return;
    }
    setApplicants(result.data);
    setApplicantsState("ready");
  }, [gameId]);

  useEffect(() => {
    let cancelled = false; ++epoch.current;
    setState("loading"); setGame(null); setMe(null); setApplicants([]); setApplicantsState("loading");
    setError(null);
    setNotice(null);
    void (async () => {
      const account = await getMe();
      if (cancelled) return;
      if (!account.ok) {
        if (account.status === 401) {
          setState("auth");
          return;
        }
        setState("error");
        setError("Не удалось проверить вход. Попробуйте ещё раз.");
        return;
      }
      setMe(account.data);
      const result = await getMyManagedGame(gameId);
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) {
          setState("auth");
          return;
        }
        setState("error");
        setError("Не удалось получить игру. Попробуйте ещё раз.");
        return;
      }
      if (!result.data) {
        setState("not-found");
        return;
      }
      setGame(result.data);
      setState("ready");
      await loadApplicants();
    })();
    return () => {
      cancelled = true; ++epoch.current;
    };
  }, [gameId, reloadToken, loadApplicants]);



  useEffect(() => {
    const changed = () => { ++epoch.current; setState("loading"); setGame(null); setMe(null); setApplicants([]); setReloadToken(n => n + 1); };
    window.addEventListener("gb-session-changed", changed);
    return () => window.removeEventListener("gb-session-changed", changed);
  }, []);

  const mutable =
    !!game &&
    game.status === "published" &&
    Date.parse(game.startsAt) > Date.now();

  async function onAction(
    action: "confirm" | "reject" | "remove",
    item: Participation,
    reason: string,
  ) {
    if (!me || !mutable || mutation.current) return;
    const request = epoch.current;
    mutation.current = true;
    setBusyId(item.id);
    setNotice(null);
    try {
      const result =
        action === "confirm"
          ? await confirmParticipation(item.id, item.version, me.csrfToken)
          : action === "reject"
            ? await rejectParticipation(
                item.id,
                item.version,
                reason,
                me.csrfToken,
              )
            : await removeParticipation(
                item.id,
                item.version,
                reason,
                me.csrfToken,
              );
      if (request !== epoch.current) return;
      if (!result.ok) {
        setNotice(
          result.status === 409
            ? "Состояние изменилось. Обновите список перед следующим действием."
            : result.status === 403
              ? "Недостаточно прав для этого действия."
              : "Не удалось выполнить действие. Проверяем актуальный список заявок.",
        );
      } else {
        setNotice(
          action === "confirm"
            ? "Заявка подтверждена."
            : action === "reject"
              ? "Заявка отклонена."
              : "Участие снято.",
        );
      }
      // Always reread Game + applicants; never assume client-side seat authority.
      const refreshed = await getMyManagedGame(gameId);
      if (request !== epoch.current) return;
      if (refreshed.ok && refreshed.data) { setGame(refreshed.data); await loadApplicants(); }
      else { setGame(null); setApplicants([]); setState(!refreshed.ok && refreshed.status === 401 ? "auth" : "not-found"); }
    } finally {
      mutation.current = false;
      setBusyId(null);
    }
  }

  const pendingCount = applicants.filter((item) => item.status === "pending")
    .length;

  return (
    <ConsumerShell active="my-games" title="Управление игрой" mode="local">
      <header className="gb-page-local-header">
        <Button variant="ghost" className="gb-game-back" href="/my-games?tab=created">
          ← Мои игры
        </Button>
      </header>

      {state === "loading" ? (
        <div className="gb-game-feedback" data-state="loading">
          <h2>Загружаем сводку</h2>
          <p>Загружаем информацию о вашей игре…</p>
        </div>
      ) : null}

      {state === "auth" ? (
        <div className="gb-game-feedback" data-state="auth">
          <h2>Нужен вход</h2>
          <p>
            Сводка управляемой игры доступна авторизованному создателю или
            менеджеру.
          </p>
          <AuthEntry returnPath={`/my-games/${gameId}`} />
          {error ? <p className="gb-c23-helper">{error}</p> : null}
        </div>
      ) : null}

      {state === "not-found" ? (
        <div className="gb-game-feedback" data-state="empty">
          <h2>Игра не в вашем списке управления</h2>
          <p>
            Возможно, доступ изменился. Вернитесь к списку управляемых игр.
          </p>
          <Button variant="primary" href="/my-games?tab=created">
            К управляемым
          </Button>
        </div>
      ) : null}

      {state === "error" ? (
        <div className="gb-game-feedback" data-state="error">
          <h2>Не удалось загрузить сводку</h2>
          <p>{error}</p>
          <Button onClick={() => setReloadToken((value) => value + 1)}>
            Обновить
          </Button>
        </div>
      ) : null}

      {state === "ready" && game ? (
        <div className="gb-owned-summary" data-surface="owned-summary">
          <GameHero game={game} preview={game.status === "draft"} />
          {me && (game.status === "draft" || game.status === "published") && <GameCoverEditor gameId={game.id} csrfToken={me.csrfToken} onChange={()=>setReloadToken(n=>n+1)}/>}
          {me && game.status === "draft" && <Button disabled={busyId!==null} onClick={async()=>{
            if(mutation.current)return;mutation.current=true;setBusyId("publish");const request=epoch.current;
            try {const result=await publishGame(game.id,game.version,me.csrfToken);if(request!==epoch.current)return;
              setNotice(result.ok?"Игра опубликована.":"Публикация не подтверждена. Проверьте состояние игры.");setReloadToken(n=>n+1);
            } finally {mutation.current=false;setBusyId(null);}
          }}>Опубликовать черновик</Button>}

          <div className="gb-game-detail-grid">
            <GameTerms game={game} showCapacity={false} />
            <aside className="gb-management-summary" aria-label="Управление игрой">
              <div className="gb-management-summary__status">
                <GameStatusBadge tone={game.status}>{({ draft: "Черновик", published: "Опубликовано", cancelled: "Игра отменена", completed: "Завершена" })[game.status]}</GameStatusBadge>
                <span data-field="management-relation">{managedGameRelationLabel(game.management)}</span>
                {applicantsState === "ready" && pendingCount > 0 && <GameStatusBadge tone="attention">{pendingCount} {pendingCount === 1 ? "заявка ждёт ответа" : "заявки ждут ответа"}</GameStatusBadge>}
              </div>
              <dl className="gb-management-counts">
                <div><dt>Подтверждено</dt><dd>{game.confirmedCount}</dd></div>
                <div><dt>Вне сервиса</dt><dd>{game.externalReservedCount}</dd></div>
                <div><dt>Вместимость</dt><dd>{game.capacity}</dd></div>
              </dl>
              <p className="gb-c23-helper">Изменение вместимости и отмена игры пока недоступны.</p>
              <div className="gb-game-form-actions">
                {game.status === "published" && <Button href={`/games/${game.id}`}>Открыть игру</Button>}
                <Button variant="outline" href="/my-games?tab=created">К управляемым играм</Button>
              </div>
            </aside>
          </div>

          {applicantsState === "loading" ? (
            <div className="gb-game-feedback" data-state="loading">
              <h2>Загружаем заявки</h2>
              <p>Получаем список участников…</p>
            </div>
          ) : null}
          {applicantsState === "error" ? (
            <div className="gb-game-feedback" data-state="error">
              <h2>Не удалось загрузить заявки</h2>
              <p>Без актуального списка действия недоступны.</p>
              <Button onClick={() => void loadApplicants()}>Обновить</Button>
            </div>
          ) : null}
          {applicantsState === "ready" ? (
            <ManagerApplicants
              items={applicants}
              mutable={mutable}
              busyId={busyId}
              notice={notice}
              onAction={(action, item, reason) =>
                void onAction(action, item, reason)
              }
              onReload={() => setReloadToken((value) => value + 1)}
            />
          ) : null}
        </div>
      ) : null}
    </ConsumerShell>
  );
}

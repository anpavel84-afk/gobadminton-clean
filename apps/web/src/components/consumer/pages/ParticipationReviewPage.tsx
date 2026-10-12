"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getGame,
  getMe,
  listAllMyParticipations,
  withdrawParticipation,
} from "../../../lib/api-client";
import type { Game, Me, Participation } from "../../../lib/consumer-types";
import {
  dominantParticipation,
  participationLabel,
} from "../../../lib/game-presentation";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { GameStatusBadge } from "../games/GameDetailComposition";

/**
 * Player withdraw/refuse — both map to admitted POST /participations/{id}/withdraw.
 * Fail closed: no fake success; reread after unknown results.
 */
export function ParticipationReviewPage({
  gameId,
  intent,
}: {
  gameId: string;
  intent: "withdraw" | "refuse";
}) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [own, setOwn] = useState<Participation | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "auth" | "error">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reload, setReload] = useState(0);
  const mutation = useRef(false);

  const title = intent === "withdraw" ? "Отзыв заявки" : "Отказ от участия";
  const expectedStatus = intent === "withdraw" ? "pending" : "confirmed";
  const actionLabel =
    intent === "withdraw" ? "Отозвать заявку" : "Отказаться от участия";

  useEffect(() => {
    let live = true;
    setState("loading");
    setNotice(null);
    void (async () => {
      const account = await getMe();
      if (!live) return;
      if (!account.ok) {
        setState(account.status === 401 ? "auth" : "error");
        return;
      }
      setMe(account.data);
      const [gameResult, parts] = await Promise.all([
        getGame(gameId),
        listAllMyParticipations(),
      ]);
      if (!live) return;
      if (!gameResult.ok || !parts.ok) {
        setState("error");
        return;
      }
      setGame(gameResult.data);
      setOwn(dominantParticipation(parts.data, gameId));
      setState("ready");
    })();
    return () => {
      live = false;
    };
  }, [gameId, reload]);

  async function onConfirm() {
    if (!me || !own || mutation.current || done) return;
    if (own.status !== expectedStatus) {
      setNotice("Текущий статус заявки не позволяет это действие.");
      return;
    }
    mutation.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await withdrawParticipation(
        own.id,
        own.version,
        me.csrfToken,
      );
      if (!result.ok) {
        setNotice(
          result.status === 409
            ? "Состояние изменилось. Обновите данные перед повтором."
            : "Не удалось подтвердить изменение. Проверяем актуальное участие.",
        );
        setReload((value) => value + 1);
        return;
      }
      setOwn(result.data);
      setDone(true);
      setNotice(
        intent === "withdraw"
          ? "Заявка отозвана. Место не занималось."
          : "Вы отказались от участия.",
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }

  const canAct =
    !!own && own.status === expectedStatus && !done && game?.status === "published";

  return (
    <ConsumerShell active="my-games" title={title} mode="local">
      <button
        type="button"
        className="gb-c23-back"
        onClick={() => router.push(`/games/${gameId}`)}
      >
        ← Назад
      </button>

      {state === "loading" ? (
        <div className="gb-c23-state" data-state="loading">
          <h2>Проверяем участие</h2>
          <p>Загружаем актуальный статус заявки…</p>
        </div>
      ) : null}

      {state === "auth" ? (
        <div className="gb-c23-state" data-state="auth">
          <h2>Нужен вход</h2>
          <p>Войдите, чтобы управлять своей заявкой.</p>
          <Button href={`/games/${gameId}`}>К игре</Button>
        </div>
      ) : null}

      {state === "error" ? (
        <div className="gb-c23-state" data-state="error">
          <h2>Не удалось проверить участие</h2>
          <p>Без актуальных данных действие недоступно.</p>
          <Button onClick={() => setReload((value) => value + 1)}>
            Обновить
          </Button>
        </div>
      ) : null}

      {state === "ready" ? (
        <div className="gb-c23-state" data-state={done ? "done" : "review"}>
          <h2>{title}</h2>
          {own ? (
            <GameStatusBadge tone={own.status}>
              {participationLabel(own.status)}
            </GameStatusBadge>
          ) : (
            <p>Активной заявки на эту игру нет.</p>
          )}
          <p>
            {intent === "withdraw"
              ? "Отзыв снимает ожидающую заявку. Pending не занимает место в составе."
              : "Отказ снимает подтверждённое участие до начала игры. Сервер освободит место."}
          </p>
          {notice ? (
            <p className="gb-game-notice" role="status">
              {notice}
            </p>
          ) : null}
          <div className="gb-game-form-actions">
            {canAct ? (
              <Button
                variant="dark"
                disabled={busy}
                onClick={() => void onConfirm()}
              >
                {busy ? "Отправляем…" : actionLabel}
              </Button>
            ) : null}
            <Button variant="secondary" href={`/games/${gameId}`}>
              Вернуться к игре
            </Button>
          </div>
        </div>
      ) : null}
    </ConsumerShell>
  );
}

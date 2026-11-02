"use client";

import { useEffect, useRef, useState } from "react";
import { listMyReviews } from "../../../lib/api-client";
import type { GameReview } from "../../../lib/consumer-types";
import {
  peerReviewHistoryLabel,
  resultsPath,
  reviewAudienceLabel,
  reviewKindLabel,
} from "../../../lib/game-results";
import { Button } from "../Button";
import "../../../styles/postgame.css";

type Direction = "received" | "sent";
type ListState = "loading" | "ready" | "empty" | "error" | "auth" | "unavailable";

const PAGE_LIMIT = 20;

function reviewContextLabel(): string {
  // DTO has no game title — honest fallback only.
  return "К итогам игры";
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Private sent/received reviews on My Games history.
 * Mutations stay on GameResults feedback tab — this surface only lists and links.
 */
export function GameReviewsHistory() {
  const [direction, setDirection] = useState<Direction>("received");
  const [items, setItems] = useState<GameReview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<ListState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const epoch = useRef(0);
  const directionRef = useRef<Direction>(direction);
  const itemsRef = useRef<GameReview[]>([]);
  directionRef.current = direction;
  itemsRef.current = items;

  function clearPrivate() {
    epoch.current += 1;
    itemsRef.current = [];
    setItems([]);
    setCursor(null);
    setError(null);
    setLoadingMore(false);
  }

  async function loadPage(opts: { cursor?: string | null; append: boolean; dir: Direction }) {
    const request = ++epoch.current;
    if (!opts.append) {
      setState("loading");
      setError(null);
      itemsRef.current = [];
      setItems([]);
      setCursor(null);
    } else {
      setLoadingMore(true);
    }
    const page = await listMyReviews({
      limit: PAGE_LIMIT,
      cursor: opts.cursor ?? undefined,
      direction: opts.dir,
    });
    // Ignore stale/deferred results across account/filter changes.
    if (request !== epoch.current || directionRef.current !== opts.dir) return;
    if (!page.ok) {
      setLoadingMore(false);
      if (page.status === 401) {
        clearPrivate();
        setState("auth");
        return;
      }
      if (page.status === 403 || page.status === 404) {
        clearPrivate();
        setState("unavailable");
        return;
      }
      if (!opts.append) {
        itemsRef.current = [];
        setItems([]);
        setCursor(null);
        setState("error");
        setError(page.error || "Не удалось загрузить отзывы.");
      } else {
        setError(page.error || "Не удалось загрузить ещё отзывы.");
      }
      return;
    }
    if (request !== epoch.current || directionRef.current !== opts.dir) return;
    const nextItems = opts.append ? [...itemsRef.current, ...page.data.items] : page.data.items;
    itemsRef.current = nextItems;
    setItems(nextItems);
    setCursor(page.data.nextCursor);
    setLoadingMore(false);
    setError(null);
    setState(nextItems.length === 0 ? "empty" : "ready");
  }

  useEffect(() => {
    clearPrivate();
    setState("loading");
    void loadPage({ append: false, dir: direction });
    const onPrivateGone = () => {
      clearPrivate();
      setState("auth");
    };
    window.addEventListener("gb-private-expired", onPrivateGone);
    window.addEventListener("gb-session-changed", onPrivateGone);
    return () => {
      epoch.current += 1;
      window.removeEventListener("gb-private-expired", onPrivateGone);
      window.removeEventListener("gb-session-changed", onPrivateGone);
    };
  }, [direction]);

  function switchDirection(next: Direction) {
    if (next === direction) return;
    clearPrivate();
    setDirection(next);
  }

  return (
    <section
      className="gb-postgame-history-reviews"
      data-surface="private-reviews-history"
      aria-label="Личная обратная связь"
    >
      <header className="gb-personal-list__heading gb-personal-list">
        <div>
          <span className="gb-game-kicker">Только для вас</span>
          <h2>Обратная связь</h2>
        </div>
        <b aria-label={`Записей: ${items.length}`}>{items.length}</b>
      </header>
      <p className="gb-c23-helper">
        Личные отзывы не публикуются в профиле и не влияют на рейтинг. Изменение и ответ — на вкладке
        «Обратная связь» итогов игры.
      </p>
      <div className="gb-game-segmented" role="group" aria-label="Направление отзывов">
        <button
          type="button"
          aria-pressed={direction === "received"}
          onClick={() => switchDirection("received")}
        >
          {reviewAudienceLabel("received")}
        </button>
        <button type="button" aria-pressed={direction === "sent"} onClick={() => switchDirection("sent")}>
          {reviewAudienceLabel("sent")}
        </button>
      </div>

      {state === "loading" ? (
        <div className="gb-game-feedback" data-state="loading">
          <h3>Загружаем отзывы</h3>
          <p>Открываем личную историю обратной связи…</p>
        </div>
      ) : null}

      {state === "auth" ? (
        <div className="gb-game-feedback" data-state="auth">
          <h3>Войдите, чтобы видеть отзывы</h3>
          <p>Личная обратная связь доступна только в вашем сеансе.</p>
        </div>
      ) : null}

      {state === "unavailable" ? (
        <div className="gb-game-feedback" data-state="unavailable">
          <h3>Раздел отзывов недоступен</h3>
          <p>Сервер не открыл личную историю. Это не пустой список.</p>
        </div>
      ) : null}

      {state === "error" ? (
        <div className="gb-game-feedback" data-state="error">
          <h3>Не удалось загрузить отзывы</h3>
          <p>{error}</p>
          <Button variant="primary" onClick={() => void loadPage({ append: false, dir: direction })}>
            Обновить
          </Button>
        </div>
      ) : null}

      {state === "empty" ? (
        <div className="gb-game-feedback" data-state="empty">
          <h3>
            {direction === "received" ? "Пока нет полученных отзывов" : "Пока нет отправленных отзывов"}
          </h3>
          <p>Когда появится запись из итогов игры, она отобразится здесь.</p>
        </div>
      ) : null}

      {state === "ready" ? (
        <ul className="gb-postgame-history-reviews__list">
          {items.map((review) => (
            <li key={review.id} className="gb-postgame-history-entry" data-kind={review.kind}>
              <div className="gb-postgame-history-entry__body">
                <span className="gb-postgame__eyebrow">{reviewKindLabel(review.kind)}</span>
                <h3>{reviewContextLabel()}</h3>
                <p>
                  {review.kind === "peer"
                    ? peerReviewHistoryLabel(review.peerRating)
                    : review.kind === "organization" && review.organizationScore != null
                      ? `Оценка ${review.organizationScore} из 5`
                      : "Без оценки"}
                  {direction === "sent" && review.recipientDisplay
                    ? ` · для ${review.recipientDisplay}`
                    : ""}
                </p>
                {review.comment ? <p className="gb-postgame-history-entry__comment">{review.comment}</p> : null}
                <small>
                  версия {review.version}
                  {review.editedAt ? " · изменено" : ""}
                  {` · ${formatWhen(review.createdAt)}`}
                  {review.reply ? " · есть ответ" : ""}
                </small>
                {review.reply?.text ? (
                  <p className="gb-postgame-history-entry__reply">
                    Ответ{review.reply.editedAt ? " (изменён)" : ""}: {review.reply.text}
                  </p>
                ) : null}
              </div>
              <div className="gb-postgame-history-entry__action">
                <Button variant="outline" href={resultsPath(review.gameId, "feedback")}>
                  К итогам · обратная связь →
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {state === "ready" && cursor ? (
        <div className="gb-postgame-history-reviews__more">
          {error ? <p className="gb-game-helper">{error}</p> : null}
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void loadPage({ cursor, append: true, dir: direction })}
          >
            {loadingMore ? "Загружаем…" : "Показать ещё"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  getVenueExperienceReviews,
  type PublicVenueReviewItem,
} from "../../../lib/venue-reviews-api";
import { Button } from "../Button";
import { VenueReviewsDialog } from "./VenueReviewsDialog";
import "../../../styles/venue-reviews.css";

type LoadState = "idle" | "loading" | "ready" | "error";

const TOPIC_LABEL: Record<string, string> = {
  surface: "Покрытие",
  lighting: "Свет",
  amenities: "Удобства",
};

/**
 * Published anonymous venue reviews. Public surfaces never own a write operation.
 */
export function VenueReviewsPanel({
  venueId,
}: {
  venueId: string;
  csrfToken?: string | null;
  canWrite?: boolean;
  onLogin?: () => void;
  embedded?: boolean;
  actorId?: string | null;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const [state, setState] = useState<LoadState>("idle");
  const [items, setItems] = useState<PublicVenueReviewItem[]>([]);
  const [count, setCount] = useState(0);
  const [gallery, setGallery] = useState(false);
  const epoch = useRef(0);

  function reload() {
    const request = ++epoch.current;
    setState("loading");
    void getVenueExperienceReviews(venueId, { limit: 5 }).then((result) => {
      if (request !== epoch.current) return;
      if (!result.ok) {
        setState("error");
        return;
      }
      setItems(result.data.items);
      setCount(result.data.publishedCount);
      setState("ready");
    });
  }

  useEffect(() => {
    reload();
    return () => {
      epoch.current += 1;
    };
  }, [venueId]);

  return (
    <section className="gb-venue-reviews" aria-label="Отзывы после игры">
      <header>
        <p className="gb-venue-reviews__badge gb-venue-reviews__badge--muted">После игры</p>
        <h2 className="gb-venue-reviews__title">Отзывы после игры</h2>
        <p className="gb-venue-reviews__lede">
          Публичные отзывы — от участников с подтверждённым посещением. Автор показан как «Участник
          игры», без профиля и деталей встречи.
        </p>
      </header>
      {state === "loading" ? <p role="status">Загружаем отзывы…</p> : null}
      {state === "error" ? (
        <div role="alert">
          <p>Не удалось загрузить отзывы.</p>
          <Button variant="outline" onClick={reload}>
            Повторить
          </Button>
        </div>
      ) : null}
      {state === "ready" && items.length === 0 ? (
        <p role="status">Отзывы после игр появятся здесь</p>
      ) : null}
      {state === "ready" && items.length > 0 ? (
        <ul className="gb-venue-reviews__list">
          {items.map((item) => (
            <li key={item.reviewHandle} className="gb-venue-reviews__card">
              <p className="gb-venue-reviews__card-meta">
                {item.authorLabel}
                {item.topics.length
                  ? ` · ${item.topics.map((t) => TOPIC_LABEL[t] ?? t).join(", ")}`
                  : ""}
              </p>
              <p className="gb-venue-reviews__card-text">{item.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="gb-venue-reviews__actions">
        {count > items.length ? (
          <Button variant="outline" onClick={() => setGallery(true)}>
            Все отзывы · {count}
          </Button>
        ) : null}
      </div>
      {gallery ? (
        <VenueReviewsDialog venueId={venueId} onClose={() => setGallery(false)} />
      ) : null}
    </section>
  );
}

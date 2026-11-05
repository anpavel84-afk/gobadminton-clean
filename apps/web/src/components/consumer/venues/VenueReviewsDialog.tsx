"use client";

import { useEffect, useRef, useState } from "react";
import {
  getVenueExperienceReviews,
  type PublicVenueReviewItem,
} from "../../../lib/venue-reviews-api";
import { Button } from "../Button";
import { ProfileDialog } from "../players/ProfileComposition";
import "../../../styles/venue-reviews.css";

const TOPIC_LABEL: Record<string, string> = {
  surface: "Покрытие",
  lighting: "Свет",
  amenities: "Удобства",
};

export function VenueReviewsDialog({
  venueId,
  onClose,
}: {
  venueId: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<PublicVenueReviewItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const epoch = useRef(0);

  useEffect(() => {
    const request = ++epoch.current;
    setState("loading");
    void getVenueExperienceReviews(venueId, {
      cursor: cursor ?? undefined,
      limit: 20,
    }).then((result) => {
      if (request !== epoch.current) return;
      if (!result.ok) {
        setState("error");
        return;
      }
      setItems((prev) => (cursor ? [...prev, ...result.data.items] : result.data.items));
      setNext(result.data.nextCursor);
      setState("ready");
    });
  }, [venueId, cursor]);

  return (
    <ProfileDialog title="Отзывы о площадке" onClose={onClose} lockBodyScroll>
      <div className="gb-venue-reviews">
        {state === "loading" && items.length === 0 ? (
          <p role="status">Загружаем…</p>
        ) : null}
        {state === "error" ? <p role="alert">Не удалось загрузить отзывы.</p> : null}
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
        {next ? (
          <div className="gb-venue-reviews__actions">
            <Button
              variant="outline"
              disabled={state === "loading"}
              onClick={() => setCursor(next)}
            >
              Ещё
            </Button>
          </div>
        ) : null}
      </div>
    </ProfileDialog>
  );
}

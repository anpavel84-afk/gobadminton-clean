"use client";

import React, { useEffect, useId, useState } from "react";
import { Button } from "../Button";
import {
  compactCommunitySummaryText,
  fetchCommunitySummaries,
  fetchOwnCommunityRating,
  formatCommunityAverage,
  upsertCommunityRating,
  voteCountLabel,
  withdrawCommunityRating,
  type CommunityOwnVote,
  type CommunityRatingSummary,
} from "../../../lib/venue-community-api";
import "../../../styles/venue-community.css";

type Props = {
  venueId: string;
  variant?: "full" | "compact";
  signedIn: boolean;
  csrfToken: string | null;
  authReturnPath: string;
  /** Optional parent-batched summary; skips network when provided with ready/error state. */
  summary?: CommunityRatingSummary | null;
  summaryLoadState?: "loading" | "ready" | "error";
  href?: string | null;
  onSummaryChange?: (summary: CommunityRatingSummary) => void;
};

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `vc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function VenueCommunityRating({
  venueId,
  variant = "full",
  signedIn,
  csrfToken,
  authReturnPath,
  summary: summaryProp,
  summaryLoadState,
  href = null,
  onSummaryChange,
}: Props) {
  const headingId = useId();
  const [summary, setSummary] = useState<CommunityRatingSummary | null>(summaryProp ?? null);
  const [own, setOwn] = useState<CommunityOwnVote | null>(null);
  const [selected, setSelected] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    summaryLoadState ?? (summaryProp ? "ready" : "loading"),
  );
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved" | "error">("idle");
  const [status, setStatus] = useState("");
  const compactOnly = variant === "compact";
  const parentOwnsSummary = summaryLoadState !== undefined;

  useEffect(() => {
    if (parentOwnsSummary) {
      setSummary(summaryProp ?? null);
      setLoadState(summaryLoadState ?? "ready");
      return;
    }
    const controller = new AbortController();
    setLoadState("loading");
    setSaveState("idle");
    setStatus("");
    void (async () => {
      try {
        // Compact surfaces never call /me (guest-safe; own-vote is VenuePage full panel only).
        const page = await fetchCommunitySummaries([venueId], controller.signal);
        const next = page.items[0] ?? null;
        if (controller.signal.aborted) return;
        setSummary(next);
        if (next) onSummaryChange?.(next);
        if (!compactOnly && signedIn) {
          const mine = await fetchOwnCommunityRating(venueId, controller.signal);
          if (controller.signal.aborted) return;
          setOwn(mine.own);
          setSummary(mine.summary);
          onSummaryChange?.(mine.summary);
          setSelected(mine.own?.value && !mine.own.withdrawn ? mine.own.value : 0);
        } else {
          setOwn(null);
          setSelected(0);
        }
        setLoadState("ready");
      } catch {
        if (!controller.signal.aborted) setLoadState("error");
      }
    })();
    return () => controller.abort();
  }, [venueId, signedIn, compactOnly, parentOwnsSummary, summaryProp, summaryLoadState, onSummaryChange]);

  if (compactOnly) {
    const text = loadState === "loading"
      ? "Оценки загружаются…"
      : loadState === "error"
        ? "Оценки временно недоступны"
        : compactCommunitySummaryText(summary);
    const body = (
      <span className={`gb-venue-community__compact${summary?.state === "available" ? "" : " is-muted"}`}>
        {text}
      </span>
    );
    if (href) {
      return (
        <a className="gb-venue-community__compact-link" href={href}>
          {body}
          <span className="gb-venue-community__compact-cta">Оценки и обсуждение</span>
        </a>
      );
    }
    return body;
  }

  async function saveVote() {
    if (!csrfToken || !selected || saveState === "pending") return;
    setSaveState("pending");
    setStatus("Сохраняем оценку…");
    try {
      const expectedVersion = own?.version ?? 0;
      const result = await upsertCommunityRating({
        venueId,
        value: selected,
        expectedVersion,
        csrfToken,
        idempotencyKey: newIdempotencyKey(),
      });
      setOwn(result.own);
      setSummary(result.summary);
      onSummaryChange?.(result.summary);
      setSelected(result.own?.value ?? selected);
      setSaveState("saved");
      setStatus("Оценка сохранена");
    } catch {
      setSaveState("error");
      setStatus("Оценку пока не удалось сохранить");
    }
  }

  async function withdraw() {
    if (!csrfToken || !own || own.withdrawn || !own.allowedActions.withdraw) return;
    setSaveState("pending");
    setStatus("Убираем оценку…");
    try {
      const result = await withdrawCommunityRating({
        venueId,
        expectedVersion: own.version,
        csrfToken,
        idempotencyKey: newIdempotencyKey(),
      });
      setOwn(result.own);
      setSummary(result.summary);
      onSummaryChange?.(result.summary);
      setSelected(0);
      setSaveState("saved");
      setStatus("Оценка убрана");
    } catch {
      setSaveState("error");
      setStatus("Не удалось убрать оценку");
    }
  }

  return (
    <section className="gb-venue-community__panel" id="ratings" aria-labelledby={headingId}>
      <div className="gb-venue-community__heading">
        <div>
          <h2 id={headingId}>Оценки сообщества</h2>
          <p>Впечатления пользователей об этой площадке</p>
        </div>
      </div>
      {loadState === "loading" ? (
        <div role="status" aria-busy="true" aria-label="Загрузка">
          <div className="gb-venue-community__skeleton is-big" />
          <div className="gb-venue-community__skeleton" />
          <span className="sr-only">Загружаем оценки…</span>
        </div>
      ) : loadState === "error" ? (
        <div className="gb-venue-community__notice is-error" role="alert">
          <strong>Не удалось загрузить оценки</strong>
          <p>Попробуйте ещё раз. Сводка временно недоступна.</p>
        </div>
      ) : summary?.state === "unavailable" ? (
        <div className="gb-venue-community__notice" role="status">
          <strong>Сводка оценок недоступна</strong>
          <p>Средний балл появится после подтверждения актуальных данных.</p>
        </div>
      ) : (
        <div className="gb-venue-community__rating-row">
          {summary?.state === "available" && summary.average !== null && summary.count ? (
            <>
              <div className="gb-venue-community__rating-number">
                {formatCommunityAverage(summary.average)}
              </div>
              <div>
                <div className="gb-venue-community__starline" aria-hidden="true">★</div>
                <p>
                  {voteCountLabel(summary.count)}
                  {summary.count < 10 ? " · пока небольшая выборка" : ""}
                </p>
              </div>
            </>
          ) : (
            <div>
              <div className="gb-venue-community__rating-empty">Пока нет оценок</div>
              <p>Поделитесь впечатлением об этой площадке.</p>
            </div>
          )}
        </div>
      )}

      {loadState === "ready" && summary?.state !== "unavailable" ? (
        signedIn && csrfToken ? (
          <div className="gb-venue-community__own">
            <strong style={{ fontSize: 14 }}>
              {own && !own.withdrawn && own.value
                ? `Ваша оценка · ${own.value} из 5`
                : "Как вам эта площадка?"}
            </strong>
            <div
              className="gb-venue-community__stars"
              role="radiogroup"
              aria-label="Ваша оценка площадки от 1 до 5"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={selected === n}
                  aria-label={`${n} из 5`}
                  tabIndex={selected === n || (!selected && n === 1) ? 0 : -1}
                  className={`gb-venue-community__star${n <= selected ? " is-selected" : ""}`}
                  onClick={() => {
                    setSelected(n);
                    setSaveState("idle");
                    setStatus("");
                  }}
                  onKeyDown={(event) => {
                    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === "Home"
                      ? 1
                      : event.key === "End"
                        ? 5
                        : Math.max(1, Math.min(5, selected + (event.key === "ArrowRight" ? 1 : -1) || n));
                    setSelected(next || n);
                  }}
                >
                  {n <= selected ? "★" : "☆"}
                </button>
              ))}
            </div>
            <p className="gb-venue-community__help">
              Оценка относится к этой площадке по адресу. Комментарий — по желанию в обсуждении ниже.
            </p>
            <div className="gb-actions" style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Button
                disabled={!selected || saveState === "pending" || (own?.value === selected && !own.withdrawn)}
                onClick={() => void saveVote()}
              >
                {own && !own.withdrawn ? "Сохранить изменение" : "Отправить оценку"}
              </Button>
              {own && !own.withdrawn && own.allowedActions.withdraw ? (
                <button type="button" className="gb-textbutton" onClick={() => void withdraw()}>
                  Убрать мою оценку
                </button>
              ) : null}
            </div>
            {saveState === "pending" ? (
              <div className="gb-venue-community__notice is-pending" role="status">{status}</div>
            ) : null}
            {saveState === "error" ? (
              <div className="gb-venue-community__notice is-error" role="alert">{status}</div>
            ) : null}
            {saveState === "saved" ? (
              <div className="gb-venue-community__notice is-success" role="status">{status}</div>
            ) : null}
          </div>
        ) : (
          <div className="gb-venue-community__guest">
            <p>Войдите, чтобы поставить свою оценку.</p>
            <Button href={`/auth?returnTo=${encodeURIComponent(`${authReturnPath}#ratings`)}`}>
              Войти и оценить
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}

"use client";

import type { ReactNode } from "react";
import { Button } from "../Button";
import type { BrowseOfferStatus, FinderEligibility } from "./usePlayerBrowseOffers";

/** Stable peer-bound status for list + modal; late receipts must not steal focus. */
export function PlayerBrowseOfferStatus({
  status,
  onCheckStatus,
  className,
}: {
  status: BrowseOfferStatus;
  onCheckStatus?: () => void;
  className?: string;
}) {
  if (status.phase === "idle" || !status.message) return null;
  const tone = status.phase === "outgoing" || status.phase === "mutual"
    ? "is-success"
    : status.phase === "sending"
      ? ""
      : "is-warning";
  return (
    <div className={`pb-offer-status ${className ?? ""}`.trim()} role="status" aria-live="polite">
      <p className={`pb-offer-status__text ${tone}`.trim()}>{status.message}</p>
      {status.canCheckStatus && onCheckStatus && (
        <Button variant="outline" onClick={onCheckStatus}>Проверить статус</Button>
      )}
    </div>
  );
}

/** Finder gate surfaces: checking / empty page / exhausted / error (not a false empty catalog). */
export function PlayerBrowseFinderGate({
  eligibility,
  onContinue,
  onRetry,
  guestAction,
}: {
  eligibility: FinderEligibility;
  onContinue?: () => void;
  onRetry?: () => void;
  guestAction?: ReactNode;
}) {
  if (eligibility.kind === "ready" || eligibility.kind === "idle") return null;
  if (eligibility.kind === "guest") {
    return (
      <div className="pb-finder-gate" role="status">
        <h2>Найти напарника</h2>
        <p>{eligibility.message || "Войдите, чтобы предложить игру"}</p>
        {guestAction}
      </div>
    );
  }
  if (eligibility.kind === "checking") {
    return (
      <div className="pb-finder-gate" role="status">
        <h2>Подбираем игроков…</h2>
        <p>Проверяем, кому можно предложить игру.</p>
      </div>
    );
  }
  if (eligibility.kind === "error") {
    return (
      <div className="pb-finder-gate" role="alert">
        <h2>Не удалось проверить подборку</h2>
        <p>{eligibility.message}</p>
        {onRetry && <Button variant="outline" onClick={onRetry}>Повторить</Button>}
      </div>
    );
  }
  if (eligibility.kind === "empty_page") {
    return (
      <div className="pb-finder-gate" role="status">
        <h2>В этой части списка новых предложений нет</h2>
        <p>Можно продолжить поиск на следующей странице каталога.</p>
        {eligibility.canContinue && onContinue && (
          <Button variant="dark" onClick={onContinue}>Продолжить поиск</Button>
        )}
      </div>
    );
  }
  return (
    <div className="pb-finder-gate" role="status">
      <h2>Подборка по этим фильтрам закончилась</h2>
      <p>{eligibility.message || "Новых предложений сейчас нет."}</p>
    </div>
  );
}

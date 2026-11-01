"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { PlayInterestReceipt } from "@gobadminton/contracts/friendship-types";
import { isValidConfirmedPlayInterestReceipt } from "../../../lib/play-interests";
import { Button } from "../Button";
import { useSocialMutation } from "../messages/useSocialMutation";
import type { BrowseOfferStatus, FinderEligibility } from "./usePlayerBrowseOffers";

/** Immutable descriptor captured at admission — never retarget mid-flight. */
export type BrowseOfferOperation = {
  token: string;
  actorId: string;
  privateGeneration: number;
  peerId: string;
  peerName: string;
  csrf: string;
  path: string;
  body: object;
  method: string;
};

/**
 * Keyed page-level POST host: one useSocialMutation instance with fixed actor+peer scope
 * for the lifetime of this mount. Render outside the conditional dialog; key={token}.
 */
export function PlayerBrowseOfferOpHost({
  operation,
  onConfirmed,
  onFailed,
  onUnknown,
}: {
  operation: BrowseOfferOperation;
  onConfirmed: (op: BrowseOfferOperation, receipt: PlayInterestReceipt) => void;
  onFailed: (op: BrowseOfferOperation, notice: string) => void;
  onUnknown: (op: BrowseOfferOperation, notice: string) => void;
}) {
  // Freeze admission fields for this instance — ignore any later prop identity churn.
  const opRef = useRef(operation);
  const settledRef = useRef(false);
  const startedRef = useRef(false);
  const onConfirmedRef = useRef(onConfirmed);
  const onFailedRef = useRef(onFailed);
  const onUnknownRef = useRef(onUnknown);
  onConfirmedRef.current = onConfirmed;
  onFailedRef.current = onFailed;
  onUnknownRef.current = onUnknown;

  const finish = (
    kind: "confirmed" | "failed" | "unknown",
    payload?: PlayInterestReceipt | string,
  ) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const op = opRef.current;
    if (kind === "confirmed" && payload && typeof payload === "object") {
      onConfirmedRef.current(op, payload);
      return;
    }
    if (kind === "failed") {
      onFailedRef.current(op, typeof payload === "string" ? payload : "Не удалось отправить");
      return;
    }
    onUnknownRef.current(
      op,
      typeof payload === "string" ? payload : "Результат не подтверждён. Не повторяйте отправку.",
    );
  };

  const mutation = useSocialMutation<PlayInterestReceipt>(
    `${opRef.current.actorId}:play-interest:${opRef.current.peerId}`,
    opRef.current.csrf,
    (receipt) => {
      finish("confirmed", receipt);
    },
    () => {
      finish("failed", "Не удалось отправить");
    },
    true,
    { validateSuccess: isValidConfirmedPlayInterestReceipt },
  );

  const runRef = useRef(mutation.run);
  runRef.current = mutation.run;
  const pendingAtStartRef = useRef(mutation.pending);
  pendingAtStartRef.current = mutation.pending;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const op = opRef.current;
    const started = runRef.current(op.path, op.body, op.method);
    if (!started) {
      // Existing pending for this immutable peer scope → UNKNOWN, do not clear marker.
      finish(
        "unknown",
        pendingAtStartRef.current
          ? "Результат не подтверждён. Не повторяйте отправку."
          : "Не удалось начать отправку.",
      );
    }
  }, []);

  useEffect(() => {
    if (!startedRef.current || mutation.busy || settledRef.current) return;
    if (mutation.pending) {
      finish("unknown", mutation.notice || "Результат не подтверждён. Не повторяйте отправку.");
    }
  }, [mutation.busy, mutation.pending, mutation.notice]);

  return null;
}

/** Stable peer-bound status for list + modal; late receipts must not steal focus. */
export function PlayerBrowseOfferStatus({
  status,
  onCheckStatus,
  unresolved = [],
  onCheckUnresolved,
  className,
  presentation = "default",
}: {
  status: BrowseOfferStatus;
  onCheckStatus?: () => void;
  /** Peer-bound UNKNOWN entries retained after later peers settle. */
  unresolved?: ReadonlyArray<{ peerId: string; peerName: string }>;
  onCheckUnresolved?: (peerId: string) => void;
  className?: string;
  /**
   * `quietRoutine` (mobile finder/list only): hide sending/outgoing/mutual visual
   * routine panels; keep failed/unknown + peer-bound extraUnknown exactly.
   * Default unchanged for desktop and other callers.
   */
  presentation?: "default" | "quietRoutine";
}) {
  const extraUnknown = unresolved.filter(
    (entry) => entry.peerId && entry.peerId !== status.peerId,
  );
  const quietRoutine = presentation === "quietRoutine"
    && (status.phase === "sending" || status.phase === "outgoing" || status.phase === "mutual");
  const showPrimary = status.phase !== "idle" && Boolean(status.message) && !quietRoutine;
  if (!showPrimary && extraUnknown.length === 0) return null;
  const tone = status.phase === "outgoing" || status.phase === "mutual"
    ? "is-success"
    : status.phase === "sending"
      ? "is-pending"
      : "is-warning";
  const renderUnresolved = (entry: { peerId: string; peerName: string }) => (
    <div key={entry.peerId} className="pb-offer-status__unresolved">
      <p className="pb-offer-status__text is-warning">
        {`${entry.peerName.trim() || "игроку"}: результат отправки не подтверждён`}
      </p>
      {onCheckUnresolved && (
        <Button variant="outline" onClick={() => onCheckUnresolved(entry.peerId)}>
          Проверить статус
        </Button>
      )}
    </div>
  );
  // noUncheckedIndexedAccess: length===1 does not narrow [0]; refine locally.
  const onlyExtraUnknown = extraUnknown.length === 1 ? extraUnknown[0] : undefined;
  return (
    <div className={`pb-offer-status ${className ?? ""}`.trim()} role="status" aria-live="polite">
      {showPrimary ? (
        <p className={`pb-offer-status__text ${tone}`.trim()}>{status.message}</p>
      ) : null}
      {status.canCheckStatus && onCheckStatus && (
        <Button variant="outline" onClick={onCheckStatus}>Проверить статус</Button>
      )}
      {onlyExtraUnknown
        ? renderUnresolved(onlyExtraUnknown)
        : extraUnknown.length > 1
          ? (
            <details className="pb-offer-status__more">
              <summary className="pb-offer-status__more-summary">
                Ещё неподтверждённых: {extraUnknown.length}
              </summary>
              <div className="pb-offer-status__more-body">
                {extraUnknown.map(renderUnresolved)}
              </div>
            </details>
          )
          : null}
    </div>
  );
}

/** Finder gate: loading / own-prerequisite / peers unavailable / empty page / exhausted / error. */
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
        <h2>Свайп</h2>
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
  if (eligibility.kind === "own_prerequisite") {
    return (
      <div className="pb-finder-gate" role="status">
        <h2>Сначала откройте свой профиль</h2>
        <p>
          {eligibility.message
            || "Предложения доступны, когда ваш профиль виден в каталоге."}
        </p>
        <Button variant="dark" href="/profile">К настройкам профиля</Button>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>Проверить снова</Button>
        )}
      </div>
    );
  }
  if (eligibility.kind === "peers_unavailable") {
    return (
      <div className="pb-finder-gate" role="status">
        <h2>Сейчас нельзя предложить игру</h2>
        <p>{eligibility.message || "Подходящие предложения временно недоступны."}</p>
        {eligibility.canContinue && onContinue && (
          <Button variant="dark" onClick={onContinue}>Продолжить поиск</Button>
        )}
        {onRetry && <Button variant="outline" onClick={onRetry}>Повторить</Button>}
      </div>
    );
  }
  if (eligibility.kind === "error") {
    const profileError = eligibility.message.includes("профиль");
    return (
      <div className="pb-finder-gate" role="alert">
        <h2>{profileError ? "Не удалось загрузить профиль" : "Не удалось проверить подборку"}</h2>
        <p>
          {profileError
            ? "Повторите попытку. Без профиля нельзя проверить предложения."
            : "Проверьте соединение и повторите."}
        </p>
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
      <p>Новых предложений сейчас нет.</p>
    </div>
  );
}

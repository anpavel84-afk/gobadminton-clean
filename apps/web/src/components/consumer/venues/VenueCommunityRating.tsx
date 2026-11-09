"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Button } from "../Button";
import {
  communityResponseProvesPendingEffect,
  compactCommunitySummaryText,
  fetchCommunitySummaries,
  fetchOwnCommunityRating,
  formatCommunityAverage,
  invalidateCommunitySummaries,
  isCommunityRatingMutationError,
  isCommunityRatingTerminalMutationStatus,
  upsertCommunityRating,
  voteCountLabel,
  withdrawCommunityRating,
  type CommunityOwnVote,
  type CommunityRatingSummary,
  type VenueCommunityReportSubject,
} from "../../../lib/venue-community-api";
import { VenueCommunityReportDialog } from "./VenueCommunityReportDialog";
import { AuthChooser } from "../players/ProfileComposition";
import "../../../styles/venue-community.css";

type Props = {
  venueId: string;
  variant?: "full" | "compact";
  signedIn: boolean;
  /** Exact actor id for report/vote bind — memory only, never placed in storage keys. */
  actorId?: string | null;
  csrfToken: string | null;
  authReturnPath: string;
  /** Optional parent-batched summary; compact skips network when provided with ready/error state. */
  summary?: CommunityRatingSummary | null;
  summaryLoadState?: "idle" | "loading" | "ready" | "error";
  href?: string | null;
  /**
   * When false, compact renders plain text (safe inside a parent <button>).
   * Default true adds the labelled link to `#ratings`.
   */
  linkToRatings?: boolean;
  sectionId?: string;
  onUnresolvedChange?: (unresolved: boolean) => void;
  onSummaryChange?: (summary: CommunityRatingSummary) => void;
};

type VotePending = {
  kind: "upsert" | "withdraw";
  key: string;
  venueId: string;
  actorId: string;
  csrfToken: string;
  expectedVersion: number;
  value: number | null;
};

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `vc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ratingsHref(authReturnPath: string, venueId: string, href: string | null): string {
  if (href) return href;
  return `/venues/${encodeURIComponent(venueId)}#ratings`;
}

/** First vote / withdrawn / version-0 shell → upsert; live vote → update. */
function ownVoteWriteAllowed(own: CommunityOwnVote): boolean {
  if (own.withdrawn || own.value == null || own.version < 1) {
    return own.allowedActions.upsert;
  }
  return own.allowedActions.update;
}

export function VenueCommunityRating({
  venueId,
  variant = "full",
  signedIn,
  actorId = null,
  csrfToken,
  authReturnPath,
  summary: summaryProp,
  summaryLoadState,
  href = null,
  linkToRatings = true,
  onSummaryChange,
  sectionId = "ratings",
  onUnresolvedChange,
}: Props) {
  const headingId = useId();
  const ratingReturnPath = `${authReturnPath.split("#")[0]}#ratings`;
  const [summary, setSummary] = useState<CommunityRatingSummary | null>(summaryProp ?? null);
  const [own, setOwn] = useState<CommunityOwnVote | null>(null);
  /** Own GET readiness — failure must not become an empty writeable vote. */
  const [ownLoadState, setOwnLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    variant === "compact" || !signedIn ? "idle" : "loading",
  );
  const [selected, setSelected] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    summaryLoadState === "ready" || summaryLoadState === "error"
      ? summaryLoadState
      : summaryProp
        ? "ready"
        : "loading",
  );
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved" | "error" | "unknown">("idle");
  const [status, setStatus] = useState("");
  const [reportSubject, setReportSubject] = useState<VenueCommunityReportSubject | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const compactOnly = variant === "compact";
  useEffect(() => { onUnresolvedChange?.(saveState === "pending" || saveState === "unknown"); }, [saveState, onUnresolvedChange]);
  const parentOwnsSummary = summaryLoadState !== undefined;
  const onSummaryChangeRef = useRef(onSummaryChange);
  onSummaryChangeRef.current = onSummaryChange;
  const generation = useRef(0);
  const pendingRef = useRef<VotePending | null>(null);
  const userPickedRef = useRef(false);
  const authRef = useRef({ venueId, actorId: actorId ?? null, csrfToken });
  // Render-time fence: reset private own/success before effects when identity drifts.
  if (
    authRef.current.venueId !== venueId
    || authRef.current.actorId !== (actorId ?? null)
    || authRef.current.csrfToken !== csrfToken
  ) {
    authRef.current = { venueId, actorId: actorId ?? null, csrfToken };
    pendingRef.current = null;
    userPickedRef.current = false;
    if (saveState === "saved" || saveState === "pending" || saveState === "unknown") {
      setSaveState("idle");
      setStatus("");
    }
    if (own) setOwn(null);
    if (selected) setSelected(0);
    if (ownLoadState !== (compactOnly || !signedIn ? "idle" : "loading")) {
      setOwnLoadState(compactOnly || !signedIn ? "idle" : "loading");
    }
  }

  const canReportOwn = Boolean(
    own
    && !own.withdrawn
    && own.version >= 1
    && Number.isInteger(own.version),
  );

  useEffect(() => {
    const gen = ++generation.current;
    const controller = new AbortController();

    if (parentOwnsSummary) {
      setSummary(summaryProp ?? null);
      if (summaryLoadState === "loading" || summaryLoadState === "idle") {
        setLoadState("loading");
      } else if (summaryLoadState === "error") {
        setLoadState("error");
      } else {
        setLoadState("ready");
      }
      // Compact guests: parent summary only — never /me.
      if (compactOnly || !signedIn) {
        setOwn(null);
        setOwnLoadState("idle");
        setSelected(0);
        return () => controller.abort();
      }
      setOwnLoadState("loading");
      // Full panel with parent-owned public summary still reads own for authorized actor.
      void fetchOwnCommunityRating(venueId, controller.signal)
        .then((mine) => {
          if (gen !== generation.current || controller.signal.aborted) return;
          if (
            authRef.current.venueId !== venueId
            || authRef.current.actorId !== (actorId ?? null)
            || authRef.current.csrfToken !== csrfToken
          ) {
            return;
          }
          setOwn(mine.own);
          setOwnLoadState("ready");
          setSummary(mine.summary);
          onSummaryChangeRef.current?.(mine.summary);
          if (!userPickedRef.current) {
            setSelected(mine.own?.value && !mine.own.withdrawn ? mine.own.value : 0);
          }
          setLoadState("ready");
        })
        .catch(() => {
          if (gen !== generation.current || controller.signal.aborted) return;
          // Public parent summary stays; never treat own GET failure as an empty writable vote.
          setOwn(null);
          setOwnLoadState("error");
          if (!userPickedRef.current) setSelected(0);
        });
      return () => controller.abort();
    }

    setLoadState("loading");
    setSaveState("idle");
    setStatus("");
    setOwn(null);
    setOwnLoadState(compactOnly || !signedIn ? "idle" : "loading");
    userPickedRef.current = false;
    setSelected(0);
    void (async () => {
      try {
        // Compact surfaces never call /me (guest-safe; own-vote is VenuePage full panel only).
        const page = await fetchCommunitySummaries([venueId], controller.signal);
        if (gen !== generation.current || controller.signal.aborted) return;
        const next = page.items[0] ?? null;
        setSummary(next);
        if (next) onSummaryChangeRef.current?.(next);
        if (!compactOnly && signedIn) {
          try {
            const mine = await fetchOwnCommunityRating(venueId, controller.signal);
            if (gen !== generation.current || controller.signal.aborted) return;
            if (
              authRef.current.venueId !== venueId
              || authRef.current.actorId !== (actorId ?? null)
              || authRef.current.csrfToken !== csrfToken
            ) {
              return;
            }
            setOwn(mine.own);
            setOwnLoadState("ready");
            setSummary(mine.summary);
            onSummaryChangeRef.current?.(mine.summary);
            if (!userPickedRef.current) {
              setSelected(mine.own?.value && !mine.own.withdrawn ? mine.own.value : 0);
            }
          } catch {
            if (gen !== generation.current || controller.signal.aborted) return;
            setOwn(null);
            setOwnLoadState("error");
            if (!userPickedRef.current) setSelected(0);
          }
        } else {
          setOwnLoadState("idle");
        }
        setLoadState("ready");
      } catch {
        if (gen !== generation.current || controller.signal.aborted) return;
        setLoadState("error");
        if (!compactOnly && signedIn) setOwnLoadState("error");
      }
    })();
    return () => controller.abort();
  }, [
    venueId,
    signedIn,
    compactOnly,
    parentOwnsSummary,
    summaryProp,
    summaryLoadState,
    actorId,
    csrfToken,
  ]);

  function contextMatches(pending: VotePending): boolean {
    return (
      pending.venueId === venueId
      && pending.actorId === (actorId ?? "")
      && pending.csrfToken === (csrfToken ?? "")
      && Boolean(actorId && csrfToken)
    );
  }

  function applyVoteResult(result: { own: CommunityOwnVote | null; summary: CommunityRatingSummary }) {
    setOwn(result.own);
    setSummary(result.summary);
    onSummaryChangeRef.current?.(result.summary);
    setSelected(result.own?.value && !result.own.withdrawn ? result.own.value : 0);
    const touch = [venueId];
    if (result.summary.canonicalVenueId) touch.push(result.summary.canonicalVenueId);
    if (result.own?.canonicalVenueId) touch.push(result.own.canonicalVenueId);
    invalidateCommunitySummaries(touch);
  }

  /**
   * Unified completion: prove → apply → clear packet → saved.
   * Any validation/application failure retains the exact frozen packet as UNKNOWN.
   */
  function completeProvenPending(
    pending: VotePending,
    result: { own: CommunityOwnVote | null; summary: CommunityRatingSummary },
    unknownMessage: string,
  ): boolean {
    if (!communityResponseProvesPendingEffect(pending, result)) {
      pendingRef.current = pending;
      setSaveState("unknown");
      setStatus(unknownMessage);
      return false;
    }
    try {
      applyVoteResult(result);
    } catch {
      pendingRef.current = pending;
      setSaveState("unknown");
      setStatus(unknownMessage);
      return false;
    }
    pendingRef.current = null;
    setSaveState("saved");
    setStatus(pending.kind === "withdraw" ? "Оценка убрана" : "Оценка сохранена");
    return true;
  }

  function isAmbiguousMutationFailure(error: unknown): boolean {
    // Ordinary Error / body-read / semantic-invalid may follow commit — keep frozen UNKNOWN.
    if (!isCommunityRatingMutationError(error)) return true;
    if (error.kind === "network" || error.kind === "invalid") return true;
    if (error.kind !== "http") return true;
    // Fail-closed: only the terminal whitelist may clear; 408 and any 5xx stay UNKNOWN.
    return !isCommunityRatingTerminalMutationStatus(error.status);
  }

  async function runPending(pending: VotePending, isRetry: boolean) {
    if (!contextMatches(pending) || saveState === "pending") return;
    // Retain frozen packet through the round-trip; clear only after validated success/terminal reject.
    pendingRef.current = pending;
    setSaveState("pending");
    setStatus(pending.kind === "withdraw" ? "Убираем оценку…" : "Сохраняем оценку…");
    const gen = generation.current;
    const unknownMessage = isRetry
      ? "Результат прошлой отправки не подтверждён. Проверьте актуальную оценку или повторите с тем же запросом."
      : "Отправка не подтверждена. Не создаём новый запрос — проверьте результат или повторите тот же.";
    try {
      const result = pending.kind === "withdraw"
        ? await withdrawCommunityRating({
          venueId: pending.venueId,
          expectedVersion: pending.expectedVersion,
          csrfToken: pending.csrfToken,
          idempotencyKey: pending.key,
        })
        : await upsertCommunityRating({
          venueId: pending.venueId,
          value: pending.value ?? 0,
          expectedVersion: pending.expectedVersion,
          csrfToken: pending.csrfToken,
          idempotencyKey: pending.key,
        });
      if (gen !== generation.current || !contextMatches(pending)) return;
      completeProvenPending(pending, result, unknownMessage);
    } catch (error) {
      if (gen !== generation.current || !contextMatches(pending)) return;
      if (isAmbiguousMutationFailure(error)) {
        // UNKNOWN: keep same key + frozen body + authorized context; no automatic new POST.
        pendingRef.current = pending;
        setSaveState("unknown");
        setStatus(unknownMessage);
        return;
      }
      // Trustworthy terminal rejection (e.g. 409) — clear pending; no fresh key auto-send.
      pendingRef.current = null;
      setSaveState("error");
      setStatus(
        isCommunityRatingMutationError(error) && error.status === 409
          ? "Конфликт версии оценки. Обновите данные и попробуйте снова."
          : pending.kind === "withdraw"
            ? "Не удалось убрать оценку"
            : "Оценку пока не удалось сохранить",
      );
    }
  }

  async function saveVote() {
    if (!csrfToken || !actorId || !selected || saveState === "pending" || saveState === "unknown") {
      return;
    }
    // Own GET must succeed before any write; failure is not an empty first-vote grant.
    if (ownLoadState !== "ready") return;
    if (own && !own.withdrawn && own.value === selected) return;
    if (own) {
      if (!ownVoteWriteAllowed(own)) return;
    }

    const pending: VotePending = {
      kind: "upsert",
      key: newIdempotencyKey(),
      venueId,
      actorId,
      csrfToken,
      expectedVersion: own?.version ?? 0,
      value: selected,
    };
    pendingRef.current = pending;
    await runPending(pending, false);
  }

  async function withdraw() {
    if (!csrfToken || !actorId || !own || own.withdrawn || !own.allowedActions.withdraw) return;
    if (saveState === "pending") return;
    const pending: VotePending = {
      kind: "withdraw",
      key: newIdempotencyKey(),
      venueId,
      actorId,
      csrfToken,
      expectedVersion: own.version,
      value: null,
    };
    pendingRef.current = pending;
    await runPending(pending, false);
  }

  async function retryUnknown() {
    const pending = pendingRef.current;
    if (!pending || !contextMatches(pending) || saveState !== "unknown") return;
    await runPending(pending, true);
  }

  async function reconcileUnknown() {
    const pending = pendingRef.current;
    if (!pending || !contextMatches(pending) || !csrfToken || !actorId || saveState !== "unknown") {
      return;
    }
    const gen = generation.current;
    setSaveState("pending");
    setStatus("Проверяем актуальную оценку…");
    const unknownMessage =
      "Актуальная оценка не подтверждает прошлый запрос. Можно повторить тот же запрос.";
    try {
      const mine = await fetchOwnCommunityRating(venueId);
      if (gen !== generation.current || !contextMatches(pending)) return;
      // Same prove → apply → clear invariant as direct 2xx; never clear before apply succeeds.
      completeProvenPending(pending, mine, unknownMessage);
    } catch {
      if (gen !== generation.current) return;
      pendingRef.current = pending;
      setSaveState("unknown");
      setStatus("Не удалось проверить результат. Можно повторить тот же запрос.");
    }
  }

  function openAggregateReport() {
    if (!(signedIn && actorId && csrfToken)) {
      setAuthOpen(true);
      return;
    }
    setReportSubject({ subjectKind: "aggregate", venueId });
  }

  function openOwnVoteReport() {
    if (!(signedIn && actorId && csrfToken) || !canReportOwn || !own) return;
    setReportSubject({
      subjectKind: "own_vote",
      venueId,
      expectedVersion: own.version,
    });
  }

  if (compactOnly) {
    const text = loadState === "loading"
      ? "Оценки загружаются…"
      : loadState === "error"
        ? "Оценки временно недоступны"
        : compactCommunitySummaryText(summary);
    const body = (
      <span
        className={`gb-venue-community__compact${summary?.state === "available" ? "" : " is-muted"}`}
        data-testid="venue-community-compact"
      >
        {text}
      </span>
    );
    if (!linkToRatings) return body;
    const link = ratingsHref(authReturnPath, venueId, href);
    return (
      <a className="gb-venue-community__compact-link" href={link} data-testid="venue-community-compact-link">
        {body}
        <span className="gb-venue-community__compact-cta">Оценки и обсуждение</span>
      </a>
    );
  }

  const writeAllowed = ownLoadState === "ready" && (own ? ownVoteWriteAllowed(own) : true);
  const saveDisabled = !selected
    || saveState === "pending"
    || saveState === "unknown"
    || (own?.value === selected && !own.withdrawn)
    || !csrfToken
    || !actorId
    || !writeAllowed;

  return (
    <section className="gb-venue-community__panel" id={sectionId} aria-labelledby={headingId}>
      <div className="gb-venue-community__heading">
        <div>
          <h2 id={headingId}>Оценки сообщества</h2>
          <p>Впечатления пользователей об этой площадке · не отзывы после игры</p>
        </div>
        {loadState === "ready" && summary?.state !== "unavailable" ? (
          <Button
            type="button"
            variant="ghost"
            className="gb-venue-community__report-trigger"
            onClick={openAggregateReport}
            data-testid="venue-community-report-aggregate"
            aria-label="Пожаловаться на сводку оценок сообщества"
          >
            Пожаловаться
          </Button>
        ) : null}
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
        signedIn && csrfToken && actorId ? (
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
                  disabled={
                    saveState === "pending"
                    || saveState === "unknown"
                    || ownLoadState !== "ready"
                  }
                  onClick={() => {
                    userPickedRef.current = true;
                    setSelected(n);
                    if (saveState !== "unknown") {
                      setSaveState("idle");
                      setStatus("");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === "Home"
                      ? 1
                      : event.key === "End"
                        ? 5
                        : Math.max(1, Math.min(5, selected + (event.key === "ArrowRight" ? 1 : -1) || n));
                    userPickedRef.current = true;
                    setSelected(next || n);
                    setSaveState("idle"); setStatus("");
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next - 1]?.focus();
                  }}
                >
                  {n <= selected ? "★" : "☆"}
                </button>
              ))}
            </div>
            <p className="gb-venue-community__help">
              Оценка относится к этой площадке по адресу. Комментарий — по желанию в обсуждении ниже.
            </p>
            {ownLoadState === "error" ? (
              <div className="gb-venue-community__notice is-error" role="alert">
                <strong>Не удалось загрузить вашу оценку</strong>
                <p>Сохранение недоступно, пока не подтвердится актуальная оценка.</p>
              </div>
            ) : null}
            {own && own.moderationState === "withheld" && !own.withdrawn ? (
              <div className="gb-venue-community__notice" role="status">
                <strong>Оценка снята с публичной сводки</strong>
                <p>Снятие модерацией нельзя отменить здесь. Можно изменить или убрать оценку, если сервер это разрешает, либо запросить проверку.</p>
              </div>
            ) : null}
            <div className="gb-actions gb-venue-community__own-actions">
              <Button
                disabled={saveDisabled}
                onClick={() => void saveVote()}
              >
                {own && !own.withdrawn && own.value != null && own.version >= 1
                  ? "Сохранить изменение"
                  : "Отправить оценку"}
              </Button>
              {own && !own.withdrawn && own.allowedActions.withdraw ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saveState === "pending" || saveState === "unknown"}
                  onClick={() => void withdraw()}
                >
                  Убрать мою оценку
                </Button>
              ) : null}
              {canReportOwn ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={openOwnVoteReport}
                  data-testid="venue-community-report-own-vote"
                >
                  {own?.moderationState === "withheld"
                    ? "Запросить проверку оценки"
                    : "Пожаловаться на свою оценку"}
                </Button>
              ) : null}
            </div>
            {saveState === "pending" ? (
              <div className="gb-venue-community__notice is-pending" role="status">{status}</div>
            ) : null}
            {saveState === "error" ? (
              <div className="gb-venue-community__notice is-error" role="alert">{status}</div>
            ) : null}
            {saveState === "unknown" ? (
              <div className="gb-venue-community__notice is-error" role="alert" data-testid="venue-community-vote-unknown">
                <strong>{status}</strong>
                <div className="gb-actions gb-venue-community__own-actions">
                  <Button type="button" variant="ghost" onClick={() => void reconcileUnknown()}>
                    Проверить актуальную оценку
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void retryUnknown()}>
                    Повторить тот же запрос
                  </Button>
                </div>
              </div>
            ) : null}
            {saveState === "saved" ? (
              <div className="gb-venue-community__notice is-success" role="status">{status}</div>
            ) : null}
          </div>
        ) : (
          <div className="gb-venue-community__guest">
            <p>Войдите, чтобы поставить свою оценку.</p>
            <Button href={`/auth?returnTo=${encodeURIComponent(ratingReturnPath)}`}>
              Войти и оценить
            </Button>
          </div>
        )
      ) : null}
      {reportSubject ? (
        <VenueCommunityReportDialog
          subject={reportSubject}
          actorId={actorId}
          csrfToken={csrfToken}
          authReturnPath={ratingReturnPath}
          onClose={() => setReportSubject(null)}
        />
      ) : null}
      {authOpen ? (
        <AuthChooser
          returnPath={ratingReturnPath}
          onClose={() => setAuthOpen(false)}
        />
      ) : null}
    </section>
  );
}

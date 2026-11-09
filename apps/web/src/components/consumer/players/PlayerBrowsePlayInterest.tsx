"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import {
  getPlayInterestState,
  isBrowseConfirmedPlayInterestOutcome,
  isValidConfirmedPlayInterestReceipt,
  playInterestCommand,
  playInterestStatus,
} from "../../../lib/play-interests";
import { canOfferPlayInterest } from "../../../lib/player-browse";
import { privateActor } from "../../../lib/foreground-updates";
import type { BrowseMatchConfirmation, MatchPlayer } from "./PlayerBrowseMatch";
import { privateViews } from "../../../lib/private-view";
import { AuthEntry } from "./ProfileComposition";
import { useSocialMutation } from "../messages/useSocialMutation";
import { Button } from "../Button";

export type BrowsePlayInterestApi = {
  request: () => boolean;
  busy: boolean;
  pendingUnknown: boolean;
  canRequest: boolean;
};

export { isBrowseConfirmedPlayInterestOutcome };

type Props = {
  me: Me | null;
  peerName?: string;
  selfPresentation?: MatchPlayer | null;
  onMatchConfirmed?: (confirmation: BrowseMatchConfirmation) => void;
  authState: "loading" | "ready" | "guest" | "error";
  peerId: string;
  returnPath: string;
  navigationLocked: boolean;
  rateBlockedUntil: number | null;
  onRateLimited: (until: number | null, retryAfterSeconds: number | null) => void;
  onRelationship: (view: PlayInterestView | null) => void;
  onConfirmedInterest: (receipt: PlayInterestReceipt) => void;
  onBusyChange: (busy: boolean) => void;
  onApi: (api: BrowsePlayInterestApi | null) => void;
  onSkip: () => void;
  onAuthRetry: () => void;
  /** desktop: primary want-to-play only (Next lives in the deck). mobile: Skip + send. */
  chrome?: "mobile" | "desktop";
  /**
   * Mobile page-level host: admit + POST outside this card.
   * When set, local mutation is not used for send (withdraw/GET unchanged).
   */
  externalAdmitSend?: ((view: PlayInterestView) => boolean) | null;
  /** Soft-disable send while previous page-level op settles / UNKNOWN for this peer. */
  sendBlockedReason?: string;
  /** After external admit from the footer button (not gesture — gesture flies itself). */
  onExternalSendAdmitted?: (() => void) | null;
};

/** Stable footer: one reserved status line + same action baseline (no panel that pushes controls). */
export function StableActionFooter({
  desktop,
  status,
  statusTone,
  primary,
  showSkip,
  skipDisabled,
  onSkip,
}: {
  desktop: boolean;
  status: string;
  statusTone?: "success" | "warning" | "";
  primary: ReactNode | null;
  showSkip: boolean;
  skipDisabled: boolean;
  onSkip: () => void;
}) {
  const tone = statusTone ? ` is-${statusTone}` : "";
  return (
    <div className={`pb-action-slot${desktop ? " pb-action-slot--desktop" : ""}`} data-browse-no-drag="">
      <p className={`pb-action-status${tone}`} role="status">{status || "\u00a0"}</p>
      {desktop ? (
        <div className="pb-main-actions pb-main-actions--desktop">
          {primary}
        </div>
      ) : (
        <div className={`pb-main-actions${primary ? "" : " pb-main-actions--skip-only"}`}>
          {showSkip && (
            <button type="button" className="pb-btn-skip" disabled={skipDisabled} onClick={onSkip}>
              Пропустить
            </button>
          )}
          {primary}
        </div>
      )}
    </div>
  );
}

/** Desktop actions shell: primary slot + Next in one row; caption outside. Shared with layout fixtures. */
export function DesktopBrowseActionsShell({
  primarySlot,
  nextControl,
  caption = "Совпадение — когда оба хотите сыграть. Не дружба.",
}: {
  primarySlot: ReactNode;
  nextControl: ReactNode;
  caption?: string;
}) {
  return (
    <div className="pb-profile-bottom">
      <div className="pb-profile-actions">
        <div className="pb-friend-slot">{primarySlot}</div>
        {nextControl}
      </div>
      <p className="pb-action-caption">{caption}</p>
    </div>
  );
}

/**
 * Pure presentational desktop actions fixture — same DOM/classes as Deck + StableActionFooter.
 * Geometry/layout regression only; no play-interest handlers/network.
 */
export function DesktopBrowseActionsFixture({
  status,
  statusTone = "",
  primaryLabel = "Давай сыграем",
  primaryClassName = "pb-btn-request",
  showPrimary = true,
  nextDisabled = false,
}: {
  status: string;
  statusTone?: "success" | "warning" | "";
  primaryLabel?: string;
  primaryClassName?: string;
  showPrimary?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <div className="gb-player-browse" data-browse-desktop="true" data-surface="player-browse-actions-layout">
      <DesktopBrowseActionsShell
        primarySlot={(
          <StableActionFooter
            desktop
            status={status}
            statusTone={statusTone}
            showSkip={false}
            skipDisabled={false}
            onSkip={() => {}}
            primary={
              showPrimary ? (
                <button type="button" className={primaryClassName}>{primaryLabel}</button>
              ) : null
            }
          />
        )}
        nextControl={(
          <button type="button" className="pb-btn-next" disabled={nextDisabled}>
            Следующий
          </button>
        )}
      />
    </div>
  );
}

export function PlayerBrowsePlayInterest({
  me,
  peerName,
  selfPresentation,
  onMatchConfirmed,
  authState,
  peerId,
  returnPath,
  navigationLocked,
  rateBlockedUntil,
  onRateLimited,
  onRelationship,
  onConfirmedInterest,
  onBusyChange,
  onApi,
  onSkip,
  onAuthRetry,
  chrome = "mobile",
  externalAdmitSend = null,
  sendBlockedReason = "",
  onExternalSendAdmitted = null,
}: Props) {
  const desktopChrome = chrome === "desktop";
  const useExternalSend = Boolean(externalAdmitSend);
  const [view, setView] = useState<PlayInterestView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "guest" | "unavailable" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkNotice, setCheckNotice] = useState("");
  const generation = useRef(0);
  const peerRef = useRef(peerId);
  const meIdRef = useRef(me?.id);
  meIdRef.current = me?.id;
  const viewRef = useRef<PlayInterestView | null>(null);
  viewRef.current = view;
  const externalAdmitRef = useRef(externalAdmitSend);
  externalAdmitRef.current = externalAdmitSend;

  const admittedMatch = useRef<Omit<BrowseMatchConfirmation, "receipt" | "token"> | null>(null);
  const actorRef = useRef("");
  actorRef.current = me ? privateActor(me) : "";

  // Distinct pending scope — never reuses friendship `${me}:friends:${peer}` storage.
  // When externalAdmitSend is set, send POST lives on the page host; local mutation remains for withdraw.
  const mutation = useSocialMutation<PlayInterestReceipt>(
    me ? `${me.id}:play-interest:${peerId}` : `guest:play-interest:${peerId}`,
    me?.csrfToken ?? "",
    (receipt, pending) => {
      setCheckNotice("");
      if (isBrowseConfirmedPlayInterestOutcome(receipt.outcome)) onConfirmedInterest(receipt);
      const captured = admittedMatch.current;
      admittedMatch.current = null;
      if (captured && pending?.method === "POST" && pending.path === "/v1/play-interests"
        && (pending.body as { targetPublicPlayerId?: string }).targetPublicPlayerId === captured.peer.publicPlayerId
        && captured.actor === actorRef.current && captured.privateGeneration === privateViews.currentGeneration
        && isValidConfirmedPlayInterestReceipt(receipt)) {
        onMatchConfirmed?.({ ...captured, token: pending.key, receipt });
      }
      void loadInterest(true);
    },
    () => { void loadInterest(true); },
    Boolean(me),
    { validateSuccess: (receipt, pending) => pending?.path === "/v1/play-interests"
      ? isValidConfirmedPlayInterestReceipt(receipt) : true },
  );

  async function loadInterest(soft = false) {
    const gen = generation.current;
    const peer = peerRef.current;
    if (!me) {
      setView(null);
      setLoadState(authState === "guest" ? "guest" : authState === "error" ? "error" : "loading");
      onRelationship(null);
      return;
    }
    if (!soft) setLoadState("loading");
    const result = await getPlayInterestState(peer);
    if (gen !== generation.current || peer !== peerRef.current) return;
    if (!result.ok) {
      // 401 → guest. 403/404 → definitive unavailable (privacy/eligibility). Transport/server
      // failures including 503 → error + human retry; never invent peer opt-out from 503.
      const next = result.status === 401 ? "guest" : [403, 404].includes(result.status) ? "unavailable" : "error";
      setView(null); setLoadState(next); onRelationship(null); return;
    }
    const nextView = result.data.items[0] ?? null;
    setView(nextView);
    setLoadState(nextView ? "ready" : "unavailable");
    onRelationship(nextView);
  }

  useEffect(() => {
    peerRef.current = peerId;
    generation.current += 1;
    setView(null);
    setCheckNotice("");
    setChecking(false);
    const release = privateViews.retain(privateViews.currentGeneration);
    const expire = () => {
      generation.current += 1;
      admittedMatch.current = null;
      setView(null);
      setLoadState("guest");
      onRelationship(null);
    };
    const session = () => { expire(); setReload(n => n + 1); };
    const foreground = () => {
      if (document.visibilityState === "visible") setReload(n => n + 1);
    };
    window.addEventListener("gb-private-expired", expire);
    window.addEventListener("gb-session-changed", session);
    document.addEventListener("visibilitychange", foreground);
    void loadInterest();
    return () => {
      generation.current += 1;
      release?.();
      window.removeEventListener("gb-private-expired", expire);
      window.removeEventListener("gb-session-changed", session);
      document.removeEventListener("visibilitychange", foreground);
      onApi(null);
    };
  }, [me?.id, me?.csrfToken, peerId, authState, reload]);

  useEffect(() => { onBusyChange(mutation.busy); }, [mutation.busy, onBusyChange]);

  useEffect(() => {
    if (mutation.lastStatus === 429) {
      const seconds = mutation.retryAfterSeconds;
      onRateLimited(Date.now() + Math.max(1, seconds ?? 60) * 1000, seconds);
    }
  }, [mutation.lastStatus, mutation.retryAfterSeconds, onRateLimited]);

  const locked = mutation.busy || mutation.pending || navigationLocked || Boolean(sendBlockedReason);
  const rateBlocked = rateBlockedUntil != null && Date.now() < rateBlockedUntil;
  const canRequest = Boolean(
    me
    && loadState === "ready"
    && canOfferPlayInterest(view)
    && !rateBlocked
    && !mutation.pending
    && !sendBlockedReason,
  );

  function runSend(): boolean {
    if (!me || locked || rateBlocked || sendBlockedReason) return false;
    const current = viewRef.current;
    if (!current || !canOfferPlayInterest(current)) return false;
    const admit = externalAdmitRef.current;
    if (admit) return admit(current);
    const command = playInterestCommand(current, peerId, "send");
    if (!command || !current.capabilities.canSend) return false;
    admittedMatch.current = selfPresentation && peerName ? {
      actor: privateActor(me), privateGeneration: privateViews.currentGeneration, admittedAt: performance.now(),
      peer: { publicPlayerId: peerId, displayName: peerName }, self: { ...selfPresentation },
    } : null;
    const started = mutation.run(command.path, command.body);
    if (!started) admittedMatch.current = null;
    return started;
  }

  function runWithdraw() {
    if (!me || locked || !view) return;
    const command = playInterestCommand(view, peerId, "withdraw");
    if (!command) return;
    mutation.run(command.path, command.body);
  }

  async function checkStatusReadonly() {
    if (!me || checking || mutation.busy) return;
    const gen = generation.current;
    const peer = peerId;
    const authId = me.id;
    setChecking(true);
    setCheckNotice("");
    const result = await getPlayInterestState(peer);
    if (gen !== generation.current || peer !== peerRef.current || meIdRef.current !== authId) return;
    setChecking(false);
    if (!result.ok) {
      setCheckNotice("Не удалось проверить статус. Предыдущая отправка могла быть получена — не повторяйте.");
      return;
    }
    const nextView = result.data.items[0] ?? null;
    if (nextView && (nextView.relationship === "outgoing" || nextView.relationship === "mutual")) {
      setView(nextView);
      setLoadState("ready");
      onRelationship(nextView);
      setCheckNotice(playInterestStatus[nextView.relationship]);
      return;
    }
    setCheckNotice("Статус не подтверждает результат предыдущей отправки. Не повторяйте отправку.");
  }

  useEffect(() => {
    onApi({
      request: runSend,
      busy: locked,
      pendingUnknown: mutation.pending,
      canRequest,
    });
    return () => onApi(null);
  }, [locked, mutation.pending, canRequest, me, peerId, rateBlocked]);

  // Fluid mobile: sendBlocked / host busy must not freeze local skip.
  const skipDisabled = useExternalSend
    ? navigationLocked
    : (locked || navigationLocked);

  if (authState === "loading" || loadState === "loading") {
    return (
      <StableActionFooter
        desktop={desktopChrome}
        status="Проверяем…"
        showSkip={!desktopChrome}
        skipDisabled={skipDisabled}
        onSkip={onSkip}
        primary={
          <button type="button" className="pb-btn-request" disabled>
            Давай сыграем
          </button>
        }
      />
    );
  }

  if (authState === "guest" || loadState === "guest") {
    return (
      <StableActionFooter
        desktop={desktopChrome}
        status="Войдите, чтобы предложить игру"
        showSkip={!desktopChrome}
        skipDisabled={navigationLocked}
        onSkip={onSkip}
        primary={<AuthEntry returnPath={returnPath}>Войти</AuthEntry>}
      />
    );
  }

  // External host owns send UNKNOWN for this peer — do not dual-render local pending UI for send.
  // Still-authenticated pending UNKNOWN: keep receipt / check-status / no-repeat before
  // temporary error or unavailable blanking. No new POST; checkStatusReadonly only.
  if (mutation.pending && !useExternalSend) {
    const knownLine = (view?.relationship === "outgoing" || view?.relationship === "mutual")
      ? playInterestStatus[view.relationship]
      : "";
    const status = checkNotice
      || knownLine
      || mutation.notice
      || "Результат не подтверждён. Не повторяйте отправку.";
    return (
      <StableActionFooter
        desktop={desktopChrome}
        status={status}
        statusTone="warning"
        showSkip={!desktopChrome}
        skipDisabled={skipDisabled}
        onSkip={onSkip}
        primary={
          <Button variant="outline" disabled={checking || mutation.busy} onClick={() => void checkStatusReadonly()}>
            {checking ? "Проверяем…" : "Проверить статус"}
          </Button>
        }
      />
    );
  }

  if (authState === "error" || loadState === "error") {
    return (
      <StableActionFooter
        desktop={desktopChrome}
        status="Не удалось проверить. Повторите."
        statusTone="warning"
        showSkip={!desktopChrome}
        skipDisabled={navigationLocked}
        onSkip={onSkip}
        primary={
          <Button variant="outline" onClick={onAuthRetry}>Повторить</Button>
        }
      />
    );
  }

  // Definitive peer unavailable (relationship) or empty/403/404 load: no technical panel,
  // no disabled send. Deck Next/Skip + known eligibility handle navigation.
  if (loadState === "unavailable" || view?.relationship === "unavailable") {
    return (
      <StableActionFooter
        desktop={desktopChrome}
        status=""
        showSkip={!desktopChrome}
        skipDisabled={navigationLocked}
        onSkip={onSkip}
        primary={null}
      />
    );
  }

  if (rateBlocked) {
    return (
      <StableActionFooter
        desktop={desktopChrome}
        status="Слишком много попыток. Позже."
        statusTone="warning"
        showSkip={!desktopChrome}
        skipDisabled={navigationLocked}
        onSkip={onSkip}
        primary={null}
      />
    );
  }

  if (view?.relationship === "outgoing" || view?.relationship === "mutual") {
    const canWithdraw = Boolean(playInterestCommand(view, peerId, "withdraw"));
    return (
      <StableActionFooter
        desktop={desktopChrome}
        status={playInterestStatus[view.relationship]}
        statusTone="success"
        showSkip={!desktopChrome}
        skipDisabled={skipDisabled}
        onSkip={onSkip}
        primary={
          canWithdraw ? (
            <button type="button" className="pb-btn-withdraw" disabled={locked} onClick={() => runWithdraw()}>
              {mutation.busy ? "Отменяем…" : "Отменить предложение"}
            </button>
          ) : null
        }
      />
    );
  }

  const notice = sendBlockedReason
    || (mutation.notice && !mutation.pending && !useExternalSend ? mutation.notice : "");
  return (
    <StableActionFooter
      desktop={desktopChrome}
      status={notice}
      statusTone={notice ? "warning" : ""}
      showSkip={!desktopChrome}
      skipDisabled={skipDisabled}
      onSkip={onSkip}
      primary={
        <button
          type="button"
          className="pb-btn-request"
          disabled={!canRequest || locked}
          onClick={() => {
            const started = runSend();
            if (started && useExternalSend) onExternalSendAdmitted?.();
          }}
        >
          {!useExternalSend && mutation.busy ? "Отправляем…" : "Давай сыграем"}
        </button>
      }
    />
  );
}

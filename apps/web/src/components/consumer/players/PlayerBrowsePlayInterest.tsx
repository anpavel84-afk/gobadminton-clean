"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import {
  getPlayInterestState,
  isBrowseConfirmedPlayInterestOutcome,
  playInterestCommand,
  playInterestStatus,
} from "../../../lib/play-interests";
import { canOfferPlayInterest } from "../../../lib/player-browse";
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
};

/** Stable footer: one reserved status line + same action baseline (no panel that pushes controls). */
function StableActionFooter({
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

export function PlayerBrowsePlayInterest({
  me,
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
}: Props) {
  const desktopChrome = chrome === "desktop";
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

  // Distinct pending scope — never reuses friendship `${me}:friends:${peer}` storage.
  const mutation = useSocialMutation<PlayInterestReceipt>(
    me ? `${me.id}:play-interest:${peerId}` : `guest:play-interest:${peerId}`,
    me?.csrfToken ?? "",
    (receipt) => {
      setCheckNotice("");
      if (isBrowseConfirmedPlayInterestOutcome(receipt.outcome)) onConfirmedInterest(receipt);
      void loadInterest(true);
    },
    () => { void loadInterest(true); },
    Boolean(me),
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

  const locked = mutation.busy || mutation.pending || navigationLocked;
  const rateBlocked = rateBlockedUntil != null && Date.now() < rateBlockedUntil;
  const canRequest = Boolean(me && loadState === "ready" && canOfferPlayInterest(view) && !rateBlocked && !mutation.pending);

  function runSend(): boolean {
    if (!me || locked || rateBlocked) return false;
    const current = viewRef.current;
    if (!current || !canOfferPlayInterest(current)) return false;
    const command = playInterestCommand(current, peerId, "send");
    if (!command || !current.capabilities.canSend) return false;
    mutation.run(command.path, command.body);
    return true;
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

  const skipDisabled = locked || navigationLocked;

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

  // Still-authenticated pending UNKNOWN: keep receipt / check-status / no-repeat before
  // temporary error or unavailable blanking. No new POST; checkStatusReadonly only.
  if (mutation.pending) {
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

  const notice = mutation.notice && !mutation.pending ? mutation.notice : "";
  return (
    <StableActionFooter
      desktop={desktopChrome}
      status={notice}
      statusTone={notice ? "warning" : ""}
      showSkip={!desktopChrome}
      skipDisabled={locked}
      onSkip={onSkip}
      primary={
        <button
          type="button"
          className="pb-btn-request"
          disabled={!canRequest || locked}
          onClick={() => { void runSend(); }}
        >
          {mutation.busy ? "Отправляем…" : "Давай сыграем"}
        </button>
      }
    />
  );
}

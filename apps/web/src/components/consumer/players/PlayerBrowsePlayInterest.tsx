"use client";

import { useEffect, useRef, useState } from "react";
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
      const next = result.status === 401 ? "guest" : [403, 404, 503].includes(result.status) ? "unavailable" : "error";
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
      setCheckNotice("Не удалось проверить статус. Исходная операция могла быть получена — не отправляйте интерес повторно.");
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
    setCheckNotice("Статус не подтверждает результат предыдущей отправки. Не отправляйте интерес повторно.");
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

  if (authState === "loading" || loadState === "loading") {
    return <div className="pb-status" role="status"><div className="pb-status__title">Проверяем интерес к игре…</div></div>;
  }

  if (authState === "guest" || loadState === "guest") {
    return <div className="pb-status" data-browse-no-drag="">
      <div className="pb-status__title">Войдите, чтобы отметить интерес к игре</div>
      <p>Гости могут листать каталог. Интерес отправится только после явного действия после входа.</p>
      <div className="pb-status-actions"><AuthEntry returnPath={returnPath}>Войти</AuthEntry></div>
    </div>;
  }

  if (authState === "error" || loadState === "error") {
    return <div className="pb-status is-warning" role="status">
      <div className="pb-status__title">Не удалось проверить интерес к игре</div>
      <div className="pb-status-actions"><Button variant="outline" onClick={onAuthRetry}>Повторить</Button></div>
    </div>;
  }

  if (loadState === "unavailable" || view?.relationship === "unavailable") {
    return <div className="pb-status" role="status">
      <div className="pb-status__title">{playInterestStatus.unavailable}</div>
      <p>Просмотр доступен. Причина недоступности не раскрывается.</p>
    </div>;
  }

  if (mutation.pending) {
    return <div className="pb-status is-warning" role="status" data-browse-no-drag="">
      <div className="pb-status__title">Результат отправки не подтверждён</div>
      <p>{mutation.notice || "Предыдущая отправка могла быть получена. Не отправляйте интерес повторно."}</p>
      {(view?.relationship === "outgoing" || view?.relationship === "mutual") && (
        <p>{playInterestStatus[view.relationship]}</p>
      )}
      {checkNotice && <p>{checkNotice}</p>}
      <div className="pb-status-actions">
        <Button variant="outline" disabled={checking || mutation.busy} onClick={() => void checkStatusReadonly()}>
          {checking ? "Проверяем…" : "Проверить статус"}
        </Button>
      </div>
    </div>;
  }

  if (rateBlocked) {
    return <div className="pb-status is-warning" role="status">
      <div className="pb-status__title">Слишком много попыток</div>
      <p>Просмотр доступен. Новые отметки интереса временно недоступны.</p>
      {desktopChrome ? (
        <div className="pb-main-actions pb-main-actions--desktop" style={{ marginTop: 12 }}>
          <button type="button" className="pb-btn-request" disabled>Хочу сыграть · позже</button>
        </div>
      ) : (
        <div className="pb-main-actions" style={{ marginTop: 12 }}>
          <button type="button" className="pb-btn-skip" disabled={navigationLocked} onClick={onSkip}>Пропустить</button>
          <button type="button" className="pb-btn-request" disabled>Хочу сыграть · позже</button>
        </div>
      )}
    </div>;
  }

  if (view?.relationship === "outgoing") {
    return <div className="pb-status is-success" role="status" data-browse-no-drag="">
      <div className="pb-status__title">{playInterestStatus.outgoing}</div>
      <p>Совпадение появится только при взаимном интересе. Это не дружба и не запрос в друзья.</p>
      <div className="pb-status-actions">
        {playInterestCommand(view, peerId, "withdraw") && (
          <Button variant="outline" disabled={locked} onClick={() => runWithdraw()}>Отозвать интерес</Button>
        )}
      </div>
    </div>;
  }

  if (view?.relationship === "mutual") {
    return <div className="pb-status is-success" role="status" data-browse-no-drag="">
      <div className="pb-status__title">{playInterestStatus.mutual}</div>
      <p>Взаимный интерес подтверждён сервером. Дружба и контакты не создаются автоматически.</p>
      <div className="pb-status-actions">
        {playInterestCommand(view, peerId, "withdraw") && (
          <Button variant="outline" disabled={locked} onClick={() => runWithdraw()}>Отозвать интерес</Button>
        )}
      </div>
    </div>;
  }

  return <div className={`pb-action-slot${desktopChrome ? " pb-action-slot--desktop" : ""}`} data-browse-no-drag="">
    {mutation.notice && !mutation.pending && <p className="pb-status" role="status" style={{ marginBottom: 12 }}>{mutation.notice}</p>}
    {desktopChrome ? (
      <div className="pb-main-actions pb-main-actions--desktop">
        <button type="button" className="pb-btn-request" disabled={!canRequest || locked} onClick={() => { void runSend(); }}>
          {mutation.busy ? "Отправляем…" : "Хочу сыграть"}
        </button>
      </div>
    ) : (
      <div className="pb-main-actions">
        <button type="button" className="pb-btn-skip" disabled={locked} onClick={onSkip}>Пропустить</button>
        <button type="button" className="pb-btn-request" disabled={!canRequest || locked} onClick={() => { void runSend(); }}>
          {mutation.busy ? "Отправляем…" : "Хочу сыграть"}
        </button>
      </div>
    )}
  </div>;
}

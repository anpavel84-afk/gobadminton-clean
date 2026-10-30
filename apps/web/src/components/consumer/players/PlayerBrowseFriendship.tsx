"use client";

import { useEffect, useRef, useState } from "react";
import type { FriendshipReceipt, FriendshipView } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import { friendCommand, friendStatus, getFriendState, getSocialCapabilities } from "../../../lib/friendships";
import { canOfferFriendship } from "../../../lib/player-browse";
import { privateViews } from "../../../lib/private-view";
import { AuthEntry } from "./ProfileComposition";
import { useSocialMutation } from "../messages/useSocialMutation";
import { Button } from "../Button";

export type BrowseFriendshipApi = {
  request: () => boolean;
  busy: boolean;
  pendingUnknown: boolean;
  canRequest: boolean;
};

type Props = {
  me: Me | null;
  authState: "loading" | "ready" | "guest" | "error";
  peerId: string;
  returnPath: string;
  navigationLocked: boolean;
  rateBlockedUntil: number | null;
  onRateLimited: (until: number | null, retryAfterSeconds: number | null) => void;
  onRelationship: (view: FriendshipView | null) => void;
  onConfirmedRequest: (receipt: FriendshipReceipt) => void;
  onBusyChange: (busy: boolean) => void;
  onApi: (api: BrowseFriendshipApi | null) => void;
  onSkip: () => void;
  onAuthRetry: () => void;
};

export function PlayerBrowseFriendship({
  me,
  authState,
  peerId,
  returnPath,
  navigationLocked,
  rateBlockedUntil,
  onRateLimited,
  onRelationship,
  onConfirmedRequest,
  onBusyChange,
  onApi,
  onSkip,
  onAuthRetry,
}: Props) {
  const [view, setView] = useState<FriendshipView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "guest" | "unavailable" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkNotice, setCheckNotice] = useState("");
  const generation = useRef(0);
  const peerRef = useRef(peerId);
  const viewRef = useRef<FriendshipView | null>(null);
  viewRef.current = view;

  const mutation = useSocialMutation<FriendshipReceipt>(
    me ? `${me.id}:friends:${peerId}` : `guest:friends:${peerId}`,
    me?.csrfToken ?? "",
    (receipt) => {
      setCheckNotice("");
      onConfirmedRequest(receipt);
      void loadFriendship(true);
    },
    () => { void loadFriendship(true); },
    Boolean(me),
  );

  async function loadFriendship(soft = false) {
    const gen = generation.current;
    const peer = peerRef.current;
    if (!me) {
      setView(null);
      setLoadState(authState === "guest" ? "guest" : authState === "error" ? "error" : "loading");
      onRelationship(null);
      return;
    }
    if (!soft) setLoadState("loading");
    const capabilities = await getSocialCapabilities();
    if (gen !== generation.current || peer !== peerRef.current) return;
    if (!capabilities.ok) {
      const next = capabilities.status === 401 ? "guest" : [403, 404, 503].includes(capabilities.status) ? "unavailable" : "error";
      setView(null); setLoadState(next); onRelationship(null); return;
    }
    if (!capabilities.data.friends) { setView(null); setLoadState("unavailable"); onRelationship(null); return; }
    const result = await getFriendState(peer);
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
    void loadFriendship();
    return () => {
      release?.();
      window.removeEventListener("gb-private-expired", expire);
      window.removeEventListener("gb-session-changed", session);
      document.removeEventListener("visibilitychange", foreground);
      onApi(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- peer/auth fence; stale callbacks ignored via generation
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
  const canRequest = Boolean(me && loadState === "ready" && canOfferFriendship(view) && !rateBlocked && !mutation.pending);

  function runRequest(): boolean {
    if (!me || locked || rateBlocked) return false;
    const current = viewRef.current;
    if (!current || !canOfferFriendship(current)) return false;
    const command = friendCommand(current, peerId, "request");
    if (!command || !current.capabilities.canRequest) return false;
    mutation.run(command.path, command.body);
    return true;
  }

  function runDecision(action: "accept" | "decline" | "cancel") {
    if (!me || locked || !view) return;
    const command = friendCommand(view, peerId, action);
    if (!command) return;
    mutation.run(command.path, command.body);
  }

  async function checkStatusReadonly() {
    if (!me || checking || mutation.busy) return;
    setChecking(true);
    setCheckNotice("");
    const result = await getFriendState(peerId);
    setChecking(false);
    if (!result.ok) {
      setCheckNotice("Не удалось проверить статус. Исходная операция могла быть получена — не отправляйте запрос повторно.");
      return;
    }
    const nextView = result.data.items[0] ?? null;
    if (nextView && (nextView.relationship === "outgoing_pending" || nextView.relationship === "friends" || nextView.relationship === "incoming_pending")) {
      setView(nextView);
      setLoadState("ready");
      onRelationship(nextView);
      setCheckNotice(friendStatus[nextView.relationship]);
      return;
    }
    setCheckNotice("Статус не подтверждает результат предыдущей отправки. Не отправляйте запрос повторно.");
  }

  useEffect(() => {
    onApi({
      request: runRequest,
      busy: locked,
      pendingUnknown: mutation.pending,
      canRequest,
    });
    return () => onApi(null);
  }, [locked, mutation.pending, canRequest, me, peerId, rateBlocked]);

  if (authState === "loading" || loadState === "loading") {
    return <div className="pb-status" role="status"><div className="pb-status__title">Проверяем дружбу…</div></div>;
  }

  if (authState === "guest" || loadState === "guest") {
    return <div className="pb-status" data-browse-no-drag="">
      <div className="pb-status__title">Войдите, чтобы предложить дружбу</div>
      <p>Гости могут листать каталог. Запрос отправится только после явного действия после входа.</p>
      <div className="pb-status-actions"><AuthEntry returnPath={returnPath}>Войти</AuthEntry></div>
    </div>;
  }

  if (authState === "error" || loadState === "error") {
    return <div className="pb-status is-warning" role="status">
      <div className="pb-status__title">Не удалось проверить дружбу</div>
      <div className="pb-status-actions"><Button variant="outline" onClick={onAuthRetry}>Повторить</Button></div>
    </div>;
  }

  if (loadState === "unavailable" || view?.relationship === "unavailable") {
    return <div className="pb-status" role="status">
      <div className="pb-status__title">{friendStatus.unavailable}</div>
      <p>Просмотр доступен. Причина недоступности не раскрывается.</p>
    </div>;
  }

  if (mutation.pending) {
    return <div className="pb-status is-warning" role="status" data-browse-no-drag="">
      <div className="pb-status__title">Результат отправки не подтверждён</div>
      <p>{mutation.notice || "Предыдущая отправка могла быть получена. Не отправляйте запрос повторно."}</p>
      {(view?.relationship === "outgoing_pending" || view?.relationship === "friends") && (
        <p>{friendStatus[view.relationship]}</p>
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
      <p>Просмотр доступен. Новые запросы временно недоступны.</p>
      <div className="pb-main-actions" style={{ marginTop: 12 }}>
        <button type="button" className="pb-btn-skip" disabled={navigationLocked} onClick={onSkip}>Пропустить</button>
        <button type="button" className="pb-btn-request" disabled>В друзья · позже</button>
      </div>
    </div>;
  }

  if (view?.relationship === "outgoing_pending") {
    return <div className="pb-status is-success" role="status" data-browse-no-drag="">
      <div className="pb-status__title">{friendStatus.outgoing_pending}</div>
      <p>Решение за игроком. Повторный запрос не отправляется.</p>
      <div className="pb-status-actions">
        {friendCommand(view, peerId, "cancel") && (
          <Button variant="outline" disabled={locked} onClick={() => runDecision("cancel")}>Отменить запрос</Button>
        )}
      </div>
    </div>;
  }

  if (view?.relationship === "incoming_pending") {
    return <div className="pb-status is-purple" role="status" data-browse-no-drag="">
      <div className="pb-status__title">{friendStatus.incoming_pending}</div>
      <p>Входящий запрос принимается или отклоняется только явными кнопками.</p>
      <div className="pb-status-actions">
        {friendCommand(view, peerId, "accept") && (
          <Button variant="primary" disabled={locked} onClick={() => runDecision("accept")}>Принять</Button>
        )}
        {friendCommand(view, peerId, "decline") && (
          <Button variant="outline" disabled={locked} onClick={() => runDecision("decline")}>Отклонить</Button>
        )}
      </div>
    </div>;
  }

  if (view?.relationship === "friends") {
    return <div className="pb-status is-success" role="status">
      <div className="pb-status__title">{friendStatus.friends}</div>
      <p>Запрос уже не нужен.</p>
    </div>;
  }

  return <div className="pb-action-slot" data-browse-no-drag="">
    {mutation.notice && !mutation.pending && <p className="pb-status" role="status" style={{ marginBottom: 12 }}>{mutation.notice}</p>}
    <div className="pb-main-actions">
      <button type="button" className="pb-btn-skip" disabled={locked} onClick={onSkip}>Пропустить</button>
      <button type="button" className="pb-btn-request" disabled={!canRequest || locked} onClick={() => { void runRequest(); }}>
        {mutation.busy ? "Отправляем…" : "Предложить дружбу"}
      </button>
    </div>
  </div>;
}

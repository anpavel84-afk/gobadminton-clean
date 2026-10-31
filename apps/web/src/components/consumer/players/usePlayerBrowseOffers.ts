"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import { getMe, getMySocialProfile } from "../../../lib/api-client";
import type { Me, PublicPlayer } from "../../../lib/consumer-types";
import {
  bindPlayInterestStates,
  getPlayInterestState,
  getPlayInterestStates,
  isBrowseConfirmedPlayInterestOutcome,
  isFinderSendEligible,
  playInterestCommand,
} from "../../../lib/play-interests";
import { canOfferPlayInterest } from "../../../lib/player-browse";
import { privateViews } from "../../../lib/private-view";
import { useSocialMutation } from "../messages/useSocialMutation";

export type BrowseOfferPhase = "idle" | "sending" | "outgoing" | "mutual" | "failed" | "unknown";

export type BrowseOfferStatus = {
  phase: BrowseOfferPhase;
  peerId: string | null;
  peerName: string;
  message: string;
  canCheckStatus: boolean;
};

export type FinderEligibilityKind =
  | "idle"
  | "guest"
  | "checking"
  | "ready"
  | "empty_page"
  | "exhausted"
  | "error";

export type FinderEligibility = {
  kind: FinderEligibilityKind;
  players: PublicPlayer[];
  message: string;
  canContinue: boolean;
};

export type AdmitSendInput = {
  peerId: string;
  peerName: string;
  view: PlayInterestView;
};

export type PlayerBrowseOffersApi = {
  status: BrowseOfferStatus;
  eligibility: FinderEligibility;
  known: ReadonlyMap<string, PlayInterestView["relationship"]>;
  sendInFlight: boolean;
  unknownPeerId: string | null;
  canSendTo(peerId: string): { ok: boolean; reason: string };
  admitSend(input: AdmitSendInput): boolean;
  noteRelationship(peerId: string, relationship: PlayInterestView["relationship"]): void;
  checkStatusReadonly(): void;
  continueSearch(): void;
  retryEligibility(): void;
  me: Me | null;
  authState: "loading" | "ready" | "guest" | "error";
};

function statusMessage(phase: BrowseOfferPhase, peerName: string, notice: string): string {
  const who = peerName.trim() || "игроку";
  switch (phase) {
    case "sending":
      return `${who}: отправляем предложение…`;
    case "outgoing":
      return `${who}: предложение отправлено`;
    case "mutual":
      return `С ${who} вы оба хотите сыграть`;
    case "failed":
      return notice || `${who}: не удалось отправить`;
    case "unknown":
      return notice || `${who}: результат отправки не подтверждён`;
    default:
      return "";
  }
}

type Props = {
  finderActive: boolean;
  ordinaryScope: string;
  catalogPlayers: PublicPlayer[];
  catalogState: string;
  hasMore: boolean;
  moreBusy: boolean;
  onLoadMore: () => void;
};

/**
 * Page-level mobile play-interest operation + finder eligibility.
 * Survives card changes and fullscreen close; one active POST; existing mutation/sessionStorage.
 */
export function usePlayerBrowseOffers({
  finderActive,
  ordinaryScope,
  catalogPlayers,
  catalogState,
  hasMore,
  moreBusy,
  onLoadMore,
}: Props): PlayerBrowseOffersApi {
  const [me, setMe] = useState<Me | null>(null);
  const [authState, setAuthState] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [authReload, setAuthReload] = useState(0);
  const [ownPublicPlayerId, setOwnPublicPlayerId] = useState<string | null>(null);
  const [known, setKnown] = useState<Map<string, PlayInterestView["relationship"]>>(() => new Map());
  const [eligibleIds, setEligibleIds] = useState<string[]>([]);
  const [eligibilityKind, setEligibilityKind] = useState<FinderEligibilityKind>("idle");
  const [eligibilityMessage, setEligibilityMessage] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [opPeerId, setOpPeerId] = useState<string | null>(null);
  const [opPeerName, setOpPeerName] = useState("");
  const [opPhase, setOpPhase] = useState<BrowseOfferPhase>("idle");
  const [opNotice, setOpNotice] = useState("");
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [continueArmed, setContinueArmed] = useState(false);
  const [unresolvedPeers, setUnresolvedPeers] = useState<Set<string>>(() => new Set());

  const actorIdRef = useRef<string | null>(null);
  const privateGenRef = useRef(0);
  const opPeerIdRef = useRef<string | null>(null);
  const opPhaseRef = useRef<BrowseOfferPhase>("idle");
  const admitLockRef = useRef(false);
  const pendingAdmitRef = useRef<AdmitSendInput | null>(null);
  const batchGen = useRef(0);
  const batchInFlight = useRef(false);
  const scopeRef = useRef(ordinaryScope);
  const continueArmedRef = useRef(false);
  continueArmedRef.current = continueArmed;
  opPeerIdRef.current = opPeerId;
  opPhaseRef.current = opPhase;

  const mutationScope = me && opPeerId
    ? `${me.id}:play-interest:${opPeerId}`
    : `guest:play-interest:__idle__`;

  const mutation = useSocialMutation<PlayInterestReceipt>(
    mutationScope,
    me?.csrfToken ?? "",
    (receipt) => {
      const peer = opPeerIdRef.current;
      const actor = actorIdRef.current;
      if (!peer || !actor || me?.id !== actor) return;
      if (!isBrowseConfirmedPlayInterestOutcome(receipt.outcome)) {
        admitLockRef.current = false;
        setOpPhase("failed");
        setOpNotice("Не удалось отправить");
        return;
      }
      const relationship = receipt.outcome === "mutual" ? "mutual" : "outgoing";
      setKnown(prev => {
        const next = new Map(prev);
        next.set(peer, relationship);
        return next;
      });
      // Keep peer in the finder buffer so index/media neighborhood stay stable; deck skips via known.
      setUnresolvedPeers(prev => {
        if (!prev.has(peer)) return prev;
        const next = new Set(prev);
        next.delete(peer);
        return next;
      });
      admitLockRef.current = false;
      setOpPhase(relationship);
      setOpNotice("");
    },
    () => {
      admitLockRef.current = false;
      setOpPhase("failed");
      setOpNotice("Не удалось отправить");
    },
    Boolean(me && opPeerId),
    { validateSuccess: (data) => isBrowseConfirmedPlayInterestOutcome(data.outcome) },
  );

  // After peer scope commits, start the single admitted POST (existing mutation + idempotency key).
  useEffect(() => {
    const input = pendingAdmitRef.current;
    if (!input || !me || opPeerId !== input.peerId) return;
    if (mutationScope !== `${me.id}:play-interest:${input.peerId}`) return;
    pendingAdmitRef.current = null;
    const command = playInterestCommand(input.view, input.peerId, "send");
    if (!command) {
      admitLockRef.current = false;
      setOpPhase("idle");
      setOpPeerId(null);
      opPeerIdRef.current = null;
      opPhaseRef.current = "idle";
      return;
    }
    const started = mutation.run(command.path, command.body);
    if (!started) {
      admitLockRef.current = false;
      setOpPhase("idle");
      setOpPeerId(null);
      opPeerIdRef.current = null;
      opPhaseRef.current = "idle";
    }
  }, [opPeerId, mutationScope, me, mutation]);

  useEffect(() => {
    if (mutation.busy) return;
    if (mutation.pending && opPeerIdRef.current) {
      const peer = opPeerIdRef.current;
      admitLockRef.current = false;
      setOpPhase("unknown");
      setUnresolvedPeers(prev => {
        if (prev.has(peer)) return prev;
        const next = new Set(prev);
        next.add(peer);
        return next;
      });
      if (mutation.notice) setOpNotice(mutation.notice);
    }
  }, [mutation.busy, mutation.pending, mutation.notice]);

  useEffect(() => {
    let live = true;
    setAuthState("loading");
    setMe(null);
    void (async () => {
      const result = await getMe();
      if (!live) return;
      if (!result.ok) {
        setMe(null);
        setAuthState(result.status === 401 ? "guest" : "error");
        return;
      }
      setMe(result.data);
      actorIdRef.current = result.data.id;
      privateGenRef.current = privateViews.currentGeneration;
      setAuthState("ready");
      const social = await getMySocialProfile();
      if (!live) return;
      if (social.ok && social.data.publicPlayerId) setOwnPublicPlayerId(social.data.publicPlayerId);
    })();
    const expire = () => {
      live = false;
      actorIdRef.current = null;
      privateGenRef.current = privateViews.currentGeneration;
      admitLockRef.current = false;
      pendingAdmitRef.current = null;
      setMe(null);
      setOwnPublicPlayerId(null);
      setAuthState("guest");
      setOpPhase("idle");
      setOpPeerId(null);
      opPeerIdRef.current = null;
      opPhaseRef.current = "idle";
      setKnown(new Map());
      setUnresolvedPeers(new Set());
      setEligibleIds([]);
      setEligibilityKind("guest");
    };
    const session = () => { expire(); setAuthReload(n => n + 1); };
    window.addEventListener("gb-private-expired", expire);
    window.addEventListener("gb-session-changed", session);
    return () => {
      live = false;
      window.removeEventListener("gb-private-expired", expire);
      window.removeEventListener("gb-session-changed", session);
    };
  }, [authReload]);

  useEffect(() => {
    if (scopeRef.current === ordinaryScope) return;
    scopeRef.current = ordinaryScope;
    batchGen.current += 1;
    batchInFlight.current = false;
    setCheckedIds(new Set());
    setEligibleIds([]);
    setEligibilityKind(finderActive ? "checking" : "idle");
    setEligibilityMessage("");
    setContinueArmed(false);
  }, [ordinaryScope, finderActive]);

  const runBatch = useCallback(async (players: PublicPlayer[], mode: "replace" | "append") => {
    if (!me || authState !== "ready") return;
    const own = ownPublicPlayerId?.trim() || "";
    const ordered = players
      .map(p => p.publicPlayerId)
      .filter(id => id && id !== own);
    const frozen = Array.from(new Set(ordered)).slice(0, 50);
    if (frozen.length === 0) {
      if (mode === "replace") {
        setEligibleIds([]);
        setEligibilityKind(hasMore ? "empty_page" : "exhausted");
        setEligibilityMessage(hasMore
          ? "В этой части списка новых предложений нет"
          : "Подборка по этим фильтрам закончилась");
      }
      return;
    }
    const gen = ++batchGen.current;
    const actor = me.id;
    const priv = privateViews.currentGeneration;
    const scope = ordinaryScope;
    batchInFlight.current = true;
    setEligibilityKind("checking");
    setEligibilityMessage("Подбираем игроков…");
    const result = await getPlayInterestStates(frozen);
    batchInFlight.current = false;
    if (gen !== batchGen.current) return;
    if (actor !== actorIdRef.current || priv !== privateViews.currentGeneration) return;
    if (scope !== scopeRef.current) return;
    if (!result.ok) {
      setEligibilityKind("error");
      setEligibilityMessage("Не удалось проверить подборку");
      return;
    }
    const bound = bindPlayInterestStates(frozen, result.data.items);
    if (!bound) {
      setEligibilityKind("error");
      setEligibilityMessage("Не удалось проверить подборку");
      return;
    }
    setKnown(prev => {
      const next = new Map(prev);
      for (const [id, view] of bound) next.set(id, view.relationship);
      return next;
    });
    setCheckedIds(prev => {
      const next = new Set(prev);
      for (const id of frozen) next.add(id);
      return next;
    });
    const nextEligible = frozen.filter(id => isFinderSendEligible(bound.get(id)));
    setEligibleIds(prev => {
      const merged = mode === "append"
        ? [...prev, ...nextEligible.filter(id => !prev.includes(id))]
        : nextEligible;
      if (merged.length > 0) {
        setEligibilityKind("ready");
        setEligibilityMessage("");
      } else if (hasMore) {
        setEligibilityKind("empty_page");
        setEligibilityMessage("В этой части списка новых предложений нет");
      } else {
        setEligibilityKind("exhausted");
        setEligibilityMessage("Подборка по этим фильтрам закончилась");
      }
      return merged;
    });
  }, [me, authState, ordinaryScope, hasMore, ownPublicPlayerId]);

  useEffect(() => {
    if (!finderActive) return;
    if (authState === "loading") return;
    if (authState === "guest") {
      setEligibilityKind("guest");
      setEligibilityMessage("Войдите, чтобы предложить игру");
      setEligibleIds([]);
      return;
    }
    if (authState !== "ready" || !me) {
      setEligibilityKind("error");
      setEligibilityMessage("Не удалось проверить подборку");
      return;
    }
    if (catalogState === "loading" && catalogPlayers.length === 0) {
      setEligibilityKind("checking");
      setEligibilityMessage("Подбираем игроков…");
      return;
    }
    if (catalogState === "error" || catalogState === "unavailable") {
      setEligibilityKind("error");
      setEligibilityMessage("Не удалось проверить подборку");
      return;
    }
    if (continueArmed) {
      if (moreBusy || (catalogState === "loading" && catalogPlayers.every(p => checkedIds.has(p.publicPlayerId)))) {
        setEligibilityKind("checking");
        setEligibilityMessage("Подбираем игроков…");
        return;
      }
      const fresh = catalogPlayers.filter(p => !checkedIds.has(p.publicPlayerId));
      if (fresh.length === 0) {
        setContinueArmed(false);
        setEligibilityKind(hasMore ? "empty_page" : "exhausted");
        setEligibilityMessage(hasMore
          ? "В этой части списка новых предложений нет"
          : "Подборка по этим фильтрам закончилась");
        return;
      }
      setContinueArmed(false);
      void runBatch(fresh, "append");
      return;
    }
    const unchecked = catalogPlayers.filter(p => !checkedIds.has(p.publicPlayerId)).slice(0, 50);
    if (unchecked.length === 0 && eligibleIds.length > 0) {
      setEligibilityKind("ready");
      return;
    }
    if (unchecked.length === 0 && checkedIds.size > 0) {
      setEligibilityKind(hasMore ? "empty_page" : "exhausted");
      setEligibilityMessage(hasMore
        ? "В этой части списка новых предложений нет"
        : "Подборка по этим фильтрам закончилась");
      return;
    }
    if (unchecked.length === 0) {
      setEligibilityKind(hasMore ? "empty_page" : catalogState === "empty" ? "exhausted" : "checking");
      setEligibilityMessage(hasMore
        ? "В этой части списка новых предложений нет"
        : catalogState === "empty"
          ? "Подборка по этим фильтрам закончилась"
          : "Подбираем игроков…");
      return;
    }
    if (batchInFlight.current) return;
    void runBatch(unchecked, eligibleIds.length ? "append" : "replace");
  }, [
    finderActive,
    authState,
    me,
    catalogState,
    catalogPlayers,
    checkedIds,
    eligibleIds.length,
    hasMore,
    moreBusy,
    continueArmed,
    runBatch,
  ]);

  // Re-open finder: re-check current page (clear checked for fresh gate on entry).
  const prevFinder = useRef(false);
  useEffect(() => {
    if (finderActive && !prevFinder.current) {
      batchGen.current += 1;
      batchInFlight.current = false;
      setCheckedIds(new Set());
      setEligibleIds([]);
      setContinueArmed(false);
      setEligibilityKind(authState === "guest" ? "guest" : "checking");
      setEligibilityMessage(authState === "guest" ? "Войдите, чтобы предложить игру" : "Подбираем игроков…");
    }
    prevFinder.current = finderActive;
  }, [finderActive, authState]);

  const unresolvedRef = useRef(unresolvedPeers);
  unresolvedRef.current = unresolvedPeers;

  const admitSend = useCallback((input: AdmitSendInput): boolean => {
    if (!me || authState !== "ready") return false;
    if (actorIdRef.current !== me.id) return false;
    if (admitLockRef.current || opPhaseRef.current === "sending") return false;
    if (unresolvedRef.current.has(input.peerId)) return false;
    if (!canOfferPlayInterest(input.view) || !input.view.capabilities.canSend) return false;
    if (!playInterestCommand(input.view, input.peerId, "send")) return false;
    admitLockRef.current = true;
    pendingAdmitRef.current = input;
    setOpPeerId(input.peerId);
    setOpPeerName(input.peerName);
    setOpPhase("sending");
    setOpNotice("");
    opPeerIdRef.current = input.peerId;
    opPhaseRef.current = "sending";
    return true;
  }, [me, authState]);

  const canSendTo = useCallback((peerId: string): { ok: boolean; reason: string } => {
    if (opPhase === "sending") {
      return { ok: false, reason: "Завершаем предыдущее предложение" };
    }
    if (unresolvedPeers.has(peerId)) {
      return { ok: false, reason: "Результат не подтверждён. Не повторяйте отправку." };
    }
    const rel = known.get(peerId);
    if (rel === "outgoing" || rel === "mutual" || rel === "unavailable") {
      return { ok: false, reason: "" };
    }
    return { ok: true, reason: "" };
  }, [opPhase, unresolvedPeers, known]);

  const noteRelationship = useCallback((peerId: string, relationship: PlayInterestView["relationship"]) => {
    setKnown(prev => {
      if (prev.get(peerId) === relationship) return prev;
      const next = new Map(prev);
      next.set(peerId, relationship);
      return next;
    });
  }, []);

  const checkStatusReadonly = useCallback(() => {
    if (!me || !opPeerId || checkingStatus) return;
    const peer = opPeerId;
    const actor = me.id;
    const gen = privateViews.currentGeneration;
    setCheckingStatus(true);
    void getPlayInterestState(peer).then(result => {
      setCheckingStatus(false);
      if (actorIdRef.current !== actor || opPeerIdRef.current !== peer) return;
      if (gen !== privateViews.currentGeneration) return;
      if (!result.ok) {
        setOpNotice("Не удалось проверить статус. Предыдущая отправка могла быть получена — не повторяйте.");
        return;
      }
      const view = result.data.items[0] ?? null;
      if (view && (view.relationship === "outgoing" || view.relationship === "mutual")) {
        setKnown(prev => {
          const next = new Map(prev);
          next.set(peer, view.relationship);
          return next;
        });
        setUnresolvedPeers(prev => {
          if (!prev.has(peer)) return prev;
          const next = new Set(prev);
          next.delete(peer);
          return next;
        });
        setOpPhase(view.relationship);
        setOpNotice("");
        return;
      }
      setOpNotice("Статус не подтверждает результат предыдущей отправки. Не повторяйте отправку.");
    });
  }, [me, opPeerId, checkingStatus]);

  const continueSearch = useCallback(() => {
    if (!hasMore || moreBusy || batchInFlight.current || continueArmedRef.current) return;
    setContinueArmed(true);
    setEligibilityKind("checking");
    setEligibilityMessage("Подбираем игроков…");
    onLoadMore();
  }, [hasMore, moreBusy, onLoadMore]);

  const retryEligibility = useCallback(() => {
    batchGen.current += 1;
    batchInFlight.current = false;
    setCheckedIds(new Set());
    setEligibleIds([]);
    setContinueArmed(false);
    setEligibilityKind("checking");
    setEligibilityMessage("Подбираем игроков…");
  }, []);

  const eligiblePlayers = useMemo(() => {
    const byId = new Map(catalogPlayers.map(p => [p.publicPlayerId, p]));
    return eligibleIds.map(id => byId.get(id)).filter((p): p is PublicPlayer => Boolean(p));
  }, [catalogPlayers, eligibleIds]);

  const status: BrowseOfferStatus = {
    phase: opPhase,
    peerId: opPeerId,
    peerName: opPeerName,
    message: statusMessage(opPhase, opPeerName, opNotice),
    canCheckStatus: opPhase === "unknown" && Boolean(opPeerId) && !checkingStatus,
  };

  const eligibility: FinderEligibility = {
    kind: eligibilityKind,
    players: eligiblePlayers,
    message: eligibilityMessage,
    canContinue: eligibilityKind === "empty_page" && hasMore && !moreBusy,
  };

  return {
    status,
    eligibility,
    known,
    sendInFlight: opPhase === "sending",
    unknownPeerId: opPeerId && unresolvedPeers.has(opPeerId) ? opPeerId : null,
    canSendTo,
    admitSend,
    noteRelationship,
    checkStatusReadonly,
    continueSearch,
    retryEligibility,
    me,
    authState,
  };
}

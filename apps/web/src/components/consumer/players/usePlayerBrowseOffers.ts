"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import { getMe, getMySocialProfile } from "../../../lib/api-client";
import type { Me, OwnSocialProfile, PublicPlayer } from "../../../lib/consumer-types";
import {
  bindPlayInterestStates,
  getPlayInterestState,
  getPlayInterestStates,
  isFinderSendEligible,
  isValidPlayInterestSendPendingMarker,
  playInterestCommand,
  playInterestPendingStorageKey,
} from "../../../lib/play-interests";
import { canOfferPlayInterest } from "../../../lib/player-browse";
import { privateViews } from "../../../lib/private-view";
import type { BrowseOfferOperation } from "./PlayerBrowseOffers";

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
  | "own_prerequisite"
  | "peers_unavailable"
  | "error";

/** Own social-profile gate for finder — independent of authState timing. */
export type OwnSocialFinderStatus = "loading" | "ready" | "hidden" | "error";

export type FinderEligibility = {
  kind: FinderEligibilityKind;
  players: PublicPlayer[];
  message: string;
  canContinue: boolean;
};

/** Classify empty sendable batch without disclosing peer-private reasons. */
export function classifyFinderBatchEmpty(input: {
  hasMore: boolean;
  relationships: ReadonlyArray<PlayInterestView["relationship"] | null | undefined>;
}): "empty_page" | "exhausted" | "peers_unavailable" {
  const known = input.relationships.filter(
    (rel): rel is PlayInterestView["relationship"] => typeof rel === "string",
  );
  if (known.length > 0 && known.every((rel) => rel === "unavailable")) {
    return "peers_unavailable";
  }
  return input.hasMore ? "empty_page" : "exhausted";
}

/** Map loaded OwnSocialProfile into finder gate (no privacy bypass). */
export function ownSocialFinderStatusFromProfile(
  profile: OwnSocialProfile | null,
  fetchOk: boolean,
): { status: OwnSocialFinderStatus; publicPlayerId: string | null } {
  if (!fetchOk || !profile) {
    return { status: "error", publicPlayerId: null };
  }
  const publicPlayerId = profile.publicPlayerId?.trim() || null;
  if (!publicPlayerId) {
    return { status: "error", publicPlayerId: null };
  }
  if (!profile.directoryVisible || !profile.socialEligible) {
    return { status: "hidden", publicPlayerId };
  }
  return { status: "ready", publicPlayerId };
}

export type AdmitSendInput = {
  peerId: string;
  peerName: string;
  view: PlayInterestView;
};

export type UnresolvedOffer = {
  peerId: string;
  peerName: string;
};

export type PlayerBrowseOffersApi = {
  status: BrowseOfferStatus;
  eligibility: FinderEligibility;
  known: ReadonlyMap<string, PlayInterestView["relationship"]>;
  sendInFlight: boolean;
  unknownPeerId: string | null;
  unresolved: readonly UnresolvedOffer[];
  /** Immutable in-flight POST host descriptor; page renders keyed OpHost outside dialog. */
  activeOperation: BrowseOfferOperation | null;
  canSendTo(peerId: string): { ok: boolean; reason: string };
  admitSend(input: AdmitSendInput): boolean;
  noteRelationship(peerId: string, relationship: PlayInterestView["relationship"]): void;
  checkStatusReadonly(peerId?: string): void;
  onOperationConfirmed(op: BrowseOfferOperation, receipt: PlayInterestReceipt): void;
  onOperationFailed(op: BrowseOfferOperation, notice: string): void;
  onOperationUnknown(op: BrowseOfferOperation, notice: string): void;
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

function readValidatedPending(actorId: string, peerId: string): boolean {
  try {
    const raw = sessionStorage.getItem(playInterestPendingStorageKey(actorId, peerId));
    if (!raw) return false;
    return isValidPlayInterestSendPendingMarker(JSON.parse(raw) as unknown, peerId);
  } catch {
    return false;
  }
}

function restoreUnresolvedPeers(
  actorId: string,
  names: Map<string, string>,
): UnresolvedOffer[] {
  const prefix = `gb-fr04-pending:${actorId}:play-interest:`;
  const found: UnresolvedOffer[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const peerId = key.slice(prefix.length);
      if (!peerId) continue;
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        if (!isValidPlayInterestSendPendingMarker(JSON.parse(raw) as unknown, peerId)) continue;
      } catch {
        continue;
      }
      found.push({ peerId, peerName: names.get(peerId) ?? "" });
    }
  } catch {
    /* Storage may be disabled — in-memory unresolved still applies after live UNKNOWN. */
  }
  return found;
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
 * Page-level play-interest operation host (mobile fluid) + shared finder eligibility.
 * Eligibility gates authenticated cards on mobile and desktop; ordinary list stays complete.
 * Survives card changes and fullscreen close; one active POST via keyed OpHost.
 * Mutation instances stay peer-immutable inside PlayerBrowseOfferOpHost — not here.
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
  const [ownProfileReload, setOwnProfileReload] = useState(0);
  const [ownPublicPlayerId, setOwnPublicPlayerId] = useState<string | null>(null);
  const [ownSocialStatus, setOwnSocialStatus] = useState<OwnSocialFinderStatus>("loading");
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
  const [unresolved, setUnresolved] = useState<UnresolvedOffer[]>([]);
  const [activeOperation, setActiveOperation] = useState<BrowseOfferOperation | null>(null);

  const actorIdRef = useRef<string | null>(null);
  const privateGenRef = useRef(0);
  const opPhaseRef = useRef<BrowseOfferPhase>("idle");
  const activeTokenRef = useRef<string | null>(null);
  const admitLockRef = useRef(false);
  const batchGen = useRef(0);
  const batchInFlight = useRef(false);
  /** Per-peer mutation revision: admission / settlement / authoritative note bump this so late batch cannot overwrite. */
  const peerMutationRevRef = useRef<Map<string, number>>(new Map());
  const scopeRef = useRef(ordinaryScope);
  const continueArmedRef = useRef(false);
  const peerNamesRef = useRef<Map<string, string>>(new Map());
  const unresolvedRef = useRef(unresolved);
  /** Ref so terminal kind checks do not put eligibilityKind in effect deps (avoids error→re-fetch loops). */
  const eligibilityKindRef = useRef(eligibilityKind);
  continueArmedRef.current = continueArmed;
  opPhaseRef.current = opPhase;
  activeTokenRef.current = activeOperation?.token ?? null;
  unresolvedRef.current = unresolved;
  eligibilityKindRef.current = eligibilityKind;

  const bumpPeerMutation = useCallback((peerId: string) => {
    if (!peerId) return;
    const map = peerMutationRevRef.current;
    map.set(peerId, (map.get(peerId) ?? 0) + 1);
  }, []);

  const retireEligibilityBookkeeping = useCallback(() => {
    batchGen.current += 1;
    batchInFlight.current = false;
    peerMutationRevRef.current = new Map();
    setCheckedIds(new Set());
    setEligibleIds([]);
    setContinueArmed(false);
  }, []);

  useEffect(() => {
    const names = peerNamesRef.current;
    for (const player of catalogPlayers) {
      if (player.publicPlayerId) names.set(player.publicPlayerId, player.displayName ?? "");
    }
  }, [catalogPlayers]);

  useEffect(() => {
    let live = true;
    setAuthState("loading");
    setMe(null);
    setOwnPublicPlayerId(null);
    setOwnSocialStatus("loading");
    void (async () => {
      const result = await getMe();
      if (!live) return;
      if (!result.ok) {
        setMe(null);
        setOwnPublicPlayerId(null);
        setOwnSocialStatus("loading");
        setAuthState(result.status === 401 ? "guest" : "error");
        return;
      }
      setMe(result.data);
      actorIdRef.current = result.data.id;
      privateGenRef.current = privateViews.currentGeneration;
      // Auth may be ready before own social profile — finder must wait on ownSocialStatus.
      setOwnSocialStatus("loading");
      setOwnPublicPlayerId(null);
      setAuthState("ready");
      const restored = restoreUnresolvedPeers(result.data.id, peerNamesRef.current);
      if (restored.length) {
        setUnresolved(restored);
        const first = restored[0];
        if (first) {
          setOpPeerId(first.peerId);
          setOpPeerName(first.peerName);
          setOpPhase("unknown");
          setOpNotice("Предыдущая отправка не подтверждена. Проверьте её результат.");
        }
      }
    })();
    const expire = () => {
      live = false;
      actorIdRef.current = null;
      privateGenRef.current = privateViews.currentGeneration;
      admitLockRef.current = false;
      activeTokenRef.current = null;
      setActiveOperation(null);
      setMe(null);
      setOwnPublicPlayerId(null);
      setOwnSocialStatus("loading");
      setAuthState("guest");
      setOpPhase("idle");
      setOpPeerId(null);
      opPhaseRef.current = "idle";
      setKnown(new Map());
      setUnresolved([]);
      // Invalidate batch ownership + checked/continuation so A→B→A cannot inherit a false empty/exhausted page.
      // Do not touch sessionStorage pending markers or invent historical UNKNOWN replay.
      batchGen.current += 1;
      batchInFlight.current = false;
      peerMutationRevRef.current = new Map();
      setCheckedIds(new Set());
      setEligibleIds([]);
      setContinueArmed(false);
      setEligibilityKind("guest");
      setEligibilityMessage("Войдите, чтобы предложить игру");
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

  // Own social profile readiness — gate finder before any peer-capability batch.
  useEffect(() => {
    if (authState !== "ready" || !me) return;
    let live = true;
    setOwnSocialStatus("loading");
    setOwnPublicPlayerId(null);
    // Drop premature checked/exhausted bookkeeping from any auth-ready race.
    retireEligibilityBookkeeping();
    void (async () => {
      const social = await getMySocialProfile();
      if (!live) return;
      if (actorIdRef.current !== me.id) return;
      const mapped = ownSocialFinderStatusFromProfile(
        social.ok ? social.data : null,
        social.ok,
      );
      setOwnPublicPlayerId(mapped.publicPlayerId);
      setOwnSocialStatus(mapped.status);
    })();
    return () => {
      live = false;
    };
  }, [authState, me, ownProfileReload, retireEligibilityBookkeeping]);

  useEffect(() => {
    if (scopeRef.current === ordinaryScope) return;
    scopeRef.current = ordinaryScope;
    retireEligibilityBookkeeping();
    setEligibilityKind(finderActive ? "checking" : "idle");
    setEligibilityMessage("");
  }, [ordinaryScope, finderActive, retireEligibilityBookkeeping]);

  const runBatch = useCallback(async (players: PublicPlayer[], mode: "replace" | "append") => {
    if (!me || authState !== "ready" || ownSocialStatus !== "ready") return;
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
          : "Новых предложений сейчас нет.");
      }
      return;
    }
    const gen = ++batchGen.current;
    const actor = me.id;
    const priv = privateViews.currentGeneration;
    const scope = ordinaryScope;
    // Capture per-peer mutation revisions with this owned batch; later admission/settlement bumps invalidate that peer only.
    const capturedRevs = new Map<string, number>();
    for (const id of frozen) {
      capturedRevs.set(id, peerMutationRevRef.current.get(id) ?? 0);
    }
    batchInFlight.current = true;
    setEligibilityKind("checking");
    setEligibilityMessage("Подбираем игроков…");
    const result = await getPlayInterestStates(frozen);
    // Only the current owned batch may clear occupancy; obsolete callbacks must not release a newer request.
    if (gen !== batchGen.current) return;
    batchInFlight.current = false;
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
    const peerStillOwned = (id: string) =>
      (peerMutationRevRef.current.get(id) ?? 0) === (capturedRevs.get(id) ?? 0);
    setKnown(prev => {
      const next = new Map(prev);
      for (const [id, view] of bound) {
        if (!peerStillOwned(id)) continue;
        next.set(id, view.relationship);
      }
      return next;
    });
    setCheckedIds(prev => {
      const next = new Set(prev);
      for (const id of frozen) {
        if (!peerStillOwned(id)) continue;
        next.add(id);
      }
      return next;
    });
    const nextEligible = frozen.filter(id => {
      if (!peerStillOwned(id)) return false;
      if (!isFinderSendEligible(bound.get(id))) return false;
      // Own unresolved/pending markers are not new-session recommendations.
      if (unresolvedRef.current.some(entry => entry.peerId === id)) return false;
      if (readValidatedPending(actor, id)) return false;
      return true;
    });
    const ownedRels = frozen
      .filter(id => peerStillOwned(id))
      .map(id => bound.get(id)?.relationship);
    setEligibleIds(prev => {
      // Drop peers that mutated after this batch captured them so stale none cannot re-admit.
      const retained = mode === "append"
        ? prev.filter(id => peerStillOwned(id) || !frozen.includes(id))
        : [];
      const merged = mode === "append"
        ? [...retained, ...nextEligible.filter(id => !retained.includes(id))]
        : nextEligible;
      if (merged.length > 0) {
        setEligibilityKind("ready");
        setEligibilityMessage("");
      } else {
        const emptyKind = classifyFinderBatchEmpty({ hasMore, relationships: ownedRels });
        setEligibilityKind(emptyKind);
        setEligibilityMessage(
          emptyKind === "peers_unavailable"
            ? "Подходящие предложения временно недоступны."
            : emptyKind === "empty_page"
              ? "В этой части списка новых предложений нет"
              : "Новых предложений сейчас нет.",
        );
      }
      return merged;
    });
  }, [me, authState, ordinaryScope, hasMore, ownPublicPlayerId, ownSocialStatus]);

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
    if (ownSocialStatus === "loading") {
      setEligibilityKind("checking");
      setEligibilityMessage("Подбираем игроков…");
      return;
    }
    if (ownSocialStatus === "error") {
      setEligibilityKind("error");
      setEligibilityMessage("Не удалось загрузить профиль");
      setEligibleIds([]);
      return;
    }
    if (ownSocialStatus === "hidden") {
      setEligibilityKind("own_prerequisite");
      setEligibilityMessage(
        "В режиме «Свайп» предложения доступны, когда ваш профиль виден в каталоге.",
      );
      setEligibleIds([]);
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
    // Capability/catalog errors stay until explicit retry or scope/account invalidation — no auto re-fetch.
    if (eligibilityKindRef.current === "error") {
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
        // Preserve peers_unavailable from prior batch — do not flash false exhausted.
        if (eligibilityKindRef.current === "peers_unavailable") return;
        setEligibilityKind(hasMore ? "empty_page" : "exhausted");
        setEligibilityMessage(hasMore
          ? "В этой части списка новых предложений нет"
          : "Новых предложений сейчас нет.");
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
      // Preserve terminal kinds from runBatch (peers_unavailable / exhausted / empty_page).
      // error already held above until explicit retry.
      if (
        eligibilityKindRef.current === "peers_unavailable"
        || eligibilityKindRef.current === "exhausted"
        || eligibilityKindRef.current === "empty_page"
        || eligibilityKindRef.current === "own_prerequisite"
      ) {
        return;
      }
      // Was ready; sendable queue drained without fresh catalog peers.
      setEligibilityKind(hasMore ? "empty_page" : "exhausted");
      setEligibilityMessage(hasMore
        ? "В этой части списка новых предложений нет"
        : "Новых предложений сейчас нет.");
      return;
    }
    if (unchecked.length === 0) {
      setEligibilityKind(hasMore ? "empty_page" : catalogState === "empty" ? "exhausted" : "checking");
      setEligibilityMessage(hasMore
        ? "В этой части списка новых предложений нет"
        : catalogState === "empty"
          ? "Новых предложений сейчас нет."
          : "Подбираем игроков…");
      return;
    }
    if (batchInFlight.current) return;
    void runBatch(unchecked, eligibleIds.length ? "append" : "replace");
  }, [
    finderActive,
    authState,
    me,
    ownSocialStatus,
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
      retireEligibilityBookkeeping();
      setEligibilityKind(authState === "guest" ? "guest" : "checking");
      setEligibilityMessage(authState === "guest" ? "Войдите, чтобы предложить игру" : "Подбираем игроков…");
    }
    prevFinder.current = finderActive;
  }, [finderActive, authState, retireEligibilityBookkeeping]);

  const opMatchesCurrentActor = useCallback((op: BrowseOfferOperation): boolean => {
    return op.actorId === actorIdRef.current
      && op.privateGeneration === privateGenRef.current;
  }, []);

  const onOperationConfirmed = useCallback((op: BrowseOfferOperation, receipt: PlayInterestReceipt) => {
    if (activeTokenRef.current !== op.token) return;
    admitLockRef.current = false;
    setActiveOperation(null);
    activeTokenRef.current = null;
    if (!opMatchesCurrentActor(op)) return;
    const peer = op.peerId;
    const relationship = receipt.outcome === "mutual" ? "mutual" : "outgoing";
    bumpPeerMutation(peer);
    setKnown(prev => {
      const next = new Map(prev);
      next.set(peer, relationship);
      return next;
    });
    setEligibleIds(prev => prev.filter(id => id !== peer));
    setUnresolved(prev => prev.filter(entry => entry.peerId !== peer));
    setOpPeerId(peer);
    setOpPeerName(op.peerName);
    setOpPhase(relationship);
    setOpNotice("");
    opPhaseRef.current = relationship;
  }, [opMatchesCurrentActor, bumpPeerMutation]);

  const onOperationFailed = useCallback((op: BrowseOfferOperation, notice: string) => {
    if (activeTokenRef.current !== op.token) return;
    admitLockRef.current = false;
    setActiveOperation(null);
    activeTokenRef.current = null;
    if (!opMatchesCurrentActor(op)) return;
    setOpPeerId(op.peerId);
    setOpPeerName(op.peerName);
    setOpPhase("failed");
    setOpNotice(notice);
    opPhaseRef.current = "failed";
  }, [opMatchesCurrentActor]);

  const onOperationUnknown = useCallback((op: BrowseOfferOperation, notice: string) => {
    if (activeTokenRef.current !== op.token) return;
    admitLockRef.current = false;
    setActiveOperation(null);
    activeTokenRef.current = null;
    if (!opMatchesCurrentActor(op)) return;
    const peer = op.peerId;
    setUnresolved(prev => {
      if (prev.some(entry => entry.peerId === peer)) return prev;
      return [...prev, { peerId: peer, peerName: op.peerName }];
    });
    setOpPeerId(peer);
    setOpPeerName(op.peerName);
    setOpPhase("unknown");
    setOpNotice(notice);
    opPhaseRef.current = "unknown";
  }, [opMatchesCurrentActor]);

  const admitSend = useCallback((input: AdmitSendInput): boolean => {
    if (!me || authState !== "ready" || ownSocialStatus !== "ready") return false;
    if (actorIdRef.current !== me.id) return false;
    if (admitLockRef.current || opPhaseRef.current === "sending" || activeTokenRef.current) return false;
    if (unresolvedRef.current.some(entry => entry.peerId === input.peerId)) return false;
    if (readValidatedPending(me.id, input.peerId)) return false;
    if (!canOfferPlayInterest(input.view) || !input.view.capabilities.canSend) return false;
    const command = playInterestCommand(input.view, input.peerId, "send");
    if (!command) return false;
    const token = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `op-${Date.now()}-${input.peerId}`;
    const operation: BrowseOfferOperation = {
      token,
      actorId: me.id,
      privateGeneration: privateViews.currentGeneration,
      peerId: input.peerId,
      peerName: input.peerName,
      csrf: me.csrfToken,
      path: command.path,
      body: command.body,
      method: "POST",
    };
    admitLockRef.current = true;
    activeTokenRef.current = token;
    peerNamesRef.current.set(input.peerId, input.peerName);
    bumpPeerMutation(input.peerId);
    setEligibleIds(prev => prev.filter(id => id !== input.peerId));
    setActiveOperation(operation);
    setOpPeerId(input.peerId);
    setOpPeerName(input.peerName);
    setOpPhase("sending");
    setOpNotice("");
    opPhaseRef.current = "sending";
    return true;
  }, [me, authState, ownSocialStatus, bumpPeerMutation]);

  const canSendTo = useCallback((peerId: string): { ok: boolean; reason: string } => {
    if (ownSocialStatus !== "ready") {
      return { ok: false, reason: ownSocialStatus === "hidden"
        ? "Сначала сделайте профиль видимым в каталоге"
        : "Проверяем профиль…" };
    }
    if (opPhase === "sending" || activeOperation) {
      return { ok: false, reason: "Завершаем предыдущее предложение" };
    }
    if (unresolved.some(entry => entry.peerId === peerId)) {
      return { ok: false, reason: "Результат не подтверждён. Не повторяйте отправку." };
    }
    if (me && readValidatedPending(me.id, peerId)) {
      return { ok: false, reason: "Результат не подтверждён. Не повторяйте отправку." };
    }
    const rel = known.get(peerId);
    if (rel === "outgoing" || rel === "mutual" || rel === "unavailable") {
      return { ok: false, reason: "" };
    }
    return { ok: true, reason: "" };
  }, [ownSocialStatus, opPhase, activeOperation, unresolved, known, me]);

  const noteRelationship = useCallback((peerId: string, relationship: PlayInterestView["relationship"]) => {
    bumpPeerMutation(peerId);
    setKnown(prev => {
      if (prev.get(peerId) === relationship) return prev;
      const next = new Map(prev);
      next.set(peerId, relationship);
      return next;
    });
    if (relationship === "outgoing" || relationship === "mutual" || relationship === "unavailable") {
      setEligibleIds(prev => prev.filter(id => id !== peerId));
    }
  }, [bumpPeerMutation]);

  const checkStatusReadonly = useCallback((peerId?: string) => {
    if (!me || checkingStatus) return;
    const peer = peerId || opPeerId;
    if (!peer) return;
    const actor = me.id;
    const gen = privateViews.currentGeneration;
    const name = peerNamesRef.current.get(peer)
      || unresolvedRef.current.find(entry => entry.peerId === peer)?.peerName
      || opPeerName;
    setCheckingStatus(true);
    void getPlayInterestState(peer).then(result => {
      setCheckingStatus(false);
      if (actorIdRef.current !== actor) return;
      if (gen !== privateViews.currentGeneration) return;
      if (!result.ok) {
        setOpPeerId(peer);
        setOpPeerName(name);
        setOpPhase("unknown");
        setOpNotice("Не удалось проверить статус. Предыдущая отправка могла быть получена — не повторяйте.");
        return;
      }
      const view = result.data.items[0] ?? null;
      if (view && (view.relationship === "outgoing" || view.relationship === "mutual")) {
        bumpPeerMutation(peer);
        setKnown(prev => {
          const next = new Map(prev);
          next.set(peer, view.relationship);
          return next;
        });
        setEligibleIds(prev => prev.filter(id => id !== peer));
        setUnresolved(prev => prev.filter(entry => entry.peerId !== peer));
        setOpPeerId(peer);
        setOpPeerName(name);
        setOpPhase(view.relationship);
        setOpNotice("");
        return;
      }
      // none/unavailable/error does not prove prior POST was rejected — keep UNKNOWN.
      setOpPeerId(peer);
      setOpPeerName(name);
      setOpPhase("unknown");
      setOpNotice("Статус не подтверждает результат предыдущей отправки. Не повторяйте отправку.");
      setUnresolved(prev => {
        if (prev.some(entry => entry.peerId === peer)) return prev;
        return [...prev, { peerId: peer, peerName: name }];
      });
    });
  }, [me, opPeerId, opPeerName, checkingStatus, bumpPeerMutation]);

  const continueSearch = useCallback(() => {
    if (!hasMore || moreBusy || batchInFlight.current || continueArmedRef.current) return;
    setContinueArmed(true);
    setEligibilityKind("checking");
    setEligibilityMessage("Подбираем игроков…");
    onLoadMore();
  }, [hasMore, moreBusy, onLoadMore]);

  const retryEligibility = useCallback(() => {
    retireEligibilityBookkeeping();
    setEligibilityKind("checking");
    setEligibilityMessage("Подбираем игроков…");
    if (ownSocialStatus === "error" || ownSocialStatus === "hidden") {
      setOwnSocialStatus("loading");
      setOwnProfileReload((n) => n + 1);
    }
  }, [retireEligibilityBookkeeping, ownSocialStatus]);

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
    canContinue:
      (eligibilityKind === "empty_page" || eligibilityKind === "peers_unavailable")
      && hasMore
      && !moreBusy,
  };

  return {
    status,
    eligibility,
    known,
    sendInFlight: opPhase === "sending" || Boolean(activeOperation),
    unknownPeerId: opPeerId && unresolved.some(entry => entry.peerId === opPeerId) ? opPeerId : null,
    unresolved,
    activeOperation,
    canSendTo,
    admitSend,
    noteRelationship,
    checkStatusReadonly,
    onOperationConfirmed,
    onOperationFailed,
    onOperationUnknown,
    continueSearch,
    retryEligibility,
    me,
    authState,
  };
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import { getMe, getMySocialProfile } from "../../../lib/api-client";
import type { City, Me, PublicPlayer } from "../../../lib/consumer-types";
import { formatSocialLevel } from "../../../lib/player-presentation";
import {
  browseDragRotationDeg,
  browseExitDurationMs,
  browseExitTranslationPx,
  browseReleaseReverseVeto,
  browseSlideDurationMs,
  chunkBrowseBio,
  classifyPointerGesture,
  estimateBrowseBioChunkChars,
  indexOfBrowsePlayer,
  isBrowseDragExcludedTarget,
  nextEligibleBrowseIndex,
  normalizeBrowseBio,
  ordinaryBrowsePlayers,
  parseBrowseCssTransformPose,
  browseTutorialLocalStorage,
  persistTutorialCompleted,
  PLAYER_BROWSE_DESKTOP_MQ,
  PLAYER_BROWSE_MAX_ROTATION_DEG,
  PLAYER_BROWSE_RETURN_MS,
  PLAYER_BROWSE_VELOCITY_WINDOW_MS,
  sampleBrowseVelocity,
  type PlayerBrowseGestureAxis,
  type PlayerBrowseTutorialStep,
  type PlayerBrowseVelocitySample,
  popSkip,
  prefersBrowseReducedMotion,
  pushSkip,
  readBrowseHistoryState,
  readTutorialCompleted,
  tutorialActorKey,
  type PlayerBrowseSlideDirection,
  withBrowseHistoryState,
} from "../../../lib/player-browse";
import { Button } from "../Button";
import { CloseButton } from "../CloseButton";
import {
  isBrowseConfirmedPlayInterestOutcome,
  PlayerBrowsePlayInterest,
  type BrowsePlayInterestApi,
} from "./PlayerBrowsePlayInterest";
import { PlayerBrowseFinderGate, PlayerBrowseOfferStatus } from "./PlayerBrowseOffers";
import type { FinderEligibility, PlayerBrowseOffersApi } from "./usePlayerBrowseOffers";
import { AuthEntry } from "./ProfileComposition";
import {
  browseMediaNeighborhood,
  browsePeerMediaKey,
  disposePreparedBrowseMedia,
  nextBrowseIntentAfterFailure,
  PLAYER_BROWSE_MEDIA_DEADLINE_MS,
  prepareBrowsePeerMedia,
  PreparedBrowseAvatar,
  PreparedBrowseCover,
  type BrowseMediaCacheStatus,
  type PreparedBrowsePeerMedia,
} from "./PlayerBrowseMedia";
import "../../../styles/player-browse.css";

type Props = {
  players: PublicPlayer[];
  cities: City[];
  ordinaryScope: string;
  catalogState: string;
  moreBusy: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  placeLabel: string;
  /** Parent desktop breakpoint; when omitted, deck measures PLAYER_BROWSE_DESKTOP_MQ itself. */
  desktop?: boolean;
  /** Mobile <1024 cards mode: fixed fullscreen shell (portal) covering app chrome. */
  mobileFullscreen?: boolean;
  onCloseFullscreen?: () => void;
  /** Page-level mobile offers host (fluid send + eligibility). Desktop omits. */
  mobileOffers?: PlayerBrowseOffersApi | null;
  /** Readonly page-owned eligibility gate for authenticated desktop cards (no fluid host). */
  finderEligibility?: FinderEligibility | null;
  onContinueFinder?: () => void;
  onRetryFinder?: () => void;
};

type DragState = {
  id: number;
  peerId: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Card pose at pointerdown (spring re-grab base); fresh dx/dy apply relative to this. */
  originX: number;
  originY: number;
  t: number;
  samples: PlayerBrowseVelocitySample[];
  axis: PlayerBrowseGestureAxis;
  capturing: boolean;
  /** Local origin for grab-pivot rotation (relative to card top-left). */
  pivotX: number;
  pivotY: number;
  consumed: boolean;
};

function Chevron({ dir }: { dir: "left" | "right" | "down" }) {
  const path = dir === "left" ? "M15 6 9 12l6 6" : dir === "down" ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6";
  return <svg className="pb-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function useLocalDesktop(explicit?: boolean): boolean {
  const [local, setLocal] = useState(false);
  useEffect(() => {
    if (explicit !== undefined) return;
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(PLAYER_BROWSE_DESKTOP_MQ);
    const sync = () => setLocal(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    if (typeof media.addListener === "function") {
      media.addListener(sync);
      return () => media.removeListener(sync);
    }
  }, [explicit]);
  return explicit ?? local;
}

export function PlayerBrowseDeck({
  players,
  cities,
  ordinaryScope,
  catalogState,
  moreBusy,
  hasMore,
  onLoadMore,
  placeLabel,
  desktop: desktopProp,
  mobileFullscreen = false,
  onCloseFullscreen,
  mobileOffers = null,
  finderEligibility = null,
  onContinueFinder,
  onRetryFinder,
}: Props) {
  const desktop = useLocalDesktop(desktopProp);
  const fluidMobile = Boolean(mobileFullscreen && mobileOffers && !desktop);
  const offersRef = useRef(mobileOffers);
  offersRef.current = mobileOffers;

  useEffect(() => {
    if (!mobileOffers) return;
    setKnown(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, relationship] of mobileOffers.known) {
        if (next.get(id) !== relationship) {
          next.set(id, relationship);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mobileOffers, mobileOffers?.known]);
  const [me, setMe] = useState<Me | null>(null);
  const [authState, setAuthState] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [ownPublicPlayerId, setOwnPublicPlayerId] = useState<string | null>(null);
  const [authReload, setAuthReload] = useState(0);
  const [index, setIndex] = useState(0);
  const [intentIndex, setIntentIndex] = useState(0);
  const [committedMedia, setCommittedMedia] = useState<PreparedBrowsePeerMedia | null>(null);
  const [skipStack, setSkipStack] = useState<string[]>([]);
  const [known, setKnown] = useState<Map<string, PlayInterestView["relationship"]>>(() => new Map());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsPage, setDetailsPage] = useState(0);
  /** Mobile-only fixed info pages: facts → about bio chunks → games (desktop keeps detailsPage). */
  const [mobileInfoPage, setMobileInfoPage] = useState(0);
  const [bioChunks, setBioChunks] = useState<string[]>([]);
  const [friendBusy, setFriendBusy] = useState(false);
  const [rateBlockedUntil, setRateBlockedUntil] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [announce, setAnnounce] = useState("");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<PlayerBrowseTutorialStep>(1);
  /** Actor who finished step 2 in this session (memory fallback). Never a cross-actor bool. */
  const [tutorialCompletedActor, setTutorialCompletedActor] = useState<string | null>(null);
  const tutorialActorSeenRef = useRef<string | null>(null);
  const tutorialBlankGateRef = useRef(true);
  const [dragStamp, setDragStamp] = useState<{ opacity: number; skip: boolean; label: string }>({ opacity: 0, skip: false, label: "" });
  const [slideDir, setSlideDir] = useState<PlayerBrowseSlideDirection | null>(null);
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const slideFrameRef = useRef<HTMLDivElement>(null);
  const detailsBodyRef = useRef<HTMLDivElement>(null);
  const detailsBioRef = useRef<HTMLParagraphElement>(null);
  const mobileDetailsBodyRef = useRef<HTMLDivElement>(null);
  const tutorialRef = useRef<HTMLButtonElement>(null);
  const friendshipApi = useRef<BrowsePlayInterestApi | null>(null);
  const drag = useRef<DragState | null>(null);
  const dragRaf = useRef(0);
  const flyingRef = useRef(false);
  const flyGen = useRef(0);
  const actionConsumedRef = useRef(false);
  const transitionTimerRef = useRef(0);
  const awaitingRightRef = useRef<string | null>(null);
  const rightConfirmGen = useRef(0);
  const scopeGen = useRef(0);
  const viewerGen = useRef(0);
  const slideGen = useRef(0);
  const slideMounted = useRef(true);
  const restoredScope = useRef<string | null>(null);
  const reducedMotionRef = useRef(false);
  const pendingDirectionRef = useRef<PlayerBrowseSlideDirection | null>(null);
  const navigationLockedRef = useRef(false);
  const tutorialOpenRef = useRef(false);
  const detailsOpenRef = useRef(false);
  const detailsPageRef = useRef(0);
  const mobileInfoPageRef = useRef(0);
  const mobileInfoPageCountRef = useRef(3);
  const bioChunksRef = useRef<string[]>([]);
  const rateBlockedUntilRef = useRef<number | null>(null);
  const currentPeerRef = useRef<string | null>(null);
  const mediaReadyRef = useRef(false);
  const skipCurrentRef = useRef<(opts?: { alreadyFlying?: boolean; generation?: number; peerId?: string | null }) => void>(() => {});
  const applySkipAdvanceRef = useRef<(peerId: string, generation: number | null) => void>(() => {});
  const applySendAdvanceRef = useRef<(peerId: string, generation: number | null) => void>(() => {});
  const requestFriendshipRef = useRef<() => void>(() => {});
  const openDetailsRef = useRef<() => void>(() => {});
  const closeDetailsRef = useRef<() => void>(() => {});
  const onCloseFullscreenRef = useRef(onCloseFullscreen);
  onCloseFullscreenRef.current = onCloseFullscreen;
  const mediaCacheRef = useRef<Map<string, {
    status: BrowseMediaCacheStatus;
    mediaKey: string;
    media?: PreparedBrowsePeerMedia;
    controller: AbortController;
    generation: number;
  }>>(new Map());
  const committedMediaRef = useRef<PreparedBrowsePeerMedia | null>(null);
  const intentIndexRef = useRef(0);
  const indexRef = useRef(0);
  const prepSeq = useRef(0);
  intentIndexRef.current = intentIndex;
  indexRef.current = index;

  const browsePlayers = useMemo(
    () => ordinaryBrowsePlayers(players, ownPublicPlayerId),
    [players, ownPublicPlayerId],
  );
  const catalogPeer = browsePlayers[index] ?? null;
  // F5: catalogPeer metadata when mediaKey matches prepared nodes; old snapshot only while replacement pending.
  const current = (
    committedMedia?.peer
    && catalogPeer
    && committedMedia.peerId === catalogPeer.publicPlayerId
    && committedMedia.mediaKey !== browsePeerMediaKey(catalogPeer)
  )
    ? committedMedia.peer
    : catalogPeer;
  const intentPlayer = browsePlayers[intentIndex] ?? null;
  const catalogMediaStale = Boolean(
    catalogPeer
    && committedMedia
    && committedMedia.peerId === catalogPeer.publicPlayerId
    && committedMedia.mediaKey !== browsePeerMediaKey(catalogPeer),
  );
  const commitPending = Boolean(
    browsePlayers.length
    && !mediaUnavailable
    && (
      intentIndex !== index
      || !committedMedia
      || !current
      || committedMedia.peerId !== current.publicPlayerId
      || (catalogMediaStale && intentIndex === index)
    ),
  );
  // Fluid mobile: POST no longer locks browse/skip — only media commit does.
  // Desktop / legacy: in-flight POST still locks navigation until receipt.
  const navigationLocked = fluidMobile ? false : friendBusy;
  const mediaReady = Boolean(current && committedMedia && committedMedia.peerId === current.publicPlayerId);
  mediaReadyRef.current = mediaReady;

  const clearMediaCache = useCallback((retainPeerId?: string | null) => {
    const retain = retainPeerId ?? null;
    for (const [id, entry] of mediaCacheRef.current) {
      entry.controller.abort();
      if (entry.media && entry.media.peerId !== retain && entry.media !== committedMediaRef.current) {
        disposePreparedBrowseMedia(entry.media);
      }
      mediaCacheRef.current.delete(id);
    }
  }, []);

  const replaceCommittedMedia = useCallback((next: PreparedBrowsePeerMedia | null) => {
    const prev = committedMediaRef.current;
    if (prev && prev !== next) {
      const cached = mediaCacheRef.current.get(prev.peerId);
      if (!cached || cached.media !== prev) disposePreparedBrowseMedia(prev);
    }
    committedMediaRef.current = next;
    setCommittedMedia(next);
    if (next) setMediaUnavailable(false);
  }, []);

  const settleIntentFailure = useCallback((
    reason: "unauthorized" | "unavailable",
    failedIndex: number,
  ) => {
    if (!slideMounted.current) return;
    setAnnounce(reason === "unauthorized"
      ? "Этот игрок сейчас недоступен в каталоге."
      : "Не удалось подготовить карточку игрока.");
    pendingDirectionRef.current = null;
    const decision = nextBrowseIntentAfterFailure(
      browsePlayers.length,
      failedIndex,
      (i) => {
        const peer = browsePlayers[i];
        if (!peer) return undefined;
        const entry = mediaCacheRef.current.get(peer.publicPlayerId);
        if (!entry || entry.mediaKey !== browsePeerMediaKey(peer)) return undefined;
        return entry.status;
      },
      Boolean(committedMediaRef.current),
      indexRef.current,
    );
    if (decision.kind === "revert") {
      // F4: replacement failure on displayed index — clear/dispose committed; terminal unavailable
      // (esp. 401/403 must not keep stale authorized pixels / commitPending forever).
      const failedPeer = browsePlayers[failedIndex];
      const committed = committedMediaRef.current;
      if (
        failedIndex === indexRef.current
        && failedPeer
        && committed
        && committed.peerId === failedPeer.publicPlayerId
        && committed.mediaKey !== browsePeerMediaKey(failedPeer)
      ) {
        replaceCommittedMedia(null);
        setMediaUnavailable(true);
        setIntentIndex(decision.index);
        return;
      }
      setMediaUnavailable(false);
      setIntentIndex(decision.index);
      return;
    }
    if (decision.kind === "advance") {
      setMediaUnavailable(false);
      setIntentIndex(decision.index);
      return;
    }
    setMediaUnavailable(true);
  }, [browsePlayers, replaceCommittedMedia]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { reducedMotionRef.current = prefersBrowseReducedMotion(media); };
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    if (typeof media.addListener === "function") {
      media.addListener(sync);
      return () => media.removeListener(sync);
    }
  }, []);

  useEffect(() => {
    let live = true;
    viewerGen.current += 1;
    clearMediaCache();
    replaceCommittedMedia(null);
    setAuthState("loading");
    setMe(null);
    setOwnPublicPlayerId(null);
    void (async () => {
      const meResult = await getMe();
      if (!live) return;
      if (!meResult.ok) {
        setMe(null);
        setAuthState(meResult.status === 401 ? "guest" : "error");
        return;
      }
      setMe(meResult.data);
      setAuthState("ready");
      const social = await getMySocialProfile();
      if (!live) return;
      if (social.ok && social.data.publicPlayerId) setOwnPublicPlayerId(social.data.publicPlayerId);
    })();
    const expire = () => {
      live = false;
      // Synchronously invalidate in-flight card exit so completion cannot skip/advance after auth change.
      viewerGen.current += 1;
      flyGen.current += 1;
      flyingRef.current = false;
      actionConsumedRef.current = false;
      awaitingRightRef.current = null;
      clearMediaCache();
      replaceCommittedMedia(null);
      setMe(null);
      setOwnPublicPlayerId(null);
      setAuthState("guest");
    };
    const session = () => { expire(); setAuthReload(n => n + 1); };
    window.addEventListener("gb-private-expired", expire);
    window.addEventListener("gb-session-changed", session);
    return () => {
      live = false;
      window.removeEventListener("gb-private-expired", expire);
      window.removeEventListener("gb-session-changed", session);
    };
  }, [authReload, clearMediaCache, replaceCommittedMedia]);

  useEffect(() => {
    scopeGen.current += 1;
    viewerGen.current += 1;
    slideGen.current += 1;
    flyGen.current += 1;
    actionConsumedRef.current = false;
    awaitingRightRef.current = null;
    flyingRef.current = false;
    clearMediaCache();
    replaceCommittedMedia(null);
    setMediaUnavailable(false);
    const frame = slideFrameRef.current;
    if (frame && typeof frame.getAnimations === "function") {
      for (const anim of frame.getAnimations()) anim.cancel();
    }
    setSkipStack([]);
    setDetailsOpen(false);
    setDetailsPage(0);
    setMobileInfoPage(0);
    setBioChunks([]);
    setKnown(new Map());
    restoredScope.current = null;
    setIndex(0);
    setIntentIndex(0);
    pendingDirectionRef.current = null;
    setSlideDir(null);
  }, [ordinaryScope, clearMediaCache, replaceCommittedMedia]);

  useEffect(() => {
    slideGen.current += 1;
    viewerGen.current += 1;
    clearMediaCache();
    replaceCommittedMedia(null);
    setMediaUnavailable(false);
    const frame = slideFrameRef.current;
    if (frame && typeof frame.getAnimations === "function") {
      for (const anim of frame.getAnimations()) anim.cancel();
    }
    setSlideDir(null);
    pendingDirectionRef.current = null;
  }, [authReload, clearMediaCache, replaceCommittedMedia]);

  useEffect(() => {
    if (restoredScope.current === ordinaryScope) return;
    const saved = readBrowseHistoryState(window.history.state, ordinaryScope);
    const savedIndex = saved ? indexOfBrowsePlayer(browsePlayers, saved.id) : -1;
    const next = savedIndex >= 0 ? savedIndex : 0;
    setIndex(next);
    setIntentIndex(next);
    restoredScope.current = ordinaryScope;
  }, [ordinaryScope, browsePlayers]);

  useEffect(() => {
    if (!browsePlayers.length) return;
    if (index >= browsePlayers.length) {
      const next = Math.max(0, browsePlayers.length - 1);
      setIndex(next);
      setIntentIndex(current => Math.min(current, next));
    }
    if (intentIndex >= browsePlayers.length) setIntentIndex(Math.max(0, browsePlayers.length - 1));
  }, [browsePlayers, index, intentIndex]);

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = 0;
    }
  }, []);

  useEffect(() => {
    const id = current?.publicPlayerId;
    if (!id) return;
    window.history.replaceState(
      withBrowseHistoryState(window.history.state, { id, scope: ordinaryScope }),
      "",
      window.location.href,
    );
  }, [current?.publicPlayerId, ordinaryScope]);

  useEffect(() => {
    setDetailsOpen(false);
    setDetailsPage(0);
    setMobileInfoPage(0);
    setBioChunks([]);
    setFriendBusy(false);
    awaitingRightRef.current = null;
    actionConsumedRef.current = false;
    flyGen.current += 1;
    clearTransitionTimer();
    flyingRef.current = false;
    setDragStamp({ opacity: 0, skip: false, label: "" });
    if (cardRef.current) {
      cardRef.current.style.transition = "none";
      cardRef.current.style.transform = "";
      cardRef.current.style.transformOrigin = "";
      cardRef.current.style.removeProperty("--pb-drag-x");
      cardRef.current.style.removeProperty("--pb-drag-y");
      cardRef.current.style.removeProperty("--pb-drag-rot");
      cardRef.current.style.removeProperty("--pb-intent-skip");
      cardRef.current.style.removeProperty("--pb-intent-request");
      cardRef.current.classList.remove("is-dragging", "is-flying");
    }
  }, [current?.publicPlayerId, clearTransitionTimer]);

  // Resolved identity only — loading/error must not open, render, or finish the guide as guest.
  const identityReady = authState === "ready" || authState === "guest";
  const tutorialActor = tutorialActorKey(me?.id);
  // Derive memory only for the current actor — same-render A→B must not see A's completion.
  const tutorialMemory = tutorialCompletedActor === tutorialActor;

  useEffect(() => {
    // Pending/error: retire open teaching without poisoning actor-seen (me is null while loading).
    if (!identityReady) {
      setTutorialOpen(false);
      setTutorialStep(1);
      return;
    }
    // On actor change: re-arm blank gate + close open guide. Do not clear completed-actor latch
    // (derivation above already excludes the previous actor from memory).
    if (tutorialActorSeenRef.current !== null && tutorialActorSeenRef.current !== tutorialActor) {
      setTutorialStep(1);
      setTutorialOpen(false);
      tutorialBlankGateRef.current = true;
    }
    tutorialActorSeenRef.current = tutorialActor;
  }, [identityReady, tutorialActor]);

  useEffect(() => {
    // Desktop: no swipe tutorial. Mobile first-use coachmarks wait for resolved identity.
    if (desktop) {
      setTutorialOpen(false);
      return;
    }
    if (!identityReady) return;
    const blank = catalogState === "loading" || catalogState === "empty" || catalogState === "error" || catalogState === "unavailable" || !browsePlayers.length;
    if (blank) {
      tutorialBlankGateRef.current = true;
      return;
    }
    const completed = readTutorialCompleted(
      browseTutorialLocalStorage(),
      tutorialActor,
      tutorialMemory,
    );
    // Auto-open only on blank→ready (or after actor reset), never re-loop after X abort in the same open.
    if (!completed && tutorialBlankGateRef.current) {
      tutorialBlankGateRef.current = false;
      setTutorialStep(1);
      setTutorialOpen(true);
    } else {
      tutorialBlankGateRef.current = false;
    }
  }, [catalogState, browsePlayers.length, tutorialMemory, desktop, identityReady, tutorialActor]);

  const onRateLimited = useCallback((until: number | null, _retryAfterSeconds: number | null) => {
    setRateBlockedUntil(until);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (rateBlockedUntil == null) return;
    const delay = rateBlockedUntil - Date.now();
    if (delay <= 0) {
      setRateBlockedUntil(null);
      return;
    }
    const timer = window.setTimeout(() => setRateBlockedUntil(null), delay);
    return () => window.clearTimeout(timer);
  }, [rateBlockedUntil]);

  const cityName = (cityId: string | null) => cities.find(c => c.id === cityId)?.nameRu;

  const cancelSlideAnimation = useCallback(() => {
    const frame = slideFrameRef.current;
    if (!frame || typeof frame.getAnimations !== "function") return;
    for (const anim of frame.getAnimations()) anim.cancel();
  }, []);

  const runSlideAfterCommit = useCallback((direction: PlayerBrowseSlideDirection | null, nextIndex: number) => {
    slideGen.current += 1;
    const token = slideGen.current;
    const reduced = reducedMotionRef.current;
    const shouldSlide = Boolean(desktop && direction && !reduced);
    if (shouldSlide && direction) {
      setSlideDir(direction);
      setAnnounce(`Карточка ${String(nextIndex + 1).padStart(2, "0")} из ${String(browsePlayers.length).padStart(2, "0")}`);
      const duration = browseSlideDurationMs(false);
      const frame = slideFrameRef.current;
      // Cancel + restart visible motion on the stable frame after prepared media commit.
      if (frame && typeof frame.animate === "function") {
        cancelSlideAnimation();
        const fromX = direction === "next" ? "28%" : "-28%";
        const animation = frame.animate(
          [
            { transform: `translateX(${fromX})`, opacity: 0.72 },
            { transform: "translateX(0)", opacity: 1 },
          ],
          { duration, easing: "ease" },
        );
        void animation.finished.then(() => {
          if (!slideMounted.current || slideGen.current !== token) return;
          setSlideDir(null);
        }).catch(() => { /* superseded cancel */ });
      } else {
        window.setTimeout(() => {
          if (!slideMounted.current || slideGen.current !== token) return;
          setSlideDir(null);
        }, duration);
      }
      return;
    }
    cancelSlideAnimation();
    setSlideDir(null);
    setAnnounce(`Карточка ${String(nextIndex + 1).padStart(2, "0")} из ${String(browsePlayers.length).padStart(2, "0")}`);
  }, [browsePlayers.length, desktop, cancelSlideAnimation]);

  const commitPreparedPeer = useCallback((nextIndex: number, media: PreparedBrowsePeerMedia, direction: PlayerBrowseSlideDirection | null) => {
    if (!slideMounted.current) return;
    const peer = browsePlayers[nextIndex];
    if (!peer || peer.publicPlayerId !== media.peerId) return;
    if (browsePeerMediaKey(peer) !== media.mediaKey) return;
    if (
      committedMediaRef.current?.peerId === media.peerId
      && committedMediaRef.current.mediaKey === media.mediaKey
      && indexRef.current === nextIndex
      && committedMediaRef.current === media
    ) {
      pendingDirectionRef.current = null;
      return;
    }
    replaceCommittedMedia(media);
    setIndex(nextIndex);
    const slideDirection = direction;
    pendingDirectionRef.current = null;
    runSlideAfterCommit(slideDirection, nextIndex);
  }, [browsePlayers, replaceCommittedMedia, runSlideAfterCommit]);

  useEffect(() => {
    if (!browsePlayers.length) return;
    const scope = scopeGen.current;
    const viewer = viewerGen.current;
    const targetIndex = Math.max(0, Math.min(intentIndex, browsePlayers.length - 1));
    const neighborhood = browseMediaNeighborhood(targetIndex, browsePlayers.length);
    const wanted = new Set(neighborhood.map(i => browsePlayers[i]!.publicPlayerId));
    const retainId = committedMediaRef.current?.peerId ?? null;

    for (const [id, entry] of [...mediaCacheRef.current.entries()]) {
      if (wanted.has(id)) continue;
      entry.controller.abort();
      if (entry.media && entry.media.peerId !== retainId && entry.media !== committedMediaRef.current) {
        disposePreparedBrowseMedia(entry.media);
      }
      mediaCacheRef.current.delete(id);
    }

    // neighborhood is already current → ahead → previous; keep that prep priority.
    const ordered = neighborhood;

    for (const i of ordered) {
      const peer = browsePlayers[i]!;
      const mediaKey = browsePeerMediaKey(peer);
      const existing = mediaCacheRef.current.get(peer.publicPlayerId);
      if (existing && existing.mediaKey !== mediaKey) {
        existing.controller.abort();
        if (existing.media && existing.media !== committedMediaRef.current) {
          disposePreparedBrowseMedia(existing.media);
        }
        mediaCacheRef.current.delete(peer.publicPlayerId);
      } else if (existing && (existing.status === "loading" || existing.status === "ready")) {
        continue;
      } else if (existing && (existing.status === "unauthorized" || existing.status === "unavailable")) {
        continue;
      }

      const controller = new AbortController();
      const generation = ++prepSeq.current;
      mediaCacheRef.current.set(peer.publicPlayerId, { status: "loading", mediaKey, controller, generation });
      void prepareBrowsePeerMedia(peer, controller.signal, PLAYER_BROWSE_MEDIA_DEADLINE_MS).then(result => {
        if (!slideMounted.current || scopeGen.current !== scope || viewerGen.current !== viewer) {
          if (result.ok) disposePreparedBrowseMedia(result.media);
          return;
        }
        const entry = mediaCacheRef.current.get(peer.publicPlayerId);
        if (!entry || entry.generation !== generation || entry.mediaKey !== mediaKey) {
          if (result.ok) disposePreparedBrowseMedia(result.media);
          return;
        }
        if (!result.ok) {
          if (result.reason === "aborted") {
            mediaCacheRef.current.delete(peer.publicPlayerId);
            return;
          }
          entry.status = result.reason === "unauthorized" ? "unauthorized" : "unavailable";
          const latestIntent = intentIndexRef.current;
          if (
            (result.reason === "unauthorized" || result.reason === "unavailable")
            && peer.publicPlayerId === browsePlayers[latestIntent]?.publicPlayerId
            && browsePeerMediaKey(browsePlayers[latestIntent]!) === mediaKey
          ) {
            settleIntentFailure(result.reason, latestIntent);
          }
          return;
        }
        entry.status = "ready";
        entry.media = result.media;
        const latestIntent = intentIndexRef.current;
        const intentPeerNow = browsePlayers[latestIntent];
        if (
          intentPeerNow
          && peer.publicPlayerId === intentPeerNow.publicPlayerId
          && browsePeerMediaKey(intentPeerNow) === result.media.mediaKey
        ) {
          commitPreparedPeer(latestIntent, result.media, pendingDirectionRef.current);
        }
      });
    }

    const intentPeer = browsePlayers[targetIndex];
    if (intentPeer) {
      const intentKey = browsePeerMediaKey(intentPeer);
      const cached = mediaCacheRef.current.get(intentPeer.publicPlayerId);
      if (cached && cached.mediaKey === intentKey && cached.status === "ready" && cached.media) {
        if (
          !committedMediaRef.current
          || committedMediaRef.current.peerId !== intentPeer.publicPlayerId
          || committedMediaRef.current.mediaKey !== intentKey
          || index !== targetIndex
        ) {
          commitPreparedPeer(targetIndex, cached.media, pendingDirectionRef.current);
        }
      } else if (
        cached
        && cached.mediaKey === intentKey
        && (cached.status === "unauthorized" || cached.status === "unavailable")
      ) {
        settleIntentFailure(cached.status, targetIndex);
      } else {
        setMediaUnavailable(false);
      }
    }
  }, [browsePlayers, intentIndex, index, authReload, ordinaryScope, commitPreparedPeer, settleIntentFailure]);

  const moveTo = useCallback((next: number, direction?: PlayerBrowseSlideDirection) => {
    if (navigationLocked) return;
    if (next < 0 || next >= browsePlayers.length) return;
    pendingDirectionRef.current = direction ?? null;
    setMediaUnavailable(false);
    setIntentIndex(next);
  }, [browsePlayers.length, navigationLocked]);

  useEffect(() => {
    slideMounted.current = true;
    return () => {
      slideMounted.current = false;
      slideGen.current += 1;
      viewerGen.current += 1;
      flyGen.current += 1;
      actionConsumedRef.current = false;
      awaitingRightRef.current = null;
      flyingRef.current = false;
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = 0;
      }
      clearMediaCache();
      replaceCommittedMedia(null);
      const frame = slideFrameRef.current;
      if (frame && typeof frame.getAnimations === "function") {
        for (const anim of frame.getAnimations()) anim.cancel();
      }
    };
  }, [clearMediaCache, replaceCommittedMedia]);

  const clearCardMotion = useCallback((instant = false) => {    const card = cardRef.current;
    if (!card) return;
    clearTransitionTimer();
    if (instant || reducedMotionRef.current) card.style.transition = "none";
    card.style.setProperty("--pb-drag-x", "0px");
    card.style.setProperty("--pb-drag-y", "0px");
    card.style.setProperty("--pb-drag-rot", "0deg");
    card.style.setProperty("--pb-intent-skip", "0");
    card.style.setProperty("--pb-intent-request", "0");
    card.style.transform = "";
    card.style.transformOrigin = "";
    card.classList.remove("is-dragging", "is-flying");
    flyingRef.current = false;
  }, [clearTransitionTimer]);

  const springBackCard = useCallback(() => {
    const card = cardRef.current;
    actionConsumedRef.current = false;
    if (!card) {
      setDragStamp({ opacity: 0, skip: false, label: "" });
      return;
    }
    // Interruptible return: pin computed pose to inline values before cancelling prior motion.
    const computed = typeof window.getComputedStyle === "function" ? window.getComputedStyle(card) : null;
    if (computed?.transform && computed.transform !== "none") {
      card.style.transform = computed.transform;
    }
    clearTransitionTimer();
    card.classList.remove("is-dragging", "is-flying");
    flyingRef.current = false;
    if (reducedMotionRef.current) {
      clearCardMotion(true);
    } else {
      card.style.transition = `transform ${PLAYER_BROWSE_RETURN_MS}ms ease-out`;
      card.style.setProperty("--pb-drag-x", "0px");
      card.style.setProperty("--pb-drag-y", "0px");
      card.style.setProperty("--pb-drag-rot", "0deg");
      card.style.setProperty("--pb-intent-skip", "0");
      card.style.setProperty("--pb-intent-request", "0");
      card.style.transform = "translate3d(0,0,0) rotate(0deg)";
      transitionTimerRef.current = window.setTimeout(() => {
        transitionTimerRef.current = 0;
        if (cardRef.current === card) clearCardMotion(true);
      }, PLAYER_BROWSE_RETURN_MS + 20);
    }
    setDragStamp({ opacity: 0, skip: false, label: "" });
  }, [clearCardMotion, clearTransitionTimer]);

  const flyOffCard = useCallback((dir: -1 | 1, opts?: {
    peerId?: string | null;
    velocity?: number;
    fromX?: number;
    fromRot?: number;
  }): Promise<{ ok: boolean; generation: number; peerId: string | null }> => {
    const card = cardRef.current;
    const peerId = opts?.peerId ?? currentPeerRef.current;
    const generation = ++flyGen.current;
    const capturedViewer = viewerGen.current;
    const flightLive = () => (
      flyGen.current === generation
      && viewerGen.current === capturedViewer
      && slideMounted.current
    );
    if (!card) return Promise.resolve({ ok: flightLive(), generation, peerId });
    flyingRef.current = true;
    clearTransitionTimer();
    card.classList.remove("is-dragging");
    card.classList.add("is-flying");
    const rect = card.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    const parsedX = Number.parseFloat(card.style.getPropertyValue("--pb-drag-x"));
    const fromX = opts?.fromX ?? (Number.isFinite(parsedX) ? parsedX : 0);
    const parsedRot = Number.parseFloat(card.style.getPropertyValue("--pb-drag-rot"));
    const fromRot = opts?.fromRot
      ?? (Number.isFinite(parsedRot) ? parsedRot : browseDragRotationDeg(fromX, width, reducedMotionRef.current));
    const rot = Math.max(
      -PLAYER_BROWSE_MAX_ROTATION_DEG,
      Math.min(
        PLAYER_BROWSE_MAX_ROTATION_DEG,
        fromRot !== 0 ? fromRot : dir * Math.min(PLAYER_BROWSE_MAX_ROTATION_DEG, 10),
      ),
    );
    const x = browseExitTranslationPx({
      dir,
      width,
      height,
      rotationDeg: rot,
      currentX: fromX,
    });
    if (reducedMotionRef.current) {
      clearCardMotion(true);
      return Promise.resolve({ ok: flightLive(), generation, peerId });
    }
    const distance = Math.abs(x - fromX);
    const duration = browseExitDurationMs(distance, opts?.velocity ?? 0);
    return new Promise(resolve => {
      // Continue from release pose — no recenter before exit.
      card.style.transition = "none";
      card.style.setProperty("--pb-drag-x", `${fromX}px`);
      card.style.setProperty("--pb-drag-y", "0px");
      card.style.setProperty("--pb-drag-rot", `${rot}deg`);
      card.style.transform = `translate3d(${fromX}px, 0, 0) rotate(${rot}deg)`;
      // Force style flush so the next transition starts from the release pose.
      void card.offsetWidth;
      card.style.transition = `transform ${duration}ms linear`;
      card.style.setProperty("--pb-drag-x", `${x}px`);
      card.style.transform = `translate3d(${x}px, 0, 0) rotate(${rot}deg)`;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        card.removeEventListener("transitionend", onEnd);
        clearTransitionTimer();
        // Fence against flyGen and viewer/auth generation; always settle the promise (no hang on unmount).
        const live = flightLive();
        flyingRef.current = false;
        resolve({ ok: live, generation, peerId });
      };
      const onEnd = (event: TransitionEvent) => {
        if (event.target === card && event.propertyName === "transform") finish();
      };
      card.addEventListener("transitionend", onEnd);
      transitionTimerRef.current = window.setTimeout(finish, duration + 40);
    });
  }, [clearCardMotion, clearTransitionTimer]);

  const applySkipAdvance = useCallback((peerId: string, generation: number | null) => {
    if (generation != null && generation !== flyGen.current) return;
    if (!slideMounted.current) return;
    // Ignore obsolete completion after peer/scope change mid-flight.
    if (generation != null && peerId !== currentPeerRef.current) {
      actionConsumedRef.current = false;
      return;
    }
    setSkipStack(stack => pushSkip(stack, peerId));
    // Mobile: no repeated skip toast — one-time hint lives in left onboarding cue.
    // Desktop keeps a short visual notice.
    if (desktop) setToast("Пропущено. Игрок не получит уведомления.");
    const liveIndex = indexRef.current;
    if (liveIndex < browsePlayers.length - 1) {
      actionConsumedRef.current = false;
      moveTo(liveIndex + 1, desktop ? "next" : undefined);
      return;
    }
    // Last card: settle to a usable terminal (not a permanent flown-off ghost).
    clearCardMotion(true);
    actionConsumedRef.current = false;
    if (hasMore) setAnnounce("Подборка на этой странице закончилась. Можно загрузить ещё.");
    else setAnnounce("Подборка закончилась.");
  }, [browsePlayers.length, hasMore, moveTo, desktop, clearCardMotion]);

  const skipCurrent = useCallback((opts?: { alreadyFlying?: boolean; generation?: number; peerId?: string | null }) => {
    if (!current || navigationLocked || tutorialOpen) return;
    if (actionConsumedRef.current && !opts?.alreadyFlying) return;
    const peerId = opts?.peerId ?? current.publicPlayerId;
    if (opts?.peerId && current.publicPlayerId !== opts.peerId && !opts.alreadyFlying) return;
    if (opts?.generation != null && opts.generation !== flyGen.current) return;
    actionConsumedRef.current = true;
    if (opts?.alreadyFlying || desktop) {
      applySkipAdvance(peerId, opts?.generation ?? null);
      return;
    }
    const capturedPeer = peerId;
    void flyOffCard(-1, { peerId: capturedPeer }).then(result => {
      if (!result.ok || result.peerId !== capturedPeer || result.generation !== flyGen.current) {
        actionConsumedRef.current = false;
        return;
      }
      applySkipAdvance(capturedPeer, result.generation);
    });
  }, [current, navigationLocked, tutorialOpen, desktop, flyOffCard, applySkipAdvance]);
  const undoSkip = useCallback(() => {
    if (navigationLocked || tutorialOpen) return;
    const { stack, id } = popSkip(skipStack);
    if (!id) return;
    const restored = indexOfBrowsePlayer(browsePlayers, id);
    setSkipStack(stack);
    if (restored >= 0) moveTo(restored, desktop && restored < index ? "prev" : desktop ? "next" : undefined);
  }, [navigationLocked, tutorialOpen, skipStack, browsePlayers, moveTo, desktop, index]);

  const applySendAdvance = useCallback((peerId: string, generation: number | null) => {
    if (generation != null && generation !== flyGen.current) return;
    if (!slideMounted.current) return;
    if (generation != null && peerId !== currentPeerRef.current) {
      actionConsumedRef.current = false;
      return;
    }
    awaitingRightRef.current = null;
    actionConsumedRef.current = false;
    const skipped = new Set(skipStack);
    const knownMap = new Map(known);
    knownMap.set(peerId, "outgoing");
    const next = nextEligibleBrowseIndex(browsePlayers, index, knownMap, skipped);
    if (next >= 0) {
      pendingDirectionRef.current = null;
      setIntentIndex(next);
      return;
    }
    clearCardMotion(true);
    setAnnounce(prev => prev || "Подборка закончилась.");
  }, [skipStack, known, browsePlayers, index, clearCardMotion]);

  const requestFriendship = useCallback(() => {
    if (navigationLocked || tutorialOpen || actionConsumedRef.current || flyingRef.current) return;
    if (fluidMobile) {
      const gate = offersRef.current?.canSendTo(currentPeerRef.current ?? "");
      if (gate && !gate.ok) {
        if (gate.reason) setAnnounce(gate.reason);
        return;
      }
    }
    actionConsumedRef.current = true;
    const started = friendshipApi.current?.request() ?? false;
    if (!started) actionConsumedRef.current = false;
  }, [navigationLocked, tutorialOpen, fluidMobile]);

  const onConfirmedRequest = useCallback((receipt: PlayInterestReceipt, capturedPeerId?: string) => {
    const peerId = capturedPeerId ?? current?.publicPlayerId;
    if (!peerId) return;
    // Withdraw succeeds as a mutation but must not toast "sent" or auto-advance.
    if (!isBrowseConfirmedPlayInterestOutcome(receipt.outcome)) return;
    const relationship = receipt.outcome === "mutual" ? "mutual" : "outgoing";
    setKnown(prev => {
      const next = new Map(prev);
      next.set(peerId, relationship);
      return next;
    });
    offersRef.current?.noteRelationship(peerId, relationship);
    const confirmedLine = receipt.outcome === "mutual" ? "Вы оба хотите сыграть" : "Предложение отправлено";
    // Mobile: aria-only announce — no visual success toast / bottom overlay.
    // Desktop keeps short toast + announce.
    setAnnounce(confirmedLine);
    if (desktop) setToast(confirmedLine);
    // Fluid mobile: flight + next card already ran at admission; receipt must not advance again.
    if (fluidMobile) {
      awaitingRightRef.current = null;
      return;
    }
    const skipped = new Set(skipStack);
    const next = nextEligibleBrowseIndex(browsePlayers, index, new Map([
      ...known,
      [peerId, relationship] as const,
    ]), skipped);
    const finishAdvance = (generation: number | null) => {
      if (generation != null && generation !== flyGen.current) return;
      if (generation != null && peerId !== currentPeerRef.current) {
        actionConsumedRef.current = false;
        return;
      }
      awaitingRightRef.current = null;
      actionConsumedRef.current = false;
      // Bypass post lock: confirmed receipt already cleared the mutation busy latch in the child.
      // Non-animated readiness commit — not a browse slide.
      if (next >= 0) {
        pendingDirectionRef.current = null;
        setIntentIndex(next);
      } else {
        // Honest terminal when no further eligible peer.
        clearCardMotion(true);
        setAnnounce(prev => prev || "Подборка закончилась.");
      }
    };
    // Desktop / legacy mobile: successful right flyout only after confirmed receipt.
    const fromGesture = awaitingRightRef.current === peerId;
    awaitingRightRef.current = null;
    if (fromGesture && !desktop) {
      rightConfirmGen.current += 1;
      const capturedPeer = peerId;
      void flyOffCard(1, { peerId: capturedPeer }).then(result => {
        if (!result.ok || result.peerId !== capturedPeer || result.generation !== flyGen.current) {
          actionConsumedRef.current = false;
          return;
        }
        finishAdvance(result.generation);
      });
      return;
    }
    finishAdvance(null);
  }, [current, skipStack, browsePlayers, index, known, desktop, flyOffCard, clearCardMotion, fluidMobile]);
  const openTutorial = useCallback(() => {
    // Explicit ? open: only when auth is ready or confirmed guest — never while /v1/me pending/error.
    if (!identityReady) return;
    if (authState === "ready" && !me?.id) return;
    setTutorialStep(1);
    setTutorialOpen(true);
  }, [identityReady, authState, me?.id]);

  /** X / Escape: leave unfinished — no persistent completion. Reopening may restart. */
  const abortTutorial = useCallback(() => {
    setTutorialOpen(false);
    setTutorialStep(1);
    requestAnimationFrame(() => deckRef.current?.focus({ preventScroll: true }));
  }, []);

  /** Step-2 finish only: durable per-actor localStorage (memory fallback if blocked). */
  const finishTutorial = useCallback(() => {
    // Refuse pending/error and ready-without-id — never write the guest marker for an unresolved viewer.
    if (!identityReady || (authState === "ready" && !me?.id)) {
      setTutorialOpen(false);
      setTutorialStep(1);
      return;
    }
    const actor = tutorialActorKey(me?.id);
    // Captured open-session actor must still match; identity flip mid-teaching must not finish wrong key.
    if (tutorialActorSeenRef.current !== null && tutorialActorSeenRef.current !== actor) {
      setTutorialOpen(false);
      setTutorialStep(1);
      return;
    }
    setTutorialOpen(false);
    setTutorialStep(1);
    persistTutorialCompleted(browseTutorialLocalStorage(), actor);
    // Latch this actor only — other actors must not inherit memory in the same session.
    setTutorialCompletedActor(actor);
    requestAnimationFrame(() => deckRef.current?.focus({ preventScroll: true }));
  }, [identityReady, authState, me?.id]);

  const advanceTutorial = useCallback(() => {
    if (tutorialStep === 1) {
      setTutorialStep(2);
      setAnnounce("Свайп вправо — давай сыграем. Совпадение только когда оба хотите сыграть.");
      return;
    }
    finishTutorial();
  }, [tutorialStep, finishTutorial]);

  /** Focus coach hit when it mounts (showHelp). Stable — no per-render ref churn stealing focus on step 2. */
  const bindTutorialHitRef = useCallback((node: HTMLButtonElement | null) => {
    tutorialRef.current = node;
    if (node) node.focus({ preventScroll: true });
  }, []);

  const openDetails = useCallback(() => {
    setDetailsPage(0);
    setMobileInfoPage(0);
    setBioChunks([]);
    setDetailsOpen(true);
  }, []);

  const closeDetails = useCallback(() => {
    setDetailsOpen(false);
    setDetailsPage(0);
    setMobileInfoPage(0);
    setBioChunks([]);
  }, []);

  useLayoutEffect(() => {
    if (!desktop || !detailsOpen) {
      return;
    }
    const bio = normalizeBrowseBio(current?.bio);
    const recompute = () => {
      const bioEl = detailsBioRef.current;
      if (!bio) {
        setBioChunks([]);
        setDetailsPage(0);
        return;
      }
      if (!bioEl) return;
      // Pager + chunk-meta slots stay reserved in layout before this measure runs.
      const previous = bioEl.textContent;
      bioEl.textContent = bio;
      const client = bioEl.clientHeight;
      const scroll = bioEl.scrollHeight;
      let nextChunks = scroll <= client + 2
        ? [bio]
        : chunkBrowseBio(bio, estimateBrowseBioChunkChars(bio.length, client, scroll));
      // Every rendered chunk must fit the final control layout (not only the first).
      for (let guard = 0; guard < 8; guard += 1) {
        let clippedLen = 0;
        let clippedClient = client;
        let clippedScroll = scroll;
        for (const chunk of nextChunks) {
          bioEl.textContent = chunk;
          const chunkClient = bioEl.clientHeight;
          const chunkScroll = bioEl.scrollHeight;
          if (chunkScroll > chunkClient + 2 && chunk.length > clippedLen) {
            clippedLen = chunk.length;
            clippedClient = chunkClient;
            clippedScroll = chunkScroll;
          }
        }
        if (!clippedLen) break;
        const tighter = estimateBrowseBioChunkChars(clippedLen, clippedClient, clippedScroll);
        const rebuilt = chunkBrowseBio(bio, tighter);
        if (
          rebuilt.length === nextChunks.length
          && rebuilt.every((part, i) => part === nextChunks[i])
        ) break;
        nextChunks = rebuilt;
      }
      bioEl.textContent = previous;
      setBioChunks(prev => (
        prev.length === nextChunks.length && prev.every((part, i) => part === nextChunks[i])
          ? prev
          : nextChunks
      ));
      setDetailsPage(page => Math.min(page, Math.max(0, nextChunks.length - 1)));
    };
    recompute();
    window.addEventListener("resize", recompute);
    const bioBox = detailsBioRef.current;
    const ro = typeof ResizeObserver === "function" && bioBox
      ? new ResizeObserver(() => recompute())
      : null;
    if (ro && bioBox) ro.observe(bioBox);
    return () => {
      window.removeEventListener("resize", recompute);
      ro?.disconnect();
    };
  }, [desktop, detailsOpen, current?.publicPlayerId, current?.bio]);

  useEffect(() => {
    if (mobileFullscreen) requestAnimationFrame(() => closeBtnRef.current?.focus({ preventScroll: true }));
  }, [mobileFullscreen]);

  // Mobile: height-fit bio chunks for about pages (facts / about* / games stay separate).
  useLayoutEffect(() => {
    if (desktop || !detailsOpen) return;
    const bio = normalizeBrowseBio(current?.bio);
    const clampMobilePage = (aboutLen: number) => {
      const aboutCount = Math.max(1, aboutLen);
      const last = aboutCount + 1; // facts=0 … games=last
      setMobileInfoPage(page => Math.min(page, last));
    };
    const recompute = () => {
      const bioEl = detailsBioRef.current;
      if (!bio) {
        setBioChunks([]);
        clampMobilePage(0);
        return;
      }
      if (!bioEl) return;
      // Measure host mirrors about-page chrome so chunks fit available height (375×667 / zoom).
      const previous = bioEl.textContent;
      bioEl.textContent = bio;
      const client = bioEl.clientHeight;
      const scroll = bioEl.scrollHeight;
      let nextChunks = scroll <= client + 2
        ? [bio]
        : chunkBrowseBio(bio, estimateBrowseBioChunkChars(bio.length, client, scroll));
      for (let guard = 0; guard < 8; guard += 1) {
        let clippedLen = 0;
        let clippedClient = client;
        let clippedScroll = scroll;
        for (const chunk of nextChunks) {
          bioEl.textContent = chunk;
          const chunkClient = bioEl.clientHeight;
          const chunkScroll = bioEl.scrollHeight;
          if (chunkScroll > chunkClient + 2 && chunk.length > clippedLen) {
            clippedLen = chunk.length;
            clippedClient = chunkClient;
            clippedScroll = chunkScroll;
          }
        }
        if (!clippedLen) break;
        const tighter = estimateBrowseBioChunkChars(clippedLen, clippedClient, clippedScroll);
        const rebuilt = chunkBrowseBio(bio, tighter);
        if (
          rebuilt.length === nextChunks.length
          && rebuilt.every((part, i) => part === nextChunks[i])
        ) break;
        nextChunks = rebuilt;
      }
      bioEl.textContent = previous;
      setBioChunks(prev => (
        prev.length === nextChunks.length && prev.every((part, i) => part === nextChunks[i])
          ? prev
          : nextChunks
      ));
      clampMobilePage(nextChunks.length);
    };
    recompute();
    window.addEventListener("resize", recompute);
    const measureRoot = detailsBioRef.current?.parentElement ?? mobileDetailsBodyRef.current;
    const ro = typeof ResizeObserver === "function" && measureRoot
      ? new ResizeObserver(() => recompute())
      : null;
    if (ro && measureRoot) ro.observe(measureRoot);
    return () => {
      window.removeEventListener("resize", recompute);
      ro?.disconnect();
    };
  }, [desktop, detailsOpen, current?.publicPlayerId, current?.bio]);

  // Legacy (non-fluid) failed / UNKNOWN right-swipe: restore readable card, no automatic replay.
  useEffect(() => {
    if (fluidMobile || desktop || friendBusy || flyingRef.current) return;
    const peer = awaitingRightRef.current;
    if (!peer || current?.publicPlayerId !== peer) return;
    // Busy cleared without a confirmed receipt consuming the await → restore.
    awaitingRightRef.current = null;
    actionConsumedRef.current = false;
    springBackCard();
    setAnnounce("Запрос не подтверждён. Карточка восстановлена.");
  }, [friendBusy, desktop, current?.publicPlayerId, springBackCard, fluidMobile]);

  // Breakpoint → desktop: cancel mobile gesture/flight timers (no mutation).
  useEffect(() => {
    if (!desktop) return;
    flyGen.current += 1;
    actionConsumedRef.current = false;
    awaitingRightRef.current = null;
    flyingRef.current = false;
    clearTransitionTimer();
    drag.current = null;
  }, [desktop, clearTransitionTimer]);

  navigationLockedRef.current = navigationLocked;
  tutorialOpenRef.current = tutorialOpen;
  detailsOpenRef.current = detailsOpen;
  detailsPageRef.current = detailsPage;
  mobileInfoPageRef.current = mobileInfoPage;
  // facts + max(1, bioChunks) about pages + games
  mobileInfoPageCountRef.current = 1 + Math.max(1, bioChunks.length) + 1;
  bioChunksRef.current = bioChunks;
  rateBlockedUntilRef.current = rateBlockedUntil;
  currentPeerRef.current = current?.publicPlayerId ?? null;
  skipCurrentRef.current = skipCurrent;
  applySkipAdvanceRef.current = applySkipAdvance;
  applySendAdvanceRef.current = applySendAdvance;
  requestFriendshipRef.current = requestFriendship;
  openDetailsRef.current = openDetails;
  closeDetailsRef.current = closeDetails;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        cancelActiveGesture(true);
        return;
      }
      if (event.key === "Escape" && tutorialOpen) {
        event.preventDefault();
        abortTutorial();
        return;
      }
      if (event.key === "Escape" && detailsOpen) {
        event.preventDefault();
        closeDetails();
        return;
      }
      if (event.key === "Escape" && mobileFullscreen && onCloseFullscreenRef.current) {
        event.preventDefault();
        onCloseFullscreenRef.current();
        return;
      }
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || tutorialOpen) return;
      if (event.target !== deckRef.current) return;
      if (event.key === "ArrowRight") { event.preventDefault(); moveTo(intentIndex + 1, "next"); }
      if (event.key === "ArrowLeft") { event.preventDefault(); moveTo(intentIndex - 1, "prev"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tutorialOpen, abortTutorial, moveTo, intentIndex, detailsOpen, closeDetails, mobileFullscreen]);

  function applyDragVisual(state: DragState) {
    const card = cardRef.current;
    if (!card) return;
    const width = card.clientWidth || window.innerWidth;
    if (state.axis === "horizontal") {
      const x = state.originX + state.dx;
      const rot = browseDragRotationDeg(x, width, reducedMotionRef.current);
      card.style.transition = "none";
      card.style.transformOrigin = `${state.pivotX}px ${state.pivotY}px`;
      card.style.setProperty("--pb-drag-x", `${x}px`);
      card.style.setProperty("--pb-drag-y", "0px");
      card.style.setProperty("--pb-drag-rot", `${rot}deg`);
      // Direct 1:1 tracking from re-grab base — no damping.
      card.style.transform = `translate3d(${x}px, 0, 0) rotate(${rot}deg)`;
      card.classList.add("is-dragging");
      const abs = Math.abs(x);
      const saturateAt = Math.max(8, width * 0.45 - 4);
      const u = Math.max(0, Math.min(1, (abs - 4) / saturateAt));
      // Smoothstep saturating tint (OUR feedback curve).
      const progress = u * u * (3 - 2 * u);
      const skip = x < 0;
      card.style.setProperty("--pb-intent-skip", skip ? String(progress) : "0");
      card.style.setProperty("--pb-intent-request", !skip ? String(progress) : "0");
      const blocked = rateBlockedUntilRef.current != null && Date.now() < rateBlockedUntilRef.current;
      setDragStamp({
        opacity: 0.95 * progress,
        skip,
        label: skip ? "Пропустить" : blocked ? "Слишком много попыток" : "Давай сыграем",
      });
      return;
    }
    if (state.axis === "vertical") {
      const rawY = state.originY + state.dy;
      const y = detailsOpenRef.current ? Math.max(0, rawY) : Math.min(0, rawY);
      card.style.transition = "none";
      card.style.transformOrigin = "";
      card.style.setProperty("--pb-drag-x", "0px");
      card.style.setProperty("--pb-drag-y", `${y}px`);
      card.style.setProperty("--pb-drag-rot", "0deg");
      card.style.transform = `translate3d(0, ${y}px, 0)`;
      card.classList.add("is-dragging");
      card.style.setProperty("--pb-intent-skip", "0");
      card.style.setProperty("--pb-intent-request", "0");
      setDragStamp({ opacity: 0, skip: false, label: "" });
    }
  }

  function cancelActiveGesture(spring: boolean) {
    const state = drag.current;
    drag.current = null;
    if (dragRaf.current) {
      cancelAnimationFrame(dragRaf.current);
      dragRaf.current = 0;
    }
    if (state?.capturing) {
      const surface = gestureRef.current;
      try {
        if (surface?.hasPointerCapture(state.id)) surface.releasePointerCapture(state.id);
      } catch { /* ignore */ }
    }
    if (spring && !flyingRef.current && !awaitingRightRef.current) springBackCard();
    else if (!awaitingRightRef.current && !flyingRef.current) {
      setDragStamp({ opacity: 0, skip: false, label: "" });
    }
  }

  // Gestures attach only after the pending card is ready; handlers use refs so drag is not recreated mid-gesture.
  useEffect(() => {
    // Desktop: explicit buttons only — no pointer swipe/drag mutations.
    if (desktop) return;
    const surface = gestureRef.current;
    if (!surface || !mediaReady) return;

    const pushSample = (state: DragState, event: PointerEvent, now: number) => {
      state.samples.push({ t: now, x: event.clientX, y: event.clientY });
      const cutoff = now - PLAYER_BROWSE_VELOCITY_WINDOW_MS - 40;
      while (state.samples.length > 2 && state.samples[0]!.t < cutoff) state.samples.shift();
      if (state.samples.length > 12) state.samples.shift();
    };

    const onDown = (event: PointerEvent) => {
      // Second contact cancels BEFORE primary / interactive exclusions; never adopt secondary pointer.
      if (drag.current && event.pointerId !== drag.current.id) {
        cancelActiveGesture(true);
        return;
      }
      if (navigationLockedRef.current || tutorialOpenRef.current || flyingRef.current || awaitingRightRef.current) return;
      if (actionConsumedRef.current) return;
      if (!mediaReadyRef.current || !currentPeerRef.current) return;
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      if (isBrowseDragExcludedTarget(event.target)) return;
      // Re-grab an in-progress spring: pin computed pose as drag origin, then cancel transition.
      const card = cardRef.current;
      if (card?.classList.contains("is-flying")) return;
      let originX = 0;
      let originY = 0;
      if (card && card.style.transition && card.style.transition !== "none") {
        const computed = window.getComputedStyle(card);
        if (computed.transform && computed.transform !== "none") {
          card.style.transform = computed.transform;
          const pose = parseBrowseCssTransformPose(computed.transform);
          originX = pose.x;
          originY = pose.y;
          card.style.setProperty("--pb-drag-x", `${originX}px`);
          card.style.setProperty("--pb-drag-y", `${originY}px`);
          card.style.setProperty("--pb-drag-rot", `${pose.rotDeg}deg`);
        }
        clearTransitionTimer();
        card.style.transition = "none";
      }
      const rect = card?.getBoundingClientRect();
      const now = performance.now();
      drag.current = {
        id: event.pointerId,
        peerId: currentPeerRef.current,
        x: event.clientX,
        y: event.clientY,
        dx: 0,
        dy: 0,
        originX,
        originY,
        t: now,
        samples: [{ t: now, x: event.clientX, y: event.clientY }],
        axis: "none",
        capturing: false,
        pivotX: rect ? event.clientX - rect.left : event.clientX,
        pivotY: rect ? event.clientY - rect.top : event.clientY,
        consumed: false,
      };
      try {
        surface.setPointerCapture(event.pointerId);
        drag.current.capturing = true;
      } catch { /* Optional capture — release-outside still ends via pointerup on window. */ }
    };

    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;
      if (!event.isPrimary) {
        cancelActiveGesture(true);
        return;
      }
      state.dx = event.clientX - state.x;
      state.dy = event.clientY - state.y;
      const now = performance.now();
      state.t = now;
      pushSample(state, event, now);
      const intent = classifyPointerGesture({
        dx: state.dx,
        dy: state.dy,
        width: surface.clientWidth || window.innerWidth,
        height: surface.clientHeight || window.innerHeight,
        phase: "move",
        lockedAxis: state.axis,
      });
      if (intent === "horizontal" || intent === "vertical") state.axis = intent;
      if (state.axis === "none") return;
      if (dragRaf.current) return;
      dragRaf.current = requestAnimationFrame(() => {
        dragRaf.current = 0;
        const live = drag.current;
        if (live) applyDragVisual(live);
      });
    };

    const finishPointer = (event: PointerEvent, cancelled: boolean) => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;
      if (state.consumed) return;
      state.consumed = true;
      // Update with release sample before classifying (spec: include release point).
      state.dx = event.clientX - state.x;
      state.dy = event.clientY - state.y;
      const now = performance.now();
      pushSample(state, event, now);
      const axis = state.axis;
      const velocity = sampleBrowseVelocity(state.samples, axis, now);
      const peerAtStart = state.peerId;
      // Visual release pose includes spring re-grab base; classifier still uses fresh dx/dy.
      const fromX = state.originX + state.dx;
      const width = surface.clientWidth || window.innerWidth;
      const fromRot = browseDragRotationDeg(fromX, width, reducedMotionRef.current);
      drag.current = null;
      if (dragRaf.current) {
        cancelAnimationFrame(dragRaf.current);
        dragRaf.current = 0;
      }
      try {
        if (state.capturing && surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      } catch { /* ignore */ }
      if (cancelled || axis === "none") {
        springBackCard();
        return;
      }
      if (peerAtStart !== currentPeerRef.current || navigationLockedRef.current || tutorialOpenRef.current || actionConsumedRef.current) {
        springBackCard();
        return;
      }
      const reverseVeto = axis === "horizontal"
        ? browseReleaseReverseVeto(state.dx, velocity)
        : axis === "vertical"
          ? browseReleaseReverseVeto(state.dy, velocity)
          : false;
      const result = classifyPointerGesture({
        dx: state.dx,
        dy: state.dy,
        width,
        height: surface.clientHeight || window.innerHeight,
        phase: "release",
        lockedAxis: axis,
        velocity,
        reverseVeto,
      });
      if (result === "skip") {
        if (actionConsumedRef.current) {
          springBackCard();
          return;
        }
        actionConsumedRef.current = true;
        applyDragVisual({ ...state, axis: "horizontal" });
        void flyOffCard(-1, { peerId: peerAtStart, velocity, fromX, fromRot }).then(fly => {
          if (!fly.ok || fly.peerId !== peerAtStart || fly.generation !== flyGen.current) {
            actionConsumedRef.current = false;
            return;
          }
          applySkipAdvanceRef.current(peerAtStart, fly.generation);
        });
        return;
      }
      if (result === "request") {
        const api = friendshipApi.current;
        if (!api?.canRequest || actionConsumedRef.current) {
          springBackCard();
          return;
        }
        const sendGate = offersRef.current?.canSendTo(peerAtStart);
        if (sendGate && !sendGate.ok) {
          springBackCard();
          if (sendGate.reason) setAnnounce(sendGate.reason);
          return;
        }
        actionConsumedRef.current = true;
        awaitingRightRef.current = peerAtStart;
        const started = api.request();
        if (!started) {
          awaitingRightRef.current = null;
          actionConsumedRef.current = false;
          springBackCard();
          return;
        }
        // Fluid mobile: fly off immediately from release pose; POST settles independently.
        if (offersRef.current) {
          applyDragVisual({ ...state, axis: "horizontal" });
          void flyOffCard(1, { peerId: peerAtStart, velocity, fromX, fromRot }).then(fly => {
            if (!fly.ok || fly.peerId !== peerAtStart || fly.generation !== flyGen.current) {
              actionConsumedRef.current = false;
              return;
            }
            applySendAdvanceRef.current(peerAtStart, fly.generation);
          });
          return;
        }
        // Legacy hold until receipt; green was intent only.
        const holdX = Math.max(-width * 0.25, Math.min(width * 0.25, fromX));
        const card = cardRef.current;
        if (card && Math.abs(fromX) > width * 0.25) {
          card.style.transition = `transform ${PLAYER_BROWSE_RETURN_MS}ms ease-out`;
          card.style.setProperty("--pb-drag-x", `${holdX}px`);
          card.style.setProperty("--pb-drag-rot", `${browseDragRotationDeg(holdX, width, reducedMotionRef.current)}deg`);
          card.style.transform = `translate3d(${holdX}px, 0, 0) rotate(${browseDragRotationDeg(holdX, width, reducedMotionRef.current)}deg)`;
        }
        setDragStamp({ opacity: 0.55, skip: false, label: "Отправляем…" });
        return;
      }
      if (result === "vertical-up") {
        if (!detailsOpenRef.current) {
          springBackCard();
          openDetailsRef.current();
          return;
        }
        const last = mobileInfoPageCountRef.current - 1;
        if (mobileInfoPageRef.current < last) {
          setMobileInfoPage(page => Math.min(last, page + 1));
        }
        springBackCard();
        return;
      }
      if (result === "vertical-down") {
        if (detailsOpenRef.current) {
          if (mobileInfoPageRef.current > 0) setMobileInfoPage(page => Math.max(0, page - 1));
          else closeDetailsRef.current();
        }
        springBackCard();
        return;
      }
      springBackCard();
    };

    const onUp = (event: PointerEvent) => finishPointer(event, false);
    const onCancel = (event: PointerEvent) => finishPointer(event, true);
    const onLost = (event: PointerEvent) => {
      if (!drag.current || drag.current.id !== event.pointerId) return;
      // Release outside capture still delivers pointerup; lost without up → cancel, no mutation.
      if (drag.current) finishPointer(event, true);
    };
    const onBlur = () => cancelActiveGesture(true);
    // Capture second contacts outside the gesture surface while a mobile drag is active.
    // Do not stopPropagation — close/help and other chrome buttons must still receive the event.
    const onDocPointerDownCapture = (event: PointerEvent) => {
      if (!drag.current || event.pointerId === drag.current.id) return;
      cancelActiveGesture(true);
    };

    surface.addEventListener("pointerdown", onDown);
    surface.addEventListener("pointermove", onMove);
    surface.addEventListener("pointerup", onUp);
    surface.addEventListener("pointercancel", onCancel);
    surface.addEventListener("lostpointercapture", onLost);
    document.addEventListener("pointerdown", onDocPointerDownCapture, true);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      // Real peer/auth/scope/breakpoint teardown: restore a readable pose (do not leave a stuck transform).
      // Ordinary applySendAdvance identity churn must not reach here — it is ref-bound, not an effect dep.
      cancelActiveGesture(true);
      surface.removeEventListener("pointerdown", onDown);
      surface.removeEventListener("pointermove", onMove);
      surface.removeEventListener("pointerup", onUp);
      surface.removeEventListener("pointercancel", onCancel);
      surface.removeEventListener("lostpointercapture", onLost);
      document.removeEventListener("pointerdown", onDocPointerDownCapture, true);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
    };
  }, [desktop, mediaReady, flyOffCard, springBackCard, clearTransitionTimer]);
  const blank = catalogState === "loading" || (!browsePlayers.length && (catalogState === "empty" || catalogState === "ready"));
  const showHelp = !desktop && identityReady && tutorialOpen && !blank && catalogState !== "error" && catalogState !== "unavailable";
  const counter = browsePlayers.length
    ? `${String(index + 1).padStart(2, "0")} / ${String(browsePlayers.length).padStart(2, "0")}`
    : "00 / 00";
  // Last-card end on mobile FS: out-of-flow end/continue (no header strip; card keeps full stage).
  const atEndFs = mobileFullscreen && browsePlayers.length > 0 && index >= browsePlayers.length - 1;
  const atEndFsPlain = atEndFs && !hasMore;
  // Mobile FS: only canonical CloseButton overlaid top-right — no counter/place/help strip.
  const mobileFsClose = mobileFullscreen ? (
    <CloseButton
      ref={closeBtnRef}
      className="pb-fs-close"
      aria-label="Закрыть карточки"
      onClick={() => onCloseFullscreenRef.current?.()}
    />
  ) : null;
  const wrapCatalogState = (body: ReactNode) => (
    <div
      className={`gb-player-browse${mobileFullscreen ? " pb-browse--fs" : ""}`}
      data-surface="player-browse-deck"
      data-browse-desktop={desktop ? "true" : "false"}
      data-mobile-fs={mobileFullscreen ? "true" : "false"}
    >
      {mobileFsClose}
      {body}
    </div>
  );

  // Authenticated cards eligibility gates (batch states) — mobile fluid host or desktop readonly.
  // Before ordinary empty/loading copy so already-sent peers never flash while checking.
  const rawGate = fluidMobile && mobileOffers
    ? mobileOffers.eligibility
    : finderEligibility;
  if (rawGate && rawGate.kind !== "ready") {
    const gateEligibility = rawGate.kind === "idle"
      ? { ...rawGate, kind: "checking" as const, message: "Подбираем игроков…" }
      : rawGate;
    return wrapCatalogState(
      <>
        {fluidMobile && mobileOffers && (
          <PlayerBrowseOfferStatus
            status={mobileOffers.status}
            onCheckStatus={() => mobileOffers.checkStatusReadonly()}
            unresolved={mobileOffers.unresolved}
            onCheckUnresolved={(peerId) => mobileOffers.checkStatusReadonly(peerId)}
            className="pb-offer-status--modal"
            presentation="quietRoutine"
          />
        )}
        <PlayerBrowseFinderGate
          eligibility={gateEligibility}
          onContinue={fluidMobile && mobileOffers
            ? () => mobileOffers.continueSearch()
            : onContinueFinder}
          onRetry={fluidMobile && mobileOffers
            ? () => mobileOffers.retryEligibility()
            : onRetryFinder}
          guestAction={fluidMobile
            ? <AuthEntry returnPath="/players?view=cards">Войти</AuthEntry>
            : undefined}
        />
      </>,
    );
  }

  if (catalogState === "loading" && !players.length) {
    return wrapCatalogState(
      <div className="pb-loading" role="status"><h2>Ищем игроков…</h2><p>Загружаем публичный каталог.</p></div>,
    );
  }
  if (catalogState === "unavailable") {
    return wrapCatalogState(
      <div className="pb-empty" role="status"><h2>Каталог игроков сейчас недоступен</h2><p>Попробуйте вернуться позже.</p></div>,
    );
  }
  if (catalogState === "error") {
    return wrapCatalogState(
      <div className="pb-empty" role="alert"><h2>Не удалось загрузить каталог</h2><p>Проверьте соединение и попробуйте снова.</p></div>,
    );
  }
  if (!browsePlayers.length) {
    return wrapCatalogState(
      <div className="pb-empty" role="status">
        <h2>Никого не нашли</h2>
        <p>Попробуйте изменить фильтры или загрузить ещё, если доступно.</p>
        {hasMore && <Button variant="outline" disabled={moreBusy} onClick={onLoadMore}>{moreBusy ? "Загрузка…" : "Загрузить ещё"}</Button>}
      </div>,
    );
  }

  const levelLabel = formatSocialLevel(current?.level);
  const meta = [levelLabel !== "не указан" ? levelLabel : null, cityName(current?.cityId ?? null), current?.areaKey].filter(Boolean).join(" · ");
  const locationLine = [cityName(current?.cityId ?? null), current?.areaKey].filter(Boolean).join(" · ");
  // Mobile fixed pages: 0=facts/overview, 1..N=about bio, last=games/profile link.
  const mobileAboutCount = Math.max(1, bioChunks.length);
  const mobileInfoLast = mobileAboutCount + 1;
  const mobileAboutIndex = mobileInfoPage >= 1 && mobileInfoPage <= mobileAboutCount
    ? mobileInfoPage - 1
    : 0;
  const mobileSection: "facts" | "about" | "games" = mobileInfoPage <= 0
    ? "facts"
    : mobileInfoPage <= mobileAboutCount
      ? "about"
      : "games";
  const atEnd = index >= browsePlayers.length - 1;
  const intentAtStart = intentIndex <= 0;
  const intentAtEnd = intentIndex >= browsePlayers.length - 1;
  const sendBlocked = fluidMobile && current
    ? mobileOffers?.canSendTo(current.publicPlayerId)
    : null;
  const friendship = current && mediaReady && (
    <PlayerBrowsePlayInterest
      key={`${me?.id ?? "guest"}:${current.publicPlayerId}`}
      me={me}
      authState={authState}
      peerId={current.publicPlayerId}
      returnPath={`/players?view=cards`}
      navigationLocked={commitPending}
      rateBlockedUntil={rateBlockedUntil}
      onRateLimited={onRateLimited}
      onRelationship={(view) => {
        if (!view) return;
        setKnown(prev => {
          const next = new Map(prev);
          next.set(current.publicPlayerId, view.relationship);
          return next;
        });
        offersRef.current?.noteRelationship(current.publicPlayerId, view.relationship);
      }}
      onConfirmedInterest={onConfirmedRequest}
      onBusyChange={(busy) => {
        if (fluidMobile) return;
        setFriendBusy(busy);
        // Single-flight covers interest buttons as well as gestures.
        if (busy) actionConsumedRef.current = true;
        else if (!flyingRef.current && !awaitingRightRef.current) actionConsumedRef.current = false;
      }}
      onApi={(api) => {
        if (!api) {
          friendshipApi.current = null;
          return;
        }
        const base = api;
        friendshipApi.current = {
          busy: base.busy,
          pendingUnknown: base.pendingUnknown,
          canRequest: base.canRequest && !(sendBlocked && !sendBlocked.ok),
          request: () => {
            if (flyingRef.current) return false;
            if (actionConsumedRef.current && awaitingRightRef.current == null) return false;
            actionConsumedRef.current = true;
            const started = base.request();
            if (!started && awaitingRightRef.current == null) actionConsumedRef.current = false;
            return started;
          },
        };
      }}
      onSkip={skipCurrent}
      onAuthRetry={() => setAuthReload(n => n + 1)}
      chrome={desktop ? "desktop" : "mobile"}
      externalAdmitSend={fluidMobile && mobileOffers
        ? (view) => mobileOffers.admitSend({
          peerId: current.publicPlayerId,
          peerName: current.displayName,
          view,
        })
        : null}
      sendBlockedReason={sendBlocked && !sendBlocked.ok ? sendBlocked.reason : ""}
      onExternalSendAdmitted={fluidMobile
        ? () => {
          const peer = current.publicPlayerId;
          awaitingRightRef.current = peer;
          void flyOffCard(1, { peerId: peer }).then(fly => {
            if (!fly.ok || fly.peerId !== peer || fly.generation !== flyGen.current) {
              actionConsumedRef.current = false;
              return;
            }
            applySendAdvanceRef.current(peer, fly.generation);
          });
        }
        : null}
    />
  );

  const desktopActions = (
    <div className="pb-profile-bottom">
      <div className="pb-profile-actions">
        <div className="pb-friend-slot">{friendship}</div>
        <button
          type="button"
          className="pb-btn-next"
          disabled={navigationLocked || showHelp || intentAtEnd}
          onClick={() => moveTo(intentIndex + 1, "next")}
        >
          Следующий <Chevron dir="right" />
        </button>
      </div>
      <p className="pb-action-caption">Совпадение — когда оба хотите сыграть. Не дружба.</p>
    </div>
  );

  return <div className={`gb-player-browse${showHelp ? " is-teaching" : ""}${mobileFullscreen ? " pb-browse--fs" : ""}`} data-surface="player-browse-deck" data-browse-desktop={desktop ? "true" : "false"} data-mobile-fs={mobileFullscreen ? "true" : "false"}>
    {mobileFsClose}
    {!mobileFullscreen && !desktop ? (
      <div className="pb-deck-context">
        <strong className="pb-deck-context__place"><img className="profile-icon" src="/discovery/pin.svg" alt="" />{placeLabel}</strong>
        <div className="pb-deck-context__tools">
          <span className="pb-counter" aria-live="polite">{counter}</span>
          <button type="button" className="pb-help" aria-label="Подсказка по жестам" disabled={!identityReady} onClick={openTutorial}>?</button>
        </div>
      </div>
    ) : null}

    <div className="pb-slider-stage">
      {desktop && (
        <>
          <button type="button" className="pb-slider-nav prev" aria-label="Предыдущий игрок — только просмотр" disabled={navigationLocked || showHelp || intentAtStart} onClick={() => moveTo(intentIndex - 1, "prev")}><Chevron dir="left" /></button>
          <button type="button" className="pb-slider-nav next" aria-label="Следующий игрок — только просмотр" disabled={navigationLocked || showHelp || intentAtEnd} onClick={() => moveTo(intentIndex + 1, "next")}><Chevron dir="right" /></button>
        </>
      )}

      <div
        ref={deckRef}
        id="player-browse-deck"
        className="pb-deck"
        tabIndex={0}
        role="group"
        aria-label="Игроки по одному"
        aria-describedby="player-browse-live"
        data-slide={slideDir ?? undefined}
      >
        {!mediaReady && mediaUnavailable && (
          <div className="pb-surface" role="status" data-media-unavailable="true">
            <div className={`pb-card${desktop ? " pb-card--desktop" : ""}`}>
              <h2>Карточка недоступна</h2>
              <p className="pb-action-caption">Не удалось подготовить карточку игрока.</p>
            </div>
          </div>
        )}
        {!mediaReady && !mediaUnavailable && (
          <div className="pb-surface" role="status" aria-busy="true">
            <div className={`pb-card${desktop ? " pb-card--desktop" : ""}`} data-media-pending="true">
              <p className="pb-action-caption">Готовим карточку игрока…</p>
            </div>
          </div>
        )}
        {current && mediaReady && <div className="pb-surface" inert={showHelp ? true : undefined}>
          <div
            ref={slideFrameRef}
            className={`pb-slide-frame${slideDir ? ` is-sliding-${slideDir}` : ""}`}
          >
            {desktop ? (
              <article
                ref={cardRef}
                className={`pb-card pb-card--desktop${detailsOpen ? " is-expanded" : ""}`}
                data-player-id={current.publicPlayerId}
                data-details={detailsOpen ? "open" : "closed"}
                aria-busy={commitPending ? true : undefined}
              >
                {!detailsOpen && (
                  <div className="pb-cover">
                    <PreparedBrowseCover media={committedMedia!.cover} />
                    {current.lookingForGame && <span className="pb-media-tag">Ищу партнёра</span>}
                    {current.trainer && !current.lookingForGame && <span className="pb-media-tag">Тренер</span>}
                    <PreparedBrowseAvatar className={`avatar avatar--${current.trainer ? "purple" : "yellow"} pb-avatar`} media={committedMedia!.avatar} name={current.displayName} tone={current.trainer ? "purple" : "yellow"} />
                  </div>
                )}
                <div className="pb-copy">
                  {!detailsOpen ? (
                    <>
                      <div className="pb-identity">
                        <div className="pb-identity-top">
                          <span className="pb-eyebrow">ЗНАКОМИМСЯ НА КОРТЕ</span>
                          <span className="pb-counter" aria-live="polite">{counter}</span>
                        </div>
                        {commitPending && intentPlayer && (
                          <span className="pb-live" role="status">Готовим карточку…</span>
                        )}
                        <h2>{current.displayName}</h2>
                        {locationLine && <p className="pb-meta"><img className="profile-icon" src="/discovery/pin.svg" alt="" />{locationLine}</p>}
                        <div className="pb-facts pb-facts--inline">
                          <div className="pb-fact"><span>Уровень игры</span><strong>{levelLabel}</strong><small>Указан игроком</small></div>
                          <div className="pb-fact"><span>Роль</span><strong>{current.trainer ? "Тренер" : "Игрок"}</strong><small>{current.lookingForGame ? "Ищет игру" : "Открыт к знакомству"}</small></div>
                        </div>
                      </div>
                      {/* Excerpt + detail link are flex-none siblings of identity so overflow:hidden on identity cannot clip the link. */}
                      <div className="pb-excerpt">
                        {current.bio ? <p className="pb-bio pb-bio--preview">{current.bio}</p> : <p className="pb-bio pb-bio--preview">О себе пока ничего не написано.</p>}
                        <button type="button" className="pb-detail-toggle" aria-expanded={false} data-browse-no-drag="" onClick={openDetails}>
                          <span>Подробнее об игроке</span>
                          <Chevron dir="right" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <section className="pb-expanded" aria-label="Подробнее об игроке">
                      <div className="pb-expanded-heading">
                        <div className="pb-expanded-person">
                          <PreparedBrowseAvatar className={`avatar avatar--${current.trainer ? "purple" : "yellow"} pb-expanded-avatar`} media={committedMedia!.avatar} name={current.displayName} tone={current.trainer ? "purple" : "yellow"} />
                          <div>
                            <span className="pb-eyebrow">ПРОФИЛЬ ИГРОКА</span>
                            <h2>{current.displayName}</h2>
                            {locationLine && <p>{locationLine}</p>}
                          </div>
                        </div>
                        <div className="pb-expanded-heading-actions">
                          <Link className="pb-profile-link pb-profile-link--heading" href={`/players/${current.publicPlayerId}`}>Открыть публичный профиль</Link>
                          <button type="button" className="pb-collapse-details" onClick={closeDetails}>
                            К карточке <Chevron dir="left" />
                          </button>
                        </div>
                      </div>
                      <div ref={detailsBodyRef} className="pb-expanded-body" data-details-page={detailsPage}>
                        <div className="pb-expanded-columns">
                          <section className="pb-expanded-about">
                            <h3>Об игроке</h3>
                            {normalizeBrowseBio(current.bio) ? (
                              <p ref={detailsBioRef} className="pb-details-bio" data-details-bio="">
                                {bioChunks[detailsPage] ?? normalizeBrowseBio(current.bio)}
                              </p>
                            ) : (
                              <p ref={detailsBioRef} className="pb-details-bio" data-details-bio="">О себе пока ничего не написано.</p>
                            )}
                            {/* Reserved before measure so pager/meta never shrink the bio after chunking. */}
                            <p
                              className="pb-bio-chunk-meta"
                              aria-live="polite"
                              data-reserved="true"
                              data-active={bioChunks.length > 1 ? "true" : "false"}
                            >
                              {bioChunks.length > 1
                                ? `Текст ${String(detailsPage + 1)} / ${String(bioChunks.length)}`
                                : "\u00a0"}
                            </p>
                          </section>
                          <section className="pb-expanded-facts" data-details-facts="">
                            <h3>Игровой профиль</h3>
                            <dl className="pb-expanded-dl">
                              <div><dt>Уровень игры</dt><dd>{levelLabel}<small>Указан игроком</small></dd></div>
                              <div><dt>Роль</dt><dd>{current.trainer ? "Тренер" : "Игрок"}</dd></div>
                              <div><dt>Где играю</dt><dd>{current.areaKey || "Не указан"}</dd></div>
                            </dl>
                            <p className="pb-games-note">Публичные ближайшие игры этого игрока пока недоступны.</p>
                          </section>
                        </div>
                      </div>
                      <div
                        className="pb-details-pager"
                        data-reserved="true"
                        data-active={bioChunks.length > 1 ? "true" : "false"}
                      >
                        {bioChunks.length > 1 && detailsPage > 0 && (
                          <button type="button" className="pb-details-more" onClick={() => setDetailsPage(page => Math.max(0, page - 1))}>
                            Назад
                          </button>
                        )}
                        {bioChunks.length > 1 && detailsPage < bioChunks.length - 1 && (
                          <button type="button" className="pb-details-more" onClick={() => setDetailsPage(page => Math.min(bioChunks.length - 1, page + 1))}>
                            Ещё сведения
                          </button>
                        )}
                      </div>
                    </section>
                  )}
                  {/* Stable slot: details toggle must not remount friendship / pending UNKNOWN. */}
                  {desktopActions}
                </div>
              </article>
            ) : (
              <article
                ref={cardRef}
                className="pb-card pb-card--mobile"
                data-player-id={current.publicPlayerId}
                data-details={detailsOpen ? "open" : "closed"}
                aria-busy={commitPending ? true : undefined}
                style={{ touchAction: "pinch-zoom" }}
              >
                <div className="pb-intent-layer" aria-hidden="true">
                  <div className="pb-intent pb-intent--skip">
                    <span className="pb-intent-icon" aria-hidden="true">✕</span>
                    <span className="pb-intent-label">Пропустить</span>
                  </div>
                  <div className="pb-intent pb-intent--request">
                    <span className="pb-intent-icon" aria-hidden="true">＋</span>
                    <span className="pb-intent-label">Давай сыграем</span>
                  </div>
                </div>

                <div ref={gestureRef} className="pb-gesture-surface" style={{ touchAction: "pinch-zoom" }}>
                  <div className={`pb-mobile-stage${detailsOpen ? " is-details" : ""}`}>
                    <div className="pb-cover" aria-hidden={detailsOpen ? true : undefined} inert={detailsOpen ? true : undefined}>
                      <PreparedBrowseCover media={committedMedia!.cover} />
                      {/* Single retained avatar host: cover OR details — never both (second host steals the node). */}
                      {!detailsOpen && (
                        <PreparedBrowseAvatar className={`avatar avatar--${current.trainer ? "purple" : "yellow"} pb-avatar`} media={committedMedia!.avatar} name={current.displayName} tone={current.trainer ? "purple" : "yellow"} />
                      )}
                    </div>
                    <div className="pb-identity-compact" aria-hidden={detailsOpen ? true : undefined} inert={detailsOpen ? true : undefined}>
                      {current.lookingForGame && <span className="pb-pill">● Ищу игру</span>}
                      {current.trainer && !current.lookingForGame && <span className="pb-pill">Тренер</span>}
                      <h2>{current.displayName}</h2>
                      {meta && <p className="pb-meta">{meta}</p>}
                      <small className="pb-level-note">Уровень — со слов игрока</small>
                      <button type="button" className="pb-detail-toggle" aria-expanded={detailsOpen} data-browse-no-drag="" onClick={openDetails}>
                        <span>Подробнее · свайп вверх</span>
                        <Chevron dir="down" />
                      </button>
                    </div>

                    {/* Closed details stay mounted for stable layout but are inert/hidden; gesture surface still receives swipes. */}
                    <div
                      className={`pb-mobile-details${detailsOpen ? " is-open" : ""}`}
                      inert={!detailsOpen ? true : undefined}
                      aria-hidden={!detailsOpen ? true : undefined}
                    >
                      <div className="pb-mobile-details__panel">
                        {/* Body clips one info page; pager stays outside so prev/next are never below the fold. */}
                        <div
                          ref={mobileDetailsBodyRef}
                          className="pb-mobile-details__body"
                          data-mobile-info-page={mobileInfoPage}
                          data-mobile-section={mobileSection}
                        >
                          {/* Measure host mirrors about-page geometry for height-fit chunking (not shown). */}
                          <div className="pb-mobile-bio-measure" aria-hidden="true">
                            <div className="pb-about pb-about--measure">
                              <h3>О себе</h3>
                              <p ref={detailsBioRef} className="pb-details-bio pb-mobile-bio" data-details-bio="" />
                              <p className="pb-bio-chunk-meta" data-reserved="true" data-active="true">Текст 1 / 1</p>
                            </div>
                          </div>

                          {/* Single retained avatar host while details open — visual only on facts/overview. */}
                          <div
                            className="pb-mobile-details__head"
                            data-page-role={mobileSection === "facts" ? "overview" : "host"}
                            aria-hidden={mobileSection !== "facts" ? true : undefined}
                          >
                            {detailsOpen && (
                              <PreparedBrowseAvatar className={`avatar avatar--${current.trainer ? "purple" : "yellow"} pb-details-avatar`} media={committedMedia!.avatar} name={current.displayName} tone={current.trainer ? "purple" : "yellow"} />
                            )}
                            {mobileSection === "facts" && (
                              <div>
                                <h3>{current.displayName}</h3>
                                {meta && <p className="pb-meta">{meta}</p>}
                              </div>
                            )}
                          </div>

                          {mobileSection === "facts" && (
                            <div className="pb-facts">
                              <div className="pb-fact"><span>Уровень</span><strong>{levelLabel}</strong><small>Самооценка игрока</small></div>
                              <div className="pb-fact"><span>Город</span><strong>{cityName(current.cityId) || "Не указан"}</strong></div>
                              <div className="pb-fact"><span>Район / метро</span><strong>{current.areaKey || "Не указан"}</strong></div>
                              <div className="pb-fact"><span>Роль</span><strong>{current.trainer ? "Тренер" : "Игрок"}</strong></div>
                            </div>
                          )}

                          {mobileSection === "about" && (
                            <div className="pb-about">
                              <h3>О себе</h3>
                              <p className="pb-details-bio pb-mobile-bio" data-details-bio="">
                                {bioChunks[mobileAboutIndex] ?? (normalizeBrowseBio(current.bio) || "О себе пока ничего не написано.")}
                              </p>
                              <p
                                className="pb-bio-chunk-meta"
                                data-reserved="true"
                                data-active={mobileAboutCount > 1 ? "true" : "false"}
                                aria-live="polite"
                              >
                                {mobileAboutCount > 1
                                  ? `Текст ${String(mobileAboutIndex + 1)} / ${String(mobileAboutCount)}`
                                  : "Текст 1 / 1"}
                              </p>
                            </div>
                          )}

                          {mobileSection === "games" && (
                            <div className="pb-games">
                              <h3>Ближайшие игры</h3>
                              <p>Публичные ближайшие игры этого игрока пока недоступны.</p>
                              <Link className="pb-profile-link" href={`/players/${current.publicPlayerId}`} data-browse-no-drag="">Открыть публичный профиль</Link>
                            </div>
                          )}
                        </div>

                        <div className="pb-details-pager" data-browse-no-drag="" data-active="true">
                          <button type="button" className="pb-details-more" onClick={() => {
                            if (mobileInfoPage > 0) setMobileInfoPage(page => Math.max(0, page - 1));
                            else closeDetails();
                          }}>
                            {mobileInfoPage > 0 ? "Назад" : "К обложке"}
                          </button>
                          {mobileInfoPage < mobileInfoLast && (
                            <button type="button" className="pb-details-more" onClick={() => {
                              setMobileInfoPage(page => Math.min(mobileInfoLast, page + 1));
                            }}>
                              Ещё сведения
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`pb-swipe-stamp${dragStamp.skip ? " is-skip" : " is-request"}`} aria-hidden="true" style={{ opacity: dragStamp.opacity }}>
                  <span>{dragStamp.label}</span>
                </div>

                {/* Stable friendship slot — must not unmount across details open/close. */}
                <div className="pb-controls pb-controls--mobile">
                  <button type="button" className="pb-undo" disabled={!skipStack.length || navigationLocked || showHelp} onClick={undoSkip}>
                    ← Вернуть
                  </button>
                  <div className="pb-friend-slot">{friendship}</div>
                </div>
              </article>
            )}
          </div>
        </div>}

        {showHelp && (
          <div
            className="pb-tutorial"
            data-tutorial-step={tutorialStep}
            onPointerDown={(event) => { event.stopPropagation(); }}
            onClick={(event) => { event.stopPropagation(); }}
          >
            <button
              type="button"
              className="pb-tutorial-close"
              aria-label="Закрыть подсказку"
              onClick={abortTutorial}
            >
              ×
            </button>
            <button
              ref={bindTutorialHitRef}
              type="button"
              className="pb-tutorial-hit"
              aria-live="polite"
              aria-label={
                tutorialStep === 1
                  ? "Шаг 1 из 2. Свайп влево — пропустить. Игрок не получит уведомления. Коснитесь, чтобы продолжить"
                  : "Шаг 2 из 2. Свайп вправо — давай сыграем. Совпадение только когда оба хотите сыграть. Коснитесь, чтобы закончить"
              }
              onClick={advanceTutorial}
            >
              <span
                className={`pb-tutorial-cue${tutorialStep === 1 ? " pb-tutorial-cue--skip" : " pb-tutorial-cue--play"}`}
                aria-hidden="true"
              >
                <span className="pb-tutorial-cue__arrow">{tutorialStep === 1 ? "←" : "→"}</span>
                <span className="pb-tutorial-cue__title">
                  {tutorialStep === 1 ? "Свайп влево — пропустить" : "Свайп вправо — давай сыграем"}
                </span>
                {tutorialStep === 1 ? (
                  <>
                    <span className="pb-tutorial-cue__hint">Игрок не получит уведомления</span>
                    <span className="pb-tutorial-cue__hint">Коснитесь, чтобы продолжить</span>
                  </>
                ) : (
                  <span className="pb-tutorial-cue__hint">Совпадение только когда оба хотите сыграть</span>
                )}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>

    {/*
      Mobile FS: end/continue out-of-flow (no header strip) so the last visible card keeps
      full stage height. Plain end uses `.pb-fs-end`; hasMore uses `.pb-deck-end--fs-more`.
      FinderGate still owns eligibility empty/continue. Desktop in-flow footer unchanged.
    */}
    {atEnd && (
      <div
        className={`pb-deck-end${mobileFullscreen ? ` pb-deck-end--fs${hasMore ? " pb-deck-end--fs-more" : ""}${atEndFsPlain ? " pb-fs-end" : ""}` : ""}`}
        role="status"
      >
        {hasMore
          ? <Button variant="outline" disabled={moreBusy || navigationLocked} onClick={onLoadMore}>{moreBusy ? "Загрузка…" : "Загрузить ещё"}</Button>
          : <p className="pb-counter">Больше игроков в текущей выборке нет.</p>}
      </div>
    )}

    <div id="player-browse-live" className="pb-live" aria-live="polite">{announce}</div>
    {toast && <div className="pb-toast" role="status">{toast}</div>}
    {fluidMobile && mobileOffers && (
      <PlayerBrowseOfferStatus
        status={mobileOffers.status}
        onCheckStatus={() => mobileOffers.checkStatusReadonly()}
        unresolved={mobileOffers.unresolved}
        onCheckUnresolved={(peerId) => mobileOffers.checkStatusReadonly(peerId)}
        className="pb-offer-status--modal"
        presentation="quietRoutine"
      />
    )}
  </div>;
}

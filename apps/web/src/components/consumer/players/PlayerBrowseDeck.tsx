"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FriendshipReceipt, FriendshipView } from "@gobadminton/contracts/friendship-types";
import { getMe, getMySocialProfile } from "../../../lib/api-client";
import type { City, Me, PublicPlayer } from "../../../lib/consumer-types";
import { formatSocialLevel } from "../../../lib/player-presentation";
import {
  browseSlideDurationMs,
  chunkBrowseBio,
  classifyPointerGesture,
  estimateBrowseBioChunkChars,
  indexOfBrowsePlayer,
  isBrowseDragExcludedTarget,
  nextEligibleBrowseIndex,
  normalizeBrowseBio,
  ordinaryBrowsePlayers,
  persistTutorialDismissed,
  PLAYER_BROWSE_DESKTOP_MQ,
  type PlayerBrowseGestureAxis,
  popSkip,
  prefersBrowseReducedMotion,
  pushSkip,
  readBrowseHistoryState,
  readTutorialDismissed,
  swipeThresholdPx,
  type PlayerBrowseSlideDirection,
  withBrowseHistoryState,
} from "../../../lib/player-browse";
import { Button } from "../Button";
import { isBrowseConfirmedRequestOutcome, PlayerBrowseFriendship, type BrowseFriendshipApi } from "./PlayerBrowseFriendship";
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
};

type DragState = {
  id: number;
  peerId: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  t: number;
  samples: Array<{ t: number; x: number; y: number }>;
  axis: PlayerBrowseGestureAxis;
  capturing: boolean;
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
}: Props) {
  const desktop = useLocalDesktop(desktopProp);
  const [me, setMe] = useState<Me | null>(null);
  const [authState, setAuthState] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [ownPublicPlayerId, setOwnPublicPlayerId] = useState<string | null>(null);
  const [authReload, setAuthReload] = useState(0);
  const [index, setIndex] = useState(0);
  const [intentIndex, setIntentIndex] = useState(0);
  const [committedMedia, setCommittedMedia] = useState<PreparedBrowsePeerMedia | null>(null);
  const [skipStack, setSkipStack] = useState<string[]>([]);
  const [known, setKnown] = useState<Map<string, FriendshipView["relationship"]>>(() => new Map());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsPage, setDetailsPage] = useState(0);
  const [bioChunks, setBioChunks] = useState<string[]>([]);
  const [friendBusy, setFriendBusy] = useState(false);
  const [rateBlockedUntil, setRateBlockedUntil] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [announce, setAnnounce] = useState("");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialMemory, setTutorialMemory] = useState(false);
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
  const tutorialRef = useRef<HTMLElement>(null);
  const friendshipApi = useRef<BrowseFriendshipApi | null>(null);
  const drag = useRef<DragState | null>(null);
  const dragRaf = useRef(0);
  const flyingRef = useRef(false);
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
  const bioChunksRef = useRef<string[]>([]);
  const rateBlockedUntilRef = useRef<number | null>(null);
  const currentPeerRef = useRef<string | null>(null);
  const mediaReadyRef = useRef(false);
  const skipCurrentRef = useRef<() => void>(() => {});
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
  // In-flight POST locks browse navigation; media wait stays cancelable by further navigation.
  // UNKNOWN latch stays in per-peer pending storage without freezing the deck.
  const navigationLocked = friendBusy;
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
      viewerGen.current += 1;
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
    setBioChunks([]);
    setFriendBusy(false);
    awaitingRightRef.current = null;
    setDragStamp({ opacity: 0, skip: false, label: "" });
    if (cardRef.current && !flyingRef.current) {
      cardRef.current.style.transform = "";
      cardRef.current.style.removeProperty("--pb-drag-x");
      cardRef.current.style.removeProperty("--pb-drag-y");
      cardRef.current.style.removeProperty("--pb-drag-rot");
      cardRef.current.style.removeProperty("--pb-intent-skip");
      cardRef.current.style.removeProperty("--pb-intent-request");
      cardRef.current.classList.remove("is-dragging", "is-flying");
    }
  }, [current?.publicPlayerId]);

  useEffect(() => {
    // Desktop: no swipe tutorial. Mobile keeps existing onboarding.
    if (desktop) {
      setTutorialOpen(false);
      return;
    }
    const dismissed = readTutorialDismissed(
      typeof sessionStorage !== "undefined" ? sessionStorage : null,
      tutorialMemory,
    );
    const blank = catalogState === "loading" || catalogState === "empty" || catalogState === "error" || catalogState === "unavailable" || !browsePlayers.length;
    if (!dismissed && !blank) setTutorialOpen(true);
  }, [catalogState, browsePlayers.length, tutorialMemory, desktop]);

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

    const ordered = [
      targetIndex,
      ...neighborhood.filter(i => i !== targetIndex),
    ];

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
      clearMediaCache();
      replaceCommittedMedia(null);
      const frame = slideFrameRef.current;
      if (frame && typeof frame.getAnimations === "function") {
        for (const anim of frame.getAnimations()) anim.cancel();
      }
    };
  }, [clearMediaCache, replaceCommittedMedia]);

  const clearCardMotion = useCallback((instant = false) => {
    const card = cardRef.current;
    if (!card) return;
    if (instant || reducedMotionRef.current) card.style.transition = "none";
    card.style.setProperty("--pb-drag-x", "0px");
    card.style.setProperty("--pb-drag-y", "0px");
    card.style.setProperty("--pb-drag-rot", "0deg");
    card.style.setProperty("--pb-intent-skip", "0");
    card.style.setProperty("--pb-intent-request", "0");
    card.style.transform = "";
    card.classList.remove("is-dragging", "is-flying");
  }, []);

  const springBackCard = useCallback(() => {
    const card = cardRef.current;
    if (!card) {
      setDragStamp({ opacity: 0, skip: false, label: "" });
      return;
    }
    card.classList.remove("is-dragging");
    if (reducedMotionRef.current) {
      clearCardMotion(true);
    } else {
      card.style.transition = "transform 200ms ease-out";
      card.style.setProperty("--pb-drag-x", "0px");
      card.style.setProperty("--pb-drag-y", "0px");
      card.style.setProperty("--pb-drag-rot", "0deg");
      card.style.setProperty("--pb-intent-skip", "0");
      card.style.setProperty("--pb-intent-request", "0");
      card.style.transform = "translate3d(0,0,0) rotate(0deg)";
      window.setTimeout(() => {
        if (cardRef.current === card) clearCardMotion(true);
      }, 220);
    }
    setDragStamp({ opacity: 0, skip: false, label: "" });
  }, [clearCardMotion]);

  const flyOffCard = useCallback((dir: -1 | 1): Promise<void> => {
    const card = cardRef.current;
    if (!card) return Promise.resolve();
    flyingRef.current = true;
    card.classList.remove("is-dragging");
    card.classList.add("is-flying");
    const width = Math.max(card.getBoundingClientRect().width, window.innerWidth * 0.92);
    const x = dir * (width + 48);
    const rot = dir * 18;
    if (reducedMotionRef.current) {
      clearCardMotion(true);
      flyingRef.current = false;
      return Promise.resolve();
    }
    return new Promise(resolve => {
      card.style.transition = "transform 240ms ease-out";
      card.style.setProperty("--pb-drag-x", `${x}px`);
      card.style.setProperty("--pb-drag-y", "0px");
      card.style.setProperty("--pb-drag-rot", `${rot}deg`);
      card.style.transform = `translate3d(${x}px, 0, 0) rotate(${rot}deg)`;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        card.removeEventListener("transitionend", onEnd);
        flyingRef.current = false;
        resolve();
      };
      const onEnd = (event: TransitionEvent) => {
        if (event.target === card && event.propertyName === "transform") finish();
      };
      card.addEventListener("transitionend", onEnd);
      window.setTimeout(finish, 300);
    });
  }, [clearCardMotion]);

  const skipCurrent = useCallback((opts?: { alreadyFlying?: boolean }) => {
    if (!current || navigationLocked || tutorialOpen) return;
    const peerId = current.publicPlayerId;
    const advance = () => {
      setSkipStack(stack => pushSkip(stack, peerId));
      if (index < browsePlayers.length - 1) moveTo(index + 1, desktop ? "next" : undefined);
      else if (hasMore) setAnnounce("Подборка на этой странице закончилась. Можно загрузить ещё.");
      else setAnnounce("Подборка закончилась.");
      setToast("Пропущено. Игрок не получит уведомления.");
    };
    if (opts?.alreadyFlying || desktop) {
      advance();
      return;
    }
    void flyOffCard(-1).then(advance);
  }, [current, navigationLocked, tutorialOpen, index, browsePlayers.length, hasMore, moveTo, desktop, flyOffCard]);

  const undoSkip = useCallback(() => {
    if (navigationLocked || tutorialOpen) return;
    const { stack, id } = popSkip(skipStack);
    if (!id) return;
    const restored = indexOfBrowsePlayer(browsePlayers, id);
    setSkipStack(stack);
    if (restored >= 0) moveTo(restored, desktop && restored < index ? "prev" : desktop ? "next" : undefined);
  }, [navigationLocked, tutorialOpen, skipStack, browsePlayers, moveTo, desktop, index]);

  const requestFriendship = useCallback(() => {
    if (navigationLocked || tutorialOpen) return;
    friendshipApi.current?.request();
  }, [navigationLocked, tutorialOpen]);

  const onConfirmedRequest = useCallback((receipt: FriendshipReceipt) => {
    if (!current) return;
    // Cancel/decline/remove are successful mutations but must not toast "sent" or auto-advance.
    if (!isBrowseConfirmedRequestOutcome(receipt.outcome)) return;
    const peerId = current.publicPlayerId;
    const relationship = receipt.outcome === "accepted" ? "friends" : "outgoing_pending";
    setKnown(prev => {
      const next = new Map(prev);
      next.set(peerId, relationship);
      return next;
    });
    setToast(receipt.outcome === "accepted" ? "Теперь вы друзья" : "Запрос отправлен");
    setAnnounce(receipt.outcome === "accepted" ? "Запрос принят" : "Запрос отправлен");
    const skipped = new Set(skipStack);
    const next = nextEligibleBrowseIndex(browsePlayers, index, new Map([
      ...known,
      [peerId, relationship] as const,
    ]), skipped);
    const finishAdvance = () => {
      awaitingRightRef.current = null;
      // Bypass post lock: confirmed receipt already cleared the mutation busy latch in the child.
      // Non-animated readiness commit — not a browse slide.
      if (next >= 0) {
        pendingDirectionRef.current = null;
        setIntentIndex(next);
      } else {
        clearCardMotion(true);
      }
    };
    // Successful right flyout only after confirmed receipt (green during drag was intent only).
    const fromGesture = awaitingRightRef.current === peerId;
    awaitingRightRef.current = null;
    if (fromGesture && !desktop) {
      rightConfirmGen.current += 1;
      void flyOffCard(1).then(finishAdvance);
      return;
    }
    finishAdvance();
  }, [current, skipStack, browsePlayers, index, known, desktop, flyOffCard, clearCardMotion]);

  const dismissTutorial = useCallback(() => {
    setTutorialOpen(false);
    const ok = persistTutorialDismissed(typeof sessionStorage !== "undefined" ? sessionStorage : null);
    if (!ok) setTutorialMemory(true);
    else setTutorialMemory(true);
    requestAnimationFrame(() => deckRef.current?.focus({ preventScroll: true }));
  }, []);

  const openDetails = useCallback(() => {
    setDetailsPage(0);
    setBioChunks([]);
    setDetailsOpen(true);
  }, []);

  const closeDetails = useCallback(() => {
    setDetailsOpen(false);
    setDetailsPage(0);
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
    if (tutorialOpen) requestAnimationFrame(() => tutorialRef.current?.focus({ preventScroll: true }));
  }, [tutorialOpen]);

  useEffect(() => {
    if (mobileFullscreen) requestAnimationFrame(() => closeBtnRef.current?.focus({ preventScroll: true }));
  }, [mobileFullscreen]);

  // Mobile details bio pages — fixed pages, no ordinary vertical scroll inside the card.
  useLayoutEffect(() => {
    if (desktop || !detailsOpen) return;
    const bio = normalizeBrowseBio(current?.bio);
    if (!bio) {
      setBioChunks([]);
      setDetailsPage(0);
      return;
    }
    const chunks = chunkBrowseBio(bio, 140);
    setBioChunks(chunks);
    setDetailsPage(page => Math.min(page, Math.max(0, chunks.length - 1)));
  }, [desktop, detailsOpen, current?.publicPlayerId, current?.bio]);

  // Failed / UNKNOWN right-swipe: restore card, no automatic replay.
  useEffect(() => {
    if (desktop || friendBusy || flyingRef.current) return;
    const peer = awaitingRightRef.current;
    if (!peer || current?.publicPlayerId !== peer) return;
    // Busy cleared without a confirmed receipt consuming the await → restore.
    awaitingRightRef.current = null;
    springBackCard();
    setAnnounce("Запрос не подтверждён. Карточка восстановлена.");
  }, [friendBusy, desktop, current?.publicPlayerId, springBackCard]);

  navigationLockedRef.current = navigationLocked;
  tutorialOpenRef.current = tutorialOpen;
  detailsOpenRef.current = detailsOpen;
  detailsPageRef.current = detailsPage;
  bioChunksRef.current = bioChunks;
  rateBlockedUntilRef.current = rateBlockedUntil;
  currentPeerRef.current = current?.publicPlayerId ?? null;
  skipCurrentRef.current = () => skipCurrent({ alreadyFlying: true });
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
        dismissTutorial();
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
  }, [tutorialOpen, dismissTutorial, moveTo, intentIndex, detailsOpen, closeDetails, mobileFullscreen]);

  function applyDragVisual(state: DragState) {
    const card = cardRef.current;
    if (!card) return;
    const width = card.clientWidth || window.innerWidth;
    if (state.axis === "horizontal") {
      const rot = state.dx / 28;
      card.style.transition = "none";
      card.style.setProperty("--pb-drag-x", `${state.dx}px`);
      card.style.setProperty("--pb-drag-y", "0px");
      card.style.setProperty("--pb-drag-rot", `${rot}deg`);
      card.style.transform = `translate3d(${state.dx}px, 0, 0) rotate(${rot}deg)`;
      card.classList.add("is-dragging");
      const threshold = swipeThresholdPx(width);
      const progress = Math.min(1, Math.abs(state.dx) / threshold);
      const skip = state.dx < 0;
      card.style.setProperty("--pb-intent-skip", skip ? String(progress) : "0");
      card.style.setProperty("--pb-intent-request", !skip ? String(progress) : "0");
      const blocked = rateBlockedUntilRef.current != null && Date.now() < rateBlockedUntilRef.current;
      setDragStamp({
        opacity: progress,
        skip,
        label: skip ? "Пропустить" : blocked ? "Запросы временно недоступны" : "В друзья",
      });
      return;
    }
    if (state.axis === "vertical") {
      const dy = detailsOpenRef.current ? Math.max(0, state.dy) : Math.min(0, state.dy);
      card.style.transition = "none";
      card.style.setProperty("--pb-drag-x", "0px");
      card.style.setProperty("--pb-drag-y", `${dy}px`);
      card.style.setProperty("--pb-drag-rot", "0deg");
      card.style.transform = `translate3d(0, ${dy}px, 0)`;
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

  function sampleVelocity(state: DragState, axis: PlayerBrowseGestureAxis): number {
    const samples = state.samples;
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1]!;
    let earlier = samples[0]!;
    for (let i = samples.length - 2; i >= 0; i -= 1) {
      const candidate = samples[i]!;
      if (last.t - candidate.t >= 24) {
        earlier = candidate;
        break;
      }
      earlier = candidate;
    }
    const dt = Math.max(1, last.t - earlier.t);
    if (axis === "horizontal") return (last.x - earlier.x) / dt;
    if (axis === "vertical") return (last.y - earlier.y) / dt;
    return 0;
  }

  // Gestures attach only after the pending card is ready; handlers use refs so drag is not recreated mid-gesture.
  useEffect(() => {
    // Desktop: explicit buttons only — no pointer swipe/drag mutations.
    if (desktop) return;
    const surface = gestureRef.current;
    if (!surface || !mediaReady) return;

    const onDown = (event: PointerEvent) => {
      if (navigationLockedRef.current || tutorialOpenRef.current || flyingRef.current || awaitingRightRef.current) return;
      if (!mediaReadyRef.current || !currentPeerRef.current) return;
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      if (isBrowseDragExcludedTarget(event.target)) return;
      if (drag.current) return;
      const now = performance.now();
      drag.current = {
        id: event.pointerId,
        peerId: currentPeerRef.current,
        x: event.clientX,
        y: event.clientY,
        dx: 0,
        dy: 0,
        t: now,
        samples: [{ t: now, x: event.clientX, y: event.clientY }],
        axis: "none",
        capturing: false,
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
      state.samples.push({ t: now, x: event.clientX, y: event.clientY });
      if (state.samples.length > 6) state.samples.shift();
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
      state.dx = event.clientX - state.x;
      state.dy = event.clientY - state.y;
      const axis = state.axis;
      const velocity = sampleVelocity(state, axis);
      const peerAtStart = state.peerId;
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
      if (peerAtStart !== currentPeerRef.current || navigationLockedRef.current || tutorialOpenRef.current) {
        springBackCard();
        return;
      }
      const result = classifyPointerGesture({
        dx: state.dx,
        dy: state.dy,
        width: surface.clientWidth || window.innerWidth,
        height: surface.clientHeight || window.innerHeight,
        phase: "release",
        lockedAxis: axis,
        velocity,
      });
      if (result === "skip") {
        void flyOffCard(-1).then(() => skipCurrentRef.current());
        return;
      }
      if (result === "request") {
        const api = friendshipApi.current;
        if (!api?.canRequest) {
          springBackCard();
          return;
        }
        awaitingRightRef.current = peerAtStart;
        const started = api.request();
        if (!started) {
          awaitingRightRef.current = null;
          springBackCard();
          return;
        }
        // Hold card at release offset until receipt; green was intent only.
        setDragStamp({ opacity: 0.55, skip: false, label: "Отправляем…" });
        return;
      }
      if (result === "vertical-up") {
        if (!detailsOpenRef.current) {
          springBackCard();
          openDetailsRef.current();
          return;
        }
        const chunks = bioChunksRef.current;
        if (chunks.length > 1 && detailsPageRef.current < chunks.length - 1) {
          setDetailsPage(page => Math.min(chunks.length - 1, page + 1));
        }
        springBackCard();
        return;
      }
      if (result === "vertical-down") {
        if (detailsOpenRef.current) {
          if (detailsPageRef.current > 0) setDetailsPage(page => Math.max(0, page - 1));
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

    surface.addEventListener("pointerdown", onDown);
    surface.addEventListener("pointermove", onMove);
    surface.addEventListener("pointerup", onUp);
    surface.addEventListener("pointercancel", onCancel);
    surface.addEventListener("lostpointercapture", onLost);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelActiveGesture(false);
      surface.removeEventListener("pointerdown", onDown);
      surface.removeEventListener("pointermove", onMove);
      surface.removeEventListener("pointerup", onUp);
      surface.removeEventListener("pointercancel", onCancel);
      surface.removeEventListener("lostpointercapture", onLost);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
    };
  }, [desktop, mediaReady, flyOffCard, springBackCard]);

  const blank = catalogState === "loading" || (!browsePlayers.length && (catalogState === "empty" || catalogState === "ready"));
  const showHelp = !desktop && tutorialOpen && !blank && catalogState !== "error" && catalogState !== "unavailable";

  if (catalogState === "loading" && !players.length) {
    return <div className="gb-player-browse"><div className="pb-loading" role="status"><h2>Ищем игроков…</h2><p>Загружаем публичный каталог.</p></div></div>;
  }
  if (catalogState === "unavailable") {
    return <div className="gb-player-browse"><div className="pb-empty" role="status"><h2>Каталог игроков сейчас недоступен</h2><p>Попробуйте вернуться позже.</p></div></div>;
  }
  if (catalogState === "error") {
    return <div className="gb-player-browse"><div className="pb-empty" role="alert"><h2>Не удалось загрузить каталог</h2><p>Проверьте соединение и попробуйте снова.</p></div></div>;
  }
  if (!browsePlayers.length) {
    return <div className="gb-player-browse">
      <div className="pb-empty" role="status">
        <h2>Никого не нашли</h2>
        <p>Попробуйте изменить фильтры или загрузить ещё, если доступно.</p>
        {hasMore && <Button variant="outline" disabled={moreBusy} onClick={onLoadMore}>{moreBusy ? "Загрузка…" : "Загрузить ещё"}</Button>}
      </div>
    </div>;
  }

  const levelLabel = formatSocialLevel(current?.level);
  const meta = [levelLabel !== "не указан" ? levelLabel : null, cityName(current?.cityId ?? null), current?.areaKey].filter(Boolean).join(" · ");
  const locationLine = [cityName(current?.cityId ?? null), current?.areaKey].filter(Boolean).join(" · ");
  const atEnd = index >= browsePlayers.length - 1;
  const intentAtStart = intentIndex <= 0;
  const intentAtEnd = intentIndex >= browsePlayers.length - 1;
  const counter = `${String(index + 1).padStart(2, "0")} / ${String(browsePlayers.length).padStart(2, "0")}`;
  const friendship = current && mediaReady && (
    <PlayerBrowseFriendship
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
      }}
      onConfirmedRequest={onConfirmedRequest}
      onBusyChange={setFriendBusy}
      onApi={(api) => { friendshipApi.current = api; }}
      onSkip={skipCurrent}
      onAuthRetry={() => setAuthReload(n => n + 1)}
      chrome={desktop ? "desktop" : "mobile"}
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
      <p className="pb-action-caption">Дружба — после подтверждения игрока.</p>
    </div>
  );

  return <div className={`gb-player-browse${showHelp ? " is-teaching" : ""}${mobileFullscreen ? " pb-browse--fs" : ""}`} data-surface="player-browse-deck" data-browse-desktop={desktop ? "true" : "false"} data-mobile-fs={mobileFullscreen ? "true" : "false"}>
    {mobileFullscreen ? (
      <header className="pb-fs-chrome">
        <div className="pb-fs-chrome__meta">
          <span className="pb-counter" aria-live="polite">{counter}</span>
          <span className="pb-fs-place">{placeLabel}</span>
        </div>
        <div className="pb-fs-chrome__tools">
          <button type="button" className="pb-help" aria-label="Подсказка по жестам" onClick={() => setTutorialOpen(true)}>?</button>
          <button
            ref={closeBtnRef}
            type="button"
            className="pb-fs-close"
            aria-label="Закрыть карточки"
            onClick={() => onCloseFullscreenRef.current?.()}
          >
            ×
          </button>
        </div>
      </header>
    ) : !desktop ? (
      <div className="pb-deck-context">
        <strong className="pb-deck-context__place"><img className="profile-icon" src="/discovery/pin.svg" alt="" />{placeLabel}</strong>
        <div className="pb-deck-context__tools">
          <span className="pb-counter" aria-live="polite">{counter}</span>
          <button type="button" className="pb-help" aria-label="Подсказка по жестам" onClick={() => setTutorialOpen(true)}>?</button>
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
                      <div className="pb-excerpt">
                        {current.bio ? <p className="pb-bio pb-bio--preview">{current.bio}</p> : <p className="pb-bio pb-bio--preview">О себе пока ничего не написано.</p>}
                        <button type="button" className="pb-detail-toggle" aria-expanded={false} data-browse-no-drag="" onClick={openDetails}>
                          <span>Подробнее об игроке</span>
                          <Chevron dir="right" />
                        </button>
                      </div>
                    </div>
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
                style={{ touchAction: "none" }}
              >
                <div className="pb-intent-layer" aria-hidden="true">
                  <div className="pb-intent pb-intent--skip">
                    <span className="pb-intent-icon" aria-hidden="true">✕</span>
                    <span className="pb-intent-label">Пропустить</span>
                  </div>
                  <div className="pb-intent pb-intent--request">
                    <span className="pb-intent-icon" aria-hidden="true">＋</span>
                    <span className="pb-intent-label">В друзья</span>
                  </div>
                </div>

                <div ref={gestureRef} className="pb-gesture-surface" style={{ touchAction: "none" }}>
                  <div className={`pb-mobile-stage${detailsOpen ? " is-details" : ""}`}>
                    <div className="pb-cover" aria-hidden={detailsOpen ? true : undefined}>
                      <PreparedBrowseCover media={committedMedia!.cover} />
                      <PreparedBrowseAvatar className={`avatar avatar--${current.trainer ? "purple" : "yellow"} pb-avatar`} media={committedMedia!.avatar} name={current.displayName} tone={current.trainer ? "purple" : "yellow"} />
                    </div>
                    <div className="pb-identity-compact" aria-hidden={detailsOpen ? true : undefined}>
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

                    <div className={`pb-mobile-details${detailsOpen ? " is-open" : ""}`} data-browse-no-drag="">
                      <div className="pb-mobile-details__panel">
                        <div className="pb-mobile-details__head">
                          <PreparedBrowseAvatar className={`avatar avatar--${current.trainer ? "purple" : "yellow"} pb-details-avatar`} media={committedMedia!.avatar} name={current.displayName} tone={current.trainer ? "purple" : "yellow"} />
                          <div>
                            <h3>{current.displayName}</h3>
                            {meta && <p className="pb-meta">{meta}</p>}
                          </div>
                        </div>
                        <div className="pb-facts">
                          <div className="pb-fact"><span>Уровень</span><strong>{levelLabel}</strong><small>Самооценка игрока</small></div>
                          <div className="pb-fact"><span>Город</span><strong>{cityName(current.cityId) || "Не указан"}</strong></div>
                          <div className="pb-fact"><span>Район / метро</span><strong>{current.areaKey || "Не указан"}</strong></div>
                          <div className="pb-fact"><span>Роль</span><strong>{current.trainer ? "Тренер" : "Игрок"}</strong></div>
                        </div>
                        <div className="pb-about">
                          <h3>О себе</h3>
                          <p>{bioChunks[detailsPage] ?? (normalizeBrowseBio(current.bio) || "О себе пока ничего не написано.")}</p>
                          {bioChunks.length > 1 && (
                            <p className="pb-bio-chunk-meta" aria-live="polite">
                              Текст {String(detailsPage + 1)} / {String(bioChunks.length)}
                            </p>
                          )}
                        </div>
                        <div className="pb-games">
                          <h3>Ближайшие игры</h3>
                          <p>Публичные ближайшие игры этого игрока пока недоступны.</p>
                          <Link className="pb-profile-link" href={`/players/${current.publicPlayerId}`}>Открыть публичный профиль</Link>
                        </div>
                        <div className="pb-details-pager" data-browse-no-drag="">
                          <button type="button" className="pb-details-more" disabled={detailsPage <= 0 && !detailsOpen} onClick={() => {
                            if (detailsPage > 0) setDetailsPage(page => page - 1);
                            else closeDetails();
                          }}>
                            {detailsPage > 0 ? "Назад" : "К обложке"}
                          </button>
                          {bioChunks.length > 1 && detailsPage < bioChunks.length - 1 && (
                            <button type="button" className="pb-details-more" onClick={() => setDetailsPage(page => Math.min(bioChunks.length - 1, page + 1))}>
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
          <div className="pb-tutorial-shade">
            <section ref={tutorialRef} className="pb-tutorial" role="dialog" aria-modal="false" aria-labelledby="pb-tutorial-title" tabIndex={-1}>
              <button type="button" className="pb-tutorial-close" aria-label="Закрыть подсказку" onClick={dismissTutorial}>×</button>
              <div className="pb-tutorial__eyebrow">Знакомьтесь в своём темпе</div>
              <h2 id="pb-tutorial-title">Одна карточка. Два жеста.</h2>
              <div className="pb-gesture-pair">
                <div className="pb-gesture-choice"><strong>Свайп влево</strong><span>Пропустить. Без уведомления игроку.</span></div>
                <div className="pb-gesture-choice"><strong>Свайп вправо</strong><span>Предложить дружбу явной командой.</span></div>
                <div className="pb-gesture-choice"><strong>Свайп вверх</strong><span>Открыть сведения. Вниз — к обложке.</span></div>
              </div>
              <p className="pb-tutorial-note">Кнопки «Пропустить» и «В друзья» дублируют жесты. Запрос уходит только после подтверждения сервера.</p>
              <button type="button" className="pb-tutorial-dismiss" onClick={dismissTutorial}>Понятно</button>
            </section>
          </div>
        )}
      </div>
    </div>

    {atEnd && (
      <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
        {hasMore
          ? <Button variant="outline" disabled={moreBusy || navigationLocked} onClick={onLoadMore}>{moreBusy ? "Загрузка…" : "Загрузить ещё"}</Button>
          : <p className="pb-counter" role="status">Больше игроков в текущей выборке нет.</p>}
      </div>
    )}

    <div id="player-browse-live" className="pb-live" aria-live="polite">{announce}</div>
    {toast && <div className="pb-toast" role="status">{toast}</div>}
  </div>;
}

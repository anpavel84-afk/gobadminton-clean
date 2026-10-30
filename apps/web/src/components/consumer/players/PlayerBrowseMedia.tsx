"use client";

import { useLayoutEffect, useRef } from "react";
import { getPlayer } from "../../../lib/api-client";
import type { PlayerAvatar, PublicPlayer } from "../../../lib/consumer-types";
import { initialsFromName } from "../../../lib/player-presentation";
import { safeAvatarUrl } from "./ProfileComposition";

/** End-to-end bound for metadata + image load/decode before fallback settle. */
export const PLAYER_BROWSE_MEDIA_DEADLINE_MS = 5000;
/**
 * Radar pin/open prewarm uses the same finite prepare budget as browse (≥ observed
 * network+decode). A shorter deadline cached timeout defaults as cover-ready.
 */
export const RADAR_PIN_MEDIA_DEADLINE_MS = PLAYER_BROWSE_MEDIA_DEADLINE_MS;
/** Hard union cap for pending + retained Radar peer preparations. */
export const RADAR_PIN_MEDIA_CAP = 4;

const DEFAULT_COVER_SRC = "/canonical/ce252.svg";
const COVER_URL_RE = /^\/v1\/media\/covers\/[a-f0-9]{64}\.png$/;

export function isSafeBrowseCoverUrl(raw: string): boolean {
  return COVER_URL_RE.test(raw);
}

/** Media identity for cache fencing; same publicPlayerId with new URLs must not reuse prep. */
export function browsePeerMediaKey(player: PublicPlayer): string {
  const uploaded = player.avatar?.uploadedUrl ?? "";
  const provider = player.avatar?.providerUrl ?? "";
  const cover = player.cover && "uploadedUrl" in player.cover
    ? `c:${player.cover.uploadedUrl ?? "null"}`
    : "c:missing";
  return `${player.publicPlayerId}|a:${uploaded}|p:${provider}|${cover}`;
}

export type PreparedBrowseAvatar =
  | { kind: "image"; src: string; node: HTMLImageElement }
  | { kind: "initials"; text: string };

export type PreparedBrowseCover =
  | { kind: "uploaded"; src: string; node: HTMLImageElement }
  /** authoritative:true = confirmed no uploaded cover; false = timeout/load fallback (not cover-ready). */
  | { kind: "default"; node: HTMLImageElement | null; authoritative?: boolean };

export type PreparedBrowsePeerMedia = {
  peerId: string;
  mediaKey: string;
  /** Exact catalog snapshot prepared with these pixels. */
  peer: PublicPlayer;
  avatar: PreparedBrowseAvatar;
  cover: PreparedBrowseCover;
};

export type PrepareBrowsePeerResult =
  | { ok: true; media: PreparedBrowsePeerMedia }
  | { ok: false; reason: "aborted" | "unauthorized" | "unavailable" };

export type BrowseMediaCacheStatus = "loading" | "ready" | "unauthorized" | "unavailable";

/** Resolve navigation after a terminal prep failure for the current intent. */
export function nextBrowseIntentAfterFailure(
  length: number,
  failedIndex: number,
  statusAt: (index: number) => BrowseMediaCacheStatus | undefined,
  hasCommitted: boolean,
  committedIndex: number,
): { kind: "revert"; index: number } | { kind: "advance"; index: number } | { kind: "unavailable" } {
  if (hasCommitted) return { kind: "revert", index: committedIndex };
  for (let i = failedIndex + 1; i < length; i += 1) {
    const status = statusAt(i);
    if (status !== "unauthorized" && status !== "unavailable") return { kind: "advance", index: i };
  }
  return { kind: "unavailable" };
}

/**
 * Tinder browse window: previous + current + next 4 (max 6), deduped.
 * Priority order: current, then ahead peers, then previous — so prep/eviction
 * never starves the visible/next cards for far-behind work.
 * Radar pin cap/admission is separate (RADAR_PIN_MEDIA_CAP) and must not use this.
 */
export function browseMediaNeighborhood(index: number, length: number): number[] {
  if (length <= 0 || index < 0 || index >= length) return [];
  const out: number[] = [];
  const push = (i: number) => {
    if (i >= 0 && i < length && !out.includes(i)) out.push(i);
  };
  push(index);
  for (let ahead = 1; ahead <= 4; ahead += 1) push(index + ahead);
  push(index - 1);
  return out;
}

function ensureStagingRoot(): HTMLDivElement {
  const existing = document.getElementById("pb-media-stage") as HTMLDivElement | null;
  if (existing) return existing;
  const root = document.createElement("div");
  root.id = "pb-media-stage";
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("inert", "");
  root.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(root);
  return root;
}

function disposeImageNode(node: HTMLImageElement | null | undefined) {
  if (!node) return;
  node.onload = null;
  node.onerror = null;
  try {
    node.removeAttribute("src");
  } catch {
    /* ignore */
  }
  node.remove();
}

export function disposePreparedBrowseMedia(media: PreparedBrowsePeerMedia | null | undefined) {
  if (!media) return;
  if (media.avatar.kind === "image") disposeImageNode(media.avatar.node);
  if (media.cover.kind === "uploaded") disposeImageNode(media.cover.node);
  else disposeImageNode(media.cover.node);
}

function settleDecodedImage(img: HTMLImageElement, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      resolve(ok);
    };
    const accept = () => {
      if (img.naturalWidth > 0) finish(true);
      else finish(false);
    };
    const onLoad = () => {
      if (typeof img.decode === "function") {
        void img.decode().then(accept).catch(() => finish(false));
      } else {
        accept();
      }
    };
    const onError = () => finish(false);
    const onAbort = () => finish(false);
    signal.addEventListener("abort", onAbort, { once: true });
    if (img.complete) {
      if (img.naturalWidth > 0) onLoad();
      else finish(false);
      return;
    }
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
  });
}

async function loadRetainedImage(
  src: string,
  signal: AbortSignal,
  options?: { referrerPolicy?: HTMLImageElement["referrerPolicy"]; className?: string; alt?: string },
): Promise<HTMLImageElement | null> {
  if (signal.aborted || typeof document === "undefined") return null;
  const stage = ensureStagingRoot();
  const img = document.createElement("img");
  img.alt = options?.alt ?? "";
  img.decoding = "async";
  if (options?.referrerPolicy) img.referrerPolicy = options.referrerPolicy;
  if (options?.className) img.className = options.className;
  stage.appendChild(img);
  img.src = src;
  const ok = await settleDecodedImage(img, signal);
  if (!ok || signal.aborted) {
    disposeImageNode(img);
    return null;
  }
  return img;
}

async function prepareAvatar(
  avatar: PlayerAvatar | undefined,
  name: string,
  signal: AbortSignal,
): Promise<PreparedBrowseAvatar> {
  const candidates = [avatar?.uploadedUrl, avatar?.providerUrl].filter(
    (url): url is string => typeof url === "string" && Boolean(url) && safeAvatarUrl(url),
  );
  for (const src of candidates) {
    if (signal.aborted) break;
    const node = await loadRetainedImage(src, signal, { referrerPolicy: "no-referrer" });
    if (node) return { kind: "image", src, node };
  }
  return { kind: "initials", text: initialsFromName(name) };
}

async function prepareCoverFromUrl(
  url: string | null | undefined,
  signal: AbortSignal,
): Promise<PreparedBrowseCover> {
  if (url && isSafeBrowseCoverUrl(url) && !signal.aborted) {
    const node = await loadRetainedImage(url, signal, { alt: "Обложка профиля" });
    if (node) return { kind: "uploaded", src: url, node };
  }
  if (signal.aborted) return { kind: "default", node: null };
  const fallback = await loadRetainedImage(DEFAULT_COVER_SRC, signal, {
    className: "profile-cover__fallback",
    alt: "",
  });
  return { kind: "default", node: fallback };
}

/**
 * Resolve cover metadata for a directory peer: directory may omit cover;
 * an authoritative uploadedUrl:null is distinct from missing metadata.
 */
export async function resolveBrowseCoverUrl(
  player: PublicPlayer,
  signal: AbortSignal,
): Promise<
  | { ok: true; url: string | null }
  | { ok: false; reason: "aborted" | "unauthorized" | "unavailable" }
> {
  if (player.cover && "uploadedUrl" in player.cover) {
    return { ok: true, url: player.cover.uploadedUrl };
  }
  const result = await getPlayer(player.publicPlayerId, signal);
  if (signal.aborted) return { ok: false, reason: "aborted" };
  if (!result.ok) {
    if (result.status === 401 || result.status === 403 || result.status === 404) {
      return { ok: false, reason: "unauthorized" };
    }
    if (result.status === 0) return { ok: false, reason: "aborted" };
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, url: result.data.cover?.uploadedUrl ?? null };
}

export async function prepareBrowsePeerMedia(
  player: PublicPlayer,
  signal: AbortSignal,
  deadlineMs: number = PLAYER_BROWSE_MEDIA_DEADLINE_MS,
  options?: { resolveCover?: boolean },
): Promise<PrepareBrowsePeerResult> {
  const peerId = player.publicPlayerId;
  const mediaKey = browsePeerMediaKey(player);
  if (signal.aborted) return { ok: false, reason: "aborted" };
  const resolveCover = options?.resolveCover !== false;

  const work = new AbortController();
  let parentAborted = false;
  let deadlineFired = false;
  const onParentAbort = () => {
    parentAborted = true;
    work.abort();
  };
  signal.addEventListener("abort", onParentAbort);
  const timer = window.setTimeout(() => {
    deadlineFired = true;
    work.abort();
  }, deadlineMs);

  let avatar: PreparedBrowseAvatar = { kind: "initials", text: initialsFromName(player.displayName) };
  let cover: PreparedBrowseCover = { kind: "default", node: null, authoritative: false };

  try {
    // Avatar bytes start with the profile GET when cover metadata is missing.
    const avatarPromise = prepareAvatar(player.avatar, player.displayName, work.signal).then(value => {
      avatar = value;
    });

    let coverUrl: string | null = null;
    let coverMetaReady = false;
    let authFail: "unauthorized" | "unavailable" | null = null;

    if (player.cover && "uploadedUrl" in player.cover) {
      coverUrl = player.cover.uploadedUrl;
      coverMetaReady = true;
    } else if (!resolveCover) {
      // Radar pin prewarm: only available avatar/cover fields — never speculative profile GET.
      coverMetaReady = true;
      coverUrl = null;
    } else {
      const meta = await resolveBrowseCoverUrl(player, work.signal);
      if (parentAborted || signal.aborted) {
        await avatarPromise.catch(() => undefined);
        disposePreparedBrowseMedia({ peerId, mediaKey, peer: player, avatar, cover });
        return { ok: false, reason: "aborted" };
      }
      if (meta.ok) {
        coverUrl = meta.url;
        coverMetaReady = true;
      } else if (meta.reason === "unauthorized") {
        authFail = "unauthorized";
      } else if (meta.reason === "unavailable") {
        authFail = "unavailable";
      }
      // Deadline abort during GET: settle with non-authoritative default (coverMetaReady stays false).
    }

    if (authFail) {
      await avatarPromise.catch(() => undefined);
      disposePreparedBrowseMedia({ peerId, mediaKey, peer: player, avatar, cover });
      return { ok: false, reason: authFail };
    }

    // Single end-to-end deadline only — no extra primary/fallback retry windows.
    const [coverResult] = await Promise.all([
      prepareCoverFromUrl(coverMetaReady ? coverUrl : null, work.signal),
      avatarPromise.catch(() => undefined),
    ]);
    // Authoritative absence: confirmed null uploaded cover. Timeout/load failure must not
    // permanently satisfy coverReady when an uploaded cover was expected.
    if (coverResult.kind === "uploaded") {
      cover = coverResult;
    } else {
      const authoritative = coverMetaReady && coverUrl === null && !deadlineFired;
      cover = { kind: "default", node: coverResult.node, authoritative };
    }

    if (parentAborted || signal.aborted) {
      disposePreparedBrowseMedia({ peerId, mediaKey, peer: player, avatar, cover });
      return { ok: false, reason: "aborted" };
    }

    // Honest fallback settle: no second in-function request; non-authoritative default may be retried by prewarm.
    return { ok: true, media: { peerId, mediaKey, peer: player, avatar, cover } };
  } catch {
    if (parentAborted || signal.aborted) {
      disposePreparedBrowseMedia({ peerId, mediaKey, peer: player, avatar, cover });
      return { ok: false, reason: "aborted" };
    }
    disposePreparedBrowseMedia({ peerId, mediaKey, peer: player, avatar, cover });
    return { ok: false, reason: "unavailable" };
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onParentAbort);
  }
}

type RadarMediaSlot = { sessionKey: string; media: PreparedBrowsePeerMedia };
type RadarInflight = {
  key: string;
  abort: AbortController;
  listeners: Set<() => void>;
  retainIds: ReadonlySet<string>;
};
const radarMediaByPeer = new Map<string, RadarMediaSlot>();
const radarMediaInflight = new Map<string, RadarInflight>();
const radarMediaListeners = new Set<() => void>();
let radarMediaSessionKey = "";
let radarMediaEpoch = 0;

/** Union of pending + retained peers currently occupying the Radar media budget. */
export function radarPreparedMediaOccupancy(): { retained: string[]; pending: string[] } {
  return {
    retained: [...radarMediaByPeer.keys()],
    pending: [...radarMediaInflight.keys()],
  };
}

function radarMediaOccupiedCount() {
  const ids = new Set<string>([...radarMediaByPeer.keys(), ...radarMediaInflight.keys()]);
  return ids.size;
}

/**
 * Make room for `admitId` under RADAR_PIN_MEDIA_CAP across pending+completed.
 * Aborts evicted pending before a new GET starts; never disposes retainIds (selected/visible).
 */
function admitRadarMediaPeer(admitId: string, retainIds: ReadonlySet<string>): boolean {
  const protect = new Set(retainIds);
  protect.add(admitId);
  while (radarMediaOccupiedCount() >= RADAR_PIN_MEDIA_CAP && !radarMediaByPeer.has(admitId) && !radarMediaInflight.has(admitId)) {
    const pendingVictim = [...radarMediaInflight.keys()].find(id => !protect.has(id));
    if (pendingVictim) {
      const inflight = radarMediaInflight.get(pendingVictim)!;
      inflight.abort.abort();
      radarMediaInflight.delete(pendingVictim);
      continue;
    }
    const retainedVictim = [...radarMediaByPeer.keys()].find(id => !protect.has(id));
    if (retainedVictim) {
      const slot = radarMediaByPeer.get(retainedVictim);
      radarMediaByPeer.delete(retainedVictim);
      disposePreparedBrowseMedia(slot?.media);
      continue;
    }
    // Every slot is protected — cannot admit another peer.
    return false;
  }
  return true;
}

function notifyRadarMediaReady() {
  for (const listener of [...radarMediaListeners]) listener();
}

/** Subscribe to Radar prepared-media commit/eviction (end-of-load, not a fixed timeout). */
export function subscribeRadarPreparedMedia(listener: () => void) {
  radarMediaListeners.add(listener);
  return () => { radarMediaListeners.delete(listener); };
}

/** Drop retained Radar pin media; optional keep predicate for still-authorized peers. */
export function clearRadarPreparedMedia(keep?: (peerId: string) => boolean) {
  for (const [peerId, slot] of [...radarMediaByPeer.entries()]) {
    if (keep?.(peerId)) continue;
    radarMediaByPeer.delete(peerId);
    disposePreparedBrowseMedia(slot.media);
  }
  for (const [peerId, inflight] of [...radarMediaInflight.entries()]) {
    if (keep?.(peerId)) continue;
    inflight.abort.abort();
    radarMediaInflight.delete(peerId);
  }
  if (!keep) {
    radarMediaSessionKey = "";
    radarMediaEpoch += 1;
  }
  notifyRadarMediaReady();
}

export function takeRadarPreparedMedia(peerId: string, mediaKey?: string, sessionKey = radarMediaSessionKey): PreparedBrowsePeerMedia | null {
  const hit = radarMediaByPeer.get(peerId);
  if (!hit || hit.sessionKey !== sessionKey) return null;
  if (mediaKey && hit.media.mediaKey !== mediaKey) return null;
  return hit.media;
}

/** True when prepared cover/avatar still matches a freshly loaded public profile. */
export function preparedMediaFitsPublicPlayer(media: PreparedBrowsePeerMedia, player: PublicPlayer): boolean {
  if (media.peerId !== player.publicPlayerId) return false;
  if (media.avatar.kind === "image") {
    const src = media.avatar.src;
    if (src !== player.avatar?.uploadedUrl && src !== player.avatar?.providerUrl) return false;
  }
  if (media.cover.kind === "uploaded") {
    return player.cover?.uploadedUrl === media.cover.src;
  }
  // Timeout/load fallback must not satisfy warm/profile readiness when an uploaded cover exists.
  if (media.cover.authoritative === false) return false;
  // Authoritative default/empty prepared cover is valid only when the profile has no uploaded cover.
  return !player.cover?.uploadedUrl;
}

/**
 * Bounded prewarm for authorized Radar pins.
 * Public GET cover metadata is allowed for known authorized peers (resolveCover);
 * never speculative private proofs. Same peer+mediaKey+cover intent reuses inflight
 * work instead of abort/restart on every render. Cap applies to pending+retained union;
 * hover/focus must call this same admission path.
 */
export function prewarmRadarPeerMedia(
  player: PublicPlayer,
  options?: {
    resolveCover?: boolean;
    deadlineMs?: number;
    sessionKey?: string;
    onReady?: () => void;
    /** Selected / currently visible prepared peers — never dispose these while evicting. */
    retainIds?: readonly string[];
  },
) {
  if (typeof document === "undefined") return;
  const sessionKey = options?.sessionKey ?? radarMediaSessionKey;
  if (sessionKey !== radarMediaSessionKey) {
    clearRadarPreparedMedia();
    radarMediaSessionKey = sessionKey;
  }
  const resolveCover = options?.resolveCover === true;
  const mediaKey = browsePeerMediaKey(player);
  const inflightKey = `${player.publicPlayerId}|${mediaKey}|${resolveCover ? "cover" : "avatar"}`;
  const retainIds = new Set(options?.retainIds ?? []);
  const existing = radarMediaByPeer.get(player.publicPlayerId);
  const authoritativeDefault = existing?.media.cover.kind === "default"
    && existing.media.cover.authoritative !== false
    && !player.cover?.uploadedUrl;
  const coverReady = existing?.media.cover.kind === "uploaded"
    || (player.cover && "uploadedUrl" in player.cover && player.cover.uploadedUrl === null)
    || authoritativeDefault;
  if (existing?.sessionKey === sessionKey && existing.media.mediaKey === mediaKey && (!resolveCover || coverReady)) {
    options?.onReady?.();
    return;
  }
  const prior = radarMediaInflight.get(player.publicPlayerId);
  if (prior) {
    // Same immutable key: join listeners; do not abort/restart.
    if (prior.key === inflightKey) {
      if (options?.onReady) prior.listeners.add(options.onReady);
      return;
    }
    prior.abort.abort();
    radarMediaInflight.delete(player.publicPlayerId);
  }
  // Enforce union cap before starting a new GET (abort evicted pending first).
  if (!admitRadarMediaPeer(player.publicPlayerId, retainIds)) return;
  const work = new AbortController();
  const listeners = new Set<() => void>();
  if (options?.onReady) listeners.add(options.onReady);
  const inflight: RadarInflight = { key: inflightKey, abort: work, listeners, retainIds };
  radarMediaInflight.set(player.publicPlayerId, inflight);
  const epoch = radarMediaEpoch;
  void prepareBrowsePeerMedia(player, work.signal, options?.deadlineMs ?? RADAR_PIN_MEDIA_DEADLINE_MS, {
    resolveCover,
  }).then(result => {
    if (radarMediaInflight.get(player.publicPlayerId) !== inflight) {
      // Orphan successful completion after cancel/eviction — dispose pixels.
      if (result.ok) disposePreparedBrowseMedia(result.media);
      return;
    }
    radarMediaInflight.delete(player.publicPlayerId);
    if (!result.ok || radarMediaSessionKey !== sessionKey || epoch !== radarMediaEpoch) {
      if (result.ok) disposePreparedBrowseMedia(result.media);
      for (const listener of listeners) listener();
      notifyRadarMediaReady();
      return;
    }
    const previous = radarMediaByPeer.get(player.publicPlayerId);
    if (previous && previous.media !== result.media) disposePreparedBrowseMedia(previous.media);
    radarMediaByPeer.set(player.publicPlayerId, { sessionKey, media: result.media });
    // Cap retained nodes; never dispose selected/visible retainIds or the peer just completed.
    const protect = new Set(retainIds);
    protect.add(player.publicPlayerId);
    while (radarMediaByPeer.size + radarMediaInflight.size > RADAR_PIN_MEDIA_CAP) {
      const victim = [...radarMediaByPeer.keys()].find(id => !protect.has(id));
      if (!victim) break;
      const slot = radarMediaByPeer.get(victim);
      radarMediaByPeer.delete(victim);
      disposePreparedBrowseMedia(slot?.media);
    }
    for (const listener of listeners) listener();
    notifyRadarMediaReady();
  });
}

/**
 * Choose up to `cap` authorized peers for prewarm: selected first, then pin/row order.
 */
export function selectRadarMediaPrewarmPeers<T extends { publicPlayerId: string }>(
  peers: T[],
  selectedId: string | null | undefined,
  cap = RADAR_PIN_MEDIA_CAP,
): T[] {
  if (peers.length === 0 || cap <= 0) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  const push = (peer: T) => {
    if (seen.has(peer.publicPlayerId) || out.length >= cap) return;
    seen.add(peer.publicPlayerId);
    out.push(peer);
  };
  if (selectedId) {
    const selected = peers.find(peer => peer.publicPlayerId === selectedId);
    if (selected) push(selected);
  }
  for (const peer of peers) push(peer);
  return out;
}

/** Mount a retained decoded <img> into a React host without remounting a new fetch. */
export function RetainedBrowseImage({
  node,
  className,
}: {
  node: HTMLImageElement;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (className) node.className = className;
    host.replaceChildren(node);
    return () => {
      if (node.parentElement === host) host.removeChild(node);
    };
  }, [node, className]);
  return <span ref={hostRef} style={{ display: "contents" }} />;
}

export function PreparedBrowseAvatar({
  media,
  name,
  tone = "yellow",
  className,
}: {
  media: PreparedBrowseAvatar | null;
  name: string;
  tone?: "lime" | "purple" | "yellow";
  className?: string;
}) {
  const cls = className ?? `avatar avatar--${tone}`;
  if (!media || media.kind === "initials") {
    return <span className={cls} aria-hidden="true">{media?.text ?? initialsFromName(name)}</span>;
  }
  return (
    <span className={cls} aria-hidden="true">
      <RetainedBrowseImage node={media.node} />
    </span>
  );
}

export function PreparedBrowseCover({ media }: { media: PreparedBrowseCover | null }) {
  if (media?.kind === "uploaded") {
    return (
      <div className="profile-cover" data-cover="uploaded">
        <RetainedBrowseImage node={media.node} />
      </div>
    );
  }
  if (media?.kind === "default" && media.node) {
    return (
      <div className="profile-cover" data-cover="default">
        <RetainedBrowseImage node={media.node} className="profile-cover__fallback" />
      </div>
    );
  }
  // Terminal settle with no decoded node: CSS surface only — no fresh image request.
  return <div className="profile-cover" data-cover="default" data-cover-settled="empty" />;
}

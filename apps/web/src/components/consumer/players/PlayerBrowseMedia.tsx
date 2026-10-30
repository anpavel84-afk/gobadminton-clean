"use client";

import { useLayoutEffect, useRef } from "react";
import { getPlayer } from "../../../lib/api-client";
import type { PlayerAvatar, PublicPlayer } from "../../../lib/consumer-types";
import { initialsFromName } from "../../../lib/player-presentation";
import { safeAvatarUrl } from "./ProfileComposition";

/** End-to-end bound for metadata + image load/decode before fallback settle. */
export const PLAYER_BROWSE_MEDIA_DEADLINE_MS = 5000;

const DEFAULT_COVER_SRC = "/canonical/ce252.svg";
const COVER_URL_RE = /^\/v1\/media\/covers\/[a-f0-9]{64}\.png$/;

export function isSafeBrowseCoverUrl(raw: string): boolean {
  return COVER_URL_RE.test(raw);
}

export type PreparedBrowseAvatar =
  | { kind: "image"; src: string; node: HTMLImageElement }
  | { kind: "initials"; text: string };

export type PreparedBrowseCover =
  | { kind: "uploaded"; src: string; node: HTMLImageElement }
  | { kind: "default"; node: HTMLImageElement | null };

export type PreparedBrowsePeerMedia = {
  peerId: string;
  avatar: PreparedBrowseAvatar;
  cover: PreparedBrowseCover;
};

export type PrepareBrowsePeerResult =
  | { ok: true; media: PreparedBrowsePeerMedia }
  | { ok: false; reason: "aborted" | "unauthorized" | "unavailable" };

export function browseMediaNeighborhood(index: number, length: number): number[] {
  if (length <= 0 || index < 0 || index >= length) return [];
  const out: number[] = [];
  for (const i of [index - 1, index, index + 1]) {
    if (i >= 0 && i < length && !out.includes(i)) out.push(i);
  }
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
    (url): url is string => Boolean(url) && safeAvatarUrl(url),
  );
  for (const src of candidates) {
    if (signal.aborted) break;
    const node = await loadRetainedImage(src, signal, { referrerPolicy: "no-referrer" });
    if (node) return { kind: "image", src, node };
  }
  return { kind: "initials", text: initialsFromName(name) };
}

async function prepareDefaultCoverNode(signal: AbortSignal): Promise<HTMLImageElement | null> {
  return loadRetainedImage(DEFAULT_COVER_SRC, signal, {
    className: "profile-cover__fallback",
    alt: "",
  });
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
  const fallback = await prepareDefaultCoverNode(signal);
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
): Promise<PrepareBrowsePeerResult> {
  const peerId = player.publicPlayerId;
  if (signal.aborted) return { ok: false, reason: "aborted" };

  const work = new AbortController();
  let parentAborted = false;
  const onParentAbort = () => {
    parentAborted = true;
    work.abort();
  };
  signal.addEventListener("abort", onParentAbort);
  const timer = window.setTimeout(() => work.abort(), deadlineMs);

  let avatar: PreparedBrowseAvatar = { kind: "initials", text: initialsFromName(player.displayName) };
  let cover: PreparedBrowseCover = { kind: "default", node: null };

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
    } else {
      const meta = await resolveBrowseCoverUrl(player, work.signal);
      if (parentAborted || signal.aborted) {
        await avatarPromise.catch(() => undefined);
        disposePreparedBrowseMedia({ peerId, avatar, cover });
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
      // Deadline abort during GET: settle with default cover (coverMetaReady stays false).
    }

    if (authFail) {
      await avatarPromise.catch(() => undefined);
      disposePreparedBrowseMedia({ peerId, avatar, cover });
      return { ok: false, reason: authFail };
    }

    const settleFallbackSignal = () => {
      const fallback = new AbortController();
      window.setTimeout(() => fallback.abort(), Math.min(2000, deadlineMs));
      return fallback.signal;
    };

    const coverWork = work.signal.aborted && !parentAborted
      ? prepareCoverFromUrl(coverMetaReady ? coverUrl : null, settleFallbackSignal())
      : prepareCoverFromUrl(coverMetaReady ? coverUrl : null, work.signal);

    const [coverResult] = await Promise.all([coverWork, avatarPromise.catch(() => undefined)]);
    cover = coverResult;

    if (parentAborted || signal.aborted) {
      disposePreparedBrowseMedia({ peerId, avatar, cover });
      return { ok: false, reason: "aborted" };
    }

    // Timed-out primary loads must not paint later: work is aborted; only settled nodes remain.
    if (cover.kind === "default" && !cover.node && !parentAborted) {
      cover = {
        kind: "default",
        node: await prepareDefaultCoverNode(settleFallbackSignal()),
      };
    }

    return { ok: true, media: { peerId, avatar, cover } };
  } catch {
    if (parentAborted || signal.aborted) {
      disposePreparedBrowseMedia({ peerId, avatar, cover });
      return { ok: false, reason: "aborted" };
    }
    disposePreparedBrowseMedia({ peerId, avatar, cover });
    return { ok: false, reason: "unavailable" };
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onParentAbort);
  }
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
  return (
    <div className="profile-cover" data-cover="default">
      <img src={DEFAULT_COVER_SRC} alt="" className="profile-cover__fallback" />
    </div>
  );
}

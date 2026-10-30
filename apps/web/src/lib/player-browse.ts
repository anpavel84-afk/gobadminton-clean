import type { FriendshipView } from "@gobadminton/contracts/friendship-types";
import type { PublicPlayer } from "./consumer-types";

export type PlayerBrowseView = "list" | "cards";
export type PlayerBrowseSlideDirection = "next" | "prev";

/** Desktop directory / deck composition (Owner v5). Mobile keeps existing <1024 layout. */
export const PLAYER_BROWSE_DESKTOP_MQ = "(min-width: 1024px)";
/** Visible horizontal player change on desktop; reduced-motion uses 0. */
export const PLAYER_BROWSE_SLIDE_MS = 240;

export const PLAYER_BROWSE_TUTORIAL_KEY = "gb-player-gallery-tutorial-v2";
export const PLAYER_BROWSE_HISTORY_KEY = "gbPlayerBrowse";

export function browseSlideDurationMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : PLAYER_BROWSE_SLIDE_MS;
}

export function browseSlideDirection(fromIndex: number, toIndex: number): PlayerBrowseSlideDirection | null {
  if (toIndex === fromIndex) return null;
  return toIndex > fromIndex ? "next" : "prev";
}

export function prefersBrowseReducedMotion(
  media: Pick<MediaQueryList, "matches"> | null | undefined,
): boolean {
  return Boolean(media?.matches);
}

export type PlayerBrowseHistoryState = {
  id: string;
  scope: string;
};

/** SSR and first client paint stay on list; URL `view=cards` applies after mount. */
export function parseBrowseView(search: string | URLSearchParams | null | undefined): PlayerBrowseView {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search ?? new URLSearchParams();
  return params.get("view") === "cards" ? "cards" : "list";
}

export function writeBrowseViewSearch(search: string, view: PlayerBrowseView): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (view === "cards") params.set("view", "cards");
  else params.delete("view");
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function readTutorialDismissed(storage: Pick<Storage, "getItem"> | null | undefined, memory: boolean): boolean {
  if (memory) return true;
  try {
    return storage?.getItem(PLAYER_BROWSE_TUTORIAL_KEY) === "1";
  } catch {
    return memory;
  }
}

export function persistTutorialDismissed(storage: Pick<Storage, "setItem"> | null | undefined): boolean {
  try {
    storage?.setItem(PLAYER_BROWSE_TUTORIAL_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function swipeThresholdPx(width: number): number {
  return Math.max(84, Math.min(120, width * 0.24));
}

/** Horizontal intent after 10px travel with 1.5× dominance; release needs threshold. */
export function classifyPointerGesture(input: {
  dx: number;
  dy: number;
  width: number;
  phase: "move" | "release";
}): "none" | "horizontal" | "skip" | "request" {
  const absX = Math.abs(input.dx);
  const absY = Math.abs(input.dy);
  if (input.phase === "move") {
    if (absX < 10 && absY < 10) return "none";
    return absX > absY * 1.5 ? "horizontal" : "none";
  }
  const threshold = swipeThresholdPx(input.width);
  if (absX < threshold || absX <= absY * 1.5) return "none";
  return input.dx < 0 ? "skip" : "request";
}

export function isBrowseDragExcludedTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest("button,a,input,select,textarea,summary,label,[data-browse-no-drag]"));
}

/** Ordinary catalog only — never Radar private rows. */
export function ordinaryBrowsePlayers(players: PublicPlayer[], ownPublicPlayerId?: string | null): PublicPlayer[] {
  const own = ownPublicPlayerId?.trim() || "";
  return players.filter(player => !own || player.publicPlayerId !== own);
}

export function indexOfBrowsePlayer(players: PublicPlayer[], id: string | null | undefined): number {
  if (!id) return -1;
  return players.findIndex(player => player.publicPlayerId === id);
}

export function readBrowseHistoryState(state: unknown, scope: string): PlayerBrowseHistoryState | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as Record<string, unknown>)[PLAYER_BROWSE_HISTORY_KEY];
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as Record<string, unknown>).id;
  const savedScope = (raw as Record<string, unknown>).scope;
  if (typeof id !== "string" || typeof savedScope !== "string" || savedScope !== scope || !id) return null;
  return { id, scope: savedScope };
}

export function withBrowseHistoryState(state: unknown, value: PlayerBrowseHistoryState | null): object {
  const base = state && typeof state === "object" ? { ...(state as object) } as Record<string, unknown> : {};
  if (value) base[PLAYER_BROWSE_HISTORY_KEY] = value;
  else delete base[PLAYER_BROWSE_HISTORY_KEY];
  return base;
}

export function relationshipBlocksNewRequest(relationship: FriendshipView["relationship"] | undefined): boolean {
  return relationship === "outgoing_pending" || relationship === "incoming_pending"
    || relationship === "friends" || relationship === "unavailable";
}

/** Auto-advance after confirmed request: next peer that is still open for a new request. */
export function nextEligibleBrowseIndex(
  players: PublicPlayer[],
  fromIndex: number,
  known: ReadonlyMap<string, FriendshipView["relationship"]>,
  skipped: ReadonlySet<string>,
): number {
  if (players.length <= 1) return -1;
  for (let offset = 1; offset < players.length; offset += 1) {
    const index = (fromIndex + offset) % players.length;
    if (index === fromIndex) continue;
    const player = players[index];
    if (!player || skipped.has(player.publicPlayerId)) continue;
    const relationship = known.get(player.publicPlayerId);
    if (relationshipBlocksNewRequest(relationship)) continue;
    return index;
  }
  return -1;
}

export function canOfferFriendship(view: FriendshipView | null | undefined): boolean {
  return Boolean(view?.capabilities.canRequest && view.relationship === "none");
}

export type BrowseSkipStack = string[];

export function pushSkip(stack: BrowseSkipStack, id: string): BrowseSkipStack {
  if (!id || stack[stack.length - 1] === id) return stack;
  return [...stack, id];
}

export function popSkip(stack: BrowseSkipStack): { stack: BrowseSkipStack; id: string | null } {
  if (!stack.length) return { stack, id: null };
  const next = stack.slice(0, -1);
  return { stack: next, id: stack[stack.length - 1] ?? null };
}

/** Normalize bio whitespace before details pagination. */
export function normalizeBrowseBio(bio: string | null | undefined): string {
  return (bio ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Split a details bio into complete, non-overlapping word-boundary chunks
 * for the fixed-size desktop banner pager (no clipped/repeated same page).
 */
export function chunkBrowseBio(bio: string, maxChars: number): string[] {
  const text = normalizeBrowseBio(bio);
  if (!text) return [];
  if (maxChars <= 0 || text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const remaining = text.length - start;
    if (remaining <= maxChars) {
      chunks.push(text.slice(start));
      break;
    }
    const hardEnd = start + maxChars;
    let breakAt = text.lastIndexOf(" ", hardEnd);
    if (breakAt <= start) breakAt = hardEnd;
    const piece = text.slice(start, breakAt).trimEnd();
    if (!piece) {
      chunks.push(text.slice(start, hardEnd));
      start = hardEnd;
      continue;
    }
    chunks.push(piece);
    start = breakAt;
    while (text[start] === " ") start += 1;
  }
  return chunks;
}

/** Reconstruct normalized bio from pager chunks (space-joined). */
export function reconstructBrowseBio(chunks: readonly string[]): string {
  return normalizeBrowseBio(chunks.join(" "));
}

/** Estimate first-chunk capacity from a full-bio overflow measure. */
export function estimateBrowseBioChunkChars(
  bioLength: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  if (bioLength <= 0) return 0;
  if (scrollHeight <= clientHeight + 2) return bioLength;
  const ratio = clientHeight / Math.max(scrollHeight, 1);
  return Math.max(24, Math.floor(bioLength * ratio * 0.9));
}

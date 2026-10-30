import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicPlayer } from "../src/lib/consumer-types";
import {
  browseMediaNeighborhood,
  browsePeerMediaKey,
  isSafeBrowseCoverUrl,
  nextBrowseIntentAfterFailure,
  PLAYER_BROWSE_MEDIA_DEADLINE_MS,
  PreparedBrowseCover,
} from "../src/components/consumer/players/PlayerBrowseMedia";
import {
  browseSlideDirection,
  browseSlideDurationMs,
  chunkBrowseBio,
  classifyPointerGesture,
  estimateBrowseBioChunkChars,
  indexOfBrowsePlayer,
  isBrowseDragExcludedTarget,
  nextEligibleBrowseIndex,
  normalizeBrowseBio,
  ordinaryBrowsePlayers,
  parseBrowseView,
  PLAYER_BROWSE_DESKTOP_MQ,
  PLAYER_BROWSE_SLIDE_MS,
  popSkip,
  prefersBrowseReducedMotion,
  pushSkip,
  readBrowseHistoryState,
  readTutorialDismissed,
  reconstructBrowseBio,
  relationshipBlocksNewRequest,
  swipeMinTravelPx,
  swipeThresholdPx,
  withBrowseHistoryState,
  writeBrowseViewSearch,
  PLAYER_BROWSE_FLICK_VELOCITY,
  PLAYER_BROWSE_HISTORY_KEY,
  PLAYER_BROWSE_TUTORIAL_KEY,
} from "../src/lib/player-browse";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deckSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowseDeck.tsx"), "utf8");
const mediaSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowseMedia.tsx"), "utf8");
const pageSource = readFileSync(join(root, "src/components/consumer/pages/PlayersDirectoryPage.tsx"), "utf8");
const toolbarSource = readFileSync(join(root, "src/components/consumer/players/PlayersDirectoryToolbar.tsx"), "utf8");
const radarSource = readFileSync(join(root, "src/components/consumer/radar/RadarControls.tsx"), "utf8");
const cssSource = readFileSync(join(root, "src/styles/player-browse.css"), "utf8");
const friendshipSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowseFriendship.tsx"), "utf8");

const player = (id: string): PublicPlayer => ({
  publicPlayerId: id,
  displayName: id,
  cityId: null,
  areaKey: null,
  level: null,
  bio: null,
  trainer: false,
  lookingForGame: false,
});

describe("player browse view URL", () => {
  it("defaults to list and selects cards only for explicit view=cards", () => {
    expect(parseBrowseView("")).toBe("list");
    expect(parseBrowseView("?cityId=1")).toBe("list");
    expect(parseBrowseView("?view=list")).toBe("list");
    expect(parseBrowseView("?view=cards")).toBe("cards");
    expect(writeBrowseViewSearch("?cityId=1", "cards")).toBe("?cityId=1&view=cards");
    expect(writeBrowseViewSearch("?view=cards&cityId=1", "list")).toBe("?cityId=1");
  });
});

describe("player browse navigation and skip order", () => {
  it("excludes self and restores history id only inside matching scope", () => {
    const rows = ordinaryBrowsePlayers([player("a"), player("me"), player("b")], "me");
    expect(rows.map(r => r.publicPlayerId)).toEqual(["a", "b"]);
    expect(indexOfBrowsePlayer(rows, "b")).toBe(1);
    expect(readBrowseHistoryState({ [PLAYER_BROWSE_HISTORY_KEY]: { id: "b", scope: "s1" } }, "s1")?.id).toBe("b");
    expect(readBrowseHistoryState({ [PLAYER_BROWSE_HISTORY_KEY]: { id: "b", scope: "old" } }, "s1")).toBeNull();
    expect(withBrowseHistoryState({}, { id: "a", scope: "s1" })).toMatchObject({ [PLAYER_BROWSE_HISTORY_KEY]: { id: "a", scope: "s1" } });
  });

  it("push/pop skip keeps LIFO order without clearing unrelated stack entries", () => {
    const once = pushSkip([], "a");
    const twice = pushSkip(once, "b");
    expect(twice).toEqual(["a", "b"]);
    expect(popSkip(twice)).toEqual({ stack: ["a"], id: "b" });
    expect(popSkip([])).toEqual({ stack: [], id: null });
  });

  it("auto-next skips known non-eligible peers and respects local skips", () => {
    const rows = [player("a"), player("b"), player("c"), player("d")];
    const known = new Map([
      ["b", "outgoing_pending" as const],
      ["c", "friends" as const],
    ]);
    expect(nextEligibleBrowseIndex(rows, 0, known, new Set())).toBe(3);
    expect(nextEligibleBrowseIndex(rows, 0, known, new Set(["d"]))).toBe(-1);
    expect(relationshipBlocksNewRequest("incoming_pending")).toBe(true);
    expect(relationshipBlocksNewRequest("none")).toBe(false);
  });
});

describe("player browse swipe boundaries", () => {
  it("locks axis with dominance; distance or same-direction flick commits; cancel/vertical stay none for horizontal", () => {
    expect(swipeThresholdPx(400)).toBe(80);
    expect(swipeMinTravelPx(400)).toBe(24);
    expect(classifyPointerGesture({ dx: 8, dy: 0, width: 400, phase: "move" })).toBe("none");
    expect(classifyPointerGesture({ dx: 30, dy: 5, width: 400, phase: "move" })).toBe("horizontal");
    expect(classifyPointerGesture({ dx: 5, dy: 30, width: 400, phase: "move" })).toBe("vertical");
    expect(classifyPointerGesture({ dx: 30, dy: 40, width: 400, phase: "move" })).toBe("none");
    expect(classifyPointerGesture({ dx: -30, dy: 0, width: 400, phase: "release" })).toBe("none");
    expect(classifyPointerGesture({ dx: -80, dy: 10, width: 400, phase: "release", lockedAxis: "horizontal" })).toBe("skip");
    expect(classifyPointerGesture({ dx: 80, dy: 10, width: 400, phase: "release", lockedAxis: "horizontal" })).toBe("request");
    expect(classifyPointerGesture({ dx: 100, dy: 90, width: 400, phase: "release" })).toBe("none");
    // Fast short flick with minimum travel commits; reverse velocity does not.
    expect(classifyPointerGesture({
      dx: -28, dy: 0, width: 400, phase: "release", lockedAxis: "horizontal", velocity: -PLAYER_BROWSE_FLICK_VELOCITY,
    })).toBe("skip");
    expect(classifyPointerGesture({
      dx: -28, dy: 0, width: 400, phase: "release", lockedAxis: "horizontal", velocity: PLAYER_BROWSE_FLICK_VELOCITY,
    })).toBe("none");
    // Vertical release reports up/down; not a horizontal mutation.
    expect(swipeThresholdPx(700)).toBe(88);
    expect(classifyPointerGesture({
      dx: 4, dy: -90, width: 400, height: 700, phase: "release", lockedAxis: "vertical",
    })).toBe("vertical-up");
    expect(classifyPointerGesture({
      dx: 4, dy: 90, width: 400, height: 700, phase: "release", lockedAxis: "vertical",
    })).toBe("vertical-down");
    expect(classifyPointerGesture({
      dx: 4, dy: -90, width: 400, height: 700, phase: "release", lockedAxis: "horizontal",
    })).toBe("none");
  });

  it("excludes interactive targets from drag start", () => {
    const rootEl = { closest: (sel: string) => (sel.includes("button") ? {} : null) } as unknown as Element;
    expect(isBrowseDragExcludedTarget(rootEl)).toBe(true);
    expect(isBrowseDragExcludedTarget(null)).toBe(false);
  });

  it("mobile fullscreen cards use portal shell, body lock hooks, and 1:1 drag without damping", () => {
    expect(pageSource).toContain("createPortal");
    expect(pageSource).toContain("pb-mobile-fs");
    expect(pageSource).toContain("closeMobileCards");
    expect(deckSource).toContain("--pb-drag-x");
    expect(deckSource).not.toContain("* 0.32");
    expect(deckSource).toContain("touchAction");
    expect(deckSource).toContain("setPointerCapture");
    expect(deckSource).toContain("flyOffCard");
    expect(deckSource).toContain("awaitingRightRef");
    expect(cssSource).toContain("pb-mobile-fs");
    expect(cssSource).toContain("touch-action: none");
    expect(cssSource).toContain("pb-intent--skip");
  });
});

describe("player browse tutorial marker", () => {
  it("reads versioned boolean only and falls back to memory", () => {
    const storage = {
      getItem: (key: string) => (key === PLAYER_BROWSE_TUTORIAL_KEY ? "1" : null),
    };
    expect(readTutorialDismissed(storage, false)).toBe(true);
    expect(readTutorialDismissed({ getItem: () => null }, true)).toBe(true);
    expect(readTutorialDismissed({ getItem: () => { throw new Error("denied"); } }, false)).toBe(false);
  });

  it("keeps inert on card surface only so the tutorial stays interactive", () => {
    expect(deckSource).toMatch(/className="pb-surface"\s+inert=\{showHelp \? true : undefined\}/);
    expect(deckSource).toMatch(/className="pb-deck"/);
    const deckOpen = deckSource.indexOf('className="pb-deck"');
    const surfaceInert = deckSource.indexOf('className="pb-surface" inert={showHelp ? true : undefined}');
    const tutorial = deckSource.indexOf('className="pb-tutorial"');
    expect(deckOpen).toBeGreaterThan(-1);
    expect(surfaceInert).toBeGreaterThan(deckOpen);
    expect(tutorial).toBeGreaterThan(surfaceInert);
    // Tutorial must not sit inside the inert surface block that closes before the shade.
    const surfaceCloseBeforeTutorial = deckSource.slice(surfaceInert, tutorial);
    expect(surfaceCloseBeforeTutorial).toContain("</div>}");
    expect(surfaceCloseBeforeTutorial).toMatch(/pb-controls|pb-profile-bottom|pb-friend-slot/);
  });

  it("ignores cancel/decline receipts in onConfirmedRequest toast/auto-advance", () => {
    expect(deckSource).toMatch(/if \(!isBrowseConfirmedRequestOutcome\(receipt\.outcome\)\) return/);
  });
});

describe("player browse desktop v5 contracts", () => {
  it("uses one shared toolbar path for list and cards on desktop", () => {
    expect(pageSource).toContain("PlayersDirectoryToolbar");
    expect(pageSource).toMatch(/desktop \? desktopToolbar/);
    expect(toolbarSource).toContain("RadarSwitchControl");
    expect(toolbarSource).toContain('presentation="directory-desktop"');
    expect(toolbarSource).toContain('presentation="directory-compact"');
    expect(toolbarSource).toContain("aria-expanded");
    expect(toolbarSource).toContain("Escape");
    expect(pageSource).toContain("PLAYER_BROWSE_DESKTOP_MQ");
    expect(PLAYER_BROWSE_DESKTOP_MQ).toBe("(min-width: 1024px)");
  });

  it("chunks long details bios without repeating clipped text; short bio stays single page", () => {
    const short = "Ищу партнёров для парных игр по вечерам.";
    expect(chunkBrowseBio(short, 180)).toEqual([short]);
    expect(chunkBrowseBio(short, 180).length).toBe(1);

    const long = normalizeBrowseBio(
      "Тестовый профиль DEV. Играю в Хамовниках по выходным, предпочитаю смешанные пары и дружеский темп. "
      + "Рада буду познакомиться на корте и договориться о спокойной игре после работы. "
      + "Люблю ровный темп, понятные договорённости и открытый публичный профиль без выдуманных игр.",
    );
    expect(long.length).toBeGreaterThan(180);
    const chunks = chunkBrowseBio(long, 90);
    expect(chunks.length).toBeGreaterThan(1);
    expect(reconstructBrowseBio(chunks)).toBe(long);
    const first = chunks[0] ?? "";
    expect(first.length).toBeGreaterThan(0);
    expect(chunks.join("")).not.toContain(first + first);
    expect(estimateBrowseBioChunkChars(long.length, 100, 220)).toBeLessThan(long.length);
    expect(estimateBrowseBioChunkChars(long.length, 200, 200)).toBe(long.length);
    expect(deckSource).toContain("chunkBrowseBio");
    expect(deckSource).toContain("bioChunks.length > 1");
    expect(deckSource).toContain('data-reserved="true"');
    expect(deckSource).toContain("pb-profile-link--heading");
    expect(deckSource).toContain("Публичные ближайшие игры этого игрока пока недоступны.");
    expect(deckSource).not.toContain("Публичные игры пока не указаны.");
    expect(radarSource).toContain("directory-desktop");
    expect(radarSource).toContain("radar-dir-switch");
    expect(cssSource).toContain("radar-dir-switch");
    expect(cssSource).toContain("pb-details-bio");
    expect(cssSource).toContain("pb-expanded-heading-actions");
  });

  it("desktop skips gestures while mobile keeps pointer handlers and tutorial gate", () => {
    expect(deckSource).toMatch(/if \(desktop\) return;/);
    expect(deckSource).toContain("addEventListener(\"pointerdown\"");
    expect(deckSource).toMatch(/if \(desktop\) \{\s*setTutorialOpen\(false\)/);
    expect(deckSource).toContain('chrome={desktop ? "desktop" : "mobile"}');
    expect(friendshipSource).toContain('chrome = "mobile"');
    expect(friendshipSource).toContain("Добавить в друзья");
  });

  it("locks details geometry via CSS contract for normal and expanded", () => {
    expect(cssSource).toMatch(/\.pb-card--desktop\s*\{[^}]*height:\s*clamp\(400px,\s*calc\(100dvh - 380px\),\s*760px\)/s);
    expect(cssSource).toContain(".pb-card--desktop.is-expanded");
    expect(cssSource).toMatch(/\.pb-surface\s*\{[^}]*height:\s*clamp\(400px,\s*calc\(100dvh - 380px\),\s*760px\)/s);
    expect(deckSource).toContain('data-details={detailsOpen ? "open" : "closed"}');
    expect(deckSource).toContain("pb-collapse-details");
  });

  it("animates explicit next/prev direction, honors reduced motion, and cancels safely", () => {
    expect(browseSlideDirection(0, 1)).toBe("next");
    expect(browseSlideDirection(2, 1)).toBe("prev");
    expect(browseSlideDirection(1, 1)).toBeNull();
    expect(PLAYER_BROWSE_SLIDE_MS).toBeGreaterThanOrEqual(200);
    expect(PLAYER_BROWSE_SLIDE_MS).toBeLessThanOrEqual(280);
    expect(browseSlideDurationMs(false)).toBe(PLAYER_BROWSE_SLIDE_MS);
    expect(browseSlideDurationMs(true)).toBe(0);
    expect(prefersBrowseReducedMotion({ matches: true })).toBe(true);
    expect(prefersBrowseReducedMotion({ matches: false })).toBe(false);
    expect(deckSource).toContain("setSlideDir(direction)");
    expect(deckSource).toContain("slideGen.current");
    expect(deckSource).toContain("reducedMotionRef");
    expect(deckSource).toContain("slideFrameRef");
    expect(deckSource).toContain("cancelSlideAnimation");
    expect(deckSource).toContain("frame.animate");
    expect(deckSource).toContain("getAnimations()");
    expect(deckSource).toContain("runSlideAfterCommit");
    expect(deckSource).toMatch(/moveTo\(intentIndex \+ 1, "next"\)/);
    expect(deckSource).toMatch(/moveTo\(intentIndex - 1, "prev"\)/);
    expect(cssSource).toContain("is-sliding-next");
    expect(cssSource).toContain("is-sliding-prev");
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("prepares bounded neighborhood media before identity commit", () => {
    expect(PLAYER_BROWSE_MEDIA_DEADLINE_MS).toBe(5000);
    expect(browseMediaNeighborhood(0, 5)).toEqual([0, 1]);
    expect(browseMediaNeighborhood(2, 5)).toEqual([1, 2, 3]);
    expect(browseMediaNeighborhood(4, 5)).toEqual([3, 4]);
    expect(browseMediaNeighborhood(0, 0)).toEqual([]);
    expect(isSafeBrowseCoverUrl("/v1/media/covers/" + "a".repeat(64) + ".png")).toBe(true);
    expect(isSafeBrowseCoverUrl("https://example.com/x.png")).toBe(false);
    expect(mediaSource).toContain("prepareBrowsePeerMedia");
    expect(mediaSource).toContain("getPlayer(player.publicPlayerId, signal)");
    expect(mediaSource).toContain("naturalWidth");
    expect(mediaSource).toContain("img.decode");
    expect(mediaSource).toContain("RetainedBrowseImage");
    expect(mediaSource).not.toContain("new Image(");
    expect(deckSource).toContain("intentIndex");
    expect(deckSource).toContain("commitPreparedPeer");
    expect(deckSource).toContain("prepareBrowsePeerMedia");
    expect(deckSource).toContain("browseMediaNeighborhood");
    expect(deckSource).toContain("PLAYER_BROWSE_MEDIA_DEADLINE_MS");
    expect(deckSource).toContain("PreparedBrowseCover");
    expect(deckSource).toContain("PreparedBrowseAvatar");
    expect(deckSource).toContain("commitPending");
    expect(deckSource).toContain("navigationLocked={commitPending}");
    expect(deckSource).toContain("viewerGen");
    expect(deckSource).not.toContain("coverById");
    expect(deckSource).not.toContain("setCoverById");
  });

  it("F1: cached terminal failures settle intent — revert, skip, or explicit unavailable", () => {
    const status = (map: Record<number, "unauthorized" | "unavailable" | "ready" | "loading">) =>
      (i: number) => map[i];
    expect(nextBrowseIntentAfterFailure(3, 1, status({ 1: "unauthorized" }), true, 0)).toEqual({
      kind: "revert",
      index: 0,
    });
    expect(nextBrowseIntentAfterFailure(3, 0, status({ 0: "unauthorized", 1: "unavailable" }), false, 0)).toEqual({
      kind: "advance",
      index: 2,
    });
    expect(nextBrowseIntentAfterFailure(2, 0, status({ 0: "unauthorized", 1: "unavailable" }), false, 0)).toEqual({
      kind: "unavailable",
    });
    expect(deckSource).toContain("settleIntentFailure");
    expect(deckSource).toContain('data-media-unavailable="true"');
  });

  it("F2: media key changes with avatar/cover URLs for the same player id", () => {
    const base = player("p1");
    const withAvatar = {
      ...base,
      avatar: { uploadedUrl: "/v1/media/avatars/" + "a".repeat(64) + ".png", providerUrl: null },
    };
    const withCover = {
      ...withAvatar,
      cover: { uploadedUrl: "/v1/media/covers/" + "b".repeat(64) + ".png" },
    };
    const replacedCover = {
      ...withAvatar,
      cover: { uploadedUrl: "/v1/media/covers/" + "c".repeat(64) + ".png" },
    };
    expect(browsePeerMediaKey(base)).not.toBe(browsePeerMediaKey(withAvatar));
    expect(browsePeerMediaKey(withCover)).not.toBe(browsePeerMediaKey(replacedCover));
    expect(browsePeerMediaKey(withCover)).toBe(browsePeerMediaKey({ ...withCover, displayName: "Other" }));
    expect(deckSource).toContain("browsePeerMediaKey");
    expect(mediaSource).toContain("mediaKey");
    expect(mediaSource).toContain("peer: player");
  });

  it("F3: empty prepared cover is terminal without a fresh img request; single 5s deadline", () => {
    expect(PLAYER_BROWSE_MEDIA_DEADLINE_MS).toBe(5000);
    expect(mediaSource).not.toMatch(/Math\.min\(2000/);
    expect(mediaSource).not.toContain("settleFallbackSignal");
    const empty = renderToStaticMarkup(<PreparedBrowseCover media={{ kind: "default", node: null }} />);
    expect(empty).toContain('data-cover-settled="empty"');
    expect(empty).not.toContain("<img");
    expect(empty).not.toContain("/canonical/ce252.svg");
  });

  it("F4: displayed-index replacement failure clears committed into terminal unavailable", () => {
    const settleStart = deckSource.indexOf("const settleIntentFailure");
    expect(settleStart).toBeGreaterThan(-1);
    const afterSettle = deckSource.slice(settleStart);
    const settleEnd = afterSettle.indexOf("}, [browsePlayers");
    expect(settleEnd).toBeGreaterThan(-1);
    const settleBody = afterSettle.slice(0, settleEnd);
    expect(settleBody).toContain("failedIndex === indexRef.current");
    expect(settleBody).toContain("replaceCommittedMedia(null)");
    expect(settleBody).toContain("setMediaUnavailable(true)");
    expect(settleBody).toMatch(/committed\.mediaKey !== browsePeerMediaKey\(failedPeer\)/);
    expect(deckSource).toMatch(/const navigationLocked = friendBusy/);
  });

  it("F5: current uses catalogPeer when mediaKey matches; old peer only while replacement pending", () => {
    expect(deckSource).toMatch(
      /committedMedia\.peerId === catalogPeer\.publicPlayerId\s*\n\s*&&\s*committedMedia\.mediaKey !== browsePeerMediaKey\(catalogPeer\)/,
    );
  });

  it("hides DEV synthetic label only for directory-compact presentation", () => {
    expect(radarSource).toContain('presentation?: RadarStatusPresentation');
    expect(radarSource).toContain('directoryCompact');
    expect(radarSource).toContain("!directoryCompact && typeof window");
    expect(radarSource).toContain("DEV_MOSCOW_LABEL");
  });
});

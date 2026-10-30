import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PublicPlayer } from "../src/lib/consumer-types";
import {
  browseSlideDirection,
  browseSlideDurationMs,
  classifyPointerGesture,
  indexOfBrowsePlayer,
  isBrowseDragExcludedTarget,
  nextEligibleBrowseIndex,
  ordinaryBrowsePlayers,
  parseBrowseView,
  PLAYER_BROWSE_DESKTOP_MQ,
  PLAYER_BROWSE_SLIDE_MS,
  popSkip,
  prefersBrowseReducedMotion,
  pushSkip,
  readBrowseHistoryState,
  readTutorialDismissed,
  relationshipBlocksNewRequest,
  swipeThresholdPx,
  withBrowseHistoryState,
  writeBrowseViewSearch,
  PLAYER_BROWSE_HISTORY_KEY,
  PLAYER_BROWSE_TUTORIAL_KEY,
} from "../src/lib/player-browse";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deckSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowseDeck.tsx"), "utf8");
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
  it("requires horizontal dominance and release threshold; partial/cancel stays none", () => {
    expect(swipeThresholdPx(400)).toBe(96);
    expect(classifyPointerGesture({ dx: 8, dy: 0, width: 400, phase: "move" })).toBe("none");
    expect(classifyPointerGesture({ dx: 30, dy: 5, width: 400, phase: "move" })).toBe("horizontal");
    expect(classifyPointerGesture({ dx: 30, dy: 40, width: 400, phase: "move" })).toBe("none");
    expect(classifyPointerGesture({ dx: -50, dy: 0, width: 400, phase: "release" })).toBe("none");
    expect(classifyPointerGesture({ dx: -100, dy: 10, width: 400, phase: "release" })).toBe("skip");
    expect(classifyPointerGesture({ dx: 100, dy: 10, width: 400, phase: "release" })).toBe("request");
    expect(classifyPointerGesture({ dx: 100, dy: 90, width: 400, phase: "release" })).toBe("none");
  });

  it("excludes interactive targets from drag start", () => {
    const rootEl = { closest: (sel: string) => (sel.includes("button") ? {} : null) } as unknown as Element;
    expect(isBrowseDragExcludedTarget(rootEl)).toBe(true);
    expect(isBrowseDragExcludedTarget(null)).toBe(false);
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
    expect(toolbarSource).toContain('presentation="directory-compact"');
    expect(toolbarSource).toContain("aria-expanded");
    expect(toolbarSource).toContain("Escape");
    expect(pageSource).toContain("PLAYER_BROWSE_DESKTOP_MQ");
    expect(PLAYER_BROWSE_DESKTOP_MQ).toBe("(min-width: 1024px)");
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
    expect(deckSource).toMatch(/moveTo\(index \+ 1, "next"\)/);
    expect(deckSource).toMatch(/moveTo\(index - 1, "prev"\)/);
    expect(cssSource).toContain("is-sliding-next");
    expect(cssSource).toContain("is-sliding-prev");
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("hides DEV synthetic label only for directory-compact presentation", () => {
    expect(radarSource).toContain('presentation?: RadarStatusPresentation');
    expect(radarSource).toContain('directoryCompact');
    expect(radarSource).toContain("!directoryCompact && typeof window");
    expect(radarSource).toContain("DEV_MOSCOW_LABEL");
  });
});

import { describe, expect, it } from "vitest";
import type { PublicPlayer } from "../src/lib/consumer-types";
import {
  classifyPointerGesture,
  indexOfBrowsePlayer,
  isBrowseDragExcludedTarget,
  nextEligibleBrowseIndex,
  ordinaryBrowsePlayers,
  parseBrowseView,
  popSkip,
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
    const root = { closest: (sel: string) => (sel.includes("button") ? {} : null) } as unknown as Element;
    expect(isBrowseDragExcludedTarget(root)).toBe(true);
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
});

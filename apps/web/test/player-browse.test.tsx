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
  preparedMediaFitsPublicPlayer,
  RADAR_PIN_MEDIA_CAP,
  RADAR_PIN_MEDIA_DEADLINE_MS,
  selectRadarMediaPrewarmPeers,
} from "../src/components/consumer/players/PlayerBrowseMedia";
import {
  browseDragRotationDeg,
  browseExitDurationMs,
  browseExitTranslationPx,
  browseReleaseReverseVeto,
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
  parseBrowseCssTransformPose,
  parseBrowseView,
  PLAYER_BROWSE_AXIS_DOMINANCE,
  PLAYER_BROWSE_AXIS_LOCK_PX,
  PLAYER_BROWSE_DESKTOP_MQ,
  PLAYER_BROWSE_EXIT_MS_MAX,
  PLAYER_BROWSE_EXIT_MS_MIN,
  PLAYER_BROWSE_FLICK_VELOCITY,
  PLAYER_BROWSE_HISTORY_KEY,
  PLAYER_BROWSE_MAX_ROTATION_DEG,
  PLAYER_BROWSE_PROJECT_MS,
  PLAYER_BROWSE_SLIDE_MS,
  PLAYER_BROWSE_TUTORIAL_KEY,
  popSkip,
  prefersBrowseReducedMotion,
  pushSkip,
  readBrowseHistoryState,
  readTutorialDismissed,
  reconstructBrowseBio,
  relationshipBlocksNewRequest,
  releaseCommitted,
  sampleBrowseVelocity,
  swipeMinTravelPx,
  swipeThresholdPx,
  withBrowseHistoryState,
  writeBrowseViewSearch,
} from "../src/lib/player-browse";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deckSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowseDeck.tsx"), "utf8");
const mediaSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowseMedia.tsx"), "utf8");
const pageSource = readFileSync(join(root, "src/components/consumer/pages/PlayersDirectoryPage.tsx"), "utf8");
const toolbarSource = readFileSync(join(root, "src/components/consumer/players/PlayersDirectoryToolbar.tsx"), "utf8");
const radarSource = readFileSync(join(root, "src/components/consumer/radar/RadarControls.tsx"), "utf8");
const cssSource = readFileSync(join(root, "src/styles/player-browse.css"), "utf8");
const friendshipSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowsePlayInterest.tsx"), "utf8");
const mapSource = readFileSync(join(root, "src/components/consumer/radar/GeographicRadarMap.tsx"), "utf8");
const sessionSource = readFileSync(join(root, "src/components/consumer/radar/RadarSessionProvider.tsx"), "utf8");

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

  it("QA-01: server route initialBrowseView matches client parseBrowseView for encoded/normal/duplicate view", async () => {
    const { default: PlayersPage } = await import("../src/app/players/page");
    const serverView = async (view: string | string[] | undefined) => {
      const el = await PlayersPage({ searchParams: Promise.resolve({ view }) });
      return (el as { props: { initialBrowseView: "cards" | "list" } }).props.initialBrowseView;
    };
    // Encoded cases: Next hands decoded searchParams; client parses the raw search string.
    expect(await serverView("cards&x=1")).toBe(parseBrowseView("?view=cards%26x%3D1"));
    expect(await serverView("%63ards")).toBe(parseBrowseView("?view=%2563ards"));
    expect(await serverView("cards")).toBe(parseBrowseView("?view=cards"));
    expect(await serverView("list")).toBe(parseBrowseView("?view=list"));
    expect(await serverView(undefined)).toBe(parseBrowseView(""));
    // First duplicate wins on both sides.
    expect(await serverView(["list", "cards"])).toBe(parseBrowseView("?view=list&view=cards"));
    expect(await serverView(["cards", "list"])).toBe(parseBrowseView("?view=cards&view=list"));
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
      ["b", "outgoing" as const],
      ["c", "mutual" as const],
    ]);
    expect(nextEligibleBrowseIndex(rows, 0, known, new Set())).toBe(3);
    expect(nextEligibleBrowseIndex(rows, 0, known, new Set(["d"]))).toBe(-1);
    expect(relationshipBlocksNewRequest("incoming_pending")).toBe(true);
    expect(relationshipBlocksNewRequest("none")).toBe(false);
  });
});

describe("player browse swipe boundaries", () => {
  it("locks axis with OUR 8px/1.3 dominance; reverse veto before distance; slow-D or projected flick", () => {
    expect(PLAYER_BROWSE_AXIS_LOCK_PX).toBe(8);
    expect(PLAYER_BROWSE_AXIS_DOMINANCE).toBe(1.3);
    expect(PLAYER_BROWSE_FLICK_VELOCITY).toBe(0.65);
    expect(PLAYER_BROWSE_PROJECT_MS).toBe(180);
    expect(swipeThresholdPx(360)).toBe(Math.max(72, Math.min(112, 360 * 0.24)));
    expect(swipeMinTravelPx(360)).toBe(Math.max(18, Math.min(28, 360 * 0.06)));
    expect(classifyPointerGesture({ dx: 6, dy: 0, width: 360, phase: "move" })).toBe("none");
    expect(classifyPointerGesture({ dx: 30, dy: 5, width: 360, phase: "move" })).toBe("horizontal");
    expect(classifyPointerGesture({ dx: 5, dy: 30, width: 360, phase: "move" })).toBe("vertical");
    // Ambiguous diagonal under 1.3 dominance stays undecided.
    expect(classifyPointerGesture({ dx: 30, dy: 35, width: 360, phase: "move" })).toBe("none");
    expect(classifyPointerGesture({ dx: -30, dy: 0, width: 360, phase: "release" })).toBe("none");
    // Slow distance commit (W=360 → D≈86.4).
    expect(classifyPointerGesture({ dx: -100, dy: 10, width: 360, phase: "release", lockedAxis: "horizontal" })).toBe("skip");
    expect(classifyPointerGesture({ dx: 100, dy: 10, width: 360, phase: "release", lockedAxis: "horizontal" })).toBe("request");
    expect(classifyPointerGesture({ dx: 100, dy: 90, width: 360, phase: "release" })).toBe("none");
    // Short fast projected flick commits; reverse velocity vetoes even past D.
    expect(classifyPointerGesture({
      dx: -28, dy: 0, width: 360, phase: "release", lockedAxis: "horizontal", velocity: -PLAYER_BROWSE_FLICK_VELOCITY,
    })).toBe("skip");
    expect(classifyPointerGesture({
      dx: -100, dy: 0, width: 360, phase: "release", lockedAxis: "horizontal", velocity: 0.45, reverseVeto: true,
    })).toBe("none");
    expect(browseReleaseReverseVeto(100, -0.45)).toBe(true);
    expect(releaseCommitted({ travel: 100, extent: 360, velocity: -0.45, reverseVeto: true })).toBe(false);
    expect(releaseCommitted({ travel: 100, extent: 360, velocity: 0 })).toBe(true);
    // Vertical release reports up/down; not a horizontal mutation (H=700 → D=112).
    expect(classifyPointerGesture({
      dx: 4, dy: -120, width: 360, height: 700, phase: "release", lockedAxis: "vertical",
    })).toBe("vertical-up");
    expect(classifyPointerGesture({
      dx: 4, dy: 120, width: 360, height: 700, phase: "release", lockedAxis: "vertical",
    })).toBe("vertical-down");
    expect(classifyPointerGesture({
      dx: 4, dy: -120, width: 360, height: 700, phase: "release", lockedAxis: "horizontal",
    })).toBe("none");
  });

  it("samples recent 80ms velocity including release; zero after pause; bounds rotation and exit geometry", () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 40, x: -20, y: 0 },
      { t: 80, x: -40, y: 0 },
    ];
    expect(sampleBrowseVelocity(samples, "horizontal", 80)).toBeCloseTo(-0.5, 5);
    expect(sampleBrowseVelocity(samples, "horizontal", 220)).toBe(0);
    expect(browseDragRotationDeg(400, 360)).toBe(PLAYER_BROWSE_MAX_ROTATION_DEG);
    expect(browseDragRotationDeg(-400, 360)).toBe(-PLAYER_BROWSE_MAX_ROTATION_DEG);
    expect(browseDragRotationDeg(180, 360)).toBe(6);
    const exit = browseExitTranslationPx({ dir: -1, width: 390, height: 788, rotationDeg: 12, currentX: -90 });
    expect(exit).toBeLessThan(-(390 / 2));
    expect(Math.abs(exit)).toBeGreaterThan(390 + 48);
    expect(browseExitDurationMs(400, 2)).toBeGreaterThanOrEqual(PLAYER_BROWSE_EXIT_MS_MIN);
    expect(browseExitDurationMs(400, 2)).toBeLessThanOrEqual(PLAYER_BROWSE_EXIT_MS_MAX);
  });

  it("parses spring re-grab base pose so origin + finger delta does not jump opposite the finger", () => {
    // CDP receipt: grabbed e=-26.1489, finger -15 → visual must be ~-41.15, not absolute -15.
    const pose = parseBrowseCssTransformPose("matrix(0.998629, -0.052336, 0.052336, 0.998629, -26.1489, 0)");
    expect(pose.x).toBeCloseTo(-26.1489, 4);
    expect(pose.y).toBe(0);
    expect(pose.x + -15).toBeCloseTo(-41.1489, 4);
    expect(parseBrowseCssTransformPose("none")).toEqual({ x: 0, y: 0, rotDeg: 0 });
    expect(parseBrowseCssTransformPose("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -30.4696, 0, 0, 1)").x)
      .toBeCloseTo(-30.4696, 4);
    expect(deckSource).toContain("originX");
    expect(deckSource).toContain("parseBrowseCssTransformPose");
    expect(cssSource).toMatch(/\.gb-player-browse \.pb-avatar img/);
    expect(cssSource).toMatch(/\.gb-player-browse \.pb-details-avatar img/);
    expect(cssSource).toContain("object-fit: cover");
    expect(cssSource).toContain("overflow: clip");
  });

  it("excludes interactive targets from drag start", () => {
    const rootEl = { closest: (sel: string) => (sel.includes("button") ? {} : null) } as unknown as Element;
    expect(isBrowseDragExcludedTarget(rootEl)).toBe(true);
    expect(isBrowseDragExcludedTarget(null)).toBe(false);
  });

  it("mobile fullscreen cards use native dialog portal, single avatar host, and 1:1 drag without damping", () => {
    expect(pageSource).toContain("createPortal");
    expect(pageSource).toContain("pb-mobile-fs");
    expect(pageSource).toContain("showModal");
    expect(pageSource).toContain("<dialog");
    expect(pageSource).toContain("closeMobileCards");
    expect(deckSource).toContain("--pb-drag-x");
    expect(deckSource).not.toContain("* 0.32");
    expect(deckSource).toContain("touchAction");
    expect(deckSource).toContain("setPointerCapture");
    expect(deckSource).toContain("flyOffCard");
    expect(deckSource).toContain("awaitingRightRef");
    expect(deckSource).toContain("flyGen");
    expect(deckSource).toContain("actionConsumedRef");
    expect(deckSource).toContain("fluidMobile");
    expect(pageSource).toContain("Найти напарника");
    expect(pageSource).toContain("pb-mobile-finder-zone");
    expect(deckSource).toContain("Single retained avatar host");
    expect(deckSource).not.toContain('pb-mobile-details${detailsOpen ? " is-open" : ""}`} data-browse-no-drag');
    expect(deckSource).toContain("{!detailsOpen && (");
    expect(deckSource).toContain("{detailsOpen && (");
    expect(cssSource).toContain("pb-mobile-fs");
    expect(cssSource).toContain("touch-action: pinch-zoom");
    expect(cssSource).toContain("pb-intent--skip");
    expect(cssSource).toContain("dialog.pb-mobile-fs");
  });

  it("QA-01: mobile fullscreen chrome wraps early catalog loading/unavailable/error/empty", () => {
    expect(deckSource).toContain("wrapCatalogState");
    expect(deckSource).toContain("mobileFsChrome");
    const chromeDef = deckSource.indexOf("const mobileFsChrome");
    const wrapDef = deckSource.indexOf("const wrapCatalogState");
    expect(chromeDef).toBeGreaterThan(-1);
    expect(wrapDef).toBeGreaterThan(chromeDef);
    expect(deckSource).toContain("return wrapCatalogState(\n      <div className=\"pb-loading\"");
    expect(deckSource).toContain("return wrapCatalogState(\n      <div className=\"pb-empty\" role=\"status\"><h2>Каталог игроков сейчас недоступен");
    expect(deckSource).toContain("return wrapCatalogState(\n      <div className=\"pb-empty\" role=\"alert\"");
    expect(deckSource).toContain("return wrapCatalogState(\n      <div className=\"pb-empty\" role=\"status\">\n        <h2>Никого не нашли");
    expect(deckSource).toContain('className="pb-fs-close"');
    expect(deckSource.match(/className="pb-fs-close"/g)?.length).toBe(1);
    // Eligibility gate + loading/unavailable/error/empty — five early fullscreen wraps.
    expect(deckSource.match(/return wrapCatalogState\(/g)?.length).toBe(5);
    expect(deckSource).toContain("mobileOffers.eligibility.kind !== \"ready\"");
  });

  it("QA-02: second contact cancels active gesture before primary/interactive exclusions", () => {
    const onDown = deckSource.indexOf("const onDown = (event: PointerEvent)");
    expect(onDown).toBeGreaterThan(-1);
    const body = deckSource.slice(onDown, onDown + 900);
    const secondContact = body.indexOf("event.pointerId !== drag.current.id");
    const primaryGate = body.indexOf("!event.isPrimary");
    const excluded = body.indexOf("isBrowseDragExcludedTarget");
    expect(secondContact).toBeGreaterThan(-1);
    expect(secondContact).toBeLessThan(primaryGate);
    expect(secondContact).toBeLessThan(excluded);
    expect(deckSource).toContain('document.addEventListener("pointerdown", onDocPointerDownCapture, true)');
    expect(deckSource).toContain("document.removeEventListener(\"pointerdown\", onDocPointerDownCapture, true)");
  });

  it("QA-03: flight completion fences viewerGen; auth expiry invalidates flyGen", () => {
    expect(deckSource).toContain("const capturedViewer = viewerGen.current");
    expect(deckSource).toContain("viewerGen.current === capturedViewer");
    const expire = deckSource.indexOf("const expire = () =>");
    expect(expire).toBeGreaterThan(-1);
    const expireBody = deckSource.slice(expire, expire + 520);
    expect(expireBody).toContain("viewerGen.current += 1");
    expect(expireBody).toContain("flyGen.current += 1");
  });

  it("QA-04: closed mobile details are inert/aria-hidden; cover/identity inert while open", () => {
    expect(deckSource).toContain('className={`pb-mobile-details${detailsOpen ? " is-open" : ""}`}');
    expect(deckSource).toContain("inert={!detailsOpen ? true : undefined}");
    expect(deckSource).toContain("aria-hidden={!detailsOpen ? true : undefined}");
    expect(deckSource).toContain('className="pb-cover" aria-hidden={detailsOpen ? true : undefined} inert={detailsOpen ? true : undefined}');
    expect(deckSource).toContain('className="pb-identity-compact" aria-hidden={detailsOpen ? true : undefined} inert={detailsOpen ? true : undefined}');
    expect(deckSource).toContain("Single retained avatar host");
    expect(deckSource).toContain("Stable friendship slot");
    expect(deckSource).toContain("PlayerBrowsePlayInterest");
  });

  it("mobile details use fixed info pages (facts / about chunks / games) with pager outside clip", () => {
    expect(deckSource).toContain("mobileInfoPage");
    expect(deckSource).toContain('data-mobile-section={mobileSection}');
    expect(deckSource).toContain('mobileSection === "facts"');
    expect(deckSource).toContain('mobileSection === "about"');
    expect(deckSource).toContain('mobileSection === "games"');
    expect(deckSource).toContain("pb-mobile-details__body");
    expect(deckSource).toContain("pb-mobile-bio-measure");
    expect(deckSource).toContain("setMobileInfoPage");
    expect(deckSource).toContain("mobileInfoPageCountRef");
    // Up/down map to mobile page index — not desktop detailsPage bio index.
    expect(deckSource).toContain("mobileInfoPageRef.current < last");
    expect(deckSource).toContain("mobileInfoPageRef.current > 0");
    expect(deckSource).toContain("Публичные ближайшие игры этого игрока пока недоступны.");
    expect(cssSource).toContain("pb-mobile-details__body");
    expect(cssSource).not.toContain("-webkit-line-clamp: 6");
    expect(cssSource).toContain('pb-mobile-details__head[data-page-role="host"]');
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

  it("ignores withdrawn play-interest receipts in onConfirmed toast/auto-advance", () => {
    expect(deckSource).toMatch(/if \(!isBrowseConfirmedPlayInterestOutcome\(receipt\.outcome\)\) return/);
    expect(deckSource).toMatch(/Withdraw succeeds as a mutation but must not toast "sent" or auto-advance/);
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

  it("keeps loading header geometry stable via initial view + viewport CSS; floating map CTA", async () => {
    const routeSource = readFileSync(join(root, "src/app/players/page.tsx"), "utf8");
    const playersCss = readFileSync(join(root, "src/styles/players.css"), "utf8");
    expect(routeSource).toContain("initialBrowseView");
    // Route binds decoded Next params directly (not parseBrowseView by name); assert actual Page output.
    const { default: PlayersPage } = await import("../src/app/players/page");
    const boundView = async (view: string | string[] | undefined) => {
      const el = await PlayersPage({ searchParams: Promise.resolve({ view }) });
      return (el as { props: { initialBrowseView: "cards" | "list" } }).props.initialBrowseView;
    };
    expect(await boundView("cards")).toBe("cards");
    expect(await boundView("list")).toBe("list");
    expect(await boundView(undefined)).toBe("list");
    expect(pageSource).toContain("initialBrowseView");
    expect(pageSource).toContain("mqReady");
    expect(pageSource).toContain("players-hero__subtitle");
    expect(pageSource).toContain("GamesViewAction");
    expect(pageSource).toContain('className="gb-players-map-cta"');
    expect(pageSource).toMatch(/mobileCards = showCards && mqReady && !desktop/);
    // Desktop hero height from viewport MQ — not gated on hydrated data-directory-desktop.
    expect(cssSource).toMatch(/@media \(min-width: 1024px\)[\s\S]*?\.gb-player-browse \.players-hero[\s\S]*?height:\s*116px/);
    expect(cssSource).toContain("players-hero__subtitle");
    expect(cssSource).toContain("position: fixed");
    expect(cssSource).toContain("gb-players-map-cta.gb-games-view-action");
    // Refs398 retained avatar: nested img under display:contents span.
    expect(playersCss).toContain(".fr3 .avatar img");
    expect(playersCss).toMatch(/\.fr3 \.avatar > img,\s*\.fr3 \.avatar img/);
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
    // Mobile page bounds: facts + about chunks + games (about count at least 1).
    const mobileAboutCount = Math.max(1, chunks.length);
    const mobilePageCount = 1 + mobileAboutCount + 1;
    expect(mobilePageCount).toBe(chunks.length + 2);
    expect(chunkBrowseBio("", 90)).toEqual([]);
    expect(1 + Math.max(1, chunkBrowseBio("", 90).length) + 1).toBe(3);
    expect(deckSource).toContain("chunkBrowseBio");
    expect(deckSource).toContain("bioChunks.length > 1");
    expect(deckSource).toContain("estimateBrowseBioChunkChars");
    expect(deckSource).toContain('data-reserved="true"');
    expect(deckSource).toContain("pb-profile-link--heading");
    expect(deckSource).toContain("Публичные ближайшие игры этого игрока пока недоступны.");
    expect(deckSource).not.toContain("Публичные игры пока не указаны.");
    expect(deckSource).toContain("mobileAboutCount");
    expect(deckSource).toContain("mobileInfoLast");
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
    expect(friendshipSource).toContain("Давай сыграем");
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
    // Tinder window: current + next4 + previous (max 6), priority current/ahead then prev.
    expect(browseMediaNeighborhood(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(browseMediaNeighborhood(2, 5)).toEqual([2, 3, 4, 1]);
    expect(browseMediaNeighborhood(4, 5)).toEqual([4, 3]);
    expect(browseMediaNeighborhood(1, 10)).toEqual([1, 2, 3, 4, 5, 0]);
    expect(browseMediaNeighborhood(1, 10).length).toBeLessThanOrEqual(6);
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
    // Radar pin cap stays independently at 4 — Tinder four-ahead must not rewrite it.
    expect(RADAR_PIN_MEDIA_CAP).toBe(4);
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
    // Fluid mobile intentionally unlocks card motion during page-level POST; desktop keeps friendBusy.
    expect(deckSource).toMatch(/const navigationLocked = fluidMobile \? false : friendBusy/);
    expect(deckSource).toContain("navigationLocked={commitPending}");
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

  it("QA-02: radar prewarm deadline matches finite prepare budget; timeout default is not cover-ready", () => {
    expect(RADAR_PIN_MEDIA_DEADLINE_MS).toBe(PLAYER_BROWSE_MEDIA_DEADLINE_MS);
    expect(RADAR_PIN_MEDIA_DEADLINE_MS).toBeGreaterThanOrEqual(5000);
    expect(mediaSource).not.toMatch(/RADAR_PIN_MEDIA_DEADLINE_MS\s*=\s*1200/);
    expect(mediaSource).toContain("authoritative");
    expect(mediaSource).toContain("deadlineFired");
    const coverUrl = "/v1/media/covers/" + "b".repeat(64) + ".png";
    const peer = {
      ...player("warm"),
      cover: { uploadedUrl: coverUrl },
    };
    const timedOutDefault = {
      peerId: peer.publicPlayerId,
      mediaKey: browsePeerMediaKey(peer),
      peer,
      avatar: { kind: "initials" as const, text: "W" },
      cover: { kind: "default" as const, node: null, authoritative: false },
    };
    expect(preparedMediaFitsPublicPlayer(timedOutDefault, peer)).toBe(false);
    const absent = {
      ...timedOutDefault,
      peer: { ...player("warm"), cover: { uploadedUrl: null } },
      mediaKey: browsePeerMediaKey({ ...player("warm"), cover: { uploadedUrl: null } }),
      cover: { kind: "default" as const, node: null, authoritative: true },
    };
    expect(preparedMediaFitsPublicPlayer(absent, absent.peer)).toBe(true);
    expect(mediaSource).toContain("authoritativeDefault");
    expect(mediaSource).toContain("authoritative !== false");
  });

  it("QA-03: RADAR_PIN_MEDIA_CAP bounds pending+retained; hover uses same admission", () => {
    expect(RADAR_PIN_MEDIA_CAP).toBe(4);
    const peers = Array.from({ length: 9 }, (_, i) => ({ publicPlayerId: `p${i}` }));
    expect(selectRadarMediaPrewarmPeers(peers, "p8", RADAR_PIN_MEDIA_CAP)).toHaveLength(4);
    expect(selectRadarMediaPrewarmPeers(peers, "p8", RADAR_PIN_MEDIA_CAP)[0]?.publicPlayerId).toBe("p8");
    expect(mediaSource).toContain("admitRadarMediaPeer");
    expect(mediaSource).toContain("radarMediaOccupiedCount");
    expect(mediaSource).toContain("retainIds");
    expect(mediaSource).toMatch(/while \(radarMediaOccupiedCount\(\) >= RADAR_PIN_MEDIA_CAP/);
    expect(mapSource).toContain("prewarmRadarPeerMedia");
    expect(mapSource).toContain("retainIds");
    expect(mapSource).toContain("pointerenter");
    expect(mapSource).toContain("focus");
    expect(sessionSource).toContain("retainIds");
  });
});

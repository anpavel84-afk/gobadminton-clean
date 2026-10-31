import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import {
  bindPlayInterestStates,
  getPlayInterestStates,
  isBrowseConfirmedPlayInterestOutcome,
  isFinderSendEligible,
  isValidConfirmedPlayInterestReceipt,
  isValidPlayInterestSendPendingMarker,
  PLAY_INTEREST_STATES_BATCH_MAX,
} from "../src/lib/play-interests";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pageSource = readFileSync(join(root, "src/components/consumer/pages/PlayersDirectoryPage.tsx"), "utf8");
const deckSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowseDeck.tsx"), "utf8");
const offersHookSource = readFileSync(join(root, "src/components/consumer/players/usePlayerBrowseOffers.ts"), "utf8");
const offersUiSource = readFileSync(join(root, "src/components/consumer/players/PlayerBrowseOffers.tsx"), "utf8");
const playInterestLib = readFileSync(join(root, "src/lib/play-interests.ts"), "utf8");
const mutationSource = readFileSync(join(root, "src/components/consumer/messages/useSocialMutation.ts"), "utf8");
// Repo docs/ — not apps/docs. realpath keeps the contract stable across worktree layouts.
const styleGuide = readFileSync(
  realpathSync(join(root, "../../docs/product/PLAYER_BROWSING_STYLE_GUIDE.md")),
  "utf8",
);

const caps = { canSend: false, canWithdraw: false };
const none: PlayInterestView = {
  interestId: null, relationship: "none", version: null,
  capabilities: { ...caps, canSend: true },
};
const outgoing: PlayInterestView = {
  interestId: "r1", relationship: "outgoing", version: "1",
  capabilities: { ...caps, canWithdraw: true },
};
const mutual: PlayInterestView = {
  interestId: "r2", relationship: "mutual", version: "2",
  capabilities: { ...caps, canWithdraw: true },
};
const unavailable: PlayInterestView = {
  interestId: null, relationship: "unavailable", version: null, capabilities: { ...caps },
};
const noneBlocked: PlayInterestView = {
  interestId: null, relationship: "none", version: null, capabilities: { ...caps },
};

describe("player browse discovery · batch eligibility helpers", () => {
  it("binds positional batch items to frozen IDs and rejects length mismatch", () => {
    const ids = ["a", "b", "c"];
    const bound = bindPlayInterestStates(ids, [none, outgoing, mutual]);
    expect(bound?.get("a")).toEqual(none);
    expect(bound?.get("b")?.relationship).toBe("outgoing");
    expect(bound?.get("c")?.relationship).toBe("mutual");
    expect(bindPlayInterestStates(ids, [none, outgoing])).toBeNull();
    expect(bindPlayInterestStates(ids, null)).toBeNull();
  });

  it("finder eligibility is none+canSend only", () => {
    expect(isFinderSendEligible(none)).toBe(true);
    expect(isFinderSendEligible(noneBlocked)).toBe(false);
    expect(isFinderSendEligible(outgoing)).toBe(false);
    expect(isFinderSendEligible(mutual)).toBe(false);
    expect(isFinderSendEligible(unavailable)).toBe(false);
    expect(isFinderSendEligible(null)).toBe(false);
  });

  it("batch URL appends repeated publicPlayerId params (not comma-string)", () => {
    expect(playInterestLib).toContain("params.append(\"publicPlayerId\", id)");
    expect(playInterestLib).toContain("PLAY_INTEREST_STATES_BATCH_MAX");
    expect(PLAY_INTEREST_STATES_BATCH_MAX).toBe(50);
    expect(typeof getPlayInterestStates).toBe("function");
  });

  it("filters a 25-peer fixture to 18 sendable excluding outgoing/mutual", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `p${i}`);
    const items: PlayInterestView[] = ids.map((_, i) => {
      if (i < 5) return outgoing;
      if (i < 7) return mutual;
      return none;
    });
    const bound = bindPlayInterestStates(ids, items);
    expect(bound).not.toBeNull();
    const eligible = ids.filter(id => isFinderSendEligible(bound!.get(id)));
    expect(eligible).toHaveLength(18);
    expect(eligible).not.toContain("p0");
    expect(eligible).not.toContain("p6");
  });
});

describe("player browse discovery · fluid send source contracts", () => {
  it("mobile entry uses finder CTA and hides segmented switch from mobile tab order", () => {
    expect(pageSource).toContain("Найти напарника");
    expect(pageSource).toContain("pb-mobile-finder-zone");
    expect(pageSource).toContain("pb-finder-cta");
    expect(pageSource).toMatch(/hidden=\{mqReady && !desktop \? true : undefined\}/);
    expect(pageSource).toContain("usePlayerBrowseOffers");
    expect(pageSource).toContain("mobileOffers");
    // Desktop segmented controls remain in source.
    expect(pageSource).toContain("pb-view-switch");
    expect(pageSource).toContain("Списком");
    expect(pageSource).toContain("По одному");
  });

  it("authenticated cards eligibility covers desktop without mobile operation host", () => {
    // Same page-owned batch gate for both views; list stays unfiltered.
    expect(pageSource).toMatch(/finderActive:\s*showCards/);
    expect(pageSource).toContain("authCardsReady");
    expect(pageSource).toContain("desktopFinderEligibility");
    expect(pageSource).toContain("finderEligibility={desktopFinderEligibility}");
    expect(pageSource).toMatch(/mobileOffers=\{mobileCards \? offers : null\}/);
    // Desktop guest keeps ordinary catalog; auth loading/error avoid flashing sent peers.
    expect(pageSource).toContain("offers.authState !== \"guest\"");
    expect(pageSource).toContain("catalog.ordinary");
    expect(deckSource).toContain("finderEligibility");
    expect(deckSource).toContain("onContinueFinder");
    expect(deckSource).toContain("onRetryFinder");
    expect(offersHookSource).toContain("readValidatedPending");
    expect(offersHookSource).toContain("unresolvedRef.current.some");
  });

  it("deck admits then flies right without waiting for receipt on mobile offers path", () => {
    expect(deckSource).toContain("fluidMobile");
    expect(deckSource).toContain("applySendAdvance");
    expect(deckSource).toContain("admitSend");
    expect(deckSource).toContain("externalAdmitSend");
    expect(deckSource).toMatch(/if \(offersRef\.current\) \{[\s\S]*flyOffCard\(1/);
    expect(deckSource).toContain("receipt must not advance again");
    expect(offersHookSource).toContain("Завершаем предыдущее предложение");
    expect(offersHookSource).toContain("getPlayInterestStates");
    expect(offersHookSource).toContain("continueSearch");
    expect(offersHookSource).toContain("activeOperation");
    expect(offersHookSource).not.toContain("useSocialMutation");
    expect(offersUiSource).toContain("Продолжить поиск");
    expect(offersUiSource).toContain("PlayerBrowseOfferOpHost");
    expect(pageSource).toContain("PlayerBrowseOfferOpHost");
    expect(pageSource).toMatch(/key=\{offers\.activeOperation\.token\}/);
  });

  it("useSocialMutation exposes sync run admission and opt-in receipt validation", () => {
    expect(mutationSource).toContain("validateSuccess");
    expect(mutationSource).toContain("Synchronous admission");
    expect(mutationSource).toMatch(/run\(path: string, body: object, method = "POST"\): boolean/);
    expect(mutationSource).toContain("Validator throw");
    expect(isBrowseConfirmedPlayInterestOutcome("outgoing")).toBe(true);
    expect(isBrowseConfirmedPlayInterestOutcome("withdrawn")).toBe(false);
  });

  it("strict confirmed receipt rejects null/malformed and accepts full outgoing/mutual", () => {
    expect(isValidConfirmedPlayInterestReceipt(null)).toBe(false);
    expect(isValidConfirmedPlayInterestReceipt({ outcome: "outgoing" })).toBe(false);
    expect(isValidConfirmedPlayInterestReceipt({
      interestId: "not-a-uuid", version: "1", outcome: "outgoing",
    })).toBe(false);
    expect(isValidConfirmedPlayInterestReceipt({
      interestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", version: "01", outcome: "outgoing",
    })).toBe(false);
    expect(isValidConfirmedPlayInterestReceipt({
      interestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", version: "1", outcome: "withdrawn",
    })).toBe(false);
    expect(isValidConfirmedPlayInterestReceipt({
      interestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", version: "1", outcome: "outgoing",
    })).toBe(true);
    expect(isValidConfirmedPlayInterestReceipt({
      interestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", version: "2", outcome: "mutual",
    })).toBe(true);
    expect(isValidPlayInterestSendPendingMarker({
      path: "/v1/play-interests",
      method: "POST",
      key: "k1",
      body: { targetPublicPlayerId: "peer-a" },
    }, "peer-a")).toBe(true);
    expect(isValidPlayInterestSendPendingMarker({
      path: "/v1/play-interests",
      method: "POST",
      key: "k1",
      body: { targetPublicPlayerId: "peer-b" },
    }, "peer-a")).toBe(false);
    expect(offersUiSource).toContain("isValidConfirmedPlayInterestReceipt");
    expect(playInterestLib).toContain("isValidConfirmedPlayInterestReceipt");
  });

  it("style guide records delivered fluid/eligibility and marks ranking PROPOSED", () => {
    expect(styleGuide).toContain("Найти напарника");
    expect(styleGuide).toContain("Fluid mobile (delivered)");
    expect(styleGuide).toContain("mobile and desktop");
    expect(styleGuide).toContain("Ordinary list remains complete");
    expect(styleGuide).toContain("Desktop guest public preview");
    expect(styleGuide).toContain("PROPOSED · smart ranking");
    expect(styleGuide).toContain("NOT implemented");
    expect(styleGuide).not.toMatch(/smart ranking[\s\S]{0,80}delivered/i);
  });

  it("mobile FS last-card end stays out of flow; modal status sits below chrome not over actions", () => {
    const css = readFileSync(join(root, "src/styles/player-browse.css"), "utf8");
    // Plain end → chrome out-of-flow; no in-flow --fs footer that shrinks the last card.
    expect(deckSource).toContain("pb-fs-end");
    expect(deckSource).toContain("atEndFsPlain");
    expect(deckSource).toContain("!(mobileFullscreen && !hasMore)");
    expect(deckSource).toContain("pb-deck-end--fs-more");
    expect(css).toMatch(/\.pb-deck-end--fs\s*\{[^}]*position:\s*absolute/s);
    expect(css).toContain(".pb-fs-end");
    // Modal notice: top under chrome/X — not bottom:~112 over Undo/primary.
    expect(css).toMatch(/\.pb-offer-status--modal\s*\{[^}]*top:\s*calc\(56px/s);
    expect(css).not.toMatch(/\.pb-offer-status--modal\s*\{[^}]*bottom:\s*calc\(112px/s);
    expect(styleGuide).toContain("below chrome/X and above Undo/primary");
    expect(styleGuide).toContain("pb-deck-end--fs-more");
  });

  it("offer status refines single extraUnknown under noUncheckedIndexedAccess", () => {
    expect(offersUiSource).toContain("const onlyExtraUnknown = extraUnknown.length === 1 ? extraUnknown[0] : undefined");
    expect(offersUiSource).toContain("onlyExtraUnknown");
    expect(offersUiSource).toContain("renderUnresolved(onlyExtraUnknown)");
    expect(offersUiSource).not.toContain("renderUnresolved(extraUnknown[0])");
    expect(offersUiSource).not.toMatch(/@ts-ignore|as any/);
  });
});

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", () => ({
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: T | ((previous: T) => T)) => {
      hooks.slots[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks.slots[index] as T) : value;
    }];
  },
  useRef<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect(effect: () => unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) { hooks.slots[index] = true; effect(); }
  },
}));
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
import { apiFetch, type ApiResult } from "../src/lib/api-client";
import { useSocialMutation } from "../src/components/consumer/messages/useSocialMutation";

describe("player browse discovery · deferred mutation admission", () => {
  const success = vi.fn();
  const refresh = vi.fn();
  const storage = new Map<string, string>();
  function render(validate?: (data: PlayInterestReceipt) => boolean) {
    hooks.cursor = 0;
    return useSocialMutation<PlayInterestReceipt>(
      "actor:play-interest:peer-a",
      "csrf",
      success,
      refresh,
      true,
      validate ? { validateSuccess: validate } : undefined,
    );
  }
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

  beforeEach(() => {
    hooks.slots = []; hooks.cursor = 0; storage.clear(); vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "discovery-key-1" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("admits exactly one POST while a deferred promise is pending", async () => {
    let resolveFetch: (value: ApiResult<unknown>) => void = () => {};
    vi.mocked(apiFetch).mockImplementation(
      () => new Promise<ApiResult<unknown>>(resolve => { resolveFetch = resolve; }),
    );
    const mutation = render();
    expect(mutation.run("/v1/play-interests", { targetPublicPlayerId: "peer-a" })).toBe(true);
    expect(mutation.run("/v1/play-interests", { targetPublicPlayerId: "peer-a" })).toBe(false);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    resolveFetch({
      ok: true,
      status: 200,
      data: { interestId: "i1", version: "1", outcome: "outgoing" } satisfies PlayInterestReceipt,
    });
    await settle();
    expect(success).toHaveBeenCalledTimes(1);
  });

  it("keeps UNKNOWN when opt-in validateSuccess rejects a malformed 2xx", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: { interestId: "i1", version: "1", outcome: "withdrawn" } satisfies PlayInterestReceipt,
    });
    const mutation = render((data) => isBrowseConfirmedPlayInterestOutcome(data.outcome));
    expect(mutation.run("/v1/play-interests", { targetPublicPlayerId: "peer-a" })).toBe(true);
    await settle();
    const again = render((data) => isBrowseConfirmedPlayInterestOutcome(data.outcome));
    expect(again.pending).toBe(true);
    expect(success).not.toHaveBeenCalled();
    expect(storage.get("gb-fr04-pending:actor:play-interest:peer-a")).toContain("discovery-key-1");
  });

  it("keeps UNKNOWN when validateSuccess throws or receives null body", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: null as unknown as PlayInterestReceipt,
    });
    const mutation = render((data) => {
      if (!isValidConfirmedPlayInterestReceipt(data)) throw new Error("malformed");
      return true;
    });
    expect(mutation.run("/v1/play-interests", { targetPublicPlayerId: "peer-a" })).toBe(true);
    await settle();
    const again = render();
    expect(again.pending).toBe(true);
    expect(success).not.toHaveBeenCalled();
    expect(storage.get("gb-fr04-pending:actor:play-interest:peer-a")).toContain("discovery-key-1");
  });
});

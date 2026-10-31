import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import {
  isBrowseConfirmedPlayInterestOutcome,
  playInterestCommand,
  playInterestStatus,
} from "../src/lib/play-interests";
import { canOfferPlayInterest, playInterestBlocksNewSend } from "../src/lib/player-browse";

const playInterestSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/components/consumer/players/PlayerBrowsePlayInterest.tsx"),
  "utf8",
);
const deckSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/components/consumer/players/PlayerBrowseDeck.tsx"),
  "utf8",
);

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
import { apiFetch } from "../src/lib/api-client";
import { useSocialMutation } from "../src/components/consumer/messages/useSocialMutation";

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

describe("player browse confirmed play-interest outcomes", () => {
  it("treats only outgoing/mutual as deck confirm; withdraw does not", () => {
    const outcomes: PlayInterestReceipt["outcome"][] = ["outgoing", "mutual", "withdrawn"];
    expect(outcomes.filter(isBrowseConfirmedPlayInterestOutcome)).toEqual(["outgoing", "mutual"]);
    expect(isBrowseConfirmedPlayInterestOutcome("withdrawn")).toBe(false);
    expect(playInterestSource).toContain('from "../../../lib/play-interests"');
    expect(playInterestSource).toContain("export { isBrowseConfirmedPlayInterestOutcome }");
    expect(playInterestSource).toMatch(/if \(isBrowseConfirmedPlayInterestOutcome\(receipt\.outcome\)\) onConfirmedInterest\(receipt\)/);
  });
});

describe("player browse play-interest intent and capabilities", () => {
  it("allows send only for none+canSend and builds the play-interests path", () => {
    expect(canOfferPlayInterest(none)).toBe(true);
    expect(canOfferPlayInterest(outgoing)).toBe(false);
    expect(canOfferPlayInterest(mutual)).toBe(false);
    expect(canOfferPlayInterest(unavailable)).toBe(false);
    expect(canOfferPlayInterest(null)).toBe(false);
    expect(playInterestCommand(none, "peer-1", "send")).toEqual({
      path: "/v1/play-interests",
      body: { targetPublicPlayerId: "peer-1" },
    });
    expect(playInterestCommand({ ...none, capabilities: { ...caps } }, "peer-1", "send")).toBeNull();
  });

  it("never routes browse send through friend-requests and keeps withdraw explicit", () => {
    expect(playInterestCommand(outgoing, "peer-1", "withdraw")?.path).toBe("/v1/play-interests/r1/withdraw");
    expect(playInterestCommand(outgoing, "peer-1", "send")).toBeNull();
    expect(playInterestBlocksNewSend("outgoing")).toBe(true);
    expect(playInterestBlocksNewSend("mutual")).toBe(true);
    expect(playInterestSource).not.toContain("/friend-requests");
    expect(deckSource).not.toContain('path: "/v1/friend-requests"');
    expect(deckSource).toContain("PlayerBrowsePlayInterest");
    expect(deckSource).toContain("Давай сыграем");
    expect(deckSource).toContain("Вы оба хотите сыграть");
  });

  it("uses a distinct pending scope identity from friendship", () => {
    const meId = "actor";
    const peerId = "peer-9";
    expect(`${meId}:play-interest:${peerId}`).toBe("actor:play-interest:peer-9");
    expect(playInterestSource).toMatch(/\$\{me\.id\}:play-interest:\$\{peerId\}/);
    expect(playInterestSource).toMatch(/guest:play-interest:\$\{peerId\}/);
  });

  it("classifies GET 503 as error not unavailable and keeps pending UNKNOWN above error/unavailable", () => {
    // Transport/server 503 must use human retry; never treat as peer privacy opt-out.
    expect(playInterestSource).toMatch(
      /result\.status === 401 \? "guest" : \[403, 404\]\.includes\(result\.status\) \? "unavailable" : "error"/,
    );
    expect(playInterestSource).not.toMatch(/\[403,\s*404,\s*503\]/);
    // Fluid mobile: local pending UI only when page host does not own send UNKNOWN.
    const pendingIdx = playInterestSource.indexOf("if (mutation.pending && !useExternalSend)");
    const errorIdx = playInterestSource.indexOf('authState === "error" || loadState === "error"');
    const unavailableIdx = playInterestSource.indexOf(
      'loadState === "unavailable" || view?.relationship === "unavailable"',
    );
    const guestIdx = playInterestSource.indexOf('authState === "guest" || loadState === "guest"');
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(-1);
    expect(unavailableIdx).toBeGreaterThan(-1);
    expect(guestIdx).toBeGreaterThan(-1);
    expect(guestIdx).toBeLessThan(pendingIdx);
    expect(pendingIdx).toBeLessThan(errorIdx);
    expect(pendingIdx).toBeLessThan(unavailableIdx);
    expect(playInterestSource).toContain("Проверить статус");
    expect(playInterestSource).toContain("Не повторяйте отправку");
    expect(playInterestSource).toContain("Не удалось проверить. Повторите.");
    expect(playInterestSource).toContain("externalAdmitSend");
  });

  it("tutorial and status copy say Давай сыграем / mutual-only match, never auto-friend", () => {
    expect(deckSource).toContain("Давай сыграем — предложение сыграть");
    expect(deckSource).toContain("Совпадение только когда оба хотите сыграть");
    expect(playInterestStatus.outgoing).toBe("Предложение отправлено");
    expect(playInterestStatus.mutual).toBe("Вы оба хотите сыграть");
    expect(playInterestSource).toContain("Отменить предложение");
    expect(playInterestSource).toContain("pb-action-status");
    expect(playInterestSource).toContain("playInterestStatus[view.relationship]");
    expect(playInterestSource).toContain("Давай сыграем");
    expect(playInterestSource).not.toContain("Добавить в друзья");
    expect(playInterestSource).not.toContain("Предложить дружбу");
    expect(playInterestSource).not.toContain("Интерес к игре сейчас недоступен");
    expect(playInterestSource).not.toContain("подтверждён сервером");
    expect(playInterestSource).not.toContain("Отозвать интерес");
  });
});

describe("player browse play-interest unknown readonly check vs mutation retry", () => {
  const success = vi.fn(), refresh = vi.fn();
  const storage = new Map<string, string>();
  function render(scope = "actor:play-interest:peer") {
    hooks.cursor = 0;
    return useSocialMutation(scope, "csrf", success, refresh);
  }
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

  beforeEach(() => {
    hooks.slots = []; hooks.cursor = 0; storage.clear(); vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "browse-attempt-key" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps unresolved pending latched without auto-clear on 0 and preserves friendship scope separately", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 0, error: "unknown" });
    const mutation = render();
    mutation.run("/v1/play-interests", { targetPublicPlayerId: "peer" });
    await settle();
    const pending = render();
    expect(pending.pending).toBe(true);
    expect(storage.get("gb-fr04-pending:actor:play-interest:peer")).toContain("browse-attempt-key");
    expect(storage.get("gb-fr04-pending:actor:friends:peer")).toBeUndefined();
    expect(typeof pending.retry).toBe("function");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not start a second write while pending for the same play-interest scope", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 503, error: "unknown" });
    const mutation = render();
    mutation.run("/v1/play-interests", { targetPublicPlayerId: "peer" });
    await settle();
    const blocked = render();
    blocked.run("/v1/play-interests", { targetPublicPlayerId: "peer" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

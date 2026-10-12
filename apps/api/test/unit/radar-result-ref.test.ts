import { describe, expect, it } from "vitest";
import {
  displaySlot,
  orderingEpoch,
  parseResultRef,
  signResultRef,
  stableRankScore,
  verifyResultRef,
} from "../../src/radar/result-ref";

const pepper = "unit-test-auth-pepper-32chars!!!!";

describe("radar resultRef helpers", () => {
  it("signs and verifies viewer-bound proofs with expiry", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    const token = signResultRef(pepper, {
      viewerUserId: "11111111-1111-4111-8111-111111111111",
      viewerSessionId: "22222222-2222-4222-8222-222222222222",
      viewerActivationId: "33333333-3333-4333-8333-333333333333",
      viewerVersion: 1,
      targetUserId: "44444444-4444-4444-8444-444444444444",
      targetActivationId: "55555555-5555-4555-8555-555555555555",
      targetVersion: 2,
      epoch: orderingEpoch(now),
      now,
      proofTtlSeconds: 60,
    });
    expect(token.includes(".")).toBe(true);
    const payload = verifyResultRef(pepper, token, now);
    expect(payload?.viewerVersion).toBe(1);
    expect(payload?.targetVersion).toBe(2);
    const later = new Date(now.getTime() + 61_000);
    expect(verifyResultRef(pepper, token, later)).toBeNull();
    expect(parseResultRef(pepper, token)?.exp).toBe(
      Math.floor(now.getTime() / 1000) + 60,
    );
  });

  it("keeps rank/slot deterministic for same pair/epoch", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    const epoch = orderingEpoch(now);
    const a = stableRankScore(pepper, "v", "t", epoch);
    const b = stableRankScore(pepper, "v", "t", epoch);
    expect(a).toBe(b);
    const slot = displaySlot(pepper, "v", "t", now);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(360);
    expect(displaySlot(pepper, "v", "t", now)).toBe(slot);
  });
});

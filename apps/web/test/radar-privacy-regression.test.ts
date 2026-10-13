import { expect, it } from "vitest";
import type { apiFetch } from "../src/lib/api-client";
import type { Me } from "../src/lib/consumer-types";
import type { UnifiedRow, UnifiedSnapshot } from "@gobadminton/contracts";
import { UnifiedDirectoryController } from "../src/lib/unified-directory";
const start = Date.parse("2030-01-01T00:00:00Z");
const stamp = (n: number) => new Date(start + n).toISOString();
const snapshot = { policyVersion: "radar-geographic-sharing-v2", contractVersion: "players-unified-radar-v1", cityId: "moscow", exposureMode: "authenticated_live", validUntil: stamp(45000), query: { queryRef: "q", originState: "none", originRef: null }, items: [], page: { nextCursor: null } } as unknown as UnifiedSnapshot;
async function harness(items: UnifiedRow[], exposureMode = "authenticated_live") {
  let time = start;
  const request = (async (path: string) => ({ ok: true, status: 200, data: path.endsWith("/map") ? { ...snapshot, exposureMode, validUntil: stamp(1000), items, mapPage: { nextMapCursor: null } } : snapshot })) as typeof apiFetch;
  const c = new UnifiedDirectoryController(request, () => time);
  c.bind({ id: "v", csrfToken: "c" } as Me); await c.query({ cityId: "moscow" });
  expect(c.view.snapshot).not.toBeNull(); await c.map();
  return { c, advance: () => { time = start + 2000; } };
}
const point = (extras: Record<string, unknown> = {}) => ({ publicPlayerId: "p", projection: "radar", player: { displayName: "p" }, radar: { resultRef: "proof", consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: stamp(45000), geo: { crs: "EPSG:4326", longitude: 37, latitude: 55 }, ...extras } }) as unknown as UnifiedRow;
it("map deadline earlier than list purges private pins", async () => { const { c, advance } = await harness([point()]); expect(c.view.pins).toHaveLength(1); advance(); c.tick(); expect(c.view.pins).toEqual([]); });
it("expired individual point rejected", async () => { const { c } = await harness([point({ validUntil: stamp(-1) })]); expect(c.view.pins).toEqual([]); });
it("missing server proof rejected", async () => { const { c } = await harness([point({ resultRef: "" })]); expect(c.view.pins).toEqual([]); });
it("wrong consent policy rejected", async () => { const { c } = await harness([point({ consentPolicyVersion: "obsolete" })]); expect(c.view.pins).toEqual([]); });
it("map exposure mismatch rejected", async () => { const { c } = await harness([point()], "synthetic_demo"); expect(c.view.pins).toEqual([]); });

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { UnifiedRow, UnifiedSnapshot } from "@gobadminton/contracts";
import type { Me } from "../src/lib/consumer-types";
import type { apiFetch } from "../src/lib/api-client";
import { compatibleRadarConfig, UnifiedDirectoryController, unifiedDirectoryAvailable, UNIFIED_WIRE } from "../src/lib/unified-directory";

const now = Date.parse("2030-01-01T00:00:00Z");
const me = { id: "actor-a", csrfToken: "csrf-a" } as Me;
const filters = { cityId: "city-a" };
const config = { exposureMode: "live", unifiedDirectory: { enabled: true, contractVersion: UNIFIED_WIRE, disclosure: { text: "Согласие" } }, publishingV2: { enabled: true }, cities: [{ cityId: "city-a", regionId: "region-a", map: { availability: "missing" } }] };
const row = { publicPlayerId: "peer", projection: "radar", player: { publicPlayerId: "peer" }, radar: { consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: new Date(now + 45000).toISOString(), resultRef: "private-proof", geo: { latitude: 1, longitude: 2, crs: "EPSG:4326" } } } as unknown as UnifiedRow;
const snapshot = { policyVersion: "radar-geographic-sharing-v2", exposureMode: "authenticated_live", contractVersion: UNIFIED_WIRE, cityId: "city-a", validUntil: new Date(now + 45000).toISOString(), query: { queryRef: "private-query", originRef: "private-origin", originState: "authorized" }, items: [row], page: { nextCursor: "private-cursor" } } as unknown as UnifiedSnapshot;
const ok = (data: unknown) => ({ ok: true as const, status: 200, data });
const error = (status: number) => ({ ok: false as const, status, error: `HTTP ${status}`, retryAfterSeconds: status === 429 ? 90 : undefined });

describe("legacy capability fallback using mock cc56 / current responses", () => {
  it("defaults OFF for absent, malformed, disabled and unknown capabilities", () => {
    for (const value of [null, {}, { ...config, unifiedDirectory: null }, { ...config, unifiedDirectory: { ...config.unifiedDirectory, enabled: "true" } }, { ...config, unifiedDirectory: { ...config.unifiedDirectory, contractVersion: "future" } }, { ...config, cities: {} }, { ...config, publishingV2: null }, { ...config, exposureMode: "unknown" }]) {
      assert.equal(compatibleRadarConfig(value), null);
      assert.equal(unifiedDirectoryAvailable(compatibleRadarConfig(value), { capabilityUnavailable: false }), false);
    }
    assert.equal(unifiedDirectoryAvailable(compatibleRadarConfig({ ...config, unifiedDirectory: { ...config.unifiedDirectory, enabled: false } }), { capabilityUnavailable: false }), false);
    assert.equal(unifiedDirectoryAvailable(compatibleRadarConfig(config), { capabilityUnavailable: false }), true);
  });
  it("returns to ordinary catalog on query 404 and does not retry or retain a foreground fix", async () => {
    const calls: string[] = [];
    const request = (async (path: string) => { calls.push(path); return error(404); }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => now); c.bind(me);
    await c.query(filters, { kind: "foreground_fix", location: { latitude: 1, longitude: 2, accuracyMeters: 50, capturedAt: new Date(now).toISOString() } });
    assert.equal(c.view.mode, "ordinary"); assert.equal(c.view.capabilityUnavailable, true);
    assert.equal(c.view.snapshot, null); assert.deepEqual(c.view.rows, []); assert.deepEqual(c.view.pins, []);
    assert.match(c.view.notice, /обычным каталогом/);
    assert.equal(unifiedDirectoryAvailable(compatibleRadarConfig(config), c.view), false);
    c.ordinary(); await c.query(filters); await c.refresh(); await c.map(); await c.more();
    assert.deepEqual(calls, ["/v1/players/query"]);
  });
  for (const route of ["more", "map", "select"] as const) {
    it(`purges existing private context on ${route} 404`, async () => {
      let calls = 0;
      const c = new UnifiedDirectoryController((async () => ++calls === 1 ? ok(snapshot) : error(404)) as typeof apiFetch, () => now);
      c.bind(me); await c.query(filters);
      c.camera = { center: [1, 2], zoom: 10 };
      if (route === "select") await c.select(c.view.rows[0]!); else await c[route]();
      assert.equal(c.view.mode, "ordinary"); assert.equal(c.view.capabilityUnavailable, true);
      assert.equal(c.view.snapshot, null); assert.equal(c.view.preview, null); assert.equal(c.view.selected, null); assert.equal(c.view.mapPage, null);
      assert.deepEqual(c.view.rows, []); assert.deepEqual(c.view.pins, []); assert.equal(c.camera, null);
      assert.doesNotMatch(JSON.stringify(c.view), /private-proof|private-query|private-origin|private-cursor/);
      await c.refresh(); assert.equal(calls, 2);
    });
  }
  it("keeps authenticated errors distinct from missing capability and honors Retry-After", async () => {
    for (const [status, notice] of [[401, /Войдите снова/], [403, /Нет доступа/], [409, /Список изменился/], [429, /немного позже/]] as const) {
      let time = now, calls = 0;
      const c = new UnifiedDirectoryController((async () => { ++calls; return error(status); }) as typeof apiFetch, () => time);
      c.bind(me); await c.query(filters); assert.match(c.view.notice, notice);
      assert.equal(c.view.capabilityUnavailable, false); assert.equal(c.view.stale, true);
      if (status === 429) { time += 31000; await c.query(filters); assert.equal(calls, 1); time += 60000; await c.query(filters); assert.equal(calls, 2); }
    }
  });
  it("ignores late 404 and success after identity, STOP, background or dispose", async () => {
    for (const action of ["identity", "stop", "background", "dispose"] as const) for (const response of [error(404), ok(snapshot)]) {
      let resolve!: (value: unknown) => void;
      const pending = new Promise(r => { resolve = r; });
      const c = new UnifiedDirectoryController((async () => pending) as typeof apiFetch, () => now);
      c.bind(me); const read = c.query(filters);
      if (action === "identity") c.bind({ ...me, id: "actor-b", csrfToken: "csrf-b" });
      if (action === "stop") c.ordinary(); if (action === "background") c.visibility(false); if (action === "dispose") c.dispose();
      resolve(response); await read;
      assert.equal(c.view.capabilityUnavailable, false); assert.equal(c.view.snapshot, null); assert.deepEqual(c.view.rows, []);
    }
  });
  it("scopes missing-capability knowledge to identity/token and preserves current API results", async () => {
    let calls = 0;
    const c = new UnifiedDirectoryController((async () => ++calls === 1 ? error(404) : ok(snapshot)) as typeof apiFetch, () => now);
    c.bind(me); await c.query(filters); c.bind(me); await c.query(filters); assert.equal(calls, 1);
    c.bind({ ...me, csrfToken: "new-session" }); await c.query(filters);
    assert.equal(calls, 2); assert.equal(c.view.capabilityUnavailable, false); assert.equal(c.view.mode, "unified"); assert.deepEqual(c.view.rows, [row]);
  });
  it("preserves current API map, preview and reference-only refresh", async () => {
    let time = now;
    const bodies: Array<Record<string, unknown>> = [];
    const request = (async (path: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      if (path.endsWith("/preview")) return ok({ player: row.player, radar: { validUntil: snapshot.validUntil } });
      if (path.endsWith("/map")) return ok({ ...snapshot, mapPage: { hasMore: false, nextMapCursor: null } });
      return ok(snapshot);
    }) as typeof apiFetch;
    const c = new UnifiedDirectoryController(request, () => time); c.bind(me);
    await c.query(filters); await c.map(); await c.select(c.view.pins[0]!);
    assert.deepEqual(c.view.pins, [row]); assert.equal(c.view.selected, "peer"); assert.equal(c.view.preview?.player.publicPlayerId, "peer");
    time += 30000; await c.refresh();
    assert.deepEqual(bodies.at(-1)?.origin, { kind: "reference", originRef: "private-origin" });
    assert.equal(c.view.capabilityUnavailable, false);
  });
  it("cannot repaint a pending preview after map 404 invalidates its generation", async () => {
    let resolve!: (value: unknown) => void;
    const preview = new Promise(r => { resolve = r; });
    const c = new UnifiedDirectoryController((async (path: string) => path.endsWith("/preview") ? preview : path.endsWith("/map") ? error(404) : ok(snapshot)) as typeof apiFetch, () => now);
    c.bind(me); await c.query(filters); const selection = c.select(c.view.rows[0]!); await c.map();
    resolve(ok({ player: row.player, radar: { validUntil: snapshot.validUntil } })); await selection;
    assert.equal(c.view.mode, "ordinary"); assert.equal(c.view.preview, null); assert.equal(c.view.selected, null); assert.equal(c.view.capabilityUnavailable, true);
  });
});

it("retains feature 401 through successful same-account identity refresh and suppresses retries", async () => {
  let time = now, calls = 0;
  const c = new UnifiedDirectoryController((async () => { ++calls; return error(401); }) as typeof apiFetch, () => time);
  c.bind(me); await c.query(filters);
  c.bind({ ...me }); c.ordinary(); c.visibility(false); c.visibility(true);
  time += 31000; await c.query(filters); await c.refresh();
  assert.equal(calls, 1); assert.equal(c.view.authenticationRequired, true);
  assert.match(c.view.notice, /Войдите снова/); assert.equal(c.view.snapshot, null);
  c.bind({ ...me, csrfToken: "refreshed-same-account" });
  assert.equal(c.view.authenticationRequired, true); assert.match(c.view.notice, /Войдите снова/);
  c.bind({ ...me, id: "actor-b", csrfToken: "csrf-b" });
  assert.equal(c.view.authenticationRequired, false); assert.equal(c.view.notice, "");
});

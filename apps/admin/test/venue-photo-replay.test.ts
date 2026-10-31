import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { it } from "vitest";

const component = readFileSync(new URL("../src/components/VenuePhoto.tsx", import.meta.url), "utf8");
assert.ok(component.includes('async function run(operation:Pending){'));
assert.ok(component.includes('setPending(operation)'));
assert.ok(component.includes('"Idempotency-Key":operation.key'));
assert.ok(component.includes('"X-Venue-Version":String(operation.version)'));
assert.ok(component.includes('e.code!=="ADMIN_UPSTREAM_UNAVAILABLE"'));
assert.ok(component.includes("Повторить то же действие"));

class AdminError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

type Pending = { method: "POST"; path: string; body: Blob; key: string; version: number; headers: Record<string, string> };

async function exercise(outcome: string) {
  const state: { pending: Pending | null; receipt: { version: number }; changed: number; errors: unknown[] } =
    { pending: null, receipt: { version: 7 }, changed: 0, errors: [] };
  const requests: { method: string; body: Blob | string; headers: Record<string, string> }[] = [];
  const receipts = new Map<string, unknown>();
  let commits = 0;
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  const operation: Pending = {
    method: "POST", path: "/v1/admin/venues/x/gallery", body: blob,
    key: "11111111-1111-4111-8111-111111111111", version: 7, headers: {},
  };
  const fetch = async (_url: string, request: { method: string; body: Blob | string; headers: Record<string, string> }) => {
    requests.push(request);
    const key = request.headers["Idempotency-Key"];
    assert.ok(key);
    if (!receipts.has(key)) {
      assert.equal(Number(request.headers["X-Venue-Version"]), 7);
      if (outcome === "definite409") return new Response(JSON.stringify({ code: "VENUE_VERSION_CONFLICT" }), { status: 409 });
      commits++;
      receipts.set(key, { version: 8, items: [] });
      if (outcome === "network") throw new TypeError("lost");
      if (outcome === "timeout") throw new DOMException("lost", "TimeoutError");
      return new Response(JSON.stringify({ code: "ADMIN_UPSTREAM_UNAVAILABLE" }), { status: Number(outcome) || 503 });
    }
    return new Response(JSON.stringify(receipts.get(key)), { status: 200 });
  };
  async function run(op: Pending) {
    const current = state.pending ?? op;
    state.pending = current;
    try {
      const response = await fetch(current.path, {
        method: current.method, body: current.body,
        headers: {
          "Content-Type": current.body.type,
          "X-CSRF-Token": "csrf",
          "Idempotency-Key": current.key,
          "X-Venue-Version": String(current.version),
          ...current.headers,
        },
      });
      if (!response.ok) {
        const p = await response.json().catch(() => ({})) as { code?: string };
        throw new AdminError(p.code ?? "ADMIN_REQUEST_FAILED", response.status);
      }
      state.receipt = await response.json() as { version: number };
      state.pending = null;
      state.changed++;
    } catch (e) {
      if (e instanceof AdminError && e.status < 500 && e.status !== 408 && e.code !== "ADMIN_UPSTREAM_UNAVAILABLE" && e.code !== "ADMIN_STEP_UP_REQUIRED") {
        state.pending = null;
      }
      state.errors.push(e);
    }
  }
  await run(operation);
  return { state, requests, commits: () => commits, operation, run };
}

for (const outcome of ["503", "502", "504", "network", "timeout"]) {
  it("gallery upload recovers commit-then-lost-response via original operation after " + outcome, async () => {
    const h = await exercise(outcome);
    assert.ok(h.state.pending, "uncertain outcome must retain original operation");
    assert.equal(h.state.receipt.version, 7);
    assert.equal(h.state.errors.length, 1);
    await h.run(h.state.pending!);
    assert.equal(h.commits(), 1);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1]!.headers["Idempotency-Key"], h.operation.key);
    assert.equal(h.requests[1]!.headers["X-Venue-Version"], "7");
    assert.equal(h.state.pending, null);
    assert.equal(h.state.receipt.version, 8);
    assert.equal(h.state.changed, 1);
  });
}

it("definite version conflict clears pending without blind retry", async () => {
  const h = await exercise("definite409");
  assert.equal(h.state.pending, null);
  assert.equal(h.commits(), 0);
  assert.equal(h.state.receipt.version, 7);
});

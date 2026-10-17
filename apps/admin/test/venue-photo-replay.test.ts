import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { it } from "vitest";

// Execute the actual save closure, without React rendering or a fabricated DEV session.
// Only TypeScript's argument annotation and non-null assertion are erased.
const component = readFileSync(new URL("../src/components/VenuePhoto.tsx", import.meta.url), "utf8");
const start = component.indexOf(' async function save(method:"PUT"|"DELETE"){');
const end = component.indexOf('\n return <div', start);
assert.ok(start >= 0 && end > start);
const saveSource = component.slice(start, end)
  .replace('method:"PUT"|"DELETE"', "method").replace("blob!", "blob");
class AdminError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}
type Operation = { method: string; body: Blob | string; key: string; version: number };
function harness(method: string, outcome: string) {
  const state: { pending: Operation | null; receipt: {version: number}; changed: number; stepups: number; errors: unknown[] } =
    { pending: null, receipt: {version: 7}, changed: 0, stepups: 0, errors: [] };
  const requests: { method: string; body: Blob | string; headers: Record<string, string> }[] = [];
  const receipts = new Map<string, unknown>();
  let commits = 0;
  const blob = new Blob([new Uint8Array([0, 255, 13, 10, 128])], {type: "image/png"});
  const fetch = async (_url: string, request: typeof requests[number]) => {
    requests.push(request);
    const key = request.headers["Idempotency-Key"];
    if (outcome === "stepup" && receipts.has(key) && state.stepups === 0) return new Response(JSON.stringify({code: "ADMIN_STEP_UP_REQUIRED"}), {status: 403});
    if (!receipts.has(key)) {
      assert.equal(Number(request.headers["X-Venue-Version"]), 7);
      if (outcome === "definite409") return new Response(JSON.stringify({code: "VENUE_VERSION_CONFLICT"}), {status: 409});
      commits++;
      receipts.set(key, {version: 8, hasCover: method === "PUT", cover: {uploadedUrl: null}});
      if (outcome === "network") throw new TypeError("Response lost after commit");
      if (outcome === "timeout") throw new DOMException("Response lost after commit", "TimeoutError");
      const status = outcome === "stepup" ? 503 : Number(outcome);
      return new Response(JSON.stringify({code: status === 503 ? "ADMIN_UPSTREAM_UNAVAILABLE" : "ADMIN_REQUEST_FAILED"}), {status});
    }
    return new Response(JSON.stringify(receipts.get(key)), {status: 200});
  };
  const invoke = async (confirm = false) => {
    const scope = {
      busy: false, reading: false, receipt: state.receipt, pending: state.pending, blob,
      setBusy: () => {}, setPending: (value: Operation | null) => {state.pending = value;},
      setError: () => {}, setNotice: () => {}, setBlob: () => {}, setConfirm: () => {},
      setReceipt: (value: {version: number}) => {state.receipt = value;},
      changed: async () => {state.changed++;}, fail: (error: unknown) => {state.errors.push(error);},
      stepup: async () => {state.stepups++;}, setReadAttempt: () => {},
      fetch, adminPath: (path: string) => path, id: "synthetic-local-venue",
      session: {csrfToken: "synthetic-only"}, AdminError,
    };
    const code = confirm ? component.slice(component.indexOf(" async function confirmAccess(){"), component.indexOf(" async function select(")) : saveSource;
    const action = new Function(...Object.keys(scope), "return (" + code + ");")(...Object.values(scope));
    await action(method);
  };
  return {state, requests, invoke, commits: () => commits};
}
for (const method of ["PUT", "DELETE"]) {
  for (const outcome of ["503", "502", "504", "network", "timeout"]) {
    it(method + " recovers commit-then-lost-response via original operation after " + outcome, async () => {
      const h = harness(method, outcome);
      await h.invoke();
      assert.ok(h.state.pending, "uncertain outcome must retain original operation");
      const original = h.state.pending;
      assert.equal(h.state.receipt.version, 7);
      assert.equal(h.state.errors.length, 1);
      await h.invoke();
      assert.equal(h.commits(), 1);
      assert.equal(h.requests.length, 2);
      assert.equal(h.requests[1].method, original.method);
      assert.equal(h.requests[1].body, original.body);
      assert.equal(h.requests[1].headers["Idempotency-Key"], original.key);
      assert.equal(h.requests[1].headers["X-Venue-Version"], String(original.version));
      assert.equal(h.state.pending, null);
      assert.equal(h.state.receipt.version, 8);
      assert.equal(h.state.changed, 1);
    });
  }
  it(method + " clears pending on definite version rejection without claiming success", async () => {
    const h = harness(method, "definite409");
    await h.invoke();
    assert.equal(h.state.pending, null);
    assert.equal(h.commits(), 0);
    assert.equal(h.state.changed, 0);
    assert.equal(h.state.errors.length, 1);
    assert.equal(h.state.receipt.version, 7);
  });
}

for (const method of ["PUT", "DELETE"]) {
  it(method + " preserves uncertain operation through required step-up and explicit replay", async () => {
    const h = harness(method, "stepup");
    await h.invoke();
    assert.ok(h.state.pending);
    const original = h.state.pending;
    await h.invoke();
    assert.equal(h.state.pending, original, "step-up rejection must not discard unresolved operation");
    assert.equal(h.state.changed, 0);
    const beforeConfirmation = h.requests.length;
    await h.invoke(true);
    assert.equal(h.state.stepups, 1, "pending operation must not block legitimate step-up");
    assert.equal(h.requests.length, beforeConfirmation, "confirmation must not auto-submit mutation");
    assert.equal(h.state.pending, original);
    await h.invoke();
    assert.equal(h.commits(), 1);
    assert.equal(h.requests.length, 3);
    for (const request of h.requests) {
      assert.equal(request.headers["Idempotency-Key"], original.key);
      assert.equal(request.headers["X-Venue-Version"], String(original.version));
      assert.equal(request.body, original.body);
    }
    assert.equal(h.state.pending, null);
    assert.equal(h.state.receipt.version, 8);
    assert.equal(h.state.changed, 1);
  });
}

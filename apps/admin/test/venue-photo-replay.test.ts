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
  const state: { pending: Operation | null; receipt: {version: number}; changed: number; errors: unknown[] } =
    { pending: null, receipt: {version: 7}, changed: 0, errors: [] };
  const requests: { method: string; body: Blob | string; headers: Record<string, string> }[] = [];
  const receipts = new Map<string, unknown>();
  let commits = 0;
  const blob = new Blob([new Uint8Array([0, 255, 13, 10, 128])], {type: "image/png"});
  const fetch = async (_url: string, request: typeof requests[number]) => {
    requests.push(request);
    const key = request.headers["Idempotency-Key"];
    if (!receipts.has(key)) {
      assert.equal(Number(request.headers["X-Venue-Version"]), 7);
      if (outcome === "definite409") return new Response(JSON.stringify({code: "VENUE_VERSION_CONFLICT"}), {status: 409});
      commits++;
      receipts.set(key, {version: 8, hasCover: method === "PUT", cover: {uploadedUrl: null}});
      if (outcome === "network") throw new TypeError("Response lost after commit");
      if (outcome === "timeout") throw new DOMException("Response lost after commit", "TimeoutError");
      const status = Number(outcome);
      return new Response(JSON.stringify({code: status === 503 ? "ADMIN_UPSTREAM_UNAVAILABLE" : "ADMIN_REQUEST_FAILED"}), {status});
    }
    return new Response(JSON.stringify(receipts.get(key)), {status: 200});
  };
  const invoke = async () => {
    const scope = {
      busy: false, reading: false, receipt: state.receipt, pending: state.pending, blob,
      setBusy: () => {}, setPending: (value: Operation | null) => {state.pending = value;},
      setError: () => {}, setNotice: () => {}, setBlob: () => {}, setConfirm: () => {},
      setReceipt: (value: {version: number}) => {state.receipt = value;},
      changed: async () => {state.changed++;}, fail: (error: unknown) => {state.errors.push(error);},
      fetch, adminPath: (path: string) => path, id: "synthetic-local-venue",
      session: {csrfToken: "synthetic-only"}, AdminError,
    };
    const save = new Function(...Object.keys(scope), "return (" + saveSource + ");")(...Object.values(scope));
    await save(method);
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

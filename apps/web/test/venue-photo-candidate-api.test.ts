/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  candidatePrivatePreview, getOwnedVenuePhotoCandidate, isCandidateEvidence, isVenuePhotoCandidate,
  uploadVenuePhotoCandidate, withdrawVenuePhotoCandidate,
} from "../src/lib/venue-photo-candidates-api";
import type { CandidateEvidence } from "../src/lib/venue-photo-candidates-api";
const venue = "10000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000002";
const evidence: CandidateEvidence = { creditKind: "photo", creditText: "Фото: Анна %", creditUrl: "https://example.org/anna", sourceUrl: "https://example.org/photo", permissionBasis: "Письменное разрешение автора на публикацию" };
const receipt = { id, venueId: venue, status: "awaiting_review", version: 1, width: 1200, height: 400, evidence, previewPath: `/v1/me/venue-photo-candidates/${id}/content` };
afterEach(() => vi.unstubAllGlobals());
describe("I3b candidate wire contract", () => {
  it("sends only supplied derivative and exact candidate rights/evidence with stable command keys", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(receipt), { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const bytes = new Blob(["confirmed-derivative"], { type: "image/webp" });
    const signal = new AbortController().signal;
    const key = "fixed-candidate-key-0001";
    const result = await uploadVenuePhotoCandidate(venue, bytes, evidence, key, "csrf", signal);
    expect(result).toEqual({ ok: true, status: 201, data: receipt });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(call[0]).toBe(`/v1/venues/${venue}/photo-candidates`);
    const init = call[1]!; const headers = new Headers(init.headers);
    expect(init.body).toBe(bytes); expect(init.credentials).toBe("include"); expect(init.cache).toBe("no-store");
    expect(init.signal).toBe(signal); expect(headers.get("Content-Type")).toBe(bytes.type);
    expect(headers.get("Idempotency-Key")).toBe(key); expect(headers.get("X-CSRF-Token")).toBe("csrf");
    expect(headers.get("X-Photo-Rights")).toBe("venue-candidate-rights-v1");
    expect(headers.get("X-Gallery-Credit-Kind")).toBe("photo");
    expect(headers.get("X-Gallery-Credit-Text")).toBe(encodeURIComponent(evidence.creditText));
    expect(headers.get("X-Gallery-Credit-Url")).toBe(encodeURIComponent(evidence.creditUrl));
    expect(headers.get("X-Gallery-Source-Url")).toBe(encodeURIComponent(evidence.sourceUrl));
    expect(decodeURIComponent(headers.get("X-Gallery-Permission-Basis")!)).toBe(evidence.permissionBasis);
    expect(headers.get("X-Gallery-Source-Author")).toBe("null"); expect(headers.get("X-Gallery-Source-Fingerprint")).toBe("null");
    await getOwnedVenuePhotoCandidate(id, signal);
    await withdrawVenuePhotoCandidate(id, "fixed-withdraw-key-0001", "csrf", signal);
    const withdrawal = vi.mocked(fetch).mock.calls[2]!;
    expect(withdrawal[0]).toBe(`/v1/me/venue-photo-candidates/${id}`);
    expect(withdrawal[1]?.method).toBe("DELETE");
    expect(JSON.parse(String(withdrawal[1]?.body))).toEqual({ expectedVersion: 1 });
    expect(new Headers(withdrawal[1]?.headers).get("X-Photo-Version")).toBe("1");
    expect(new Headers(withdrawal[1]?.headers).get("Idempotency-Key")).toBe("fixed-withdraw-key-0001");
  });
  it("validates known identity, canonical venue, status/version and exact private path before preview", async () => {
    expect(isVenuePhotoCandidate(receipt, venue, id)).toBe(true);
    for (const change of [{ id: "unknown" }, { venueId: id }, { version: 2 }, { status: "ready" }, { width: 400 }, { previewPath: `https://evil.invalid/${id}` }]) {
      expect(isVenuePhotoCandidate({ ...receipt, ...change }, venue, id)).toBe(false);
    }
    expect(isVenuePhotoCandidate({ ...receipt, status: "accepted", version: 2, previewPath: null }, venue, id)).toBe(true);
    expect(isVenuePhotoCandidate({ ...receipt, status: "accepted", version: 2 }, venue, id)).toBe(false);
    expect(isCandidateEvidence({ ...evidence, permissionBasis: "licensed" })).toBe(false);
    expect(isCandidateEvidence({ ...evidence, sourceUrl: "http://example.org" })).toBe(false);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(candidatePrivatePreview({ ...receipt, status: "accepted", version: 2, previewPath: null, width: 1200, height: 400 }, new AbortController().signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

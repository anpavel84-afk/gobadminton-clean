// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../src/lib/api-client";
import { isCommunityPhotoPage } from "../src/lib/venue-comment-photos-api";
import { isCurrentPhotoSource } from "../src/lib/comments-api";
import { useVenueCommunityPhotos } from "../src/components/consumer/venues/useVenueCommunityPhotos";
import type { VenueCommunityPhoto } from "../src/lib/comments-types";
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
const venue = "10000000-0000-4000-8000-000000000001";
const comment = "10000000-0000-4000-8000-000000000002";
const parent = "10000000-0000-4000-8000-000000000003";
const photo = (n: number, reply = false): VenueCommunityPhoto => ({
  id: `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`, width: 400, height: 300,
  url: `/v1/comments/${comment}/revisions/2/photos/20000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  source: { commentId: comment, parentCommentId: reply ? parent : null, resourceVersion: 2, path: `/v1/comments/${comment}` },
});
const first = Array.from({ length: 24 }, (_, i) => photo(i));
const page = (items = first, nextCursor: string | null = "opaque+cursor/one=") => ({ venueId: venue, items, nextCursor });
const ok = (data: unknown) => ({ ok: true as const, status: 200, data });
const source = (p = photo(24, true)) => ({ id: comment, entityId: venue, entityKind: "venue", parentCommentId: p.source.parentCommentId,
  body: "Текущий источник", deleted: false, version: 2, photos: [{ id: p.id, width: p.width, height: p.height, url: p.url }],
  mine: false, edited: true, author: null, replyCount: 0, createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T11:00:00Z" });
afterEach(() => { cleanup(); vi.mocked(apiFetch).mockReset(); });

describe("I2c2 current-photo API contracts", () => {
  it("accepts a real 24-item opaque page and rejects invented routes, stale versions, duplicates and malformed source", () => {
    expect(isCommunityPhotoPage(page())).toBe(true);
    expect(isCommunityPhotoPage(page([photo(1)], "cursor"))).toBe(false);
    expect(isCommunityPhotoPage(page([photo(1), photo(1)], null))).toBe(false);
    for (const url of ["https://example.test/photo", photo(1).url + "?raw=1", photo(1).url.replace("/2/", "/1/")]) {
      expect(isCommunityPhotoPage(page([{ ...photo(1), url }], null))).toBe(false);
    }
    expect(isCommunityPhotoPage(page([{ ...photo(1), source: { ...photo(1).source, path: "/media/1" } }], null))).toBe(false);
    expect(isCurrentPhotoSource(source(), photo(24, true))).toBe(true);
    expect(isCurrentPhotoSource({ ...source(), version: 3 }, photo(24, true))).toBe(false);
    expect(isCurrentPhotoSource({ ...source(), deleted: true }, photo(24, true))).toBe(false);
    expect(isCurrentPhotoSource({ ...source(), photos: [] }, photo(24, true))).toBe(false);
    expect(isCurrentPhotoSource({ ...source(), author: {} }, photo(24, true))).toBe(false);
  });
  it("keeps photo 24 on next-page failure, retries the exact opaque cursor and resolves a later-page reply with bounded credit and current source reads", async () => {
    let fail = true;
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === `/v1/comments/${comment}`) return ok(source()) as never;
      if (path.includes("?cursor=")) return (fail ? { ok: false, status: 503, error: "offline" } : ok(page([photo(24, true)], null))) as never;
      return ok(page()) as never;
    });
    const { result } = renderHook(() => useVenueCommunityPhotos(venue, null, null));
    await waitFor(() => expect(result.current.items).toHaveLength(24));
    act(() => result.current.open(first[23]!));
    await act(async () => result.current.move(1));
    expect(result.current.selected?.id).toBe(first[23]!.id);
    expect(result.current.phase).toBe("error"); fail = false;
    await act(async () => result.current.move(1));
    expect(result.current.selected?.id).toBe(photo(24).id);
    expect(result.current.items).toHaveLength(25);
    expect(result.current.cursor).toBeNull();
    await act(async () => result.current.jump());
    expect(result.current.selection).toBeNull(); expect(result.current.source?.parentCommentId).toBe(parent);
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === `/v1/comments/${comment}`)).toHaveLength(3);
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.includes("?cursor=" )).map(([path]) => path)).toEqual([
      `/v1/venues/${venue}/community-photos?cursor=opaque%2Bcursor%2Fone%3D`,
      `/v1/venues/${venue}/community-photos?cursor=opaque%2Bcursor%2Fone%3D`,
    ]);
  });
  it("drops family cursor and viewer on 409; restart never sends the stale cursor", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => (path.includes("?cursor=")
      ? { ok: false, status: 409, error: "changed", problem: { code: "VENUE_CANONICAL_CHANGED" } } : ok(page())) as never);
    const { result } = renderHook(() => useVenueCommunityPhotos(venue, null, null));
    await waitFor(() => expect(result.current.items).toHaveLength(24));
    act(() => result.current.open(first[23]!)); await act(async () => result.current.move(1));
    expect(result.current.phase).toBe("restart"); expect(result.current.items).toHaveLength(0); expect(result.current.selection).toBeNull();
    await act(async () => result.current.restart());
    expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[0]).toBe(`/v1/venues/${venue}/community-photos`);
  });
  it("aborts and hides previous actor/venue reads, including away-and-return and session expiry", async () => {
    let finish!: (v: never) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(ok(page([], null)) as never);
    const { result, rerender } = renderHook(({ actor, id }) => useVenueCommunityPhotos(id, actor, "session"), { initialProps: { actor: "a", id: venue } });
    const firstSignal = vi.mocked(apiFetch).mock.calls[0]?.[1]?.signal;
    rerender({ actor: "b", id: parent }); rerender({ actor: "a", id: venue });
    await act(async () => finish(ok(page()) as never));
    expect(firstSignal?.aborted).toBe(true); expect(result.current.items).toHaveLength(0);
    act(() => window.dispatchEvent(new Event("gb-private-expired")));
    expect(result.current.selection).toBeNull(); expect(result.current.source).toBeNull();
    const count = vi.mocked(apiFetch).mock.calls.length;
    await act(async () => result.current.restart()); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(count);
  });
  it("rejects revised/revoked source and fences a detail response after close", async () => {
    let finish!: (v: never) => void;
    vi.mocked(apiFetch).mockImplementation(async (path) => path.includes("community-photos") ? ok(page([photo(24, true)], null)) as never : await new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useVenueCommunityPhotos(venue, null, null));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.open(photo(24, true)));
    let pending!: Promise<void>; act(() => { pending = result.current.jump(); });
    await act(async () => { finish(ok({ ...source(), version: 3 }) as never); await pending; });
    expect(result.current.source).toBeNull(); expect(result.current.sourceError).toContain("изменилась");
    act(() => { pending = result.current.jump(); }); act(() => result.current.close());
    await act(async () => { finish(ok(source()) as never); await pending; });
    expect(result.current.source).toBeNull(); expect(result.current.selection).toBeNull();
  });
});

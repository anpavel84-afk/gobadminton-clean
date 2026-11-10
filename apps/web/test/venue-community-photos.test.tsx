// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../src/lib/api-client";
import { isCommunityPhotoPage } from "../src/lib/venue-comment-photos-api";
import { isCurrentPhotoSource } from "../src/lib/comments-api";
import { useVenueCommunityPhotos } from "../src/components/consumer/venues/useVenueCommunityPhotos";
import { VenueCommunityContent } from "../src/components/consumer/venues/VenueCommunityContent";
import type { VenueCommunityPhoto } from "../src/lib/comments-types";
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
vi.mock("../src/components/consumer/venues/VenueCommunityPhotoViewer", () => ({ VenueCommunityPhotoViewer: () => null }));
vi.mock("../src/components/consumer/venues/VenueCommunityRating", () => ({ VenueCommunityRating: () => <section>Оценки</section> }));
vi.mock("../src/components/consumer/venues/VenueReviewsPanel", () => ({ VenueReviewsPanel: () => <section>Отзывы</section> }));
vi.mock("../src/components/consumer/comments/CommentsSection", () => ({
  CommentsSection: ({ onUnresolvedChange }: { onUnresolvedChange: (value: boolean) => void }) => <section>Обсуждение<button onClick={() => onUnresolvedChange(true)}>Незавершённая публикация</button></section>,
}));
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
afterEach(() => { cleanup(); vi.mocked(apiFetch).mockReset(); });

describe("I2c2 one community owner in page and expanded map host", () => {
  it("keeps one gallery/read across density changes, bottom order and the existing unresolved guard", async () => {
    vi.mocked(apiFetch).mockResolvedValue(ok(page([], null)));
    const unresolved = vi.fn();
    const props = { venueId: venue, me: null, authReturnPath: `/venues/${venue}`, onUnresolvedChange: unresolved };
    const { container, rerender } = render(<VenueCommunityContent {...props} />);
    await screen.findByText("Пока нет фотографий сообщества.");
    expect(Array.from(container.querySelectorAll("[data-community-section]")).map((node) => node.getAttribute("data-community-section"))).toEqual(["ratings", "discussion", "reviews", "photos"]);
    const owner = container.querySelector("[data-venue-community]");
    expect(container.querySelectorAll("[data-venue-community]")).toHaveLength(1);
    rerender(<VenueCommunityContent {...props} embedded />);
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1));
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe(`/v1/venues/${venue}/community-photos`);
    expect(container.querySelector("[data-venue-community]")).toBe(owner);
    expect(screen.getAllByRole("region", { name: "Фотографии сообщества" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Незавершённая публикация" }));
    expect(unresolved).toHaveBeenLastCalledWith(true);
  });
  it("keeps the existing community usable when its new gallery read fails and retries only on request", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: false, status: 0, error: "Unavailable gallery transport" })
      .mockResolvedValue(ok(page([], null)));
    const unresolved = vi.fn();
    render(<VenueCommunityContent venueId={venue} me={null} authReturnPath={`/venues/${venue}`} onUnresolvedChange={unresolved} />);
    await screen.findByText("Не удалось загрузить фотографии.");
    expect(screen.queryByText("Пока нет фотографий сообщества.")).toBeNull();
    expect(screen.getByText("Оценки")).toBeTruthy();
    expect(screen.getByText("Отзывы")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Незавершённая публикация" }));
    expect(unresolved).toHaveBeenLastCalledWith(true);
    expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Обновить фотографии" }));
    await screen.findByText("Пока нет фотографий сообщества.");
    expect(vi.mocked(apiFetch).mock.calls.map(([path]) => path)).toEqual([
      `/v1/venues/${venue}/community-photos`, `/v1/venues/${venue}/community-photos`,
    ]);
  });
});

describe("I2c2 current-photo API contracts", () => {
  it.each(["close", "jump"] as const)("keeps the initial gallery loading through inline %s and populates its valid response", async (action) => {
    const initialRead = deferred<ReturnType<typeof ok>>();
    const inline = photo(24, true);
    vi.mocked(apiFetch).mockImplementation(async (path) => (path.includes("community-photos")
      ? await initialRead.promise : ok(source(inline))) as never);
    const { result } = renderHook(() => useVenueCommunityPhotos(venue, null, null));
    expect(result.current.phase).toBe("loading");
    act(() => result.current.open(inline, [inline]));
    expect(result.current.selected).toEqual(inline);
    expect(result.current.items).toEqual([]);
    await act(async () => { await result.current[action](); });
    expect(result.current.selection).toBeNull();
    expect(result.current.phase).toBe("loading");
    expect(result.current.items).toEqual([]);
    expect(result.current.source).toEqual(action === "jump" ? source(inline) : null);
    await act(async () => initialRead.resolve(ok(page())));
    expect(result.current.phase).toBe("ready");
    expect(result.current.items).toEqual(first);
    expect(result.current.cursor).toBe("opaque+cursor/one=");
    expect(result.current.selection).toBeNull();
    expect(result.current.source).toEqual(action === "jump" ? source(inline) : null);
  });
  it.each(["close", "jump"] as const)("fences the preserved initial read after inline %s when the actor changes", async (action) => {
    const oldRead = deferred<ReturnType<typeof ok>>();
    const newRead = deferred<ReturnType<typeof ok>>();
    const inline = photo(24, true);
    let galleryReads = 0;
    vi.mocked(apiFetch).mockImplementation(async (path) => (path.includes("community-photos")
      ? await (++galleryReads === 1 ? oldRead.promise : newRead.promise) : ok(source(inline))) as never);
    const { result, rerender } = renderHook(({ actor }) => useVenueCommunityPhotos(venue, actor, "session"), { initialProps: { actor: "a" } });
    const oldSignal = vi.mocked(apiFetch).mock.calls[0]?.[1]?.signal;
    act(() => result.current.open(inline, [inline]));
    await act(async () => { await result.current[action](); });
    expect(result.current.phase).toBe("loading");
    rerender({ actor: "b" });
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.phase).toBe("loading");
    expect(result.current.items).toEqual([]);
    expect(result.current.selection).toBeNull();
    expect(result.current.source).toBeNull();
    const newItems = [photo(40)];
    await act(async () => newRead.resolve(ok(page(newItems, null))));
    expect(result.current.phase).toBe("ready");
    expect(result.current.items).toEqual(newItems);
    // The old transport deliberately completes despite abort after the new actor's response.
    await act(async () => oldRead.resolve(ok(page())));
    expect(result.current.phase).toBe("ready");
    expect(result.current.items).toEqual(newItems);
    expect(result.current.cursor).toBeNull();
    expect(result.current.source).toBeNull();
  });
  it.each(["close", "jump"] as const)("still cancels a pending next page on viewer %s without losing loaded photos", async (action) => {
    const nextRead = deferred<ReturnType<typeof ok>>();
    vi.mocked(apiFetch).mockImplementation(async (path) => (path.includes("?cursor=")
      ? await nextRead.promise : path.includes("community-photos") ? ok(page()) : ok(source(first[23]!))) as never);
    const { result } = renderHook(() => useVenueCommunityPhotos(venue, null, null));
    await waitFor(() => expect(result.current.items).toEqual(first));
    act(() => result.current.open(first[23]!));
    act(() => result.current.move(1));
    expect(result.current.phase).toBe("loading");
    await act(async () => { await result.current[action](); });
    expect(result.current.selection).toBeNull();
    expect(result.current.phase).toBe("ready");
    expect(result.current.items).toEqual(first);
    await act(async () => nextRead.resolve(ok(page([photo(24, true)], null))));
    expect(result.current.items).toEqual(first);
    expect(result.current.cursor).toBe("opaque+cursor/one=");
    expect(result.current.selection).toBeNull();
  });
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

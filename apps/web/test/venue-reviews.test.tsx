/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type * as ReviewApi from "../src/lib/venue-reviews-api";
import type { ApiResult } from "../src/lib/api-client";
import { VenueReviewComposer } from "../src/components/consumer/venues/VenueReviewComposer";
import { VenueReviewsPanel } from "../src/components/consumer/venues/VenueReviewsPanel";

const api = vi.hoisted(() => ({ eligibility: vi.fn<typeof ReviewApi.getOwnVenueReviewEligibility>(),
  preview: vi.fn<typeof ReviewApi.previewVenueReviewConsent>(), send: vi.fn<typeof ReviewApi.createVenueReview>(),
  reviews: vi.fn<typeof ReviewApi.getVenueExperienceReviews>() }));
vi.mock("../src/lib/venue-reviews-api", async original => ({ ...await original<typeof ReviewApi>(), getOwnVenueReviewEligibility: api.eligibility,
  previewVenueReviewConsent: api.preview, createVenueReview: api.send, getVenueExperienceReviews: api.reviews }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
  createElement("a", { href, ...props }, children) }));

const venue = "10000000-0000-4000-8000-000000000001";
const actor = "30000000-0000-4000-8000-000000000001";
const basis: ReviewApi.OwnVenueEligibilityBasis = { gameId: "game-one", gameTitle: "Игра", admission: "may_submit",
  reason: null, outcomeVersion: 7, attendanceVersion: 12, firstEligibleAt: null, helpHint: null };
const receipt: ApiResult<ReviewApi.VenueReviewMutationReceipt> = { ok: true, status: 201, data: {
  id: "review-one", version: 1, status: "self_draft", reviewHandle: "handle", receiptToken: "receipt",
  publicVisible: false, notBefore: null } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  api.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases: [basis] } });
  api.preview.mockResolvedValue({ ok: true, status: 200, data: { consentProjectionHash: "projection-one", authorLabel: "Участник игры" } });
  api.send.mockResolvedValue({ ok: false, status: 503, error: "unconfirmed" });
  api.reviews.mockResolvedValue({ ok: true, status: 200, data: { venueId: venue, publishedCount: 1,
    items: [{ reviewHandle: "published", authorLabel: "Участник игры", text: "Публичный опыт после игры",
      topics: [], publishedRevision: 1, publishedAt: "2026-11-01T12:00:00Z" }], nextCursor: null, canWriteHint: false } });
});
afterEach(cleanup);
async function ready() { await screen.findByText("Можно поделиться опытом"); }
function composer(props: Partial<Parameters<typeof VenueReviewComposer>[0]> = {}) {
  return createElement(VenueReviewComposer, { venueId: venue, actorId: actor, csrfToken: "session-one", onClose: vi.fn(), ...props });
}
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../src/components/consumer/venues");

describe("venue reviews UI contracts", () => {
  it("defaults audience to self_draft and requires unchecked public consent", () => {
    const composer = readFileSync(path.join(root, "VenueReviewComposer.tsx"), "utf8");
    expect(composer).toMatch(/useState<VenueAudience>\("self_draft"\)/);
    expect(composer).toMatch(/setConsent\(false\)/);
    expect(composer).toMatch(/consentProjectionHash/);
    expect(composer).toMatch(/Не удалось подтвердить отправку/);
    expect(composer).toMatch(/Участник игры/);
  });

  it("VenuePage composes the public experience panel through shared community content and retains the generic CTA", async () => {
    const page = readFileSync(path.join(root, "VenuePage.tsx"), "utf8");
    const community = readFileSync(path.join(root, "VenueCommunityContent.tsx"), "utf8");
    expect(page).toMatch(/import \{ VenueCommunityContent \} from "\.\/VenueCommunityContent"/);
    expect(page).toMatch(/<VenueCommunityContent\b[^>]*venueId=\{venue\.id\}/);
    expect(community).toMatch(/import \{ VenueReviewsPanel \} from "\.\/VenueReviewsPanel"/);
    expect(community).toMatch(/<VenueReviewsPanel\b[^>]*venueId=\{venueId\}/);
    expect(page).not.toMatch(/напишите комментарий/i);
    const login = vi.fn();
    render(createElement(VenueReviewsPanel, { venueId: venue, onLogin: login }));
    const panel = screen.getByRole("region", { name: "Опыт на площадке" });
    expect(await within(panel).findByText("Публичный опыт после игры")).toBeTruthy();
    expect(api.reviews).toHaveBeenCalledWith(venue, { limit: 5 });
    fireEvent.click(within(panel).getByRole("button", { name: /^Поделиться опытом$/ }));
    expect(login).toHaveBeenCalledTimes(1);
  });
});


describe("mounted review operation ownership", () => {
  it("keeps the admitted public packet through pending/503/close and exact retry", async () => {
    const pending = deferred<Awaited<ReturnType<typeof ReviewApi.createVenueReview>>>();
    api.send.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...receipt, data: { ...receipt.data, status: "submitted" } });
    const unresolved = vi.fn(), close = vi.fn();
    render(composer({ onUnresolvedChange: unresolved, onClose: close }));
    await ready();
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "  Точный опыт  " } });
    fireEvent.click(screen.getByLabelText("Всем на странице площадки"));
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true));
    expect(unresolved).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(unresolved).toHaveBeenLastCalledWith(true);
    const firstCall = api.send.mock.calls[0];
    if (!firstCall) throw new Error("Missing admitted review send");
    const original: Parameters<typeof ReviewApi.createVenueReview> = structuredClone(firstCall);
    expect(original[0]).toEqual({ venueId: venue, gameId: basis.gameId, audience: "public_venue", text: "Точный опыт",
      topics: ["surface"], expectedBasisVersions: { outcomeVersion: 7, attendanceVersion: 12 }, consentProjectionHash: "projection-one" });
    expect(original[1]).toBe("session-one"); expect(original[2]).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Как вам площадка?" });
    const header = dialog.querySelector<HTMLElement>("header");
    const actions = dialog.querySelector<HTMLElement>(".gb-venue-reviews__actions");
    if (!header || !actions) throw new Error("Missing review close controls");
    const headerClose = within(header).getByRole("button", { name: /^Закрыть$/ });
    const footerClose = within(actions).getByRole("button", { name: /^Закрыть$/ });
    expect((footerClose as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(headerClose);
    fireEvent.click(footerClose);
    expect(close).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: false, status: 503, error: "unconfirmed" }));
    expect((footerClose as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(headerClose);
    fireEvent.click(footerClose);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect((screen.getByLabelText("Ваш опыт на площадке") as HTMLTextAreaElement).disabled).toBe(true);
    expect(unresolved).toHaveBeenLastCalledWith(true);
    // Even a programmatic control drift cannot change an already admitted retry packet.
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Другой текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить отправку" }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
    expect(api.send.mock.calls[1]).toEqual(original);
    await screen.findByText(/Публикация — после независимой проверки и паузы 48 часов/);
    expect(unresolved).toHaveBeenLastCalledWith(false);
    expect((footerClose as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(footerClose);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["gb-session-changed", "gb-private-expired", "actor", "csrf", "venue"])("fences late send and prior retry on %s", async boundary => {
    const pending = deferred<Awaited<ReturnType<typeof ReviewApi.createVenueReview>>>();
    api.send.mockReturnValueOnce(pending.promise);
    const submitted = vi.fn(), unresolved = vi.fn();
    const props = { onSubmitted: submitted, onUnresolvedChange: unresolved };
    const view = render(composer(props)); await ready();
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Текст" } });
    fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    expect(unresolved).toHaveBeenLastCalledWith(true);
    if (boundary.startsWith("gb-")) act(() => { window.dispatchEvent(new Event(boundary)); });
    else view.rerender(composer({ ...props, ...(boundary === "actor" ? { actorId: "another-actor" }
      : boundary === "csrf" ? { csrfToken: "session-two" } : { venueId: "another-venue" }) }));
    await act(async () => pending.resolve(receipt));
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.queryByText("Сохранено только вам.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Проверить отправку" })).toBeNull();
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(unresolved).toHaveBeenLastCalledWith(false);
  });

  it.each(["draft", "gb-session-changed", "gb-private-expired", "venue"])("ignores a stale consent preview after %s", async boundary => {
    const pending = deferred<Awaited<ReturnType<typeof ReviewApi.previewVenueReviewConsent>>>();
    api.preview.mockReturnValueOnce(pending.promise);
    const unresolved = vi.fn();
    const view = render(composer({ onUnresolvedChange: unresolved })); await ready();
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Первый текст" } });
    fireEvent.click(screen.getByLabelText("Всем на странице площадки"));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(unresolved).toHaveBeenLastCalledWith(false); // Preview is a read, not an admitted send.
    if (boundary === "draft") fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Второй текст" } });
    else if (boundary === "venue") view.rerender(composer({ venueId: "another-venue", onUnresolvedChange: unresolved }));
    else act(() => { window.dispatchEvent(new Event(boundary)); });
    await act(async () => pending.resolve({ ok: true, status: 200, data: { consentProjectionHash: "stale", authorLabel: "Участник игры" } }));
    const checkbox = screen.queryByRole("checkbox") as HTMLInputElement | null;
    if (checkbox) expect(checkbox.checked).toBe(false);
    expect(api.send).not.toHaveBeenCalled();
  });
});

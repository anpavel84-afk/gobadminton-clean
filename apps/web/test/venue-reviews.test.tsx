/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import type * as ReviewApi from "../src/lib/venue-reviews-api";
import type { ApiResult } from "../src/lib/api-client";
import { VenueReviewComposer } from "../src/components/consumer/venues/VenueReviewComposer";
import { VenueReviewsPanel } from "../src/components/consumer/venues/VenueReviewsPanel";
import { ProfileDialog } from "../src/components/consumer/players/ProfileComposition";

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
  return createElement(VenueReviewComposer, { venueId: venue, gameId: basis.gameId, actorId: actor, csrfToken: "session-one", onClose: vi.fn(), ...props });
}
// jsdom has no native CloseWatcher: model its noncancelable cancel + actual close.
function forceNativeClose(dialog: HTMLElement) {
  const cancel = new Event("cancel", { cancelable: false });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(false);
  dialog.removeAttribute("open");
  fireEvent(dialog, new Event("close"));
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

  it.each([false, true])("keeps the shared public panel read-only for signed-in=%s", async signedIn => {
    const page = readFileSync(path.join(root, "VenuePage.tsx"), "utf8");
    const community = readFileSync(path.join(root, "VenueCommunityContent.tsx"), "utf8");
    expect(page).toMatch(/import \{ VenueCommunityContent \} from "\.\/VenueCommunityContent"/);
    expect(page).toMatch(/<VenueCommunityContent\b[^>]*venueId=\{venue\.id\}/);
    expect(community).toMatch(/import \{ VenueReviewsPanel \} from "\.\/VenueReviewsPanel"/);
    expect(community).toMatch(/<VenueReviewsPanel\b[^>]*venueId=\{venueId\}/);
    expect(page).not.toMatch(/напишите комментарий/i);
    const login = vi.fn();
    render(createElement(VenueReviewsPanel, { venueId: venue, onLogin: login, canWrite: signedIn,
      csrfToken: signedIn ? "session-one" : null, actorId: signedIn ? actor : null }));
    const panel = screen.getByRole("region", { name: "Отзывы после игры" });
    expect(await within(panel).findByText("Публичный опыт после игры")).toBeTruthy();
    expect(api.reviews).toHaveBeenCalledWith(venue, { limit: 5 });
    expect(within(panel).queryByRole("button", { name: /Поделиться|Оставить|Войти/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Игра, после которой оставляете отзыв")).toBeNull();
    expect(login).not.toHaveBeenCalled();
    expect(api.eligibility).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
  });
});


describe("shared ProfileDialog native-close opt-in", () => {
  it.each([false, true])("keeps default cancel/native-close behavior with lockBodyScroll=%s without notification opt-in", lockBodyScroll => {
    const close = vi.fn();
    const view = render(createElement(ProfileDialog, { title: "Default", onClose: close, lockBodyScroll, children: "Body" }));
    const dialog = screen.getByRole("dialog");
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    dialog.removeAttribute("open"); fireEvent(dialog, new Event("close"));
    view.rerender(createElement(ProfileDialog, { title: "Updated", onClose: close, lockBodyScroll, children: "Body" }));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe(lockBodyScroll ? "hidden" : "");
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("releases focus/scroll only once, reopens only by signal and ignores StrictMode/managed cleanup", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger); trigger.focus();
    const nativeClose = vi.fn();
    const show = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const modal = (signal: number) => createElement(StrictMode, null, createElement(ProfileDialog, {
      title: "Retained", onClose: vi.fn(), onNativeClose: nativeClose,
      reopenSignal: signal, lockBodyScroll: true, children: "Body",
    }));
    const view = render(modal(0));
    const dialog = screen.getByRole("dialog");
    // A close queued by StrictMode cleanup must not report a newly opened dialog.
    fireEvent(dialog, new Event("close"));
    expect(nativeClose).not.toHaveBeenCalled();
    const initialShows = show.mock.calls.length;
    forceNativeClose(dialog);
    expect(nativeClose).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
    view.rerender(modal(0));
    expect(show).toHaveBeenCalledTimes(initialShows);
    expect(dialog.hasAttribute("open")).toBe(false);
    view.rerender(modal(1));
    expect(show).toHaveBeenCalledTimes(initialShows + 1);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    fireEvent(dialog, new Event("close"));
    expect(nativeClose).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
    trigger.remove(); show.mockRestore();
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
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
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
    const busyCancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, busyCancel);
    expect(busyCancel.defaultPrevented).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => pending.resolve({ ok: false, status: 503, error: "unconfirmed" }));
    expect((footerClose as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(headerClose);
    fireEvent.click(footerClose);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect((screen.getByLabelText("Ваш опыт на площадке") as HTMLTextAreaElement).disabled).toBe(true);
    expect(unresolved).toHaveBeenLastCalledWith(true);
    forceNativeClose(dialog);
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    const resume = screen.getByTestId("venue-review-resume");
    expect(resume.closest("dialog")).toBeNull();
    expect(document.activeElement).toBe(resume);
    expect(api.send).toHaveBeenCalledTimes(1);
    fireEvent.click(resume);
    expect(screen.getByRole("dialog", { name: "Как вам площадка?" })).toBe(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.queryByTestId("venue-review-resume")).toBeNull();
    expect(api.send).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Ваш опыт на площадке") as HTMLTextAreaElement).value).toBe("  Точный опыт  ");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    // Even a programmatic control drift cannot change an already admitted retry packet.
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Другой текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить отправку" }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
    expect(api.send.mock.calls[1]).toEqual(original);
    await screen.findByText("Отправлен; ещё не опубликован.");
    expect(screen.getByText("Публичный отзыв не виден.")).toBeTruthy();
    expect(api.eligibility).toHaveBeenCalledTimes(2); // Open + new write; UNKNOWN retry does not recompute it.
    expect(unresolved).toHaveBeenLastCalledWith(false);
    expect((footerClose as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(footerClose);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["gb-session-changed", "gb-private-expired", "actor", "logout", "csrf", "venue", "game"])("fences late send and prior retry on %s", async boundary => {
    const pending = deferred<Awaited<ReturnType<typeof ReviewApi.createVenueReview>>>();
    api.send.mockReturnValueOnce(pending.promise);
    const submitted = vi.fn(), unresolved = vi.fn();
    const props = { onSubmitted: submitted, onUnresolvedChange: unresolved };
    const view = render(composer(props)); await ready();
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Текст" } });
    fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    expect(unresolved).toHaveBeenLastCalledWith(true);
    forceNativeClose(screen.getByRole("dialog", { name: "Как вам площадка?" }));
    expect(screen.getByTestId("venue-review-resume")).toBeTruthy();
    if (boundary.startsWith("gb-")) act(() => { window.dispatchEvent(new Event(boundary)); });
    else view.rerender(composer({ ...props, ...(boundary === "actor" ? { actorId: "another-actor" } : boundary === "logout" ? { actorId: null, csrfToken: "" }
      : boundary === "csrf" ? { csrfToken: "session-two" } : boundary === "game" ? { gameId: "another-game" } : { venueId: "another-venue" }) }));
    await act(async () => pending.resolve(receipt));
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.queryByText("Сохранено только вам.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Проверить отправку" })).toBeNull();
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    expect(unresolved).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId("venue-review-resume")).toBeNull();
  });

  it("does not reopen or resend when a native-hidden busy send succeeds", async () => {
    const pending = deferred<Awaited<ReturnType<typeof ReviewApi.createVenueReview>>>();
    api.send.mockReturnValueOnce(pending.promise);
    const submitted = vi.fn(), close = vi.fn();
    render(composer({ onSubmitted: submitted, onClose: close })); await ready();
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Точный текст" } });
    fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    const dialog = screen.getByRole("dialog");
    forceNativeClose(dialog);
    await act(async () => pending.resolve(receipt));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("venue-review-resume"));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Сохранено только вам.")).toBeTruthy();
    expect(api.send).toHaveBeenCalledTimes(1);
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

describe("fixed-game admission", () => {
  it("uses only the fixed game and fresh basis for a private write", async () => {
    api.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases: [
      { ...basis, gameId: "other-game", outcomeVersion: 99 }, basis,
    ] } });
    api.send.mockResolvedValueOnce(receipt);
    render(composer()); await ready();
    expect(screen.queryByLabelText("Игра, после которой оставляете отзыв")).toBeNull();
    expect((screen.getByLabelText("Оставить только себе") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Мой опыт" } });
    fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await screen.findByText("Сохранено только вам.");
    expect(api.eligibility).toHaveBeenCalledTimes(2);
    expect(api.send.mock.calls[0]?.[0]).toEqual({ venueId: venue, gameId: basis.gameId,
      audience: "self_draft", text: "Мой опыт", topics: ["surface"],
      expectedBasisVersions: { outcomeVersion: 7, attendanceVersion: 12 } });
    expect((screen.getByRole("button", { name: /^Сохранить$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    { bases: [{ ...basis, gameId: "other-game" }], message: "Не удалось подтвердить возможность отзыва по этой игре." },
    { bases: [{ ...basis, admission: "hold" as const, helpHint: "attendance_clarifying" as const }], message: /Уточняем посещение/ },
    { bases: [{ ...basis, admission: "deny" as const, reason: "window_closed" }], message: /Срок подачи отзыва по этой игре истёк/ },
    { bases: [{ ...basis, admission: "missing_history" as const }], message: /Не удалось подтвердить историческую площадку/ },
  ])("never substitutes another game for an unavailable basis: $message", async ({ bases, message }) => {
    api.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases: [...bases, { ...basis, gameId: "another-eligible" }] } });
    render(composer());
    await screen.findByText(message);
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Текст" } });
    expect((screen.getByRole("button", { name: /^Сохранить$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.send).not.toHaveBeenCalled();
  });

  it.each(["hold", "versions", "missing"])("rechecks a new write and stops stale %s", async change => {
    render(composer()); await ready();
    api.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases: change === "missing" ? [] : [
      change === "hold" ? { ...basis, admission: "hold", helpHint: "attendance_clarifying" }
        : { ...basis, attendanceVersion: 13 },
    ] } });
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Сохранённый текст" } });
    fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(api.eligibility).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByLabelText("Ваш опыт на площадке") as HTMLTextAreaElement).disabled).toBe(false));
    expect(api.send).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Ваш опыт на площадке") as HTMLTextAreaElement).value).toBe("Сохранённый текст");
    if (change === "versions") {
      expect(screen.getByText(/Данные игры изменились/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
      await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
      expect(api.send.mock.calls[0]?.[0].expectedBasisVersions.attendanceVersion).toBe(13);
    }
  });

  it("invalidates already granted public consent when the projection is edited", async () => {
    render(composer()); await ready();
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Первый текст" } });
    fireEvent.click(screen.getByLabelText("Всем на странице площадки"));
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true));
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Изменённый текст" } });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: /^Сохранить$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.send).not.toHaveBeenCalled();
  });
});


it("shows the exact receipt's pending revision and independent public visibility", async () => {
  api.send.mockResolvedValueOnce({ ...receipt, data: { ...receipt.data, status: "revision_waiting",
    publicVisible: true, notBefore: "2026-11-10T12:00:00Z" } });
  render(composer()); await ready();
  fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Мой текст" } });
  fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
  await screen.findByText("Новая версия ожидает проверки.");
  expect(screen.getByText("Публичная версия отзыва доступна.")).toBeTruthy();
  expect(screen.getByText(/Публикация возможна не ранее 2026-11-10T12:00:00Z; она не гарантирована/)).toBeTruthy();
  expect(screen.queryByText(/Срок подачи/)).toBeNull();
});

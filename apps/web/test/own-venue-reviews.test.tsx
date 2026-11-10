/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClient from "../src/lib/api-client";
import type { OwnVenueReview, VenueReviewMutationReceipt } from "../src/lib/venue-reviews-api";

const transport = vi.hoisted(() => ({
  request: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: transport.refresh }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));
vi.mock("../src/lib/api-client", async importOriginal => ({
  ...await importOriginal<typeof ApiClient>(),
  apiFetch: transport.request,
}));
import { OwnVenueReviews } from "../src/components/consumer/venues/OwnVenueReviews";

const ownPath = "/v1/me/venue-reviews";
const row: OwnVenueReview = {
  id: "returned-review", reviewHandle: "exact-public-handle", venueId: "returned-venue",
  status: "revision_pending", version: 7, audience: "public_venue", text: "Новый личный текст",
  topics: [], pendingRevision: 7, approvedRevision: 4, publicVisible: true,
  notBefore: null, firstEligibleAt: "2020-01-01T00:00:00Z", receiptToken: "pending-intake",
};
const receipt: VenueReviewMutationReceipt = {
  id: row.id, reviewHandle: row.reviewHandle, version: 8, status: "withdrawn",
  publicVisible: false, receiptToken: null, notBefore: null,
};
function ok(data: unknown) { return { ok: true, status: 200, data }; }
function fail(status: number, code = "UNAVAILABLE") { return { ok: false, status, error: code, problem: { code, title: code } }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function mount(actorId = "owner-a", csrfToken = "csrf-a", onUnauthorized = vi.fn()) {
  return render(<OwnVenueReviews actorId={actorId} csrfToken={csrfToken} onUnauthorized={onUnauthorized} />);
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Открыть отзывы" }));
  await screen.findByRole("button", { name: "Отозвать отзыв" });
}
function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "Отозвать отзыв" }));
  fireEvent.click(screen.getByRole("button", { name: "Да, отозвать" }));
}
function commands() { return transport.request.mock.calls.filter(([path]) => String(path).endsWith("/commands")); }
function requireCall<T>(calls: readonly T[], index: number): T {
  const call = calls[index];
  if (call === undefined) throw new Error(`Expected mock call at index ${index}`);
  return call;
}
function button(name: string) { return screen.getByRole("button", { name }) as HTMLButtonElement; }

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear(); localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  transport.request.mockImplementation(async (path: string) => {
    if (path === ownPath) return ok({ items: [row] });
    if (path.endsWith("/commands")) return ok(receipt);
    return ok({ venueId: row.venueId, items: [], publishedCount: 0, nextCursor: null });
  });
});
afterEach(cleanup);

describe("private own collection and public truth", () => {
  it("requires an actual actor and CSRF, reads only on private entry and shows bounded coverage", async () => {
    const view = mount("", "");
    expect(screen.queryByRole("region")).toBeNull();
    view.rerender(<OwnVenueReviews actorId="owner-a" csrfToken="csrf-a" onUnauthorized={vi.fn()} />);
    expect(transport.request).not.toHaveBeenCalled();
    await open();
    expect(requireCall(transport.request.mock.calls, 0)[0]).toBe(ownPath);
    expect(screen.getByText(/до 50 последних/)).toBeTruthy();
    expect(screen.getByText(/отсутствие отзыва.*не означает/)).toBeTruthy();
    expect(screen.getByText(/Редактирование пока недоступно/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(transport.request.mock.calls.every(([path]) => path === ownPath)).toBe(true);
  });

  it("keeps pending COALESCE separate and uses only the exact public handle across bounded pages", async () => {
    let page = 0;
    transport.request.mockImplementation(async (path: string) => {
      if (path === ownPath) return ok({ items: [row] });
      page += 1;
      return ok({ venueId: row.venueId, items: page === 1
        ? [{ reviewHandle: "someone-else", text: "Чужой текст" }]
        : [{ reviewHandle: row.reviewHandle, text: "Прежний публичный текст" }], nextCursor: page === 1 ? "page-two" : null });
    });
    mount(); await open();
    expect(screen.getByText("Ваш текст · ожидает обработки")).toBeTruthy();
    expect(screen.queryByText("Прежний публичный текст")).toBeNull();
    fireEvent.click(button("Показать публичный текст"));
    expect(await screen.findByText("Прежний публичный текст")).toBeTruthy();
    expect(screen.queryByText("Чужой текст")).toBeNull();
    expect(screen.getAllByText(row.text!).length).toBeGreaterThan(0);
    expect(requireCall(transport.request.mock.calls, 2)[0]).toContain("cursor=page-two");
  });

  it("bounds public lookup to three pages, never replaces a missing quote with own text", async () => {
    let page = 0;
    transport.request.mockImplementation(async (path: string) => path === ownPath ? ok({ items: [row] })
      : ok({ venueId: row.venueId, items: [{ reviewHandle: "wrong", text: "Чужая цитата" }], nextCursor: `cursor-${++page}` }));
    mount(); await open();
    fireEvent.click(button("Показать публичный текст"));
    await waitFor(() => expect(button("Показать публичный текст").disabled).toBe(false));
    expect(page).toBe(3);
    expect(document.querySelector("blockquote")).toBeNull();
    expect(screen.getByText(/Публичная видимость подтверждена/)).toBeTruthy();
    expect(screen.queryByText("Чужая цитата")).toBeNull();
  });

  it("reports read errors and latest50 empty honestly without guessing an id or deletion", async () => {
    transport.request.mockResolvedValueOnce(fail(503));
    mount(); fireEvent.click(button("Открыть отзывы"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    transport.request.mockResolvedValueOnce(ok({ items: [] }));
    fireEvent.click(button("Обновить список"));
    expect(await screen.findByText(/В последних 50 отзывах записей нет/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отозвать отзыв" })).toBeNull();
    expect(transport.request.mock.calls.every(([path]) => path === ownPath)).toBe(true);
  });

  it("manages exactly 50 returned rows without a fabricated continuation endpoint", async () => {
    transport.request.mockResolvedValue(ok({ items: Array.from({ length: 50 }, (_, i) => ({
      ...row, id: `returned-${i}`, reviewHandle: `handle-${i}`, publicVisible: false,
    })) }));
    mount(); fireEvent.click(button("Открыть отзывы"));
    expect(await screen.findAllByRole("button", { name: "Отозвать отзыв" })).toHaveLength(50);
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Ещё" })).toBeNull();
  });
});

describe("withdraw command and recovery", () => {
  it("withdraws after the edit window without provider/eligibility calls and clears pending only on receipt", async () => {
    const reply = deferred<unknown>();
    transport.request.mockImplementation(async (path: string) => path.endsWith("/commands") ? reply.promise : ok({ items: [row] }));
    mount(); await open(); confirm();
    expect(screen.getAllByText(row.text!).length).toBeGreaterThan(0);
    expect(screen.queryByText("Отозван")).toBeNull();
    const [path, init] = requireCall(commands(), 0);
    expect(path).toBe(`${ownPath}/${row.id}/commands`);
    expect(JSON.parse(init.body)).toEqual({ action: "withdraw", expectedVersion: 7 });
    expect(init.csrfToken).toBe("csrf-a");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    await act(async () => reply.resolve(ok(receipt)));
    expect(await screen.findByText("Отозван")).toBeTruthy();
    expect(screen.queryByText(row.text!)).toBeNull();
    expect(screen.queryByText("Ваш текст · ожидает обработки")).toBeNull();
    expect(transport.refresh).toHaveBeenCalledTimes(1);
    expect(transport.request.mock.calls.map(([path]) => path)).toEqual([ownPath, `${ownPath}/${row.id}/commands`]);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });

  it("keeps provider/installation outage unresolved, double-click locked, close/reopen and exact retry", async () => {
    const first = deferred<unknown>();
    transport.request.mockImplementation(async (path: string) => path.endsWith("/commands") ? first.promise : ok({ items: [row] }));
    mount(); await open();
    fireEvent.click(button("Отозвать отзыв"));
    const send = button("Да, отозвать");
    act(() => { fireEvent.click(send); fireEvent.click(send); });
    expect(commands()).toHaveLength(1);
    fireEvent.click(button("Скрыть окно"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button("Свернуть отзывы"));
    await act(async () => first.resolve(fail(503, "PROVIDER_UNAVAILABLE")));
    expect(screen.getByText(/Результат отзыва не подтверждён/)).toBeTruthy();
    fireEvent.click(button("Открыть отзывы"));
    expect(button("Обновить список").disabled).toBe(true);
    expect(button("Отозвать отзыв").disabled).toBe(true);
    expect(transport.request.mock.calls.filter(([path]) => path === ownPath)).toHaveLength(1);
    fireEvent.click(button("Вернуться к операции"));
    const frozen = requireCall(commands(), 0);
    transport.request.mockResolvedValueOnce(ok(receipt));
    fireEvent.click(button("Повторить исходный запрос"));
    expect(await screen.findByText("Отозван")).toBeTruthy();
    expect(commands()).toHaveLength(2);
    expect(requireCall(commands(), 1)).toEqual(frozen);
  });

  it.each([
    { ...receipt, id: "other-review" }, { ...receipt, reviewHandle: "other-handle" },
    { ...receipt, version: 20 }, { ...receipt, publicVisible: true },
    { ...receipt, status: "published" }, { ...receipt, receiptToken: "pending-intake" },
  ])("treats malformed or unrelated 2xx receipt as UNKNOWN: %j", async data => {
    transport.request.mockImplementation(async (path: string) => path.endsWith("/commands") ? ok(data) : ok({ items: [row] }));
    mount(); await open(); confirm();
    await screen.findByRole("button", { name: "Повторить исходный запрос" });
    await waitFor(() => expect(button("Повторить исходный запрос").disabled).toBe(false));
    expect(screen.queryByText("Отозван")).toBeNull();
    expect(button("Обновить список").disabled).toBe(true);
    expect(transport.refresh).not.toHaveBeenCalled();
    expect(screen.getAllByText(row.text!).length).toBeGreaterThan(0);
  });

  it("conflict stays locked across close/reopen, failed/UNKNOWN reads; fresh returned version needs reconfirmation", async () => {
    transport.request.mockImplementation(async (path: string) => path.endsWith("/commands") ? fail(409, "VERSION_CONFLICT") : ok({ items: [row] }));
    mount(); await open(); confirm();
    await screen.findByText("Сначала успешно обновите список и подтвердите действие заново.");
    fireEvent.click(button("Отмена"));
    fireEvent.click(button("Свернуть отзывы")); fireEvent.click(button("Открыть отзывы"));
    expect(button("Отозвать отзыв").disabled).toBe(true);
    for (const status of [503, 0]) {
      transport.request.mockResolvedValueOnce(fail(status));
      fireEvent.click(button("Обновить список"));
      await waitFor(() => expect(button("Обновить список").disabled).toBe(false));
      expect(button("Отозвать отзыв").disabled).toBe(true);
      expect(commands()).toHaveLength(1);
    }
    transport.request.mockResolvedValueOnce(ok({ items: [{ ...row, version: 11 }] }));
    fireEvent.click(button("Обновить список"));
    await waitFor(() => expect(button("Отозвать отзыв").disabled).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(commands()).toHaveLength(1);
    transport.request.mockResolvedValueOnce(ok({ ...receipt, version: 12 }));
    confirm();
    expect(await screen.findByText("Отозван")).toBeTruthy();
    expect(JSON.parse(requireCall(commands(), 1)[1].body)).toEqual({ action: "withdraw", expectedVersion: 11 });
  });

  it("successful conflict refresh with absent row proves no deletion and offers no stale action", async () => {
    transport.request.mockImplementation(async (path: string) => path.endsWith("/commands") ? fail(409, "VERSION_CONFLICT") : ok({ items: [row] }));
    mount(); await open(); confirm();
    await screen.findByText("Сначала успешно обновите список и подтвердите действие заново.");
    fireEvent.click(button("Отмена"));
    transport.request.mockResolvedValueOnce(ok({ items: [] }));
    fireEvent.click(button("Обновить список"));
    await screen.findByText(/В последних 50 отзывах записей нет/);
    expect(screen.queryByRole("button", { name: "Отозвать отзыв" })).toBeNull();
    expect(commands()).toHaveLength(1);
  });
});

describe("actor and session fences", () => {
  it("does not apply another actor's delayed read", async () => {
    const late = deferred<unknown>();
    transport.request.mockResolvedValueOnce(late.promise);
    const view = mount(); fireEvent.click(button("Открыть отзывы"));
    view.rerender(<OwnVenueReviews actorId="owner-b" csrfToken="csrf-b" onUnauthorized={vi.fn()} />);
    transport.request.mockResolvedValueOnce(ok({ items: [] }));
    fireEvent.click(button("Открыть отзывы"));
    await screen.findByText(/В последних 50 отзывах записей нет/);
    await act(async () => late.resolve(ok({ items: [row] })));
    expect(screen.queryByText(row.text!)).toBeNull();
    expect(commands()).toHaveLength(0);
  });

  it.each(["gb-private-expired", "gb-session-changed"])("clears private context and fences late reads on %s", async event => {
    const late = deferred<unknown>();
    transport.request.mockResolvedValueOnce(late.promise);
    const unauthorized = vi.fn();
    mount("owner-a", "csrf-a", unauthorized);
    fireEvent.click(button("Открыть отзывы"));
    act(() => window.dispatchEvent(new Event(event)));
    await act(async () => late.resolve(ok({ items: [row] })));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText(row.text!)).toBeNull();
    expect(unauthorized).toHaveBeenCalled();
  });

  it.each(["gb-private-expired", "gb-session-changed"])("never settles or replays a late command after %s", async event => {
    const late = deferred<unknown>();
    transport.request.mockImplementation(async (path: string) => path.endsWith("/commands") ? late.promise : ok({ items: [row] }));
    mount(); await open(); confirm();
    act(() => window.dispatchEvent(new Event(event)));
    await act(async () => late.resolve(ok(receipt)));
    expect(screen.queryByRole("region")).toBeNull();
    expect(transport.refresh).not.toHaveBeenCalled();
    expect(commands()).toHaveLength(1);
  });

  it("does not replay UNKNOWN into another actor/session, or settle its late write", async () => {
    const late = deferred<unknown>();
    transport.request.mockImplementation(async (path: string) => path.endsWith("/commands") ? late.promise : ok({ items: [row] }));
    const view = mount(); await open(); confirm();
    view.rerender(<OwnVenueReviews actorId="owner-b" csrfToken="csrf-b" onUnauthorized={vi.fn()} />);
    await act(async () => late.resolve(ok(receipt)));
    expect(transport.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(row.text!)).toBeNull();
    expect(screen.queryByRole("button", { name: "Повторить исходный запрос" })).toBeNull();
    expect(commands()).toHaveLength(1);
    transport.request.mockResolvedValueOnce(ok({ items: [] }));
    fireEvent.click(button("Открыть отзывы"));
    await screen.findByText(/В последних 50 отзывах записей нет/);
    expect(commands()).toHaveLength(1);
  });
});

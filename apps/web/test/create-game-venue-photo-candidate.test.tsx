/** @vitest-environment jsdom */
import { Blob, File } from "node:buffer";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { CreateGamePage } from "../src/components/consumer/pages/CreateGamePage";
import { markSessionPresence } from "../src/lib/session-presence";
import { gameCoverRequest } from "../src/lib/game-cover-api";
const city = vi.hoisted(() => ({ cityId: "city", nameRu: "Москва", timezone: "Europe/Moscow" }));
vi.mock("../src/components/consumer/discovery/DiscoveryCityProvider", () => ({ useDiscoveryCity: () => ({ location: city }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../src/components/consumer/games/GameDetailComposition", () => ({ GameHero: () => <div>Предпросмотр игры</div>, GameTerms: () => null }));
vi.mock("../src/components/consumer/games/GameLevelRange", () => ({ GameLevelRange: () => null }));
vi.mock("../src/components/consumer/games/VenueBookingHelp", () => ({ VenueBookingHelp: () => null }));
vi.mock("../src/components/consumer/games/VenuePickerDialog", () => ({ VenuePickerDialog: () => null }));
vi.mock("../src/components/consumer/venues/VenueCover", () => ({ VenueCover: () => null }));
vi.mock("../src/components/consumer/venues/VenueCommunityRating", () => ({ VenueCommunityRating: () => null }));
vi.mock("../src/components/consumer/players/ProfileComposition", () => ({ AuthEntry: () => null }));
vi.mock("../src/components/consumer/messages/InvitationChooser", () => ({ InvitationChooser: () => null }));
vi.mock("../src/lib/use-venue-community", () => ({ useVenueCommunitySummaries: () => ({ summaries: {}, state: "ready" }) }));
vi.mock("../src/lib/avatar-preprocess", () => ({ preprocessAvatar: async () => new Blob(["VENUE-DERIVATIVE"], { type: "image/png" }), AVATAR_DERIVATIVE_MAX_BYTES: 512 * 1024 }));
vi.mock("../src/lib/game-cover-api", () => ({ gameCoverRequest: vi.fn(async () => ({ version: 2 })) }));
vi.mock("../src/components/consumer/games/GamePhotoSelection", () => ({
  GamePhotoSelection: ({ onChange, onReady }: { onChange: (bytes: Blob) => void; onReady: (ready: boolean) => void }) =>
    <button type="button" onClick={() => { onChange(new Blob(["GAME-DERIVATIVE"], { type: "image/webp" })); onReady(true); }}>Выбрать отдельное фото игры</button>,
}));
const venueId = "10000000-0000-4000-8000-000000000001", gameId = "10000000-0000-4000-8000-000000000002";
const venue = { id: venueId, cityId: "city", name: "Канонический зал", address: "Адрес", timezone: "Europe/Moscow" };
const game = { id: gameId, version: 1, title: "Игра", venue, startsAt: "2030-01-01T12:00:00Z", endsAt: "2030-01-01T14:00:00Z", timezone: "Europe/Moscow", activityKind: "regular", confirmedCount: 1, availablePlaces: 3, capacity: 4, status: "draft" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let resolveVenue: (response: Response) => void;
let photoStatus: number;
let gameFailure: boolean;
function calls(path: string, method: string) { return vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === path && init?.method === method); }
beforeEach(() => {
  markSessionPresence("present"); photoStatus = 503; gameFailure = false;
  vi.mocked(gameCoverRequest).mockClear();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("URL", class extends URL { static override createObjectURL = vi.fn(() => "blob:synthetic"); static override revokeObjectURL = vi.fn(); });
  vi.stubGlobal("fetch", vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    const url = String(path);
    if (url === "/v1/me") return json({ id: "actor", displayName: "Автор", csrfToken: "csrf", linkedProviders: [], locale: "ru" });
    if (url === "/v1/me/social-profile") return json({ cityId: "city", trainer: false });
    if (url === "/v1/me/game-preferences") return json({ version: 1, defaultPublicGameContact: "Контакт" });
    if (url.startsWith("/v1/venues?")) return json({ items: [], nextCursor: null });
    if (url === "/v1/venues" && init?.method === "POST") return new Promise<Response>(done => { resolveVenue = done; });
    if (url === `/v1/venues/${venueId}/photo-candidates`) return json({ code: photoStatus === 404 ? "PHOTO_CANDIDATE_UNAVAILABLE" : "MODERATION_UNAVAILABLE" }, photoStatus);
    if (url === "/v1/games" && init?.method === "POST") return gameFailure ? json({ code: "INVALID_GAME" }, 422) : json(game, 201);
    if (url === `/v1/games/${gameId}/publish`) return json({ ...game, version: 3, status: "published" });
    if (url === "/v1/me/participations") return json({ items: [{ gameId, status: "confirmed" }], nextCursor: null });
    throw new Error(`Unexpected fixture route ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fillAndConfirm() {
  render(<CreateGamePage embedded />);
  await screen.findByRole("heading", { name: "Создать игру" });
  fireEvent.change(screen.getByRole("combobox", { name: /^Площадка/ }), { target: { value: "new" } });
  fireEvent.change(screen.getByLabelText("Название площадки"), { target: { value: "Новый зал" } });
  fireEvent.change(screen.getByLabelText("Адрес"), { target: { value: "Адрес" } });
  fireEvent.change(screen.getByLabelText("Широта"), { target: { value: "55" } });
  fireEvent.change(screen.getByLabelText("Долгота"), { target: { value: "37" } });
  fireEvent.click(screen.getByRole("button", { name: "Выбрать дату" }));
  fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "2030-01-01" } });
  fireEvent.change(screen.getByLabelText(/^Время начала/), { target: { value: "15:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Выбрать отдельное фото игры" }));
  fireEvent.change(screen.getByLabelText("Выбрать фото площадки"), { target: { files: [new File(["raw"], "venue.png", { type: "image/png" })] } });
  await screen.findByAltText("Подготовленный фрагмент фото площадки");
  for (const [label, value] of [
    ["Подпись фото (Фото: имя автора)", "Фото: Анна"], ["Ссылка на автора / подпись (HTTPS)", "https://example.org/anna"],
    ["Ссылка на источник фото (HTTPS)", "https://example.org/photo"], ["Основание разрешения на публикацию", "Письменное разрешение автора"],
  ]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Подтверждаю право/ }));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить фото площадки и права" }));
  fireEvent.click(screen.getByRole("button", { name: "Далее — к созданию" }));
  await screen.findByRole("heading", { name: "Проверка перед созданием" });
  fireEvent.click(screen.getByRole("button", { name: "Создать игру" }));
  await waitFor(() => expect(calls("/v1/venues", "POST")).toHaveLength(1));
  expect(calls(`/v1/venues/${venueId}/photo-candidates`, "POST")).toHaveLength(0);
  expect(calls("/v1/games", "POST")).toHaveLength(0);
  await act(async () => resolveVenue(json(venue, 201)));
}
describe("I3b canonical creation and independent game cover", () => {
  it.each([503, 404])("keeps canonical success and game progression after optional photo HTTP %s, never recreating either for photo retry", async code => {
    photoStatus = code; await fillAndConfirm();
    await screen.findByRole("heading", { name: "Игра опубликована" });
    expect(calls("/v1/venues", "POST")).toHaveLength(1);
    expect(calls("/v1/games", "POST")).toHaveLength(1);
    expect(JSON.parse(String(calls("/v1/games", "POST")[0]![1]?.body)).venueId).toBe(venueId);
    expect(gameCoverRequest).toHaveBeenCalledTimes(1);
    expect(await vi.mocked(gameCoverRequest).mock.calls[0]![4]?.text()).toBe("GAME-DERIVATIVE");
    const candidateBytes = calls(`/v1/venues/${venueId}/photo-candidates`, "POST")[0]![1]?.body;
    if (!(candidateBytes instanceof Blob)) throw new Error("Expected the prepared candidate Blob");
    expect(await candidateBytes.text()).toBe("VENUE-DERIVATIVE");
    if (code === 503) {
      fireEvent.click(screen.getByRole("button", { name: "Проверить / повторить ту же команду фото" }));
      await waitFor(() => expect(calls(`/v1/venues/${venueId}/photo-candidates`, "POST")).toHaveLength(2));
    } else expect(screen.getByText(/право автора проверяет сервер/)).toBeTruthy();
    expect(calls("/v1/venues", "POST")).toHaveLength(1); expect(calls("/v1/games", "POST")).toHaveLength(1);
  });
  it("retains the canonical venue for a corrected game submission after a definite game failure", async () => {
    gameFailure = true; await fillAndConfirm();
    await screen.findByRole("heading", { name: "Создать игру" });
    expect(screen.getByText("Канонический зал")).toBeTruthy();
    gameFailure = false;
    fireEvent.click(screen.getByRole("button", { name: "Далее — к созданию" }));
    fireEvent.click(await screen.findByRole("button", { name: "Создать игру" }));
    await screen.findByRole("heading", { name: "Игра опубликована" });
    expect(calls("/v1/venues", "POST")).toHaveLength(1);
    expect(calls("/v1/games", "POST")).toHaveLength(2);
    expect(calls(`/v1/venues/${venueId}/photo-candidates`, "POST")).toHaveLength(1);
  });
});

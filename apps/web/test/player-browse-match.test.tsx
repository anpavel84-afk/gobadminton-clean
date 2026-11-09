/** @vitest-environment jsdom */
/** #404 mounted product paths. All people, receipts and transport below are TEST FIXTURES. */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "../src/lib/api-client";
import type { Me, OwnSocialProfile, PublicPlayer } from "../src/lib/consumer-types";
import type { ContactState } from "../src/lib/messaging-types";
import type { PlayInterestReceipt } from "@gobadminton/contracts/friendship-types";
import type * as PlayerBrowseMedia from "../src/components/consumer/players/PlayerBrowseMedia";

const transport = vi.hoisted(() => ({ apiFetch: vi.fn(), getMe: vi.fn(), getMySocialProfile: vi.fn(), listPlayers: vi.fn(), getContactState: vi.fn(), desktop: true }));
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
vi.mock("../src/lib/api-client", async original => ({ ...await original<Record<string, unknown>>(),
  apiFetch: transport.apiFetch, getMe: transport.getMe, getMySocialProfile: transport.getMySocialProfile,
  listPlayers: transport.listPlayers, listCities: async () => ({ ok: true, data: { items: [] } }),
}));
vi.mock("../src/lib/messaging-api", async original => ({ ...await original<Record<string, unknown>>(), getContactState: transport.getContactState }));
vi.mock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
vi.mock("../src/components/consumer/radar/RadarControls", () => ({ RadarSwitchControl: () => null, RadarStatusControls: () => null }));
vi.mock("../src/components/consumer/radar/RadarSessionProvider", () => ({
  useRadarSession: () => ({ controller: null, view: {} }),
  useUnifiedDirectory: () => ({ controller: null, view: { mode: "ordinary", rows: [], selected: null, notice: "" } }),
  useRadarConfig: () => null,
  useDirectoryFilters: () => ({ filters: { name: "", areaKey: "", cityId: "", lookingOnly: false, trainerOnly: false }, update: () => {} }),
}));
vi.mock("../src/lib/player-browse", async original => ({ ...await original<Record<string, unknown>>(), readTutorialCompleted: () => true }));
// Only media I/O is replaced. The real deck selection, admission, flight completion,
// PlayInterest, useOffers and page result ownership execute unchanged.
vi.mock("../src/components/consumer/players/PlayerBrowseMedia", async original => {
  const actual = await original<typeof PlayerBrowseMedia>();
  return { ...actual, prepareBrowsePeerMedia: async (peer: PublicPlayer) => ({ ok: true, media: {
    peerId: peer.publicPlayerId, peer, mediaKey: actual.browsePeerMediaKey(peer),
    avatar: { kind: "initials", text: "Т" }, cover: { kind: "default", node: null, authoritative: true },
  } }) };
});

import { PlayersDirectoryPage } from "../src/components/consumer/pages/PlayersDirectoryPage";
import { PlayerBrowsePlayInterest } from "../src/components/consumer/players/PlayerBrowsePlayInterest";
import { PlayerBrowseMatch, PlayerBrowseMatchDialog, usePlayerBrowseMatch, type BrowseMatchConfirmation } from "../src/components/consumer/players/PlayerBrowseMatch";
import { foregroundUpdates, privateActor } from "../src/lib/foreground-updates";
import { privateViews } from "../src/lib/private-view";

const me: Me = { id: "fixture-user-id", displayName: "PRIVATE NAME MUST NOT APPEAR", csrfToken: "fixture-csrf", locale: "ru", linkedProviders: [] };
const self = { publicPlayerId: "fixture-self-public", displayName: "Алексей Смирнов" };
const peers = ["Даниил Волков", "Следующий Игрок", "Третий Игрок"].map((displayName, i) => ({
  publicPlayerId: `fixture-peer-${i}`, displayName, cityId: null, areaKey: null, level: null, bio: null,
  trainer: false, lookingForGame: true, avatar: { uploadedUrl: null, providerUrl: null }, cover: { uploadedUrl: null },
})) as unknown as [PublicPlayer, PublicPlayer, PublicPlayer];
const own = { ...self, socialEligible: true, directoryVisible: true, optedInAt: "2026-11-09T00:00:00Z" } as OwnSocialProfile;
const receipt: PlayInterestReceipt = { interestId: "00000000-0000-4000-8000-000000000404", version: "2", outcome: "mutual" };
const none = { interestId: null, version: null, relationship: "none", capabilities: { canSend: true, canWithdraw: false } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function confirmation(over: Partial<BrowseMatchConfirmation> = {}): BrowseMatchConfirmation {
  return { actor: privateActor(me), privateGeneration: privateViews.currentGeneration, token: "fixture-operation", admittedAt: performance.now(), self,
    peer: { publicPlayerId: peers[0].publicPlayerId, displayName: peers[0].displayName }, receipt, ...over };
}
const resultSurface = () => document.querySelector<HTMLElement>('[data-surface="player-browse-match"]');
const flush = async () => { await act(async () => { await new Promise(done => setTimeout(done, 30)); }); };

beforeEach(() => {
  vi.clearAllMocks();
  foregroundUpdates.clear();
  sessionStorage.clear(); localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.history.replaceState(null, "", "/players?view=cards");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => window.setTimeout(() => fn(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion") || transport.desktop,
    media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me });
  transport.getMySocialProfile.mockResolvedValue({ ok: true, status: 200, data: own });
  transport.listPlayers.mockResolvedValue({ ok: true, status: 200, data: { items: peers, nextCursor: null } });
  transport.getContactState.mockImplementation(async (peer: string) => ({ ok: true, status: 200, data: { targetPublicPlayerId: peer, state: "none", canRequestContact: true } }));
  transport.apiFetch.mockImplementation(async (path: string) => {
    const params = new URL(path, "https://fixture.invalid").searchParams;
    return { ok: true, status: 200, data: { items: params.getAll("publicPlayerId").map(() => none) } };
  });
});
afterEach(() => { cleanup(); foregroundUpdates.clear(); vi.unstubAllGlobals(); });

async function readyPage(desktop: boolean) {
  transport.desktop = desktop;
  render(<PlayersDirectoryPage initialBrowseView="cards" />);
  const send = await screen.findByRole("button", { name: "Давай сыграем" });
  await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
  return send;
}

describe("actual desktop and mobile mutation paths", () => {
  it.each([true, false])("captured previous peer, one advance and retained deck (desktop=%s)", async desktop => {
    const pending = deferred<ApiResult<PlayInterestReceipt>>();
    const original = transport.apiFetch.getMockImplementation()!;
    transport.apiFetch.mockImplementation((path: string, options?: { method?: string }) => options?.method === "POST" ? pending.promise : original(path, options));
    const send = await readyPage(desktop);
    const deck = document.querySelector(".pb-deck") ?? document.querySelector(".players-browse-deck") ?? document.querySelector(".pb-browse--fs");
    fireEvent.click(send);
    if (!desktop) await waitFor(() => expect(document.querySelector(".pb-card[data-player-id] .pb-identity h2")?.textContent ?? document.body.textContent).toContain(peers[1].displayName));
    await act(async () => { pending.resolve({ ok: true, status: 200, data: receipt }); });
    await waitFor(() => expect(resultSurface()).not.toBeNull());
    expect(resultSurface()!.textContent).toContain(peers[0].displayName);
    expect(resultSurface()!.textContent).toContain(self.displayName);
    expect(resultSurface()!.textContent).not.toContain(me.displayName);
    expect(resultSurface()!.textContent).not.toContain(peers[1].displayName);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    expect(document.activeElement?.id).toBe("pb-match-title");
    const continueButton = within(resultSurface()!).getByRole("button", { name: /Продолжить поиск/ });
    fireEvent.keyDown(continueButton, { key: "Tab" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Закрыть дружеский матч");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(resultSurface()).toBeNull());
    if (deck) expect(deck.isConnected).toBe(true);
    if (!desktop) expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    await flush();
    expect(document.body.textContent).toContain(peers[1].displayName);
    // A double advance would select peer 3; compare the rendered profile identity.
    const profile = document.querySelector(".pb-card[data-player-id] .pb-identity h2");
    expect(document.querySelector(".pb-card[data-player-id]")?.getAttribute("data-player-id")).toBe(peers[1].publicPlayerId);
    if (profile) expect(profile.textContent).toContain(peers[1].displayName);
    expect(document.activeElement?.closest(".pb-match-shell")).toBeNull();
    expect(transport.apiFetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it.each(["outgoing", "withdrawn", "malformed", "UNKNOWN"])("never presents %s", async outcome => {
    const original = transport.apiFetch.getMockImplementation()!;
    transport.apiFetch.mockImplementation((path: string, options?: { method?: string }) => options?.method === "POST"
      ? Promise.resolve(outcome === "UNKNOWN" ? { ok: false, status: 0, error: "fixture transport" }
        : { ok: true, status: 200, data: { ...receipt, outcome: outcome === "malformed" ? "mutual" : outcome, version: outcome === "malformed" ? 2 : "2" } })
      : original(path, options));
    fireEvent.click(await readyPage(true));
    await flush();
    expect(resultSurface()).toBeNull();
    expect(transport.getContactState).not.toHaveBeenCalled();
  });

  it("keeps an existing successful withdraw separate from send validation", async () => {
    transport.apiFetch.mockImplementation(async (_path: string, options?: { method?: string }) => options?.method === "POST"
      ? { ok: true, status: 200, data: { ...receipt, outcome: "withdrawn" } }
      : { ok: true, status: 200, data: { items: [{ ...none, interestId: receipt.interestId, version: "2", relationship: "outgoing", capabilities: { canSend: false, canWithdraw: true } }] } });
    const onConfirmedInterest = vi.fn(), onMatchConfirmed = vi.fn();
    render(createElement(PlayerBrowsePlayInterest, {
      me, authState: "ready", peerId: peers[0].publicPlayerId, peerName: peers[0].displayName,
      selfPresentation: self, returnPath: "/players?view=cards", navigationLocked: false, rateBlockedUntil: null,
      onRateLimited: vi.fn(), onRelationship: vi.fn(), onConfirmedInterest, onMatchConfirmed,
      onBusyChange: vi.fn(), onApi: vi.fn(), onSkip: vi.fn(), onAuthRetry: vi.fn(), chrome: "desktop",
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Отменить предложение" }));
    await waitFor(() => expect(transport.apiFetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1));
    await flush();
    expect(onConfirmedInterest).not.toHaveBeenCalled();
    expect(onMatchConfirmed).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`gb-fr04-pending:${me.id}:play-interest:${peers[0].publicPlayerId}`)).toBeNull();
  });

  it("late mobile receipt after finder close is consumed without reopening", async () => {
    const pending = deferred<ApiResult<PlayInterestReceipt>>();
    const original = transport.apiFetch.getMockImplementation()!;
    transport.apiFetch.mockImplementation((path: string, options?: { method?: string }) => options?.method === "POST" ? pending.promise : original(path, options));
    fireEvent.click(await readyPage(false));
    fireEvent(document.querySelector("dialog")!, new Event("cancel", { cancelable: true }));
    await act(async () => { pending.resolve({ ok: true, status: 200, data: receipt }); });
    await flush();
    expect(resultSurface()).toBeNull();
    expect(transport.getContactState).not.toHaveBeenCalled();
  });
});

describe("ephemeral page owner", () => {
  it("dedups, consumes suppressed receipts, never replaces/queues, retires on session/hidden", () => {
    const hook = renderHook(({ active }) => usePlayerBrowseMatch(me, active), { initialProps: { active: true } });
    const first = confirmation();
    act(() => hook.result.current.receive(first));
    expect(hook.result.current.match?.peer.displayName).toBe(peers[0].displayName);
    act(() => hook.result.current.receive(confirmation({ receipt: { ...receipt, version: "3" } })));
    expect(hook.result.current.match?.receipt.version).toBe("2");
    act(() => hook.result.current.dismiss());
    act(() => hook.result.current.receive(first));
    expect(hook.result.current.match).toBeNull();
    hook.rerender({ active: false });
    const suppressed = confirmation({ receipt: { ...receipt, version: "4" } });
    act(() => hook.result.current.receive(suppressed));
    hook.rerender({ active: true });
    act(() => hook.result.current.receive(suppressed));
    expect(hook.result.current.match).toBeNull();
    act(() => hook.result.current.receive(confirmation({ receipt: { ...receipt, version: "5" } })));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(hook.result.current.match).toBeNull();
    const hidden = confirmation({ receipt: { ...receipt, version: "6" } });
    act(() => hook.result.current.receive(hidden));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => hook.result.current.receive(hidden));
    // A different receipt admitted before hiding also cannot steal focus on return.
    act(() => hook.result.current.receive({ ...first, receipt: { ...receipt, version: "7" } }));
    expect(hook.result.current.match).toBeNull();
    act(() => window.dispatchEvent(new Event("gb-session-changed")));
    act(() => hook.result.current.receive(first));
    expect(hook.result.current.match).toBeNull();
  });
});

describe("separate contact permission", () => {
  it.each(["none", "accepted", "pending_incoming", "pending_outgoing", "unavailable"] as const)("%s uses existing navigation contract without a POST", async state => {
    const target = peers[0].publicPlayerId;
    transport.getContactState.mockResolvedValue({ ok: true, status: 200, data: { targetPublicPlayerId: target, state, canRequestContact: true, conversationId: "fixture-conversation" } });
    render(createElement(PlayerBrowseMatch, { match: confirmation(), me, onDismiss: vi.fn() }));
    expect(screen.queryByRole("link")).toBeNull();
    await waitFor(() => expect(transport.getContactState).toHaveBeenCalled());
    if (state === "unavailable") {
      await screen.findByText("Сейчас написать этому игроку нельзя.");
      expect(screen.queryByRole("link")).toBeNull();
    } else {
      const link = await screen.findByRole("link", { name: state.startsWith("pending") ? /Открыть запрос/ : /Написать/ });
      expect(link.getAttribute("href")).toBe(state === "none" ? `/messages?to=${target}` : "/messages?conversation=fixture-conversation");
      link.addEventListener("click", event => event.preventDefault());
      fireEvent.click(link);
    }
    expect(transport.apiFetch).not.toHaveBeenCalled();
  });

  it("rejects wrong target and a deferred permission after private retirement", async () => {
    const pending = deferred<ApiResult<ContactState>>();
    transport.getContactState.mockReturnValue(pending.promise);
    const onDismiss = vi.fn();
    const view = render(createElement(PlayerBrowseMatch, { match: confirmation(), me, onDismiss }));
    await waitFor(() => expect(transport.getContactState).toHaveBeenCalled());
    act(() => window.dispatchEvent(new Event("gb-private-expired")));
    await act(async () => pending.resolve({ ok: true, status: 200, data: { targetPublicPlayerId: peers[0].publicPlayerId, state: "none", canRequestContact: true } }));
    expect(screen.queryByRole("link")).toBeNull();
    view.unmount();
    transport.getContactState.mockResolvedValue({ ok: true, status: 200, data: { targetPublicPlayerId: "WRONG-TARGET", state: "none", canRequestContact: true } });
    render(createElement(PlayerBrowseMatch, { match: confirmation(), me, onDismiss }));
    await screen.findByText("Сейчас написать этому игроку нельзя.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("removes a permitted action when contact permission is revoked", async () => {
    const match = confirmation();
    const onDismiss = vi.fn();
    render(createElement(PlayerBrowseMatch, { match, me, onDismiss }));
    await screen.findByRole("link", { name: /Написать/ });
    act(() => foregroundUpdates.publish(`contact:${match.peer.publicPlayerId}:match:${match.token}:0`, {
      targetPublicPlayerId: match.peer.publicPlayerId, state: "unavailable",
    }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers bounded retry after an error", async () => {
    transport.getContactState.mockResolvedValueOnce({ ok: false, status: 503, error: "fixture unavailable" });
    render(createElement(PlayerBrowseMatch, { match: confirmation(), me, onDismiss: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: /Повторить проверку/ }));
    expect(screen.queryByRole("link")).toBeNull();
    await screen.findByRole("link", { name: /Написать/ });
    expect(transport.getContactState).toHaveBeenCalledTimes(2);
  });
});

// Browser helper consumes mounted actual React markup + actual product CSS. No DEV/auth claims.
it("exports marked component geometry fixtures when requested", async () => {
  if (!process.env.GB404_BROWSER_FIXTURE) return;
  const fixtures: Record<string, string> = {};
  for (const scenario of ["allowed", "blocked", "long-name"]) {
    transport.getContactState.mockImplementation(async (peer: string) => ({ ok: true, status: 200, data: scenario === "blocked"
      ? { targetPublicPlayerId: peer, state: "unavailable" }
      : { targetPublicPlayerId: peer, state: "none", canRequestContact: true } }));
    const match = confirmation(scenario === "long-name" ? {
      self: { ...self, displayName: "Александр Константинопольский" },
      peer: { publicPlayerId: peers[0].publicPlayerId, displayName: "Даниил Александрович Соколов-Воскресенский" },
    } : {});
    const view = render(createElement(PlayerBrowseMatchDialog, { onClose: () => {}, children: createElement(PlayerBrowseMatch, { match, me, onDismiss: () => {} }) }));
    await waitFor(() => expect(resultSurface()?.querySelector(".pb-match-status")?.textContent).not.toContain("Проверяем"));
    fixtures[scenario] = view.container.innerHTML;
    cleanup(); foregroundUpdates.clear();
  }
  writeFileSync(process.env.GB404_BROWSER_FIXTURE, JSON.stringify({ status: "SYNTHETIC_COMPONENT_FIXTURES_NOT_DEV", fixtures }));
});

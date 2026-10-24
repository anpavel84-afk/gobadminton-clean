import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameDetail, Venue, VenueSummary } from "../src/lib/consumer-types";
import { GameVenueContacts } from "../src/components/consumer/games/GameVenueContacts";
import { VenuePublicProfile } from "../src/components/consumer/venues/VenuePublicProfile";

// Stateful page harness: actual page effects, request ordering and contact renderer.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock("react", async original => {
  const real = await original<typeof React>();
  return { ...real,
    useState(initial: unknown) {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = initial;
      return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = value; }];
    },
    useRef(initial: unknown) { const i = hooks.cursor++; return hooks.slots[i] ??= { current: initial }; },
    useCallback(fn: unknown, deps: unknown[]) {
      const i = hooks.cursor++, old = hooks.slots[i] as { deps: unknown[]; fn: unknown } | undefined;
      if (!old || deps.some((d, n) => d !== old.deps[n])) hooks.slots[i] = { deps, fn };
      return (hooks.slots[i] as { fn: unknown }).fn;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const i = hooks.cursor++, old = hooks.slots[i] as unknown[] | undefined;
      if (!old || deps.some((d, n) => d !== old[n])) {
        hooks.slots[i] = deps;
        hooks.effects.push(() => { hooks.cleanups[i]?.(); const cleanup = effect(); if (cleanup) hooks.cleanups[i] = cleanup; });
      }
    },
  };
});
vi.mock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../src/components/consumer/players/ProfileComposition", () => ({ AuthChooser: () => null }));
vi.mock("../src/components/consumer/games/GameDetailComposition", () => ({ GameHero: () => null, GameTerms: () => null, GameStatusBadge: () => null }));
vi.mock("../src/components/consumer/games/GameShare", () => ({ GameShare: () => null }));
vi.mock("../src/components/consumer/games/GameActionBar", () => ({ GameActionBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("../src/lib/api-client", () => ({ getGame: vi.fn(), getMe: vi.fn(), listAllMyParticipations: vi.fn(), requestParticipation: vi.fn() }));
vi.mock("../src/lib/messaging-api", () => ({ getGameChat: vi.fn() }));
import { getGame, getMe, listAllMyParticipations } from "../src/lib/api-client";
import { getGameChat } from "../src/lib/messaging-api";
import { GameDetailPage } from "../src/components/consumer/pages/GameDetailPage";
const publicVenue: VenueSummary = { id: "venue", name: "Зал", address: "Адрес", cityId: "city", timezone: "UTC" };
const privateVenue = { ...publicVenue, contactPhone: "+7 (999) 123-45-67", contactWebsite: "https://example.org/booking", bookingNote: "PRIVATE_SENTINEL <img src=x onerror=alert(1)>" };
const game = { id: "a", venue: privateVenue, status: "published", availablePlaces: 3, applicationDeadlineAt: "2099-01-01", settlement: { mode: "external", terms: "Условия" } } as GameDetail;
function render(id = "a") { hooks.cursor = 0; return renderToStaticMarkup(GameDetailPage({ gameId: id })); }
function effects() { hooks.effects.splice(0).forEach(fn => fn()); }
async function settle(id = "a") { for (let i = 0; i < 10; i++) { render(id); effects(); await Promise.resolve(); } return render(id); }
const markup = (venue: GameDetail["venue"]) => renderToStaticMarkup(<GameVenueContacts venue={venue} />);
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = [];
  vi.stubGlobal("window", new EventTarget());
  vi.mocked(getGame).mockResolvedValue({ ok: true, status: 200, data: game });
  vi.mocked(getMe).mockResolvedValue({ ok: true, status: 200, data: { id: "viewer", displayName: "Viewer", csrfToken: "test", locale: "ru", linkedProviders: [] } });
  vi.mocked(listAllMyParticipations).mockResolvedValue({ ok: true, status: 200, data: [] });
  vi.mocked(getGameChat).mockResolvedValue({ ok: false, status: 403, error: "denied" });
});
afterEach(() => { hooks.cleanups.forEach(fn => fn()); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("game-only venue contacts", () => {
  it("renders full response as safe links and escaped inert note", () => {
    const html = markup(privateVenue);
    expect(html).toContain('href="tel:+79991234567"');
    expect(html).toContain('href="https://example.org/booking"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("&lt;img"); expect(html).not.toContain("<img");
  });
  it.each([publicVenue, { ...publicVenue, contactPhone: null, contactWebsite: null, bookingNote: null }, { ...publicVenue, contactPhone: " ", contactWebsite: "", bookingNote: "\n " }])("omits entire section for legacy/null/empty", venue => { expect(markup(venue)).toBe(""); });
  it("renders partial response without inventing other fields or public fallback", () => {
    const html = markup({ ...publicVenue, bookingNote: "Инструкция", publicContacts: { phone: "+79999999999", website: "https://public.test", messengers: [] } });
    expect(html).toContain("Инструкция"); expect(html).not.toContain("href=");
    expect(html).not.toContain("public.test");
  });
  it("does not disclose a private sentinel through the public venue renderer", () => {
    const html = renderToStaticMarkup(<VenuePublicProfile venue={{ ...privateVenue, profile: null, publicContacts: null }} />);
    expect(html).not.toContain("PRIVATE_SENTINEL");
    expect(html).not.toContain("example.org/booking");
    expect(html).not.toContain("tel:");
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "//example.org", "https://user:pass@example.org", "https://@example.org", "https://example.org/\nfoo", "https://example.org/%0afoo", "https://example.org\\@evil.test"])("rejects unsafe website %s", value => { expect(markup({ ...publicVenue, contactWebsite: value })).toBe(""); });
  it.each(["123", "+7999;ext=1234567", "javascript:123456789", "+79991234567\n", "1".repeat(41)])("rejects unsafe phone %s", value => { expect(markup({ ...publicVenue, contactPhone: value })).toBe(""); });
  it("removes private fields on role-change omission and refresh, and clears immediately on logout", async () => {
    expect(await settle()).toContain("PRIVATE_SENTINEL");
    vi.mocked(getGame).mockResolvedValue({ ok: true, status: 200, data: { ...game, venue: publicVenue } });
    window.dispatchEvent(new Event("focus"));
    expect(render()).not.toContain("PRIVATE_SENTINEL");
    expect(await settle()).not.toContain("Контакты площадки");
    vi.mocked(getGame).mockResolvedValue({ ok: true, status: 200, data: game });
    window.dispatchEvent(new Event("focus")); expect(await settle()).toContain("PRIVATE_SENTINEL");
    vi.mocked(getMe).mockResolvedValue({ ok: false, status: 401, error: "guest" });
    window.dispatchEvent(new Event("gb-session-changed"));
    expect(render()).not.toContain("PRIVATE_SENTINEL");
    expect(await settle()).not.toContain("PRIVATE_SENTINEL");
  });
  it("ignores stale game responses and hides previous game before switch effects", async () => {
    expect(await settle()).toContain("PRIVATE_SENTINEL");
    let finish!: (result: Awaited<ReturnType<typeof getGame>>) => void;
    vi.mocked(getGame).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    window.dispatchEvent(new Event("focus"));
    expect(render("b")).not.toContain("PRIVATE_SENTINEL");
    vi.mocked(getGame).mockResolvedValue({ ok: true, status: 200, data: { ...game, id: "b", venue: publicVenue } });
    expect(await settle("b")).not.toContain("PRIVATE_SENTINEL");
    finish({ ok: true, status: 200, data: game });
    expect(await settle("b")).not.toContain("PRIVATE_SENTINEL");
  });
  it("hides contacts on failed refresh and private expiry", async () => {
    expect(await settle()).toContain("PRIVATE_SENTINEL");
    vi.mocked(getGame).mockResolvedValue({ ok: false, status: 503, error: "offline" });
    window.dispatchEvent(new Event("gb-private-expired"));
    const html = await settle(); expect(html).toContain("Игра недоступна"); expect(html).not.toContain("PRIVATE_SENTINEL");
  });
});
// Compile-time public/private fence: public venue types cannot name private keys.
const publicTypeFence: [Extract<keyof Venue, "contactPhone" | "contactWebsite" | "bookingNote">, Extract<keyof VenueSummary, "contactPhone" | "contactWebsite" | "bookingNote">] extends [never, never] ? true : never = true;
void publicTypeFence;

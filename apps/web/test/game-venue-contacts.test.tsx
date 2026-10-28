import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameDetail, Venue, VenueSummary } from "../src/lib/consumer-types";
import { GameVenueContacts } from "../src/components/consumer/games/GameVenueContacts";
import { VenuePublicProfile } from "../src/components/consumer/venues/VenuePublicProfile";
import { websiteMatrixNegative, websiteMatrixPositive } from "./fixtures/website-authority-matrix";

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
  it("renders the QA percent-encoded Cyrillic website destination", () => {
    expect(markup({ ...publicVenue, contactWebsite: "https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B" })).toContain('href="https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B"');
  });
  it.each([
    ["https://example.org/контакты", "https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B"],
    ["https://example.org/%d0%ba", "https://example.org/%d0%ba"],
    ["https://example.org/%D0%bA", "https://example.org/%D0%bA"],
    ["https://example.org/%d0%ba%d0%be%d0%bd%d1%82%d0%b0%d0%ba%d1%82%d1%8b", "https://example.org/%d0%ba%d0%be%d0%bd%d1%82%d0%b0%d0%ba%d1%82%d1%8b"],
    ["https://example.org/?q=%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B#%F0%9F%98%80", "https://example.org/?q=%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B#%F0%9F%98%80"],
    ["https://example.org/?q=контакты#😀", "https://example.org/?q=%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B#%F0%9F%98%80"],
    ["https://example.org/%C4%80", "https://example.org/%C4%80"],
    ["https://example.org/%E3%81%82", "https://example.org/%E3%81%82"],
    ["https://example.org/%F0%9F%98%80", "https://example.org/%F0%9F%98%80"],
    ["https://example.org/%C3%A9", "https://example.org/%C3%A9"],
    ["http://example.org/booking", "http://example.org/booking"],
    ["HtTpS://example.org/booking", "https://example.org/booking"],
    ["https://example.org/%2F%2Fevil.test", "https://example.org/%2F%2Fevil.test"],
    ["https://example.org/?next=https%3A%2F%2Fevil.test", "https://example.org/?next=https%3A%2F%2Fevil.test"],
    ["https://example.org/%25", "https://example.org/%25"],
    ["https://example.org/%250A", "https://example.org/%250A"],
    ["https://example.org/" + "a".repeat(280), "https://example.org/" + "a".repeat(280)],
  ])("accepts valid website %s with its original serialized destination", (value, href) => { expect(markup({ ...publicVenue, contactWebsite: value })).toContain(`href="${href}"`); });
  it.each([
    ...["%C0%AF", "%FF", "%80", "%AF", "%C2", "%E2%82", "%ED%A0%80", "%F4%90%80%80", "%A", "%", "%ZZ"].map(value => `https://example.org/${value}`),
    "https://example.org/?q=%ZZ", "https://example.org/#%A", "https://example.org/?q=%A", "https://example.org/#%ZZ", "https://example.org/?q=%", "https://example.org/#%",
    "JaVaScRiPt:alert(1)", "DaTa:text/html,x", "ftp://example.org/", "/relative", "https:example.org", "javascript%3Aalert(1)",
    "https://user@example.org", "https://%75ser:%70ass@example.org",
    ...["\0", "\t", "\n", "\r", "\x7f", "\u0085"].map(value => `https://example.org/${value}foo`),
    ...["%00", "%09", "%0A", "%0d", "%1F", "%7F", "%C2%80", "%C2%85", "%C2%9F"].map(value => `https://example.org/${value}`),
    "https://example.org/?q=%00", "https://example.org/#%09", "https://example.org/?q=%0A", "https://example.org/#%1F", "https://example.org/?q=%7F", "https://example.org/#%C2%85",
    "https://example.org/%5C", "https://example.org/?q=%5c",
    42, false, {}, null, undefined, "", "https://", "https://example.org/" + "a".repeat(281), "https://example.org/" + "я".repeat(47), "https://example.org/\ud800", "https://example.org/\udc00",
  ])("rejects invalid website encoding or destination %s", value => { expect(markup({ ...publicVenue, contactWebsite: value as GameDetail["venue"]["contactWebsite"] })).toBe(""); });
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


// Authority matrix lives in ./fixtures/website-authority-matrix.ts (same #272 cases).

describe("Astra original-authority website regression matrix", () => {
  const rejected = (input: unknown) => expect(markup({ ...publicVenue, contactWebsite: input as GameDetail["venue"]["contactWebsite"] })).toBe("");
  const accepted = (input: string, href: string) => {
    const html = markup({ ...publicVenue, contactWebsite: input });
    const anchors = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/g)];
    expect(anchors).toHaveLength(1);
    const attribute = anchors[0]?.[1] ?? "";
    const entities: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#x27;": "'", "&lt;": "<", "&gt;": ">" };
    expect(attribute.replace(/&(?:amp|quot|lt|gt|#x27);/g, entity => entities[entity]!)).toBe(href);
    expect(html).not.toMatch(/<(?:img|script|svg)\b|\son[a-z]+\s*=/i);
    expect(html).toContain('rel="noopener noreferrer"');
    if (href.includes("&")) expect(attribute).toContain("&amp;");
  };
  it("serializes every positive destination exactly into one inert website anchor", () => {
    for (const [input, href] of websiteMatrixPositive) accepted(input, href);
  });
  it("omits every rejected website, including generated controls and malformed UTF-8", () => {
    for (const input of websiteMatrixNegative) rejected(input);
  });
  it("removes only the rejected website when valid phone and note remain", () => {
    for (const contactWebsite of ["https:///@example.org/", "https:////:@example.org/"]) {
      const html = markup({ ...publicVenue, contactWebsite, contactPhone: "+79991234567", bookingNote: "Инструкция" });
      expect(html).toContain('href="tel:+79991234567"');
      expect(html).toContain("Инструкция");
      expect(html).not.toContain("example.org");
      expect(html.match(/<a\b/g)).toHaveLength(1);
    }
  });
  it("checks compact structural-token and slash families against an independent fixed-host scanner", () => {
    // This oracle covers only these generated fixed-host cases; URL supplies serialization.
    const oracle = (input: string) => {
      if (input.length > 300 || [...input].some(c => c.charCodeAt(0) <= 31 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159 || c === "\\")) return null;
      let i = "https:".length;
      while (input[i] === "/") i++;
      if (i < "https:".length + 2) return null;
      const start = i;
      while (i < input.length && input[i] !== "/" && input[i] !== "?" && input[i] !== "#") i++;
      if (input.slice(start, i) !== "example.org") return null;
      try { decodeURIComponent(input); return new URL(input).href; } catch { return null; }
    };
    const check = (input: string) => { const href = oracle(input); if (href === null) rejected(input); else accepted(input, href); };
    const alphabet = ["/", "\\", "@", ":", "?", "#", "%"];
    let tokens = [""];
    for (let length = 0; length <= 3; length++) {
      for (const token of tokens) check("https:" + token + "example.org/");
      tokens = tokens.flatMap(token => alphabet.map(c => token + c));
    }
    for (const count of [2, 3, 4, 5, 8, 32, 279, 280]) {
      for (const userinfo of ["", "@", ":@", "u@", ":p@", "@@", "%40"]) {
        for (const suffix of ["/", "?@x", "#@x"]) check("https:" + "/".repeat(count) + userinfo + "example.org" + suffix);
      }
    }
  });
});

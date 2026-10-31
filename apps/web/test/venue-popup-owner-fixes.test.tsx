import { createRef, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { describe, expect, it } from "vitest";
import { VenuePublicContacts, VenueSheet, VenueSheetGameRow } from "../src/components/consumer/games/VenueSheet";
import { CreateGamePage, CreateGamePresentation, emptyDraft } from "../src/components/consumer/pages/CreateGamePage";
import { initialCreateVenue, selectCreateVenue } from "../src/lib/venue-popup-create";
import { venueCreatePath } from "../src/lib/games-venue-map";
import { safeAuthReturnPath } from "../src/lib/auth-return";
import { formatSeats } from "../src/lib/game-presentation";
import { VENUE_ILLUSTRATION_ALT, venueIllustrationUrl } from "../src/lib/venue-illustration";
import type { Game, VenueSummary } from "../src/lib/consumer-types";

// Real React SSR throughout. No hook substitution, component mocks or event/effect claims.
const venue: VenueSummary = { id: "venue", cityId: "city", name: "Зал", address: "Адрес", timezone: "Europe/Moscow" };
const gamePhoto = `/v1/media/game-covers/${"a".repeat(64)}.png`;
const venuePhoto = `/v1/media/venue-covers/${"b".repeat(64)}.png`;
const avatar = `/v1/media/avatars/${"c".repeat(64)}.png`;
const game: Game = {
  id: "game", version: 1, title: "Вечерняя игра", venue, status: "draft", visibility: "public",
  startsAt: "2026-11-20T15:00:00Z", endsAt: "2026-11-20T17:00:00Z", applicationDeadlineAt: "2026-11-20T15:00:00Z",
  timezone: venue.timezone, activityKind: "regular", trainer: null, trainingDescription: null,
  organizer: { id: null, displayName: "Анна", publicContact: "+79991234567", avatar: { uploadedUrl: avatar, providerUrl: null } },
  capacity: 4, confirmedCount: 1, availablePlaces: 2, externalReservedCount: 1, formatKey: "doubles",
  levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0", "3.5"] },
  settlement: { mode: "external", purpose: "no_trainer_fee", terms: "Условия площадки", priceMinor: null, currency: null },
};
const noop = () => {};
const asyncNoop = async () => {};
function ssr(node: ReactNode) {
  return renderToStaticMarkup(<PathnameContext.Provider value="/games/create">{node}</PathnameContext.Provider>);
}
function textContent(html: string) { return html.replace(/<[^>]*>/g, ""); }
function links(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(match => ({
    href: /href="([^"]*)"/.exec(match[1]!)?.[1],
    target: /target="([^"]*)"/.exec(match[1]!)?.[1],
    rel: /rel="([^"]*)"/.exec(match[1]!)?.[1],
    text: textContent(match[2]!),
  }));
}
type PresentationProps = ComponentProps<typeof CreateGamePresentation>;
function presentation(overrides: Partial<PresentationProps> = {}): PresentationProps {
  return {
    step: "form", me: null, preferences: null, saveContact: false, setSaveContact: noop, creatorSeat: null,
    trainer: null, setReload: noop, activityKind: "regular", setActivityKind: noop, dateChoice: "today",
    setDateChoice: noop, customDuration: false, setCustomDuration: noop,
    draft: { ...emptyDraft(), venueId: venue.id, startDate: "2026-11-20", startTime: "18:00" }, setDraft: noop,
    knownVenues: [venue], selectedVenue: venue, venueStatus: "ready", setVenueReload: noop,
    venuePickerOpen: false, setVenuePickerOpen: noop, venueTriggerRef: createRef<HTMLButtonElement>(),
    onVenueModeChange: noop, onVenueSelect: noop, created: null, error: null, busy: false, setBusy: noop,
    photo: null, setPhoto: noop, photoReady: true, setPhotoReady: noop, photoUrl: undefined,
    contactEdited: { current: false }, previewPayload: null, previewGame: game,
    location: { cityId: venue.cityId, timezone: venue.timezone, nameRu: "Москва" },
    onCheck: asyncNoop, onPublish: asyncNoop, setStep: noop, recoveryChecked: false,
    rereadResult: asyncNoop, returnPath: "/games/create", ...overrides,
  };
}

describe("production venue popup presentation with real React", () => {
  it.each([
    [gamePhoto, venuePhoto, gamePhoto],
    [null, venuePhoto, venuePhoto],
    ["https://unsafe.example/game.png", venuePhoto, venuePhoto],
    [null, null, "/discovery/badminton-courts.jpg"],
    ["/bad.png", "/bad.png", "/discovery/badminton-courts.jpg"],
  ])("uses the shared cover precedence (%s, %s)", (uploadedUrl, venueUrl, expected) => {
    const html = ssr(<VenueSheetGameRow game={{ ...game, cover: { uploadedUrl }, venue: { ...venue, cover: { uploadedUrl: venueUrl } } }} timezone={venue.timezone} onOpen={noop} />);
    expect(html).toContain(`src="${expected}"`);
    expect(html).toContain(`src="${avatar}"`);
    expect(textContent(html)).toContain("18:00–20:00");
    for (const label of [game.title, "3.0, 3.5", "Организатор", "Анна", formatSeats(game)]) expect(textContent(html)).toContain(label);
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html.match(/<\/button>/g)).toHaveLength(1);
    expect(html).not.toMatch(/<a\b/);
  });
  it("keeps square game media separate from the organizer and free-seat footer", () => {
    const html = ssr(<VenueSheetGameRow game={game} timezone={venue.timezone} onOpen={noop} />);
    expect(html).toContain('class="gb-venue-sheet-game-main"');
    expect(html).toContain('class="gb-venue-sheet-game-summary"');
    expect(html).toContain('gb-venue-sheet-game-cover');
    expect(html).toContain('class="gb-venue-sheet-game-footer"');
    expect(html).toContain('class="gb-venue-sheet-game-organizer"');
    expect(html.indexOf('gb-venue-sheet-game-main')).toBeLessThan(html.indexOf('gb-venue-sheet-game-footer'));
    expect(html.indexOf('gb-venue-sheet-game-organizer')).toBeLessThan(html.indexOf('gb-venue-sheet-count'));
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(textContent(html)).toContain(formatSeats(game));
  });
  it("uses one publish action surface in the embedded preview without changing the full-page preview", () => {
    const embeddedForm = ssr(<CreateGamePresentation {...presentation()} embedded onClose={noop} />);
    const embeddedPreview = ssr(<CreateGamePresentation {...presentation({ step: "preview" })} embedded onClose={noop} />);
    const standalonePreview = ssr(<CreateGamePresentation {...presentation({ step: "preview" })} />);
    expect(embeddedForm).toContain('class="gb-game-form-actions"');
    expect(embeddedForm).not.toContain('gb-game-popup-preview-actions');
    expect(embeddedPreview).toContain('class="gb-game-popup-preview-actions"');
    expect(standalonePreview).not.toContain('gb-game-popup-preview-actions');
    expect(embeddedPreview.match(/aria-label="Действия игры"/g)).toHaveLength(1);
    expect(standalonePreview.match(/aria-label="Действия игры"/g)).toHaveLength(1);
    expect(embeddedPreview).toContain("Создать игру");
    expect(embeddedPreview).toContain("Назад к редактированию");
  });
  it("keeps trainer fallback distinct from organizer identity", () => {
    const html = ssr(<VenueSheetGameRow game={{ ...game, activityKind: "trainer_led" }} timezone={venue.timezone} onOpen={noop} />);
    expect(html).toContain('src="/discovery/badminton-courts.jpg"');
    expect(html).toContain(`src="${avatar}"`);
  });
  it("uses generic illustration for selected create-game venue without uploaded cover", () => {
    const html = ssr(<CreateGamePresentation {...presentation()} />);
    expect(html).toContain(`src="${venueIllustrationUrl(venue.id)}"`);
    expect(html).toContain('data-fallback="illustration"');
    expect(html).toContain(`alt="${VENUE_ILLUSTRATION_ALT}"`);
    expect(html).not.toContain("Бадминтонный корт");
  });
  it.each([null, undefined, [], {}, { phone: "123\n4567", website: "javascript:alert(1)", messengers: [{ kind: "telegram", url: "https://t.me/a/.." }] }])("renders the honest empty contact state (%j)", value => {
    const html = ssr(<VenuePublicContacts value={value} />);
    expect(html.match(/<h3>Контакты площадки<\/h3>/g)).toHaveLength(1);
    expect(textContent(html)).toContain("Контакты пока не добавлены");
    expect(html).not.toContain("Публичные контакты организации"); expect(links(html)).toEqual([]);
  });
  it("normalizes safe public contacts, whitelists and deduplicates messengers", () => {
    const html = ssr(<VenuePublicContacts value={{
      phone: " +7 (999) 123-45-67 ", website: " HTTP://Example.COM:80/a/../b ",
      bookingNote: "PRIVATE_BOOKING", contact_phone: "PRIVATE_PHONE", privateContacts: "PRIVATE_CONTACTS",
      messengers: [null, [], { kind: "email", url: "https://example.com/email" },
        { kind: "telegram", url: "https://t.me.evil.example/club" },
        { kind: "telegram", url: "https://t.me/club" }, { kind: "telegram", url: "https://t.me/duplicate" },
        { kind: "whatsapp", url: "https://wa.me/79991234567" }, { kind: "vk", url: "https://vk.com/club" }],
    }} />);
    const anchors = links(html);
    expect(anchors.map(link => link.href)).toEqual(["tel:+79991234567", "http://example.com/b", "https://t.me/club", "https://wa.me/79991234567", "https://vk.com/club"]);
    expect(anchors.map(link => link.text)).toEqual(["+7 (999) 123-45-67", "example.com↗", "Telegram", "WhatsApp", "ВКонтакте"]);
    expect(anchors[0]?.target).toBeUndefined(); expect(anchors[0]?.rel).toBeUndefined();
    for (const link of anchors.slice(1)) { expect(link.target).toBe("_blank"); expect(link.rel).toBe("noopener noreferrer"); }
    expect(html).toMatch(/gb-venue-contact-messengers[\s\S]*Telegram[\s\S]*WhatsApp/);
    expect(html).not.toContain("PRIVATE_");
  });
  it.each(["https://user@example.com/", "https://example.com:444/", "https://example.com/\n", "https://example.com/\\x", "https://foo／bar.example/", "https://example.com/" + "я".repeat(100)])("drops only the damaged contact (%s)", website => {
    const anchors = links(ssr(<VenuePublicContacts value={{ phone: "+1234567", website, messengers: [{ kind: "telegram", url: "https://t.me/club" }] }} />));
    expect(anchors.map(link => link.href)).toEqual(["tel:+1234567", "https://t.me/club"]);
  });
  it("keeps website/WhatsApp when phone and Telegram are damaged", () => {
    const anchors = links(ssr(<VenuePublicContacts value={{ phone: "+123\u00854567", website: "https://пример.рф/", messengers: [{ kind: "telegram", url: "http://t.me/club" }, { kind: "whatsapp", url: "https://wa.me/1234567" }] }} />));
    expect(anchors.map(link => link.href)).toEqual(["https://xn--e1afmkfd.xn--p1ai/", "https://wa.me/1234567"]);
    expect(anchors[0]?.text).toBe("xn--e1afmkfd.xn--p1ai↗");
  });
  it("uses only venue.publicContacts, keeps coverSlot and gates the local CTA", () => {
    const supplied = { ...venue, publicContacts: null, bookingNote: "PRIVATE_BOOKING", contact_phone: "PRIVATE_PHONE" };
    const render = (ready: boolean, games: Game[]) => ssr(<VenueSheet venue={supplied} games={games} gamesReady={ready} now={0} active={false} coverSlot={<div>Existing cover slot</div>} onCollapse={noop} onDeselect={noop} />);
    const html = render(true, []);
    expect(html).toContain("Existing cover slot"); expect(html).not.toContain("PRIVATE_");
    expect(html).toMatch(/<button[^>]*>Создать игру на этой площадке/);
    expect(links(html)).toEqual([]);
    expect(textContent(html).indexOf(venue.address)).toBeLessThan(textContent(html).indexOf("Контакты площадки"));
    expect(textContent(html).indexOf("Контакты площадки")).toBeLessThan(textContent(html).indexOf("Создать игру"));
    expect(render(false, [])).not.toContain("Создать игру на этой площадке");
    expect(render(true, [game])).not.toContain("Создать игру на этой площадке");
    for (const [markup, label] of [[html, "Создать игру на этой площадке"], [render(true, [game]), "Показать игры на этой площадке"]]) {
      expect(markup).toContain(`aria-label="${label}"`);
      expect(markup).toContain(`${label}<span aria-hidden="true">→</span></button>`);
    }
  });
  it.each(["form", "preview"] as const)("shares actual fields and actions in embedded/full %s", step => {
    const props = presentation({ step });
    const embedded = ssr(<CreateGamePresentation {...props} embedded onClose={noop} />);
    const full = ssr(<CreateGamePresentation {...props} />);
    for (const html of [embedded, full]) {
      for (const field of ["title", "venueMode", "venueId", "startDate", "startTime", "capacity", "format", "visibility", "contact", "venueTerms"]) expect(html).toContain(`id="${field}"`);
      expect(html).not.toContain('id="levels"');
      expect(html).toMatch(/<input\b[^>]*\btype="range"[^>]*\bmin="1"[^>]*\bmax="3\.5"[^>]*\bstep="0\.5"[^>]*\baria-label="Нижний уровень"[^>]*\bvalue="3"/);
      expect(html).toMatch(/<input\b[^>]*\btype="range"[^>]*\bmin="3"[^>]*\bmax="7"[^>]*\bstep="0\.5"[^>]*\baria-label="Верхний уровень"[^>]*\bvalue="3\.5"/);
      expect(html).toContain('type="file"'); expect(html).toContain("Далее — к созданию"); expect(html).toContain("Отмена");
      if (step === "preview") { expect(html).toContain("Создать игру"); expect(html).toContain("Назад к редактированию"); expect(html).toMatch(/<form[^>]*hidden=""/); }
    }
    expect(embedded).not.toContain('data-shell-mode='); expect(embedded).not.toMatch(/<nav\b/);
    expect(embedded).not.toContain("Все игры"); expect(links(embedded).some(link => link.href?.startsWith("/venues"))).toBe(false);
    expect(full).toContain('data-shell-mode="local"'); expect(full).toMatch(/<nav\b/);
    expect(full).toContain("Все игры"); expect(links(full).some(link => link.href === "/venues/venue")).toBe(true);
  });
  it("shares new venue fields, photo readiness and validation", () => {
    const props = presentation({ draft: { ...emptyDraft(), createNewVenue: true }, photoReady: false, customDuration: true, error: "Проверьте поля" });
    const html = ssr(<CreateGamePresentation {...props} embedded />);
    for (const id of ["venueName", "venueAddress", "lat", "lng", "duration"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Проверьте поля"); expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Далее — к созданию/);
  });
  it("resumes an invite after publishing without creating an invitation automatically", () => {
    const peerId = "10000000-0000-4000-8000-000000000001";
    const published = ssr(<CreateGamePresentation {...presentation({
      step: "published", created: { ...game, status: "published" },
      invitePlayerId: peerId, me: { id: "viewer", csrfToken: "test" } as PresentationProps["me"],
    })} />);
    expect(published).toContain("Пригласить выбранного игрока");
    expect(published).toContain("Пригласить на игру");
    expect(published).not.toContain("Пригласить в созданную игру");
    expect(published).not.toContain("Приглашение отправлено");
    const standalone = ssr(<CreateGamePresentation {...presentation({ step: "published", created: game })} />);
    expect(standalone).not.toContain("Пригласить выбранного игрока");
  });
  it("keeps publication/recovery results local with explicit game/summary links", () => {
    const published = ssr(<CreateGamePresentation {...presentation({ step: "published", created: game })} embedded onClose={noop} />);
    expect(published).toContain("Игра опубликована"); expect(published).toContain("К площадке");
    expect(links(published).map(link => link.href)).toEqual(["/games/game", "/my-games/game"]);
    const recovery = ssr(<CreateGamePresentation {...presentation({ step: "unknown", error: "Проверьте результат" })} embedded />);
    expect(recovery).toContain("Результат публикации неизвестен"); expect(recovery).toContain("Проверить состояние");
    expect(links(recovery).map(link => link.href)).toEqual(["/my-games?tab=created"]);
  });
  it("supports the default route component with real React SSR", () => {
    expect(ssr(<CreateGamePage />)).toContain("Готовим создание игры");
  });
});

describe("production pure create selection", () => {
  const other = { ...venue, id: "other" };
  const options = { cityId: venue.cityId, search: "?venueId=other", venues: [venue, other] };
  it("prefers a valid prop immediately, even before the catalog arrives", () => {
    expect(initialCreateVenue({ ...options, initialVenue: venue, venues: [] })).toBe(venue);
    expect(initialCreateVenue({ ...options, initialVenue: venue })).toBe(venue);
  });
  it.each([null, { ...venue, cityId: "foreign" }, { ...venue, id: "" }, { ...venue, name: "" }, { ...venue, timezone: "invalid-timezone" }])("does not fall back from an invalid/foreign prop (%j)", initialVenue => {
    expect(initialCreateVenue({ ...options, initialVenue })).toBeNull();
  });
  it("waits for same-city full-route query resolution", () => {
    expect(initialCreateVenue({ ...options, venues: [] })).toBeNull();
    expect(initialCreateVenue(options)).toBe(other);
    expect(initialCreateVenue({ ...options, venues: [{ ...other, cityId: "foreign" }] })).toBeNull();
    expect(initialCreateVenue({ ...options, cityId: undefined })).toBeNull();
  });
  it("applies late catalog data only to an untouched known-venue draft", () => {
    const draft = emptyDraft();
    expect(selectCreateVenue(draft, null, false)).toBe(draft);
    const selected = selectCreateVenue(draft, initialCreateVenue(options), false);
    expect(selected.venueId).toBe(other.id);
    expect(selectCreateVenue(selected, venue, false)).toBe(selected);
    const manual = { ...draft, venueId: "manual" };
    expect(selectCreateVenue(manual, other, true)).toBe(manual);
    const newVenue = { ...draft, createNewVenue: true };
    expect(selectCreateVenue(newVenue, other, false)).toBe(newVenue);
    expect(selectCreateVenue(draft, other, true)).toBe(draft); // Manual switch back to an empty picker.
  });
  it("encodes popup venue context through the existing safe return policy", () => {
    const id = "зал /?&=+";
    const path = venueCreatePath(new URLSearchParams({ venueId: id }).toString());
    expect(safeAuthReturnPath(path)).toBe(path);
    expect(new URL(path, "https://gobadminton.invalid").searchParams.get("venueId")).toBe(id);
    expect(safeAuthReturnPath("//evil.example")).toBe("/games");
  });
});

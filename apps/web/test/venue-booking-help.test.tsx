import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VenueBookingHelp } from "../src/components/consumer/games/VenueBookingHelp";
import { VenuePublicContacts } from "../src/components/consumer/venues/VenuePublicContacts";
import type { VenueSummary } from "../src/lib/consumer-types";
import {
  buildVenueBookingDraft,
  copyVenueBookingText,
} from "../src/lib/venue-booking-help";

const venue: VenueSummary = {
  id: "10000000-0000-4000-8000-000000000010",
  cityId: "a0000000-0000-4000-8000-000000000001",
  name: "Зал Север",
  address: "ул. Тестовая, 1",
  timezone: "Europe/Moscow",
  publicContacts: {
    phone: "+7 (999) 111-22-33",
    website: "https://example.org/club",
    messengers: [{ kind: "telegram", url: "https://t.me/club" }],
  },
};

describe("#386 venue booking help", () => {
  it("builds draft only for complete validated city-local datetime", () => {
    expect(buildVenueBookingDraft({
      venueName: venue.name,
      venueAddress: venue.address,
      startDate: "2026-11-10",
      startTime: "19:30",
      durationMinutes: "120",
      timezone: "Europe/Moscow",
    })).toMatchObject({
      localWhenLabel: "10.11.2026, 19:30 (Europe/Moscow)",
      durationLabel: "2 ч",
    });
    expect(buildVenueBookingDraft({
      venueName: venue.name,
      venueAddress: venue.address,
      startDate: "",
      startTime: "19:30",
      durationMinutes: "120",
      timezone: "Europe/Moscow",
    })).toBeNull();
    expect(buildVenueBookingDraft({
      venueName: venue.name,
      venueAddress: venue.address,
      startDate: "2026-11-10",
      startTime: "19:30",
      durationMinutes: "0",
      timezone: "Europe/Moscow",
    })).toBeNull();
  });

  it("reports copy success only after fulfilled writeText", async () => {
    expect(await copyVenueBookingText("text", undefined)).toBe("copy_failed");
    expect(await copyVenueBookingText("text", { writeText: async () => { throw new Error("denied"); } })).toBe("copy_failed");
    const writeText = vi.fn(async () => {});
    expect(await copyVenueBookingText("черновик", { writeText })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("черновик");
  });

  it("shows only public contacts and honest empty; never private booking fields", () => {
    const withContacts = renderToStaticMarkup(createElement(VenuePublicContacts, { value: venue.publicContacts }));
    expect(withContacts).toContain("+7 (999) 111-22-33");
    expect(withContacts).toContain("example.org");
    expect(withContacts).not.toContain("PRIVATE");
    const empty = renderToStaticMarkup(createElement(VenuePublicContacts, { value: null }));
    expect(empty).toContain("Контакты пока не добавлены");
    const poisoned = renderToStaticMarkup(createElement(VenuePublicContacts, {
      value: {
        phone: null,
        website: null,
        messengers: [],
        contactPhone: "+79990001122",
        bookingNote: "PRIVATE_NOTE",
      },
    }));
    expect(poisoned).toContain("Контакты пока не добавлены");
    expect(poisoned).not.toContain("PRIVATE_NOTE");
    expect(poisoned).not.toContain("+79990001122");
  });

  it("renders closed checklist and disables draft until datetime is complete", () => {
    const html = renderToStaticMarkup(createElement(VenueBookingHelp, {
      venue,
      createNewVenue: false,
      startDate: "",
      startTime: "",
      durationMinutes: "120",
      timezone: "Europe/Moscow",
      accountKey: "actor-1",
    }));
    expect(html).toContain("Чек-лист перед обращением к площадке");
    expect(html).toContain("Контакты площадки");
    expect(html).toContain("Укажите дату, время и длительность");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|>)/);
    expect(html).not.toContain("Скопировать черновик");
  });
});

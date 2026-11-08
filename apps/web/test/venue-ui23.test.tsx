/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VenueCommunityRating } from "../src/components/consumer/venues/VenueCommunityRating";
import { VenuePickerDialog } from "../src/components/consumer/games/VenuePickerDialog";
import { CommentsSection } from "../src/components/consumer/comments/CommentsSection";
import { DiscoveryGameCard } from "../src/components/consumer/discovery/DiscoveryGameCard";
import type { VenueSummary, Game, GameRoleReputationCard, Me } from "../src/lib/consumer-types";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("../src/components/consumer/venues/VenueGallery", () => ({
  VenueGallery: () => createElement("span", { "data-gallery": "stub" }),
}));

vi.mock("../src/lib/use-venue-community", () => ({
  useVenueCommunitySummaries: () => ({
    state: "ready",
    summaries: {
      "10000000-0000-4000-8000-0000000000a1": {
        venueId: "10000000-0000-4000-8000-0000000000a1",
        canonicalVenueId: "10000000-0000-4000-8000-0000000000a1",
        state: "empty",
        average: null,
        count: null,
      },
    },
  }),
}));

const V1 = "10000000-0000-4000-8000-0000000000a1";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function ownRow(overrides: Record<string, unknown> = {}) {
  return {
    venueId: V1,
    canonicalVenueId: V1,
    value: null,
    version: 0,
    withdrawn: false,
    moderationState: "clear",
    allowedActions: { upsert: true, update: false, withdraw: false },
    ...overrides,
  };
}

function summary(state: "empty" | "available" | "unavailable" = "empty") {
  return {
    venueId: V1,
    canonicalVenueId: V1,
    state,
    average: state === "available" ? 4.3 : null,
    count: state === "available" ? 3 : null,
  };
}

const venueA: VenueSummary = {
  id: V1,
  name: "Зал A",
  address: "Адрес A",
  cityId: "city",
  timezone: "Europe/Moscow",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("#507/#530 ui23 first-vote upsert gate", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary("empty")] });
      }
      if (url.includes(`/v1/venues/${V1}/community-rating/me`)) {
        return jsonResponse({ own: ownRow(), summary: summary("empty") });
      }
      if (url.includes(`/v1/venues/${V1}/community-rating`) && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        expect(body.expectedVersion).toBe(0);
        expect(body.value).toBe(4);
        return jsonResponse({
          own: ownRow({ value: 4, version: 1, allowedActions: { upsert: false, update: true, withdraw: true } }),
          summary: summary("available"),
        });
      }
      throw new Error(`unexpected ${url} ${init?.method}`);
    }));
  });

  it("uses upsert for value=null version=0 and keeps save label as first send", async () => {
    render(createElement(VenueCommunityRating, {
      venueId: V1,
      signedIn: true,
      actorId: "actor-1",
      csrfToken: "csrf-1",
      authReturnPath: `/venues/${V1}`,
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Отправить оценку" })).toBeTruthy());
    const star = screen.getByRole("radio", { name: "4 из 5" });
    await act(async () => { star.click(); });
    const save = screen.getByRole("button", { name: "Отправить оценку" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });
    await waitFor(() => expect(screen.getByText("Оценка сохранена")).toBeTruthy());
  });

  it("does not grant write when own GET fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary("empty")] });
      }
      if (url.includes(`/v1/venues/${V1}/community-rating/me`)) {
        return jsonResponse({ error: "boom" }, 500);
      }
      throw new Error(`unexpected write ${url} ${init?.method}`);
    }));
    render(createElement(VenueCommunityRating, {
      venueId: V1,
      signedIn: true,
      actorId: "actor-1",
      csrfToken: "csrf-1",
      authReturnPath: `/venues/${V1}`,
    }));
    await waitFor(() => expect(screen.getByText(/Не удалось загрузить вашу оценку/)).toBeTruthy());
    const star = screen.getByRole("radio", { name: "3 из 5" }) as HTMLButtonElement;
    expect(star.disabled).toBe(true);
    const save = screen.getByRole("button", { name: "Отправить оценку" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});

describe("#530 D1 picker sibling community/photo actions", () => {
  it("keeps plain summary inside select row and community link as sibling", () => {
    render(createElement(VenuePickerDialog, {
      venues: [venueA],
      selectedId: "",
      status: "ready",
      onSelect: () => undefined,
      onClose: () => undefined,
      onRetry: () => undefined,
    }));
    const select = screen.getByRole("button", { name: /Зал A/ });
    expect(select.textContent).toMatch(/Пока нет оценок|Оценки/);
    const link = screen.getByTestId("venue-picker-community-link");
    expect(link.getAttribute("href")).toBe(`/venues/${encodeURIComponent(V1)}#ratings`);
    expect(select.contains(link)).toBe(false);
    expect(select.querySelector("a")).toBeNull();
  });
});

describe("#530 comments presentation + venue discussion shell", () => {
  it("scopes comment avatar classes and accepts discussion title/sectionId", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles/comments.css"), "utf8");
    expect(css).toMatch(/\.gb-consumer \.gb-comments \.gb-comments__avatar/);
    expect(css).toMatch(/width:\s*40px/);
    expect(css).toMatch(/\.gb-comment__reply-avatar[\s\S]*width:\s*32px|width:\s*32px[\s\S]*\.gb-comment__reply-avatar/);
    expect(css).toMatch(/object-fit:\s*cover/);

    const me: Me = {
      id: "u1",
      displayName: "Тест",
      locale: "ru",
      linkedProviders: [],
      csrfToken: "csrf",
    };
    const html = renderToStaticMarkup(createElement(CommentsSection, {
      kind: "venue",
      entityId: V1,
      me,
      title: "Обсуждение площадки",
      description: "Вопросы и впечатления",
      authReturnPath: `/venues/${V1}#discussion`,
      parentPublic: true,
      sectionId: "discussion",
    }));
    expect(html).toContain('id="discussion"');
    expect(html).toContain("Обсуждение площадки");
    expect(html).not.toContain("Обсуждение и фотографии");
    expect(html).not.toContain("Добавление фотографий");
  });
});

describe("#521 R3 trainer people band", () => {
  it("places details/share in full-width people band with plain Тренер label", () => {
    const game: Game = {
      id: "game-trainer",
      version: 1,
      title: "Demo Morozov Coaching Hour",
      status: "published",
      visibility: "public",
      activityKind: "trainer_led",
      trainer: {
        profileId: "trainer-profile-am",
        displayName: "Alexey Morozov (demo trainer)",
        declarationSource: "self_declared",
      },
      trainingDescription: null,
      organizer: { id: "org-user-am", displayName: "Alexey Morozov", publicContact: "private" },
      venue: {
        id: "venue-1",
        name: "Demo Arena",
        cityId: "city",
        address: "Addr",
        timezone: "Europe/Moscow",
      },
      startsAt: "2030-11-11T16:00:00Z",
      endsAt: "2030-11-11T18:00:00Z",
      timezone: "Europe/Moscow",
      applicationDeadlineAt: "2030-11-11T12:00:00Z",
      capacity: 4,
      confirmedCount: 1,
      externalReservedCount: 0,
      availablePlaces: 3,
      formatKey: "doubles",
      levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0"] },
      settlement: {
        mode: "external",
        purpose: "trainer_fee",
        priceStatus: "by_agreement",
        priceMinor: null,
        currency: null,
        terms: "Оплата по договорённости",
      },
    };
    const reputation: GameRoleReputationCard = {
      gameId: game.id,
      organization: {
        roleHandle: "o".repeat(32),
        role: "organization",
        subjectDisplayName: "Alexey Morozov",
        heldGamesCount: 3,
        countScope: "confirmed_history",
        historyMayBeIncomplete: true,
        publishedReviewCount: 0,
        projectionVersion: "1",
        availability: "available",
      },
      training: {
        roleHandle: "t".repeat(32),
        role: "training",
        subjectDisplayName: "Alexey Morozov (demo trainer)",
        heldGamesCount: 1,
        countScope: "confirmed_history",
        historyMayBeIncomplete: true,
        publishedReviewCount: 0,
        projectionVersion: "1",
        availability: "available",
      },
    };
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game, reputation }));
    expect(html).toMatch(/gb-discovery-card__people[\s\S]*gb-discovery-card__actions/);
    expect(html).not.toContain("gb-discovery-card__footer");
    expect(html).toContain(">Тренер<");
    expect(html).not.toMatch(/<small>Тренер · самостоятельно указано<\/small>/);
    const css = readFileSync(resolve(__dirname, "../src/styles/discovery.css"), "utf8");
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*auto\s*auto/);
  });
});

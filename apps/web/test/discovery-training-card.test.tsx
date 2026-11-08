import { createElement, type AnchorHTMLAttributes } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryGameCard } from "../src/components/consumer/discovery/DiscoveryGameCard";
import type { Game, GameRoleReputationCard } from "../src/lib/consumer-types";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));

/** Exact DiscoveryGameCard SSR payload for the sibling browser geometry helper. */
export function renderTrainingCardBrowserFixtures() {
  const venue = {
    id: "venue-1",
    name: "Demo Arena Izmailovo",
    cityId: "city",
    address: "Измайловский проспект, 1",
    timezone: "Europe/Moscow",
  };
  const regular: Game = {
    id: "game-regular",
    version: 1,
    title: "TEST · ordinary long title that must wrap safely beside the photo column",
    status: "published",
    visibility: "public",
    activityKind: "regular",
    trainer: null,
    trainingDescription: null,
    organizer: { id: "org-user-1", displayName: "TEST · DEV Москва 6", publicContact: "private" },
    venue,
    startsAt: "2030-11-10T13:21:00Z",
    endsAt: "2030-11-10T14:21:00Z",
    timezone: "Europe/Moscow",
    applicationDeadlineAt: "2030-11-10T12:00:00Z",
    capacity: 4,
    confirmedCount: 1,
    externalReservedCount: 0,
    availablePlaces: 3,
    formatKey: "doubles",
    levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["2.5"] },
    settlement: {
      mode: "external",
      purpose: "no_trainer_fee",
      priceMinor: null,
      currency: null,
      terms: "Аренду делим поровну. Длинные условия участия для проверки переноса строк без обрезки CTA.",
    },
  };
  const trainer: Game = {
    ...regular,
    id: "game-trainer",
    title: "Demo Morozov Coaching Hour with a long title for layout stress",
    activityKind: "trainer_led",
    trainer: {
      profileId: "trainer-profile-am",
      displayName: "Alexey Morozov (demo trainer)",
      declarationSource: "self_declared",
    },
    organizer: { id: "org-user-other", displayName: "Other Organizer With Long Name", publicContact: "private" },
    settlement: {
      mode: "external",
      purpose: "trainer_fee",
      priceStatus: "by_agreement",
      priceMinor: null,
      currency: null,
      terms: "Оплата тренеру по договорённости · Synthetic long settlement terms that must remain visible with share and details after reputation loads.",
    },
  };
  const reputation: GameRoleReputationCard = {
    gameId: trainer.id,
    organization: {
      roleHandle: "o".repeat(32),
      role: "organization",
      subjectDisplayName: "Other Organizer With Long Name",
      heldGamesCount: 3,
      countScope: "confirmed_history",
      historyMayBeIncomplete: true,
      publishedReviewCount: 2,
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
      publishedReviewCount: 1,
      projectionVersion: "1",
      availability: "available",
    },
  };
  return {
    regularHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: regular })),
    trainerHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainer, reputation })),
  };
}


const venue = {
  id: "venue-1",
  name: "Demo Arena Izmailovo",
  cityId: "city",
  address: "Измайловский проспект, 1",
  timezone: "Europe/Moscow",
};

const baseGame: Game = {
  id: "game-regular",
  version: 1,
  title: "TEST · ordinary",
  status: "published",
  visibility: "public",
  activityKind: "regular",
  trainer: null,
  trainingDescription: null,
  organizer: { id: "org-user-1", displayName: "TEST · DEV Москва 6", publicContact: "private" },
  venue,
  startsAt: "2030-11-10T13:21:00Z",
  endsAt: "2030-11-10T14:21:00Z",
  timezone: "Europe/Moscow",
  applicationDeadlineAt: "2030-11-10T12:00:00Z",
  capacity: 4,
  confirmedCount: 1,
  externalReservedCount: 0,
  availablePlaces: 3,
  formatKey: "doubles",
  levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["2.5"] },
  settlement: {
    mode: "external",
    purpose: "no_trainer_fee",
    priceMinor: null,
    currency: null,
    terms: "Аренду делим поровну. Длинные условия участия для проверки переноса строк без обрезки CTA.",
  },
};

const trainerDistinct: Game = {
  ...baseGame,
  id: "game-trainer-distinct",
  title: "Demo Morozov Coaching Hour",
  activityKind: "trainer_led",
  trainer: {
    profileId: "trainer-profile-am",
    displayName: "Alexey Morozov (demo trainer)",
    declarationSource: "self_declared",
  },
  organizer: { id: "org-user-other", displayName: "Other Organizer", publicContact: "private" },
  startsAt: "2030-11-11T16:00:00Z",
  endsAt: "2030-11-11T18:00:00Z",
  settlement: {
    mode: "external",
    purpose: "trainer_fee",
    priceStatus: "by_agreement",
    priceMinor: null,
    currency: null,
    terms: "Оплата тренеру по договорённости · Synthetic long settlement terms that must remain visible with share and details.",
  },
};

const trainerSameId: Game = {
  ...trainerDistinct,
  id: "game-trainer-same",
  trainer: {
    profileId: "shared-person-id",
    displayName: "Alexey Morozov (demo trainer)",
    declarationSource: "self_declared",
  },
  organizer: { id: "shared-person-id", displayName: "Alexey Morozov", publicContact: "private" },
};

const trainerMissing: Game = {
  ...trainerDistinct,
  id: "game-trainer-missing",
  trainer: null,
};

const reputation: GameRoleReputationCard = {
  gameId: trainerDistinct.id,
  organization: {
    roleHandle: "o".repeat(32),
    role: "organization",
    subjectDisplayName: "Other Organizer",
    heldGamesCount: 3,
    countScope: "confirmed_history",
    historyMayBeIncomplete: true,
    publishedReviewCount: 2,
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
    publishedReviewCount: 1,
    projectionVersion: "1",
    availability: "available",
  },
};

const cardSource = readFileSync(new URL("../src/components/consumer/discovery/DiscoveryGameCard.tsx", import.meta.url), "utf8");
const discoveryCss = readFileSync(new URL("../src/styles/discovery.css", import.meta.url), "utf8");

describe("#521 discovery training card unified desktop row", () => {
  it("writes exact DiscoveryGameCard SSR fixture for the browser helper when requested", () => {
    const path = process.env.GB521_BROWSER_FIXTURE;
    if (!path) return;
    writeFileSync(path, JSON.stringify(renderTrainingCardBrowserFixtures()));
  });

  it("removes content-height stacked latch; CSS keeps desktop row for all cards", () => {
    expect(cardSource).not.toMatch(/useFeedCardLayout|mediaBudget|data-layout/);
    expect(cardSource).not.toMatch(/setLayout\("stacked"\)|scrollHeight/);
    expect(discoveryCss).not.toMatch(/data-layout="stacked"|aspect-ratio:\s*16\s*\/\s*10/);
    expect(discoveryCss).toMatch(/grid-template-columns:\s*minmax\(210px,\s*min\(300px,\s*36%\)\)\s*minmax\(0,\s*1fr\)/);
    expect(discoveryCss).toMatch(/@media \(max-width:\s*720px\)[\s\S]*\.gb-discovery-card,\s*\.gb-discovery-skeleton\s*\{\s*display:\s*block/);
  });

  it("keeps ordinary and trainer cards on the same article contract without stacked layout attr", () => {
    const regular = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: baseGame }));
    const training = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct, reputation }));
    for (const html of [regular, training]) {
      expect(html).toContain('class="gb-discovery-card"');
      expect(html).not.toContain("data-layout");
      expect(html).toContain("gb-discovery-card__image");
      expect(html).toContain("gb-discovery-card__content");
      expect(html).toContain("Подробнее");
      expect(html).toContain(`href="/games/${html.includes(trainerDistinct.id) ? trainerDistinct.id : baseGame.id}"`);
    }
    expect(regular).toContain("Обычная игра");
    expect(regular).toContain('data-activity="regular"');
    expect(training).toContain("С тренером");
    expect(training).toContain('data-activity="trainer_led"');
    expect(training).toContain('data-role="trainer"');
    expect(training).toContain('data-trainer-profile="trainer-profile-am"');
    expect(training).toContain("Alexey Morozov (demo trainer)");
    expect(training).toContain('data-role="organizer"');
    expect(training).toContain('data-organizer-id="org-user-other"');
    expect(training).toContain("Other Organizer");
    expect(training).toContain("Отзывы");
  });

  it("compacts only when trainer profileId and organizer.id are the same stable key", () => {
    const same = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerSameId }));
    const distinct = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct }));
    expect(same).toContain('data-role="trainer-organizer"');
    expect(same).toContain('data-trainer-profile="shared-person-id"');
    expect(same).toContain('data-organizer-id="shared-person-id"');
    expect(same).toContain("Тренер · самостоятельно указано · Организатор");
    expect(same).toContain("Alexey Morozov");
    expect(same.match(/data-role="trainer"/g) ?? []).toHaveLength(0);
    expect(distinct).toContain('data-role="trainer"');
    expect(distinct).toContain('data-role="organizer"');
    expect(distinct).not.toContain("data-role=\"trainer-organizer\"");
    expect(distinct).not.toContain("MorozovOther");
  });

  it("shows truthful unavailable trainer state without fabricating a person", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerMissing }));
    expect(html).toContain("С тренером");
    expect(html).toContain('data-trainer-unavailable="true"');
    expect(html).toContain("Профиль недоступен");
    expect(html).not.toContain("data-trainer-profile=");
    expect(html).toContain("Other Organizer");
    expect(html).toContain("Организатор");
  });

  it("preserves long terms, seats, share and reputation actions on trainer cards", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct, reputation }));
    expect(html).toContain(trainerDistinct.settlement.terms);
    expect(html).toContain("Свободно 3 из 4");
    expect(html).toContain("Demo Arena Izmailovo");
    expect(html).toContain("Уровень: 2.5");
    expect(html).toContain("Парная игра");
    expect(html).toContain(`href="/games/${trainerDistinct.id}"`);
  });
});

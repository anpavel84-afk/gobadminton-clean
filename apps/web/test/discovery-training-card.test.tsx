import { createElement, type AnchorHTMLAttributes } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryGameCard } from "../src/components/consumer/discovery/DiscoveryGameCard";
import type { Game, GameRoleReputationCard } from "../src/lib/consumer-types";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));

const LONG_TRAINER =
  "Alexey Morozov (demo trainer) · Extended Qualifier String That Must Fully Wrap Across Widths";
const LONG_ORGANIZER =
  "Other Organizer With Extremely Long Display Name For Wrap Verification Across Widths";

/** Exact DiscoveryGameCard SSR payloads for the sibling browser geometry helper. */
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
  const trainerDistinct: Game = {
    ...regular,
    id: "game-trainer",
    title: "Demo Morozov Coaching Hour with a long title for layout stress",
    activityKind: "trainer_led",
    trainer: {
      profileId: "trainer-profile-am",
      displayName: LONG_TRAINER,
      declarationSource: "self_declared",
    },
    organizer: { id: "org-user-other", displayName: LONG_ORGANIZER, publicContact: "private" },
    settlement: {
      mode: "external",
      purpose: "trainer_fee",
      priceStatus: "by_agreement",
      priceMinor: null,
      currency: null,
      terms: "Оплата тренеру по договорённости · Synthetic long settlement terms that must remain visible with share and details after reputation loads.",
    },
  };
  /** Coinciding UUID strings across namespaces must still render two role rows. */
  const trainerSameStringIds: Game = {
    ...trainerDistinct,
    id: "game-trainer-same-string",
    trainer: {
      profileId: "shared-looking-id",
      displayName: LONG_TRAINER,
      declarationSource: "self_declared",
    },
    organizer: { id: "shared-looking-id", displayName: "Alexey Morozov", publicContact: "private" },
  };
  const trainerMissing: Game = {
    ...trainerDistinct,
    id: "game-trainer-missing",
    trainer: null,
    organizer: { id: "org-user-other", displayName: LONG_ORGANIZER, publicContact: "private" },
  };
  const reputation: GameRoleReputationCard = {
    gameId: trainerDistinct.id,
    organization: {
      roleHandle: "o".repeat(32),
      role: "organization",
      subjectDisplayName: LONG_ORGANIZER,
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
      subjectDisplayName: LONG_TRAINER,
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
    trainerHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct, reputation })),
    trainerSameStringIdsHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerSameStringIds })),
    trainerMissingHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerMissing })),
    longTrainerName: LONG_TRAINER,
    longOrganizerName: LONG_ORGANIZER,
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

/** Coinciding string values across different id namespaces — must NOT merge roles. */
const trainerSameStringIds: Game = {
  ...trainerDistinct,
  id: "game-trainer-same",
  trainer: {
    profileId: "shared-looking-id",
    displayName: LONG_TRAINER,
    declarationSource: "self_declared",
  },
  organizer: { id: "shared-looking-id", displayName: "Alexey Morozov", publicContact: "private" },
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
    expect(cardSource).not.toMatch(/sameKnownPerson|combinedIdentity|trainer-organizer/);
    expect(discoveryCss).not.toMatch(/data-layout="stacked"|aspect-ratio:\s*16\s*\/\s*10/);
    expect(discoveryCss).toMatch(/grid-template-columns:\s*minmax\(210px,\s*min\(300px,\s*36%\)\)\s*minmax\(0,\s*1fr\)/);
    expect(discoveryCss).toMatch(/@media \(max-width:\s*720px\)[\s\S]*\.gb-discovery-card,\s*\.gb-discovery-skeleton\s*\{\s*display:\s*block/);
  });

  it("allows complete trainer/organizer name wrap without ellipsis clipping", () => {
    expect(discoveryCss).toMatch(/\.gb-discovery-host strong\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(discoveryCss).toMatch(/\.gb-discovery-host strong\s*\{[^}]*white-space:\s*normal/);
    expect(discoveryCss).not.toMatch(
      /\.gb-discovery-host strong\s*\{[^}]*(?:text-overflow:\s*ellipsis|white-space:\s*nowrap)/,
    );
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, {
      game: {
        ...trainerDistinct,
        trainer: { ...trainerDistinct.trainer!, displayName: LONG_TRAINER },
        organizer: { ...trainerDistinct.organizer, displayName: LONG_ORGANIZER },
      },
    }));
    expect(html).toContain(LONG_TRAINER);
    expect(html).toContain(LONG_ORGANIZER);
    expect(html).not.toContain("…");
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

  it("always shows trainer and organizer separately even when id strings coincide", () => {
    const same = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerSameStringIds }));
    const distinct = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct }));
    for (const html of [same, distinct]) {
      expect(html).toContain('data-role="trainer"');
      expect(html).toContain('data-role="organizer"');
      expect(html).not.toContain('data-role="trainer-organizer"');
      expect(html).not.toContain("Тренер · самостоятельно указано · Организатор");
      expect(html).toContain("Тренер · самостоятельно указано");
      expect(html).toContain("Организатор");
    }
    expect(same).toContain('data-trainer-profile="shared-looking-id"');
    expect(same).toContain('data-organizer-id="shared-looking-id"');
    expect(same).toContain(LONG_TRAINER);
    expect(same).toContain("Alexey Morozov");
    expect(same.match(/data-role="trainer"/g)?.length).toBe(1);
    expect(same.match(/data-role="organizer"/g)?.length).toBe(1);
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

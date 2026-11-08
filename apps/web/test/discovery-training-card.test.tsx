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
const DEMO_TRAINER = "Alexey Morozov (demo trainer)";
const DEMO_ORGANIZER = "Alexey Morozov";

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
  const trainerTypical: Game = {
    ...regular,
    id: "game-trainer-typical",
    title: "Demo Morozov Coaching Hour",
    activityKind: "trainer_led",
    trainer: {
      profileId: "trainer-profile-am",
      displayName: DEMO_TRAINER,
      declarationSource: "self_declared",
    },
    organizer: { id: "org-user-am", displayName: DEMO_ORGANIZER, publicContact: "private" },
    startsAt: "2030-11-11T16:00:00Z",
    endsAt: "2030-11-11T18:00:00Z",
    settlement: {
      mode: "external",
      purpose: "trainer_fee",
      priceStatus: "by_agreement",
      priceMinor: null,
      currency: null,
      terms: "Оплата тренеру по договорённости · Synthetic demo settlement terms. Payment custody outside MVP.",
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
  const reputationTypical: GameRoleReputationCard = {
    gameId: trainerTypical.id,
    organization: {
      roleHandle: "o".repeat(32),
      role: "organization",
      subjectDisplayName: DEMO_ORGANIZER,
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
      subjectDisplayName: DEMO_TRAINER,
      heldGamesCount: 1,
      countScope: "confirmed_history",
      historyMayBeIncomplete: true,
      publishedReviewCount: 0,
      projectionVersion: "1",
      availability: "available",
    },
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
  const reputationNullHeld: GameRoleReputationCard = {
    ...reputation,
    organization: {
      ...reputation.organization!,
      heldGamesCount: null,
      publishedReviewCount: 2,
    },
  };
  const reputationZeroHeld: GameRoleReputationCard = {
    ...reputation,
    organization: {
      ...reputation.organization!,
      heldGamesCount: 0,
      historyMayBeIncomplete: true,
      publishedReviewCount: 0,
    },
  };
  return {
    regularHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: regular })),
    trainerTypicalHtml: renderToStaticMarkup(
      createElement(DiscoveryGameCard, { game: trainerTypical, reputation: reputationTypical }),
    ),
    trainerHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct, reputation })),
    trainerSameStringIdsHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerSameStringIds })),
    trainerMissingHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerMissing })),
    trainerWithoutRoleDataHtml: renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct })),
    trainerNullHeldHtml: renderToStaticMarkup(
      createElement(DiscoveryGameCard, { game: trainerDistinct, reputation: reputationNullHeld }),
    ),
    trainerZeroHeldHtml: renderToStaticMarkup(
      createElement(DiscoveryGameCard, { game: trainerDistinct, reputation: reputationZeroHeld }),
    ),
    longTrainerName: LONG_TRAINER,
    longOrganizerName: LONG_ORGANIZER,
    demoTrainerName: DEMO_TRAINER,
    demoOrganizerName: DEMO_ORGANIZER,
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
const panelSource = readFileSync(new URL("../src/components/consumer/games/RoleReputationPanel.tsx", import.meta.url), "utf8");
const discoveryCss = readFileSync(new URL("../src/styles/discovery.css", import.meta.url), "utf8");

describe("#521 discovery training card D2 square + compact roles", () => {
  it("writes exact DiscoveryGameCard SSR fixture for the browser helper when requested", () => {
    const path = process.env.GB521_BROWSER_FIXTURE;
    if (!path) return;
    writeFileSync(path, JSON.stringify(renderTrainingCardBrowserFixtures()));
  });

  it("keeps desktop square image CSS without height-latch or mobile square rewrite", () => {
    expect(cardSource).not.toMatch(/useFeedCardLayout|mediaBudget|data-layout|ResizeObserver|height-latch/);
    expect(cardSource).not.toMatch(/setLayout\("stacked"\)|scrollHeight/);
    expect(cardSource).not.toMatch(/sameKnownPerson|combinedIdentity|trainer-organizer/);
    expect(discoveryCss).not.toMatch(/data-layout="stacked"|aspect-ratio:\s*16\s*\/\s*10/);
    expect(discoveryCss).toMatch(/grid-template-columns:\s*minmax\(210px,\s*min\(300px,\s*36%\)\)\s*minmax\(0,\s*1fr\)/);
    expect(discoveryCss).toMatch(/\.gb-discovery-card\s*\{[^}]*align-items:\s*start/);
    expect(discoveryCss).toMatch(/\.gb-discovery-card__image\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
    expect(discoveryCss).toMatch(/\.gb-discovery-card__image\s*\{[^}]*align-self:\s*start/);
    expect(discoveryCss).toMatch(/object-fit:\s*cover/);
    expect(discoveryCss).toMatch(/object-position:\s*50%\s*50%/);
    expect(discoveryCss).toMatch(/@media \(max-width:\s*720px\)[\s\S]*\.gb-discovery-card__image[\s\S]*height:\s*210px/);
    expect(discoveryCss).toMatch(/@media \(max-width:\s*720px\)[\s\S]*\.gb-discovery-card__image[\s\S]*aspect-ratio:\s*auto/);
    expect(discoveryCss).not.toMatch(/\.gb-discovery-(?:card|host|card__people)[^{]*\{[^}]*(?:line-clamp|text-overflow:\s*ellipsis)/);
    expect(discoveryCss).toMatch(/\.gb-discovery-card__people/);
    expect(discoveryCss).toMatch(/\.gb-discovery-card__role-review/);
    expect(discoveryCss).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*auto\s*auto/);
    expect(discoveryCss).toMatch(/\.gb-discovery-card\[data-activity="trainer_led"\]\s*\.gb-discovery-terms\s*\{[^}]*margin-bottom:\s*0/);
    expect(panelSource).toMatch(/renderCompact/);
    expect(panelSource).toMatch(/compactHistoryLabel|Подтверждённая история/);
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
    expect(regular).not.toContain("gb-discovery-card__people");
    expect(training).toContain("С тренером");
    expect(training).toContain('data-activity="trainer_led"');
    expect(training).toContain("gb-discovery-card__people");
    expect(training).toContain("gb-discovery-card__actions");
    expect(training).not.toContain("gb-discovery-card__footer");
    expect(training).toContain('data-role="trainer"');
    expect(training).toContain('data-trainer-profile="trainer-profile-am"');
    expect(training).toContain("Alexey Morozov (demo trainer)");
    expect(training).toContain('data-role="organizer"');
    expect(training).toContain('data-organizer-id="org-user-other"');
    expect(training).toContain("Other Organizer");
    expect(training).toContain("gb-discovery-card__role-review");
    expect(training).toContain("Отзывы");
    expect(training).toContain("Подтверждённая история: 3");
    expect(training).toContain(">Тренер<");
    expect(training).not.toMatch(/<small>Тренер · самостоятельно указано<\/small>/);
    expect(training).not.toContain("gb-role-rep-footer");
  });

  it("always shows trainer and organizer separately even when id strings coincide", () => {
    const same = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerSameStringIds }));
    const distinct = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct }));
    for (const html of [same, distinct]) {
      expect(html).toContain('data-role="trainer"');
      expect(html).toContain('data-role="organizer"');
      expect(html).not.toContain('data-role="trainer-organizer"');
      expect(html).not.toContain("Тренер · самостоятельно указано · Организатор");
      expect(html).toContain(">Тренер<");
      expect(html).not.toMatch(/<small>Тренер · самостоятельно указано<\/small>/);
      expect(html).toContain("Организатор");
      expect(html).toContain("gb-discovery-card__people");
    }
    expect(same).toContain('data-trainer-profile="shared-looking-id"');
    expect(same).toContain('data-organizer-id="shared-looking-id"');
    expect(same).toContain(LONG_TRAINER);
    expect(same).toContain("Alexey Morozov");
    expect(same.match(/data-role="trainer"/g)?.length).toBe(1);
    expect(same.match(/data-role="organizer"/g)?.length).toBe(1);
    expect(distinct).not.toContain("MorozovOther");
  });

  it("shows truthful unavailable trainer state without fabricating organizer avatar", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerMissing }));
    expect(html).toContain("С тренером");
    expect(html).toContain('data-trainer-unavailable="true"');
    expect(html).toContain("Профиль недоступен");
    expect(html).not.toContain("data-trainer-profile=");
    expect(html).toContain("Other Organizer");
    expect(html).toContain("Организатор");
    expect(html).toContain("gb-discovery-card__people");
    expect(html).toContain("gb-discovery-card__actions");
    expect(html).toContain("Подробнее");
  });

  it("preserves long terms, seats, share and compact review cues on trainer cards", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct, reputation }));
    expect(html).toContain(trainerDistinct.settlement.terms);
    expect(html).toContain("Свободно 3 из 4");
    expect(html).toContain("Demo Arena Izmailovo");
    expect(html).toContain("Уровень: 2.5");
    expect(html).toContain("Парная игра");
    expect(html).toContain(`href="/games/${trainerDistinct.id}"`);
    expect(html).toContain(" · Отзывы · 1");
    expect(html).toContain(" · Отзывы · 2");
    expect(html).toContain('aria-label="Отзывы о тренировках · 1: Alexey Morozov (demo trainer). Тренер · самостоятельно указано"');
    expect(html).toContain('aria-label="Отзывы об организации · 2: Other Organizer"');
    expect(html).toMatch(/gb-discovery-card__people[\s\S]*gb-discovery-card__actions/);
  });

  it("keeps available reviews when held count is null and distinguishes zero from null history", () => {
    const nullHeld: GameRoleReputationCard = {
      ...reputation,
      organization: { ...reputation.organization!, heldGamesCount: null, publishedReviewCount: 2 },
    };
    const zeroHeld: GameRoleReputationCard = {
      ...reputation,
      organization: {
        ...reputation.organization!,
        heldGamesCount: 0,
        historyMayBeIncomplete: true,
        publishedReviewCount: 0,
      },
      training: { ...reputation.training!, availability: "unavailable" },
    };
    const without = renderToStaticMarkup(createElement(DiscoveryGameCard, { game: trainerDistinct }));
    const nullHtml = renderToStaticMarkup(
      createElement(DiscoveryGameCard, { game: trainerDistinct, reputation: nullHeld }),
    );
    const zeroHtml = renderToStaticMarkup(
      createElement(DiscoveryGameCard, { game: trainerDistinct, reputation: zeroHeld }),
    );
    expect(without).toContain("gb-discovery-card__people");
    expect(without).toContain("Подробнее");
    expect(without).not.toContain("gb-discovery-card__role-review");
    expect(without).not.toContain("gb-discovery-card__history\"");
    expect(nullHtml).toContain("gb-discovery-card__role-review");
    expect(nullHtml).toContain(" · Отзывы · 2");
    expect(nullHtml).not.toContain("gb-discovery-card__history\"");
    expect(nullHtml).not.toContain("Подтверждённая история");
    expect(zeroHtml).toContain("По подтверждённой истории проведённых игр пока нет");
    expect(zeroHtml).not.toContain("Подтверждённая история: 0");
    expect(zeroHtml).not.toContain(" · Отзывы · 0");
  });

  it("leaves unavailable review gates as plain roles without fake zero counts", () => {
    const unavailable: GameRoleReputationCard = {
      gameId: trainerDistinct.id,
      organization: { ...reputation.organization!, availability: "unavailable" },
      training: { ...reputation.training!, availability: "unavailable" },
    };
    const html = renderToStaticMarkup(
      createElement(DiscoveryGameCard, { game: trainerDistinct, reputation: unavailable }),
    );
    expect(html).toContain(">Тренер<");
    expect(html).not.toMatch(/<small>Тренер · самостоятельно указано<\/small>/);
    expect(html).toContain("Организатор");
    expect(html).not.toContain("gb-discovery-card__role-review");
    expect(html).not.toContain(" · Отзывы · 0");
    expect(html).not.toContain("gb-discovery-card__history\"");
    expect(html).toContain("Подробнее");
  });
});

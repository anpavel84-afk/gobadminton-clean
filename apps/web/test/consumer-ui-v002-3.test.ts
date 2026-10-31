import { describe, expect, it } from "vitest";
import {
  canRequestParticipation,
  dominantParticipation,
  isTrainerLed,
  participationLabel,
} from "../src/lib/game-presentation";
import { API_BLOCKERS, type Game, type Participation } from "../src/lib/consumer-types";

async function readSource(...parts: string[]): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.join(__dirname, ...parts), "utf8");
}

function sampleGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    version: 1,
    title: "Friday doubles",
    status: "published",
    visibility: "public",
    activityKind: "regular",
    trainer: null,
    trainingDescription: null,
    organizer: {
      id: null,
      displayName: "Павел",
      publicContact: "telegram:@pavel",
    },
    venue: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Корт 1",
      cityId: "33333333-3333-3333-3333-333333333333",
      address: "Москва",
      timezone: "Europe/Moscow",
    },
    startsAt: "2030-01-01T10:00:00.000Z",
    endsAt: "2030-01-01T12:00:00.000Z",
    timezone: "Europe/Moscow",
    applicationDeadlineAt: "2030-01-01T09:00:00.000Z",
    capacity: 8,
    externalReservedCount: 0,
    confirmedCount: 2,
    availablePlaces: 6,
    formatKey: "doubles",
    levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0"] },
    settlement: {
      mode: "external",
      purpose: "no_trainer_fee",
      priceMinor: null,
      currency: null,
      terms: "Court outside platform",
    },
    ...overrides,
  };
}

describe("Consumer v002.3 regular vs trainer-led presentation", () => {
  it("keeps trainer marker only for trainer_led games", () => {
    const regular = sampleGame({ activityKind: "regular", trainer: null });
    const trainerLed = sampleGame({
      activityKind: "trainer_led",
      trainer: {
        profileId: "44444444-4444-4444-4444-444444444444",
        displayName: "Алексей",
        declarationSource: "self_declared",
      },
      settlement: {
        mode: "external",
        purpose: "trainer_fee",
        priceStatus: "by_agreement",
        priceMinor: null,
        currency: null,
        terms: "By agreement",
      },
    });
    expect(isTrainerLed(regular)).toBe(false);
    expect(isTrainerLed(trainerLed)).toBe(true);
  });

  it("blocks new request when full, but not because of unrelated pending elsewhere", () => {
    const full = sampleGame({ availablePlaces: 0 });
    expect(canRequestParticipation(full, null)).toBe(false);
    const open = sampleGame({ availablePlaces: 2 });
    expect(canRequestParticipation(open, null)).toBe(true);
    expect(
      canRequestParticipation(open, {
        id: "p1",
        gameId: open.id,
        userId: "u1",
        status: "pending",
        version: 1,
        attemptNumber: 1,
        requestedAt: "2030-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("lets cancellation dominate prior confirmation", () => {
    const items: Participation[] = [
      {
        id: "a",
        gameId: "g1",
        userId: "u1",
        status: "confirmed",
        version: 1,
        attemptNumber: 1,
        requestedAt: "2030-01-01T00:00:00.000Z",
      },
      {
        id: "b",
        gameId: "g1",
        userId: "u1",
        status: "cancelled_by_game",
        version: 2,
        attemptNumber: 1,
        requestedAt: "2030-01-01T01:00:00.000Z",
      },
    ];
    expect(dominantParticipation(items, "g1")?.status).toBe("cancelled_by_game");
    expect(participationLabel("pending")).toContain("Ждём");
    expect(participationLabel("confirmed")).toContain("подтверждено");
  });
});

describe("Consumer v002.3 shell and gate integrity", () => {
  it("uses Games / Players / My Games / Messages mobile tabs and header Profile", async () => {
    const items = await readSource("../src/components/consumer/nav-items.ts");
    const nav = await readSource("../src/components/consumer/RootNav.tsx");
    expect(items).toContain('label: "Игры"');
    expect(items).toContain('label: "Игроки"');
    expect(items).toContain('label: "Мои игры"');
    expect(items).toContain('label: "Сообщения"');
    expect(items).not.toContain('label: "Профиль"');
    expect(nav).toContain('href="/profile"');
    expect(items).not.toMatch(/Организатор|Trainers|Кабинет/);
  });

  it("wires managed games to authoritative GET /me/games including non-creator managers", async () => {
    const page = await readSource("../src/components/consumer/pages/MyGamesPage.tsx");
    const client = await readSource("../src/lib/api-client.ts");
    const owned = await readSource(
      "../src/components/consumer/pages/OwnedGameSummaryPage.tsx",
    );
    expect(client).toContain("/v1/me/games");
    expect(client).toContain("listAllMyManagedGames");
    expect(client).toContain("listMyCreatedGames");
    expect(page).toContain("listAllMyManagedGames");
    expect(page).toContain('data-list="managed-by-me"');
    expect(page).toContain("managedGameRelationLabel");
    expect(page).not.toContain("listGames(");
    expect(page).not.toContain("localStorage");
    expect(owned).toContain("getMyManagedGame");
    expect(owned).toContain("listAllGameParticipations");
    expect(owned).toContain("confirmParticipation");
    expect(owned).toContain("rejectParticipation");
    expect(owned).toContain("removeParticipation");
    expect(owned).not.toContain('data-gated="D-MGMT"');
    expect(owned).toContain("Изменение вместимости и отмена игры пока недоступны");
    expect(API_BLOCKERS.REQUEST_ATTENTION_COUNT).toMatch(/pending-request count/i);
  });

  it("keeps managed-games auth/loading/error/empty distinct from discovery", async () => {
    const page = await readSource("../src/components/consumer/pages/MyGamesPage.tsx");
    expect(page).toContain('data-state="auth"');
    expect(page).toContain('data-state="loading"');
    expect(page).toContain('data-state="error"');
    expect(page).toContain('data-state="empty"');
    expect(page).toContain("listAllMyManagedGames()");
    expect(page).not.toContain('data-blocker="owned-games-list"');
  });

  it("wires withdrawal/refusal review routes to admitted withdraw API", async () => {
    const review = await readSource(
      "../src/components/consumer/pages/ParticipationReviewPage.tsx",
    );
    const detail = await readSource("../src/components/consumer/pages/GameDetailPage.tsx");
    const client = await readSource("../src/lib/api-client.ts");
    expect(client).toContain("/v1/participations/${participationId}/withdraw");
    expect(review).toContain("withdrawParticipation");
    expect(review).not.toContain("Ваше участие не изменилось");
    expect(detail).toContain("/review?intent=withdraw");
    expect(detail).toContain("/review?intent=refuse");
  });

  it("wires TrainerProfile deactivation and keeps fixed fee create path closed", async () => {
    const create = await readSource("../src/components/consumer/pages/CreateGamePage.tsx");
    const profile = await readSource("../src/components/consumer/pages/ProfilePage.tsx");
    const trainer = await readSource(
      "../src/components/consumer/pages/TrainerProfileEditPage.tsx",
    );
    const client = await readSource("../src/lib/api-client.ts");
    expect(create).toContain('priceStatus: "by_agreement"');
    expect(create).not.toContain('priceStatus: "fixed"');
    expect(client).toContain("/v1/me/trainer-profile/deactivate");
    expect(profile).toContain("deactivateTrainerProfile");
    expect(profile).not.toContain('data-gated="PX-01"');
    expect(trainer).toContain("deactivateTrainerProfile");
  });

  it("binds production semantic tokens rather than Player Cabinet dark canvas", async () => {
    const tokens = await readSource("../src/styles/consumer-tokens.css");
    expect(tokens).toContain("--gb-paper: #f5f6f2");
    expect(tokens).toContain("--gb-lime: #a7f447");
    expect(tokens).toContain("--gb-ink: #13221a");
    expect(tokens).toContain("--gb-purple: #7945de");
    expect(tokens).toContain("--gb-yellow: #ffe640");
    expect(tokens).toContain("--gb-text-primary");
    expect(tokens).toContain("--c23-canvas: var(--gb-paper)");
    expect(tokens).not.toContain("#071012");
  });

  it("keeps Design Spec venue-copy override against Make illustrative court/shuttle claim", async () => {
    const detail = await readSource("../src/components/consumer/games/GameDetailComposition.tsx");
    expect(detail).toContain("Условия аренды площадки уточняйте у организатора");
    expect(detail).not.toContain("воланы включены");
  });

  it("keeps Settings sensitive rows gated", async () => {
    const settings = await readSource("../src/components/consumer/pages/SettingsPage.tsx");
    expect(settings).toContain('href="/profile/settings/login-methods"');
    expect(settings).toContain('href="/profile/settings/sessions"');
    expect(settings).not.toContain("Пока недоступно</small></button>\n        <button type=\"button\" disabled data-gated=\"C-AUTH\"");
    expect(settings).toContain('data-gated="C-DEL"');
    expect(settings).toContain('href="/help"');
    expect(settings).toContain('href="/legal"');
    expect(settings).toContain("logout(me.csrfToken, { signal: controller.signal, notifySession: false })");
  });

  it("hides non-admitted Позже/level dead ends and wires Profile logout", async () => {
    const profile = await readSource("../src/components/consumer/pages/ProfilePage.tsx");
    const players = await readSource("../src/components/consumer/pages/PlayersDirectoryPage.tsx");
    const discovery = await readSource("../src/components/consumer/pages/GamesDiscoveryPage.tsx");
    expect(profile).not.toContain('href="/profile/settings/messages"');
    expect(profile).toContain('label="Разрешать личные сообщения"');
    expect(profile).not.toContain('label="Принимать запросы на общение"');
    expect(profile).not.toContain("Позже");
    expect(profile).not.toContain("Настройка пока недоступна");
    expect(profile).toContain("logout(me.csrfToken)");
    expect(profile).toContain('className="account-panel__logout"');
    expect(players).not.toContain("Уровень · позже");
    expect(players).toContain("readSelectedLocation()?.cityId");
    expect(discovery).not.toContain("Все уровни");
  });
});

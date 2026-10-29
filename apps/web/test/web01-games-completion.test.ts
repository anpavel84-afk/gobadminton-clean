import { describe, expect, it } from "vitest";
import {
  capacityStatusLabel,
  capacityTone,
  canRequestParticipation,
  participationLabel,
} from "../src/lib/game-presentation";
import type { Game } from "../src/lib/consumer-types";

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

describe("WEB-01 Games completion", () => {
  it("keeps pending distinct from confirmed in labels", () => {
    expect(participationLabel("pending")).toContain("Ждём");
    expect(participationLabel("confirmed")).toContain("подтверждено");
    expect(participationLabel("pending")).not.toEqual(
      participationLabel("confirmed"),
    );
  });

  it("exposes capacity tones for detail presentation", () => {
    expect(capacityTone(sampleGame({ availablePlaces: 6 }))).toBe("available");
    expect(capacityTone(sampleGame({ availablePlaces: 2 }))).toBe("few");
    expect(capacityTone(sampleGame({ availablePlaces: 0 }))).toBe("full");
    expect(capacityTone(sampleGame({ status: "cancelled" }))).toBe("cancelled");
    expect(capacityStatusLabel(sampleGame({ availablePlaces: 0 }))).toContain(
      "Мест нет",
    );
    expect(canRequestParticipation(sampleGame({ availablePlaces: 0 }), null)).toBe(
      false,
    );
  });

  it("implements DR-08 mobile sticky participation bar above bottom nav", async () => {
    const page = await readSource(
      "../src/components/consumer/pages/GameDetailPage.tsx",
    );
    const css = await readSource("../src/styles/games.css");
    expect(page).toContain('data-sticky-cta="dr-08"');
    expect(page).toContain("<GameActionBar>");
    expect(page).toContain('mode="page"');
    expect(page).toContain("pending");
    expect(page).toContain("confirmed");
    expect(css).toContain(".gb-game-action");
    expect(css).toContain("bottom: calc(76px + env(safe-area-inset-bottom");

  });

  it("keeps Create → Preview → Publish with owned-summary success and no auto-repeat", async () => {
    const page = await readSource(
      "../src/components/consumer/pages/CreateGamePage.tsx",
    );
    expect(page).toContain('data-surface="create-form"');
    expect(page).toContain('data-surface="create-preview"');
    expect(page).toContain("gb-game-form-group");
    expect(page).toContain("Создать игру");
    expect(page).toContain("Назад к редактированию");
    expect(page).toContain('data-result="success"');
    expect(page).toContain('data-result={step}');
    expect(page).toContain('step === "conflict"');
    expect(page).toContain("Открыть сводку созданной игры");
    expect(page).toContain("if (busy) return");
    expect(page).toContain("Проверьте список своих игр перед повторной публикацией");
  });

  it("wires My Games participating + managed games with Create entry", async () => {
    const page = await readSource(
      "../src/components/consumer/pages/MyGamesPage.tsx",
    );
    expect(page).toContain("Участвую");
    expect(page).toContain("Управляю");
    expect(page).toContain("Созданные мной и управляемые");
    expect(page).toContain("listAllMyManagedGames");
    expect(page).toContain("listAllMyParticipations");
    expect(page).toContain('data-list="managed-by-me"');
    expect(page).toContain("gb-my-games-header");
    expect(page).toContain('ownStatus={participation.status}');
    expect(page).toContain('gb-history-link');
    expect(page).toContain('view === "history"');
    expect(page).not.toContain('data-gated="D-HIST"');
    expect(page).toContain("isParticipatingHistoryRow");
    expect(page).toContain("isActiveCreatedGame");
  });

  it("preserves Players gate and admitted Messages header; Games allows Radar status without player slot fields", async () => {
    const nav = await readSource("../src/components/consumer/RootNav.tsx");
    const players = await readSource(
      "../src/components/consumer/pages/PlayersGatedPage.tsx",
    );
    const discovery = await readSource(
      "../src/components/consumer/pages/GamesDiscoveryPage.tsx",
    );
    const detail = await readSource(
      "../src/components/consumer/pages/GameDetailPage.tsx",
    );
    expect(nav).toContain('href="/messages"');
    expect(players).toContain('data-gated="players"');
    expect(discovery).not.toMatch(/displaySlot|proximityBand/);
    expect(detail).not.toMatch(/Radar|Inbox|Написать сообщение/);
  });
});

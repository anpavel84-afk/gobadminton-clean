import { describe, expect, it, vi, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  confirmParticipation,
  deactivateTrainerProfile,
  getMyManagedGame,
  listAllGameParticipations,
  listAllMyManagedGames,
  rejectParticipation,
  removeParticipation,
  withdrawParticipation,
} from "../src/lib/api-client";
import {
  applicantLabel,
  isActiveCreatedGame,
  isParticipatingHistoryRow,
  isPastGame,
  managedGameRelationLabel,
} from "../src/lib/game-presentation";
import type { Game } from "../src/lib/consumer-types";

const here = path.dirname(fileURLToPath(import.meta.url));
async function readSource(rel: string) {
  return readFile(path.join(here, rel), "utf8");
}

const baseGame: Game = {
  id: "game",
  version: 1,
  title: "Игра",
  status: "published",
  visibility: "public",
  activityKind: "regular",
  trainer: null,
  trainingDescription: null,
  organizer: { id: null, displayName: "Орг", publicContact: "Связь" },
  venue: {
    id: "venue",
    name: "Зал",
    address: "Адрес",
    cityId: "city",
    timezone: "Europe/Moscow",
  },
  startsAt: "2035-01-01T16:00:00Z",
  endsAt: "2035-01-01T18:00:00Z",
  applicationDeadlineAt: "2035-01-01T15:00:00Z",
  timezone: "Europe/Moscow",
  capacity: 8,
  confirmedCount: 1,
  externalReservedCount: 0,
  availablePlaces: 7,
  formatKey: "doubles",
  levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0"] },
  settlement: {
    mode: "external",
    purpose: "no_trainer_fee",
    priceMinor: null,
    currency: null,
    terms: "Аренду делим",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("game-profile-controls-v001", () => {
  it("exposes manager + trainer + withdraw clients against admitted paths", async () => {
    const client = await readSource("../src/lib/api-client.ts");
    expect(client).toContain("/v1/games/${gameId}/participations");
    expect(client).toContain("/v1/participations/${participationId}/confirm");
    expect(client).toContain("/v1/participations/${participationId}/reject");
    expect(client).toContain("/v1/participations/${participationId}/remove");
    expect(client).toContain("/v1/participations/${participationId}/withdraw");
    expect(client).toContain("/v1/me/trainer-profile/deactivate");
  });

  it("keeps account deletion deferred and capacity/cancel unsupported", async () => {
    const settings = await readSource(
      "../src/components/consumer/pages/SettingsPage.tsx",
    );
    const profile = await readSource(
      "../src/components/consumer/pages/ProfilePage.tsx",
    );
    const owned = await readSource(
      "../src/components/consumer/pages/OwnedGameSummaryPage.tsx",
    );
    expect(settings).toContain('data-gated="C-DEL"');
    expect(profile).toContain("Удалить аккаунт");
    expect(profile).toContain("Пока недоступно");
    expect(owned).toContain("Изменение вместимости и отмена игры пока недоступны");
  });

  it("classifies history from admitted game/participation fields only", () => {
    const now = Date.parse("2030-06-01T12:00:00Z");
    expect(isPastGame({ ...baseGame, endsAt: "2030-05-01T18:00:00Z" }, now)).toBe(
      true,
    );
    expect(isPastGame(baseGame, now)).toBe(false);
    expect(isActiveCreatedGame({ ...baseGame, status: "draft" }, now)).toBe(true);
    expect(
      isActiveCreatedGame({ ...baseGame, status: "cancelled" }, now),
    ).toBe(false);
    expect(isParticipatingHistoryRow(baseGame, "pending", now)).toBe(false);
    expect(isParticipatingHistoryRow(baseGame, "rejected", now)).toBe(true);
    // Q-GPC-01: null/failed game read is not history evidence for active statuses.
    expect(isParticipatingHistoryRow(null, "confirmed", now)).toBe(false);
    expect(isParticipatingHistoryRow(null, "pending", now)).toBe(false);
    expect(isParticipatingHistoryRow(null, "withdrawn", now)).toBe(true);
    expect(applicantLabel("abcdef12-3456-7890-abcd-ef1234567890")).toBe(
      "Игрок · abcdef12",
    );
  });

  it("Q-GPC-02 keeps Profile social.trainer aligned after deactivate success", async () => {
    const profile = await readSource(
      "../src/components/consumer/pages/ProfilePage.tsx",
    );
    expect(profile).toContain('value={social.trainer ? "Включён" : "Выключен"}');
    expect(profile).toContain("setSocial({ ...social, trainer: false })");
    expect(profile).toContain("deactivateTrainerProfile");
  });

  it("Q-GPC-03 surfaces non-creator managed games with honest relation labels", async () => {
    const page = await readSource(
      "../src/components/consumer/pages/MyGamesPage.tsx",
    );
    const owned = await readSource(
      "../src/components/consumer/pages/OwnedGameSummaryPage.tsx",
    );
    const client = await readSource("../src/lib/api-client.ts");
    expect(client).toContain("listAllMyManagedGames");
    expect(client).toContain("getMyManagedGame");
    expect(page).toContain("listAllMyManagedGames");
    expect(page).toContain("managedGameRelationLabel");
    expect(page).toContain('data-list="managed-by-me"');
    expect(page).toContain("Управляю");
    expect(page).toContain("Созданные мной и управляемые");
    expect(owned).toContain("getMyManagedGame");
    expect(owned).toContain("managedGameRelationLabel");
    expect(owned).not.toContain("getMyCreatedGame");
    expect(managedGameRelationLabel({ role: "owner", createdByMe: true })).toBe(
      "Создана мной",
    );
    expect(
      managedGameRelationLabel({ role: "manager", createdByMe: false }),
    ).toBe("Управляю");
  });

  it("pages all managed games and resolves non-creator manager by id", async () => {
    const managed = {
      ...baseGame,
      id: "managed-game",
      management: { role: "manager" as const, createdByMe: false },
    };
    const created = {
      ...baseGame,
      id: "created-game",
      management: { role: "owner" as const, createdByMe: true },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [managed, created], nextCursor: null }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [managed], nextCursor: null })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [created], nextCursor: null })),
      );
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("window", {});
    const listed = await listAllMyManagedGames();
    expect(listed.ok && listed.data.map((item) => item.id)).toEqual([
      "managed-game",
      "created-game",
    ]);
    const hit = await getMyManagedGame("managed-game");
    expect(hit.ok && hit.data?.id).toBe("managed-game");
    expect(hit.ok && hit.data && !hit.data.management.createdByMe).toBe(true);
    const miss = await getMyManagedGame("missing");
    expect(miss.ok && miss.data).toBeNull();
  });

  it("pages manager applicants across cursors and fails closed", async () => {
    const part = {
      id: "p1",
      gameId: "game",
      userId: "user",
      status: "pending",
      version: 1,
      attemptNumber: 1,
      requestedAt: "2030-01-01T10:00:00Z",
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], nextCursor: "next" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [part], nextCursor: null })),
      );
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("window", {});
    const ok = await listAllGameParticipations("game");
    expect(ok.ok && ok.data).toEqual([part]);
    fetcher
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], nextCursor: "next" })),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    expect((await listAllGameParticipations("game")).ok).toBe(false);
  });

  it("posts confirm/reject/remove/withdraw/deactivate with CSRF bodies", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: "x",
          gameId: "g",
          userId: "u",
          status: "confirmed",
          version: 2,
          attemptNumber: 1,
          requestedAt: "2030-01-01T10:00:00Z",
          displayName: "T",
          bio: null,
          declarationSource: "self_declared",
          declaredAt: "2030-01-01T10:00:00Z",
        }),
        { status: 200 },
      );
    });
    await confirmParticipation("p1", 1, "csrf");
    await rejectParticipation("p1", 1, "reason", "csrf");
    await removeParticipation("p1", 1, "reason", "csrf");
    await withdrawParticipation("p1", 1, "csrf");
    await deactivateTrainerProfile(3, "csrf");
    expect(calls.map((c) => c.url)).toEqual([
      "/v1/participations/p1/confirm",
      "/v1/participations/p1/reject",
      "/v1/participations/p1/remove",
      "/v1/participations/p1/withdraw",
      "/v1/me/trainer-profile/deactivate",
    ]);
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      expect(headers.get("X-CSRF-Token")).toBe("csrf");
      expect(headers.get("Idempotency-Key")).toBeTruthy();
    }
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      expectedVersion: 1,
      reason: "reason",
    });
    expect(JSON.parse(String(calls[4]?.init.body))).toEqual({
      expectedVersion: 3,
    });
  });
});

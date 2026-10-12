import { describe, expect, it } from "vitest";
import {
  formatSocialLevel,
  isSocialDirectoryDisabled,
  lookingIntentActive,
  lookingIntentExpired,
  pilotSocialLevel,
} from "../src/lib/player-presentation";
import type { ApiResult } from "../src/lib/api-client";
import type { LookingIntent } from "../src/lib/consumer-types";

async function readSource(...parts: string[]): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.join(__dirname, ...parts), "utf8");
}

describe("WEB-02 Players / Profile", () => {
  it("detects social directory fail-closed code", () => {
    const denied: ApiResult<unknown> = {
      ok: false,
      status: 404,
      error: "disabled",
      problem: {
        type: "about:blank",
        title: "disabled",
        status: 404,
        code: "SOCIAL_DIRECTORY_DISABLED",
        requestId: "r1",
      },
    };
    expect(isSocialDirectoryDisabled(denied)).toBe(true);
    expect(
      isSocialDirectoryDisabled({
        ok: false,
        status: 404,
        error: "missing",
        problem: {
          type: "about:blank",
          title: "missing",
          status: 404,
          code: "RESOURCE_UNAVAILABLE",
          requestId: "r2",
        },
      }),
    ).toBe(false);
  });

  it("formats pilot levels and looking intent lifecycle", () => {
    expect(formatSocialLevel(pilotSocialLevel("beginner"))).toContain("Начинающий");
    const active: LookingIntent = {
      version: 1,
      state: "active",
      cityId: "11111111-1111-1111-1111-111111111111",
      areaKey: "center",
      startsAt: null,
      endsAt: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
      formatKeys: [],
    };
    const expired: LookingIntent = {
      ...active,
      expiresAt: "2000-01-01T00:00:00.000Z",
    };
    expect(lookingIntentActive(active)).toBe(true);
    expect(lookingIntentExpired(expired)).toBe(true);
    expect(lookingIntentActive(expired)).toBe(false);
  });

  it("wires directory to GET /players with honest states and contract filters only", async () => {
    const page = await readSource(
      "../src/components/consumer/pages/PlayersDirectoryPage.tsx",
    );
    const route = await readSource("../src/app/players/page.tsx");
    const client = await readSource("../src/lib/api-client.ts");
    expect(route).toContain("PlayersDirectoryPage");
    expect(client).toContain("export function listPlayers");
    expect(page).toContain('data-surface="players-directory"');
    expect(page).toContain('state="unavailable"');
    expect(page).toContain("isSocialDirectoryDisabled");
    expect(page).toContain("looking");
    expect(page).toContain("trainer");
    expect(page).toContain("areaKey");
    expect(page).toContain("cityId");
    expect(page).toContain("RadarSwitchControl");
    expect(page).not.toMatch(/fixture players|fake player|mockPlayers/i);
    expect(page).not.toMatch(/levelId|level filter|фильтр по уровню.*select/i);
  });

  it("presents public profile variants and connects admitted DM/Invite while keeping Radar gated", async () => {
    const page = await readSource(
      "../src/components/consumer/pages/PublicPlayerProfilePage.tsx",
    );
    const route = await readSource(
      "../src/app/players/[publicPlayerId]/page.tsx",
    );
    expect(route).toContain("PublicPlayerProfilePage");
    expect(page).toContain('data-surface="public-player"');
    expect(page).toContain('data-variant={variant}');
    expect(page).toContain("<ContactAction");
    expect(page).toContain("<ContactNote");
    expect(page).not.toContain('Radar включён');
    expect(page).toContain("Ближайшие игры этого игрока пока недоступны");
    expect(page).toContain("Тренер");
    expect(page).toContain("Ищу игру");
    expect(page).toContain('data-action={blocked ? "unblock" : "block"}');
    expect(page).toContain("createAbuseReport");
    expect(page).not.toMatch(/proximityBand|displaySlot|Radar включён/);
  });

  it("wires Own Profile looking/visibility and DR-09 account stacking", async () => {
    const page = await readSource(
      "../src/components/consumer/pages/ProfilePage.tsx",
    );
    const css = await readSource("../src/styles/players.css");
    expect(page).toContain('data-surface="own-profile"');
    expect(page).toContain('data-surface="op-03"');
    expect(page).toContain('data-surface="op-05"');
    expect(page).toContain("putMyLookingForGame");
    expect(page).toContain("putMySocialProfileVisibility");
    expect(page).toContain('href="/players"');
    expect(page).toContain("deactivateTrainerProfile");
    expect(page).not.toContain('data-gated="PX-01"');
    expect(page).toContain("Отключить");
    expect(css).toContain("@media (max-width:900px)");
    expect(css).toContain(".fr3 .account-panel");
    expect(css).toContain("grid-template-columns:minmax(0,1fr) 300px");
  });

  it("preserves WEB94 mobile Messages and header Profile actions", async () => {
    const items = await readSource("../src/components/consumer/nav-items.ts");
    const nav = await readSource("../src/components/consumer/RootNav.tsx");
    expect(items).toContain('label: "Сообщения"');
    expect(items).not.toContain('label: "Профиль"');
    expect(nav).toContain('href="/profile"');
    expect(nav).toContain('href="/messages"');
  });

});

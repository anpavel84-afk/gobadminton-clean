import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerCard, Toggle, VisibilityRow } from "../src/components/consumer/players/ProfileComposition";
import { getPlayer, listPlayers, putMySocialProfileVisibility } from "../src/lib/api-client";
import type { PublicPlayer } from "../src/lib/consumer-types";
const player: PublicPlayer = { publicPlayerId: "public-id", displayName: "Мария Л.", cityId: "city-id", areaKey: "Сокол", level: null, bio: "Люблю парную игру", trainer: false, lookingForGame: false };
afterEach(() => vi.unstubAllGlobals());
describe("FR-03 public projection and controls", () => {
  it("renders an accessible public card without inferring private fields or capability", () => {
    const html = renderToStaticMarkup(<PlayerCard player={{ ...player, phone: "secret-phone", email: "secret-email" } as PublicPlayer} city="Москва" />);
    expect(html).toContain('href="/players/public-id"'); expect(html).toContain("Люблю парную игру"); expect(html).toContain("Москва · Сокол");
    expect(html).not.toMatch(/secret-|city-id|Ищу игру|Тренер|Был недавно|км/);
    const active = renderToStaticMarkup(<PlayerCard player={{ ...player, trainer: true, lookingForGame: true }} />);
    expect(active).toContain("Тренер"); expect(active).toContain("Ищу игру"); expect(active).not.toMatch(/проверен|сертифицирован/i);
  });
  it("uses an honest checked, disabled trainer switch and field visibility text", () => {
    const html = renderToStaticMarkup(<><Toggle label="Я тренер" on disabled /><VisibilityRow label="Район" value="Сокол" shown={false} /></>);
    expect(html).toContain('role="switch"'); expect(html).toContain('aria-checked="true"'); expect(html).toContain('disabled=""'); expect(html).toContain("Скрыто");
  });
  it("public reads require no prior session and expose only accepted query filters", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [player], nextCursor: null }), { status: 200 })); vi.stubGlobal("fetch", fetch); vi.stubGlobal("window", {});
    await listPlayers({ name: "Мария", cityId: "city", looking: true, trainer: true, cursor: "next", limit: 50 });
    expect(fetch).toHaveBeenCalledTimes(1); const url = new URL(fetch.mock.calls[0]![0], "http://localhost");
    expect(url.pathname).toBe("/v1/players"); expect(url.searchParams.get("looking")).toBe("true"); expect(url.searchParams.get("cursor")).toBe("next");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(player), { status: 200 })); const detail = await getPlayer("public-id"); expect(detail.ok).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves visibility version/consent and CSRF with no automatic write retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetch); vi.stubGlobal("window", {});
    const result = await putMySocialProfileVisibility({ directoryVisible: true, expectedVersion: 7, consentPolicyVersion: "directory-mvp-v1" }, "csrf-test");
    expect(result.ok).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]![1]; expect(JSON.parse(init.body)).toEqual({ directoryVisible: true, expectedVersion: 7, consentPolicyVersion: "directory-mvp-v1" }); expect(init.headers.get("X-CSRF-Token")).toBe("csrf-test");
  });
});

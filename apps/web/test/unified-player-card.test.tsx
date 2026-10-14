import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UnifiedRow } from "@gobadminton/contracts";
import type { PublicPlayer } from "../src/lib/consumer-types";
import { PlayerCard } from "../src/components/consumer/players/ProfileComposition";
import { UnifiedPlayerCard } from "../src/components/consumer/radar/UnifiedPlayerCard";
const player = { publicPlayerId: "peer", displayName: "Безопасное имя", trainer: true, level: null, areaKey: "Центр", bio: "Описание", lookingForGame: true } as PublicPlayer;
const row = { projection: "directory", player, radar: null, publicPlayerId: "peer" } as UnifiedRow;
describe("single Players card family", () => {
  it("keeps the ordinary directory card byte-identical without distance", () => {
    expect(renderToStaticMarkup(<UnifiedPlayerCard row={row} city="Москва" onSelect={() => {}} />)).toBe(renderToStaticMarkup(<PlayerCard player={player} city="Москва" />));
  });
  it("adds only distance metadata and keeps public profile navigation", () => {
    const radar = { distance: { kind: "estimate", roundedMeters: 500, roundingStepMeters: 100 }, geo: { quality: "degraded", uncertaintyMeters: 1000, sourceAgeSeconds: 5 } } as unknown as NonNullable<UnifiedRow["radar"]>;
    const html = renderToStaticMarkup(<UnifiedPlayerCard row={{ ...row, radar }} city="Москва" onSelect={() => {}} />);
    expect(html).toContain('href="/players/peer"'); expect(html).toContain("≈ 500 м"); expect(html).not.toContain("Подробнее"); expect(html.replace(/<span class="unified-distance"[^>]*>.*?<\/span>/, "")).toBe(renderToStaticMarkup(<PlayerCard player={player} city="Москва" />));
  });
  it("Radar-only projection uses the same contents with a safe preview button", () => {
    const html = renderToStaticMarkup(<UnifiedPlayerCard row={{ ...row, projection: "radar_public" } as unknown as UnifiedRow} city="Москва" onSelect={() => {}} />);
    expect(html).toContain('<button type="button" class="player-card"'); expect(html).not.toContain('href='); expect(html).toContain("player-card__title"); expect(html).toContain("Безопасное имя");
  });
});

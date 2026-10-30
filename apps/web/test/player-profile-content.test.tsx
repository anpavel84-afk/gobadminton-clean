import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicPlayer } from "../src/lib/consumer-types";
import { PlayerProfileContent, PlayerProfileHero } from "../src/components/consumer/players/PlayerProfileContent";

const player: PublicPlayer = {
  publicPlayerId: "peer",
  displayName: "Мария Л.",
  cityId: "city",
  areaKey: "Сокол",
  level: null,
  bio: "Люблю парную игру",
  trainer: false,
  lookingForGame: true,
  avatar: { uploadedUrl: null, providerUrl: null },
};

describe("PlayerProfileContent shared ordinary/Radar presentation", () => {
  it("renders the same shared profile markup for the same approved fields", () => {
    const ordinary = renderToStaticMarkup(<PlayerProfileContent player={player} city="Москва" />);
    const radar = renderToStaticMarkup(<PlayerProfileContent player={player} city="Москва" />);
    expect(ordinary).toBe(radar);
    expect(ordinary).toContain("player-profile-hero");
    expect(ordinary).toContain("player-profile-visual");
    expect(ordinary).toContain("Мария Л.");
    expect(ordinary).toContain("Люблю парную игру");
    expect(ordinary).toContain("Москва · Сокол");
    expect(ordinary).toContain("Ищу игру");
    expect(ordinary).not.toContain("Приблизительное положение");
    expect(ordinary).not.toContain("погрешность");
  });

  it("adds distance only as optional Radar metadata without inventing cover/bio", () => {
    const withDistance = renderToStaticMarkup(
      <PlayerProfileContent player={{ ...player, bio: null, cover: null }} distance="≈ 1,2 км" titleAs="h2" />,
    );
    const without = renderToStaticMarkup(
      <PlayerProfileContent player={{ ...player, bio: null, cover: null }} titleAs="h2" />,
    );
    expect(withDistance).toContain("player-profile-distance");
    expect(withDistance).toContain("≈ 1,2 км");
    expect(without).not.toContain("player-profile-distance");
    expect(withDistance).not.toContain("Люблю парную игру");
    expect(withDistance.replace(/<span class="player-profile-distance"[^>]*>.*?<\/span>/, "")).toBe(without);
  });

  it("does not invent looking/trainer/cover when fields are absent", () => {
    const html = renderToStaticMarkup(
      <PlayerProfileContent player={{ publicPlayerId: "peer", displayName: "Игрок", lookingForGame: false, trainer: false }} />,
    );
    expect(html).toContain("Игрок");
    expect(html).not.toContain("Ищу игру");
    expect(html).not.toContain("Тренер");
    expect(html).not.toContain("profile-cover");
    expect(html).not.toContain("Обложка профиля");
  });

  it("shares PlayerProfileHero cover/avatar arrangement with public content", () => {
    const coverUrl = `/v1/media/covers/${"a".repeat(64)}.png`;
    const fields = { ...player, cover: { uploadedUrl: coverUrl } };
    const hero = renderToStaticMarkup(<PlayerProfileHero player={fields} city="Москва" titleAs="h2" />);
    const content = renderToStaticMarkup(<PlayerProfileContent player={fields} city="Москва" titleAs="h2" />);
    // React 19 SSR hoists image preload <link> tags to the markup root. Standalone
    // PlayerProfileHero therefore yields "preloads + section", while PlayerProfileContent
    // yields "preloads + wrapper div + section". Compare the section subtree only.
    const stripReactPreloadLinkPrefixes = (html: string) =>
      html.replace(/^(?:<link\s+rel="preload"[^>]*\/>)*/, "");
    const heroSection = stripReactPreloadLinkPrefixes(hero);
    expect(hero).toContain("player-profile-hero");
    expect(hero).toContain("player-profile-visual");
    expect(hero).toContain(coverUrl);
    expect(hero).toContain("<h2>Мария Л.</h2>");
    expect(hero).toContain("avatar");
    expect(heroSection.startsWith('<section class="player-profile-hero">')).toBe(true);
    expect(stripReactPreloadLinkPrefixes(content)).toContain(heroSection);
  });
});

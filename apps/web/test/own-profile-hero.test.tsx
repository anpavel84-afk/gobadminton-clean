import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerProfileHero } from "../src/components/consumer/players/PlayerProfileContent";

const coverUrl = `/v1/media/covers/${"b".repeat(64)}.png`;

describe("own profile shared cover/avatar hero", () => {
  it("uses shared hero classes with h2 title and optional own cover-frame alias", () => {
    const html = renderToStaticMarkup(
      <PlayerProfileHero
        titleAs="h2"
        visualClassName="own-profile-avatar"
        city="Москва"
        player={{
          publicPlayerId: "own",
          displayName: "Очень длинное имя игрока для проверки переноса",
          level: null,
          trainer: false,
          lookingForGame: false,
          avatar: { uploadedUrl: null, providerUrl: null },
          bio: "Свой текст",
          areaKey: "Сокол",
          cover: { uploadedUrl: coverUrl },
        }}
      />,
    );
    expect(html).toContain('class="player-profile-visual own-profile-avatar"');
    expect(html).toContain("player-profile-copy");
    expect(html).toContain("<h2>Очень длинное имя игрока для проверки переноса</h2>");
    expect(html).not.toContain("<h1>");
    expect(html).toContain(coverUrl);
    expect(html).toContain("Игрок");
    expect(html).toContain("Москва · Сокол");
    expect(html).toContain("Свой текст");
  });

  it("keeps avatar inside visual without inventing cover when upload is absent", () => {
    const html = renderToStaticMarkup(
      <PlayerProfileHero
        titleAs="h2"
        visualClassName="own-profile-avatar"
        player={{
          publicPlayerId: "own",
          displayName: "Без обложки",
          lookingForGame: true,
          trainer: true,
          cover: { uploadedUrl: null },
          avatar: { uploadedUrl: null, providerUrl: null },
        }}
      />,
    );
    expect(html).toContain("player-profile-visual");
    expect(html).toContain("avatar");
    expect(html).toContain("Ищу игру");
    expect(html).toContain("Тренер");
    expect(html).not.toContain("profile-cover");
    expect(html).not.toContain("Обложка профиля");
  });
});

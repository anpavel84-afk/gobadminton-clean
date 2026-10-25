import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GamePhotoSelection } from "../src/components/consumer/games/GamePhotoSelection";
import { VenueGameActions } from "../src/components/consumer/games/VenueGameActions";
import { GameShare } from "../src/components/consumer/games/GameShare";
import { publicGameUrl } from "../src/lib/game-share";

describe("venue popup UAT #174: game actions and photo layout", () => {
  it("shows the existing real share trigger and a truthful loading state without a fake friend invitation", () => {
    const html = renderToStaticMarkup(<VenueGameActions gameId="game-123" />);
    expect(html).toContain('aria-label="Действия с игрой"');
    expect(html).toContain("Проверяем возможность участия");
    expect(html).toContain("Поделиться / отправить другу");
    expect(html).toContain('aria-label="Поделиться / отправить другу"');
    expect(html).not.toContain("Приглашение отправлено");
    expect(html).not.toContain("Оставить заявку"); // never before authoritative eligibility is known
  });

  it("keeps icon-only sharing on the regular game page unchanged", () => {
    const html = renderToStaticMarkup(<GameShare gameId="game-123" />);
    expect(html).toContain('aria-label="Поделиться игрой"');
    expect(html).not.toContain("Поделиться / отправить другу");
    expect(publicGameUrl("https://dev.gobadminton.ru/?view=map", "game-123")).toBe("https://dev.gobadminton.ru/games/game-123");
  });

  it("gives reset-photo a dedicated spaced control while retaining the file picker", () => {
    const html = renderToStaticMarkup(<GamePhotoSelection onChange={() => {}} onReady={() => {}} />);
    expect(html).toContain("gb-game-photo-selection");
    expect(html).toContain("gb-game-photo-reset");
    expect(html).toContain('type="file"');
    expect(html).toContain("Без своего фото");
    const css = readFileSync(new URL("../src/styles/games.css", import.meta.url), "utf8");
    expect(css).toContain(".gb-game-photo-selection .gb-game-photo-reset");
    expect(css).toContain("margin-top:18px");
  });

  it("sets lime popup CTA ink explicitly rather than inheriting native browser blue", () => {
    const css = readFileSync(new URL("../src/styles/venue-popup.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.gb-consumer \.gb-venue-sheet-primary[^\n]*color:var\(--gb-ink\)/);
    expect(css).toContain(".gb-venue-game-actions");
  });
});

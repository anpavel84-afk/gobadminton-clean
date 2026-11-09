import { createElement } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DesktopBrowseActionsFixture,
  DesktopBrowseActionsShell,
  StableActionFooter,
} from "../src/components/consumer/players/PlayerBrowsePlayInterest";

const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, "../src/styles/player-browse.css"), "utf8");
const deckSource = readFileSync(
  join(root, "../src/components/consumer/players/PlayerBrowseDeck.tsx"),
  "utf8",
);
const playSource = readFileSync(
  join(root, "../src/components/consumer/players/PlayerBrowsePlayInterest.tsx"),
  "utf8",
);

const STATES: Array<{
  id: string;
  status: string;
  statusTone?: "success" | "warning" | "";
  primaryLabel: string;
  primaryClassName: string;
  showPrimary?: boolean;
}> = [
  { id: "ready", status: "", primaryLabel: "Давай сыграем", primaryClassName: "pb-btn-request" },
  { id: "hint", status: "Войдите, чтобы предложить игру", primaryLabel: "Войти", primaryClassName: "pb-btn-request" },
  { id: "warn", status: "Не удалось проверить. Повторите.", statusTone: "warning", primaryLabel: "Повторить", primaryClassName: "pb-btn-withdraw" },
  { id: "busy", status: "Проверяем…", primaryLabel: "Давай сыграем", primaryClassName: "pb-btn-request" },
  { id: "sent", status: "Предложение отправлено", statusTone: "success", primaryLabel: "Отменить предложение", primaryClassName: "pb-btn-withdraw" },
  { id: "blocked", status: "Слишком много попыток. Позже.", statusTone: "warning", primaryLabel: "Давай сыграем", primaryClassName: "pb-btn-request", showPrimary: false },
  { id: "guest", status: "Войдите, чтобы предложить игру", primaryLabel: "Войти", primaryClassName: "pb-btn-request" },
  { id: "long-primary", status: "Вы оба хотите сыграть", statusTone: "success", primaryLabel: "Отменить предложение", primaryClassName: "pb-btn-withdraw" },
];

describe("player browse desktop actions layout (#523)", () => {
  it("scopes desktop button row to CSS grid so status cannot stretch Next alone", () => {
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-profile-actions\s*\{[^}]*display:\s*grid/s,
    );
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-friend-slot,\s*\n\s*\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-action-slot--desktop\s*\{[^}]*display:\s*contents/s,
    );
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-btn-next\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*2/s,
    );
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-main-actions--desktop\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*2/s,
    );
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-action-status\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*1/s,
    );
    // Desktop shared geometry stays Style Guide 48; mobile 52 untouched.
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-btn-next\s*\{[^}]*min-height:\s*48px/s,
    );
    expect(css).toMatch(/\.gb-player-browse\s+\.pb-main-actions\s*\{[^}]*min-height:\s*52px/s);
    expect(css).not.toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-profile-actions\s*\{[^}]*align-items:\s*stretch;\s*[^}]*display:\s*flex/s,
    );
  });

  it("Deck reuses DesktopBrowseActionsShell; caption stays outside the button row", () => {
    expect(deckSource).toContain("DesktopBrowseActionsShell");
    expect(deckSource).toContain("primarySlot={friendship}");
    expect(deckSource).toContain('className="pb-btn-next"');
    expect(playSource).toContain("export function DesktopBrowseActionsShell");
    expect(playSource).toContain("export function DesktopBrowseActionsFixture");
    expect(playSource).toContain("export function StableActionFooter");
    const html = renderToStaticMarkup(
      createElement(DesktopBrowseActionsFixture, {
        status: "Предложение отправлено",
        statusTone: "success",
        primaryLabel: "Отменить предложение",
        primaryClassName: "pb-btn-withdraw",
      }),
    );
    expect(html).toContain('data-browse-desktop="true"');
    expect(html).toContain("pb-profile-actions");
    expect(html).toContain("pb-action-status");
    expect(html).toContain("pb-btn-next");
    expect(html).toContain("pb-btn-withdraw");
    expect(html).toContain("Совпадение — когда оба хотите сыграть. Не дружба.");
    expect(html.indexOf("pb-profile-actions")).toBeLessThan(html.indexOf("pb-action-caption"));
    expect(html.indexOf("pb-action-caption")).toBeGreaterThan(html.indexOf("pb-btn-next"));
  });

  it("keeps equal-baseline markup for warn/busy/sent/blocked/guest/hint with primary present", () => {
    for (const state of STATES) {
      const html = renderToStaticMarkup(
        createElement(DesktopBrowseActionsFixture, {
          status: state.status,
          statusTone: state.statusTone,
          primaryLabel: state.primaryLabel,
          primaryClassName: state.primaryClassName,
          showPrimary: state.showPrimary !== false,
        }),
      );
      expect(html).toContain("pb-main-actions--desktop");
      expect(html).toContain("pb-btn-next");
      expect(html).toContain("pb-action-status");
      if (state.showPrimary === false) {
        expect(html).not.toContain(state.primaryClassName);
      } else {
        expect(html).toContain(state.primaryLabel);
        expect(html).toContain(state.primaryClassName);
      }
    }
    const shell = renderToStaticMarkup(
      createElement(DesktopBrowseActionsShell, {
        primarySlot: createElement(StableActionFooter, {
          desktop: true,
          status: "",
          showSkip: false,
          skipDisabled: false,
          onSkip: () => {},
          primary: createElement("button", { type: "button", className: "pb-btn-request" }, "Давай сыграем"),
        }),
        nextControl: createElement("button", { type: "button", className: "pb-btn-next" }, "Следующий"),
      }),
    );
    expect(shell).toContain("pb-friend-slot");
    expect(shell).toContain("pb-btn-request");
  });

  it("writes SSR fixture payload for the CDP browser helper when requested", () => {
    const out = process.env.GB523_BROWSER_FIXTURE;
    if (!out) return;
    const desktopStates = Object.fromEntries(
      STATES.map((state) => [
        state.id,
        renderToStaticMarkup(
          createElement(DesktopBrowseActionsFixture, {
            status: state.status,
            statusTone: state.statusTone,
            primaryLabel: state.primaryLabel,
            primaryClassName: state.primaryClassName,
            showPrimary: state.showPrimary !== false,
          }),
        ),
      ]),
    );
    const mobile = renderToStaticMarkup(
      createElement("div", {
        className: "gb-player-browse",
        "data-browse-desktop": "false",
        "data-surface": "player-browse-actions-mobile",
      }, createElement(StableActionFooter, {
        desktop: false,
        status: "",
        showSkip: true,
        skipDisabled: false,
        onSkip: () => {},
        primary: createElement("button", { type: "button", className: "pb-btn-request" }, "Давай сыграем"),
      })),
    );
    writeFileSync(out, JSON.stringify({ desktopStates, mobileHtml: mobile }, null, 2));
    expect(desktopStates.ready).toContain("Давай сыграем");
    expect(mobile).toContain("Пропустить");
  });
});

describe("mobile Players map CTA reuses GamesViewAction (#526)", () => {
  const pageSource = readFileSync(
    join(root, "../src/components/consumer/pages/PlayersDirectoryPage.tsx"),
    "utf8",
  );
  const zoneAt = pageSource.indexOf("const mobileFinderZone");
  const zone = pageSource.slice(zoneAt, pageSource.indexOf("const catalogFilters", zoneAt));
  it("renders one shared lime-tile action in the finder zone with the same link and name", () => {
    expect(zone).toContain("<GamesViewAction");
    expect(zone).toContain('href="/players/radar"');
    expect(zone).toContain('labelShort="На карте"');
    expect(zone).toContain('aria-label="Игроки на карте"');
    expect(zone).toContain("{activationId ?");
    expect(zone).not.toContain("gb-c23-btn--outline");
  });
  it("keeps the action in flow inside the zone so it cannot overlap Свайп or navigation", () => {
    const rule = css.slice(css.indexOf(".pb-mobile-finder-zone .pb-finder-map-secondary.gb-games-view-action {"));
    expect(rule.slice(0, 200)).toContain("position: static");
    expect(css).toContain(".pb-mobile-finder-zone .gb-map-cta-label--short");
  });
});

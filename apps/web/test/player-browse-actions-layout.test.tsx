import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopBrowseActionsFixture,
  DesktopBrowseActionsShell,
  StableActionFooter,
} from "../src/components/consumer/players/PlayerBrowsePlayInterest";
import { Button } from "../src/components/consumer/Button";
import { GamesViewAction } from "../src/components/consumer/games/GamesViewAction";

vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, props.children),
}));

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

const BOTTOM_NAV = createElement(
  "nav",
  { className: "gb-bottom-nav", "aria-label": "Основная" },
  createElement("a", { href: "/games" }, "Игры"),
  createElement("a", { href: "/players", "aria-current": "page" }, "Игроки"),
  createElement("a", { href: "/venues" }, "Клубы"),
  createElement("a", { href: "/profile" }, "Профиль"),
);

/** Exact #526 Players map props from PlayersDirectoryPage (Radar ON). */
function playersMapAction(className: string) {
  return createElement(GamesViewAction, {
    view: "list",
    href: "/players/radar",
    labelFull: "Игроки на карте",
    labelShort: "На карте",
    className,
    "aria-label": "Игроки на карте",
  });
}

/** Mobile list finder zone: «Свайп» + in-flow GamesViewAction (Radar ON). */
function renderPlayers526MobileFixture() {
  return renderToStaticMarkup(
    createElement(
      "div",
      { className: "gb-app-shell", "data-surface": "players-526-mobile" },
      createElement(
        "div",
        { className: "gb-consumer" },
        createElement(
          "div",
          {
            className: "fr3 players-page gb-player-browse",
            "data-surface": "players-directory",
            "data-browse-view": "list",
            "data-directory-desktop": "false",
          },
          createElement(
            "div",
            {
              className: "pb-mobile-finder-zone",
              "data-radar": "on",
              "data-fixture": "players-526-finder",
            },
            createElement(Button, {
              type: "button",
              variant: "dark",
              className: "pb-finder-cta",
              "aria-label": "Свайп",
              children: createElement("span", { className: "pb-finder-cta__label" }, "Свайп"),
            }),
            createElement(
              "div",
              {
                className: "pb-finder-map-group",
                role: "group",
                "aria-label": "Игроки на карте",
              },
              playersMapAction("pb-finder-map-secondary"),
            ),
          ),
        ),
      ),
      BOTTOM_NAV,
    ),
  );
}

/** Desktop ≥1024 list: floating gb-players-map-cta (Radar ON); bottom nav stays in DOM but CSS-hidden. */
function renderPlayers526DesktopFixture() {
  return renderToStaticMarkup(
    createElement(
      "div",
      { className: "gb-app-shell", "data-surface": "players-526-desktop" },
      createElement(
        "div",
        { className: "gb-consumer" },
        createElement(
          "div",
          {
            className: "fr3 players-page gb-player-browse",
            "data-surface": "players-directory",
            "data-browse-view": "list",
            "data-directory-desktop": "true",
          },
          playersMapAction("gb-players-map-cta"),
        ),
      ),
      BOTTOM_NAV,
    ),
  );
}

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
    const players526 = {
      mobileRadarOnHtml: renderPlayers526MobileFixture(),
      desktopHtml: renderPlayers526DesktopFixture(),
    };
    writeFileSync(out, JSON.stringify({ desktopStates, mobileHtml: mobile, players526 }, null, 2));
    expect(desktopStates.ready).toContain("Давай сыграем");
    expect(mobile).toContain("Пропустить");
    expect(players526.mobileRadarOnHtml).toContain("pb-mobile-finder-zone");
    expect(players526.mobileRadarOnHtml).toContain("pb-finder-map-secondary");
    expect(players526.mobileRadarOnHtml).toContain("На карте");
    // Mobile accessible name is on the finder map group (GamesViewAction href path).
    expect(players526.mobileRadarOnHtml).toContain('role="group"');
    expect(players526.mobileRadarOnHtml).toContain('aria-label="Игроки на карте"');
    expect(players526.mobileRadarOnHtml).toContain('href="/players/radar"');
    expect(players526.mobileRadarOnHtml).toContain("gb-map-entry-tile");
    expect(players526.desktopHtml).toContain("gb-players-map-cta");
    expect(players526.desktopHtml).toContain("Игроки на карте");
    expect(players526.desktopHtml).toContain('href="/players/radar"');
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
  it("SSR-renders the actual #526 finder/map fixture (GamesViewAction + Свайп + nav)", () => {
    const mobile = renderPlayers526MobileFixture();
    expect(mobile).toContain('data-fixture="players-526-finder"');
    expect(mobile).toContain('data-radar="on"');
    expect(mobile).toContain("pb-finder-cta");
    expect(mobile).toContain("Свайп");
    expect(mobile).toContain("pb-finder-map-secondary");
    expect(mobile).toContain("gb-games-view-action");
    expect(mobile).toContain("gb-map-entry-tile");
    expect(mobile).toContain("На карте");
    expect(mobile).toContain("Игроки на карте");
    expect(mobile).toContain('href="/players/radar"');
    expect(mobile).toContain("gb-bottom-nav");
    const desktop = renderPlayers526DesktopFixture();
    expect(desktop).toContain("gb-players-map-cta");
    // Desktop accessible name comes from the full label text on the real GamesViewAction link.
    expect(desktop).toContain('class="gb-map-cta-label gb-map-cta-label--full">Игроки на карте');
    expect(desktop).toContain('href="/players/radar"');
    expect(desktop).toContain("gb-map-entry-tile");
    expect(desktop).not.toContain("pb-mobile-finder-zone");
  });
});

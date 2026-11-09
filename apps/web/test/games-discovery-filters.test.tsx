/** @vitest-environment jsdom */
/** #458 compact discovery filters — mounted React control regressions (not DEV/Owner UAT). */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children),
}));

import { DiscoveryLevelFilters, LevelGuide } from "../src/components/consumer/LevelGuide";
import {
  filterGamesBySelectedNtrpLevel,
  levelGuideSkillFor,
  ntrpHalfstepIds,
} from "../src/lib/level-guide";

beforeAll(() => {
  if (typeof HTMLDialogElement !== "undefined") {
    const proto = HTMLDialogElement.prototype;
    if (typeof proto.showModal !== "function") {
      proto.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      };
    }
    if (typeof proto.close !== "function") {
      proto.close = function close(this: HTMLDialogElement) {
        this.removeAttribute("open");
      };
    }
  }
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function Harness({
  initialLevel = "",
  dayLabel = "Все ближайшие",
  activityLabel = "Все",
}: {
  initialLevel?: string;
  dayLabel?: string;
  activityLabel?: string;
}) {
  const [levelFilter, setLevelFilter] = useState(initialLevel);
  const label = levelFilter ? (levelGuideSkillFor(levelFilter)?.label ?? levelFilter) : "";
  return createElement(
    "div",
    { className: "gb-discovery", "data-surface": "games-discovery" },
    createElement(
      "div",
      { className: "gb-discovery-filters" },
      createElement(
        "div",
        { className: "gb-discovery-chips", role: "group", "aria-label": "Фильтр активности" },
        createElement("button", { type: "button", className: "gb-discovery-chip", "aria-pressed": "true" }, "Все"),
      ),
      createElement(DiscoveryLevelFilters, {
        cityName: "Москва",
        dayLabel,
        activityLabel,
        levelFilter,
        onLevelFilterChange: setLevelFilter,
      }),
    ),
    createElement(
      "header",
      { className: "gb-discovery-feed-heading" },
      createElement("div", null, createElement("h2", null, "Игры в Москве")),
    ),
    levelFilter
      ? createElement(
          "p",
          { className: "gb-discovery-helper", "data-level-filter": "active", role: "status" },
          `Уровень ${label} · только загруженные игры (ntrp v1)`,
        )
      : null,
  );
}

function listed(id: string, allowedLevelIds: string[], scaleId = "ntrp", scaleVersion = 1) {
  return { id, levelRule: { scaleId, scaleVersion, allowedLevelIds } };
}

describe("GamesDiscovery compact filters #458", () => {
  it("default closed: one filters icon, no LevelGuide panel, no feed eyebrow", () => {
    const { container } = render(createElement(Harness));
    const triggers = screen.getAllByRole("button", { name: "Фильтры" });
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.className).toContain("gb-discovery-filters-trigger");
    expect(triggers[0]?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-level-guide]")).toBeNull();
    expect(container.textContent).not.toContain("По времени");
    expect(container.textContent).not.toContain("Выходите на корт");
    expect(container.textContent).not.toContain("Фильтр по моему уровню");
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("keyboard open focuses level select; Escape/X/К списку return focus to trigger", async () => {
    render(createElement(Harness));
    const trigger = screen.getByRole("button", { name: "Фильтры" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe("SELECT");
    });
    expect(within(dialog).getByText("Москва · Все ближайшие · Все")).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Где играем|Когда/i)).toBeNull();

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть фильтры" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "К списку" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("level selection persists across close; reset clears only level context labels stay", async () => {
    render(
      createElement(Harness, {
        dayLabel: "11 ноября",
        activityLabel: "С тренером",
      }),
    );
    const trigger = screen.getByRole("button", { name: "Фильтры" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Уровень для фильтра списка");
    fireEvent.change(select, { target: { value: "3.0" } });
    expect(trigger.getAttribute("data-active")).toBe("true");
    expect(document.querySelector('[data-level-filter="active"]')?.textContent).toContain(
      "Уровень 3,0 · только загруженные игры (ntrp v1)",
    );

    fireEvent.click(screen.getByRole("button", { name: "К списку" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger.getAttribute("data-active")).toBe("true");
    expect(document.querySelector('[data-level-filter="active"]')?.textContent).toContain("3,0");

    fireEvent.click(trigger);
    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByText("Москва · 11 ноября · С тренером")).toBeTruthy();
    const reset = within(reopened).getByRole("button", { name: "Сбросить уровень" });
    expect((reset as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reset);
    expect(trigger.getAttribute("data-active")).toBeNull();
    expect(document.querySelector('[data-level-filter="active"]')).toBeNull();
    expect(within(reopened).getByText("Москва · 11 ноября · С тренером")).toBeTruthy();
    expect(
      (within(reopened).getByRole("button", { name: "Сбросить уровень" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await waitFor(() => expect(document.activeElement?.tagName).toBe("SELECT"));
  });

  it("help exposes 13 ntrp definitions; foreign scale excluded from loaded filter; no profile writes", () => {
    const loaded = [
      listed("a", ["3.0"]),
      listed("b", ["3.0"], "other-scale", 1),
      listed("c", ["2.5"]),
    ];
    const filtered = filterGamesBySelectedNtrpLevel(loaded, "3.0");
    expect(filtered.map((g) => g.id)).toEqual(["a"]);
    expect(ntrpHalfstepIds()).toHaveLength(13);

    const html = renderToStaticMarkup(
      createElement(LevelGuide, {
        surface: "discovery",
        presentation: "compact",
        value: { kind: "ntrp", levelId: "3.0" },
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("Что означают уровни");
    for (const id of ntrpHalfstepIds()) expect(html).toContain(id);
    expect(html).not.toMatch(/fetch\(|localStorage|sessionStorage|Сохранить/i);
  });
});

const fixturePath = process.env.GB458_BROWSER_FIXTURE;
if (fixturePath) {
  const closed = renderToStaticMarkup(createElement(Harness));
  const openMarkup = renderToStaticMarkup(
    createElement(
      "div",
      { className: "gb-discovery", "data-surface": "games-discovery" },
      createElement(
        "div",
        { className: "gb-discovery-filters" },
        createElement("div", { className: "gb-discovery-chips" }, createElement("button", { type: "button", className: "gb-discovery-chip", "aria-pressed": "true" }, "Все")),
        createElement(
          "button",
          {
            type: "button",
            className: "gb-discovery-filters-trigger",
            "aria-label": "Фильтры",
            "aria-haspopup": "dialog",
            "aria-expanded": "true",
            "aria-controls": "gb458-filters",
            "data-active": "true",
          },
          createElement("img", { className: "gb-discovery-icon", src: "/discovery/filter.svg", alt: "", width: 20, height: 20 }),
        ),
      ),
      createElement(
        "header",
        { className: "gb-discovery-feed-heading" },
        createElement("div", null, createElement("h2", null, "Игры в Москве")),
      ),
      createElement(
        "dialog",
        {
          id: "gb458-filters",
          className: "gb-discovery-filters-dialog",
          open: true,
          "aria-labelledby": "gb458-title",
        },
        createElement(
          "header",
          { className: "gb-discovery-filters-dialog__header" },
          createElement(
            "div",
            { className: "gb-discovery-filters-dialog__chrome" },
            createElement("button", { type: "button", className: "gb-close-button", "aria-label": "Закрыть фильтры" }, "×"),
          ),
          createElement("h2", { id: "gb458-title" }, "Фильтры"),
          createElement("p", { className: "gb-discovery-filters-dialog__summary" }, "Москва · Все ближайшие · Все"),
        ),
        createElement(
          "div",
          { className: "gb-discovery-filters-dialog__body" },
          createElement(LevelGuide, {
            surface: "discovery",
            presentation: "compact",
            labelledBy: "gb458-title",
            value: { kind: "ntrp", levelId: "3.0" },
            onChange: () => undefined,
          }),
        ),
        createElement(
          "footer",
          { className: "gb-discovery-filters-dialog__footer" },
          createElement("button", { type: "button", className: "gb-discovery-filters-dialog__reset" }, "Сбросить уровень"),
          createElement("button", { type: "button", className: "gb-c23-btn gb-c23-btn--dark" }, "К списку"),
        ),
      ),
    ),
  );
  writeFileSync(
    fixturePath,
    JSON.stringify({
      closedHtml: closed,
      openHtml: openMarkup,
      halfSteps: ntrpHalfstepIds(),
    }),
  );
}

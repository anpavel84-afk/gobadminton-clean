import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostgameReminders } from "../src/components/consumer/games/PostgameReminders";
import { reminderResultsHref } from "../src/lib/game-reminders";
import type { Me, PostgameReminder } from "../src/lib/consumer-types";

vi.mock("next/link", () => ({
  default: (props: { href: string; children?: unknown }) =>
    createElement("a", { href: props.href }, props.children as never),
}));

vi.mock("../src/lib/game-reminders", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/game-reminders")>(
    "../src/lib/game-reminders",
  );
  return {
    ...actual,
    listPostgameReminders: vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        installed: true,
        writesEnabled: true,
        items: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            gameId: "10000000-0000-4000-8000-000000000010",
            gameTitle: "Вечерний корт",
            endsAt: "2026-11-01T12:00:00.000Z",
            ordinal: 1 as const,
            version: 1,
            state: "visible" as const,
            dueAt: "2026-11-01T13:00:00.000Z",
            visibleAt: "2026-11-01T13:00:00.000Z",
            resultsPath: "/my-games/10000000-0000-4000-8000-000000000010/results",
            allowedActions: { canOpenResults: true, canLater: true },
          },
        ],
      },
    })),
    laterPostgameReminder: vi.fn(),
  };
});

const me: Me = {
  id: "10000000-0000-4000-8000-000000000099",
  displayName: "Organizer",
  locale: "ru",
  linkedProviders: ["vk"],
  csrfToken: "csrf-synthetic",
};

describe("#457 postgame reminders UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders compact notice with Подвести итоги and Позже labels", () => {
    const html = renderToStaticMarkup(createElement(PostgameReminders, { me }));
    // SSR first paint is empty until effect; assert helper + empty fence.
    expect(html).toBe("");
    expect(
      reminderResultsHref({
        gameId: "10000000-0000-4000-8000-000000000010",
        resultsPath: "/my-games/10000000-0000-4000-8000-000000000010/results",
      }),
    ).toBe("/my-games/10000000-0000-4000-8000-000000000010/results");
  });

  it("falls back to results route when resultsPath missing shape", () => {
    const reminder = {
      gameId: "10000000-0000-4000-8000-000000000011",
      resultsPath: "https://evil.example/x",
    } as Pick<PostgameReminder, "gameId" | "resultsPath">;
    expect(reminderResultsHref(reminder)).toBe(
      "/my-games/10000000-0000-4000-8000-000000000011/results",
    );
  });

  it("renders nothing without me (auth fence)", () => {
    const html = renderToStaticMarkup(createElement(PostgameReminders, { me: null }));
    expect(html).toBe("");
  });
});

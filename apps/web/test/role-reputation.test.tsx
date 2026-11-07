import { createElement, isValidElement } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleReputationCardSummary } from "../src/lib/consumer-types";

const api = vi.hoisted(() => ({
  getRoleReputation: vi.fn(),
  getGameRoleReputation: vi.fn(),
  getPlayerRoleReputation: vi.fn(),
}));

vi.mock("../src/lib/api-client", () => api);

vi.mock("../src/components/consumer/games/RoleReviewsDialog", () => ({
  RoleReviewsDialog: (props: { roleHandle: string; role: string }) =>
    createElement("div", {
      "data-testid": "role-reviews-dialog",
      "data-handle": props.roleHandle,
      "data-role": props.role,
    }),
}));

vi.mock("../src/components/consumer/games/RoleReviewComposer", () => ({
  RoleReviewComposer: () => null,
}));

const hooks = vi.hoisted(() => ({
  index: 0,
  slots: [] as { value: unknown; deps?: readonly unknown[] }[],
  effects: [] as (() => unknown)[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  function cell() {
    const index = hooks.index++;
    return hooks.slots[index] ?? (hooks.slots[index] = { value: undefined });
  }
  function changed(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    return (
      !previous ||
      previous.length !== next.length ||
      next.some((value, index) => !Object.is(previous[index], value))
    );
  }
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.index;
      const existed = index in hooks.slots;
      const slot = cell();
      if (!existed) slot.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        slot.value,
        (next: unknown) => {
          slot.value =
            typeof next === "function" ? (next as (previous: unknown) => unknown)(slot.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const slot = cell();
      if (!slot.value) slot.value = { current: initial };
      return slot.value as { current: unknown };
    },
    useEffect(effect: () => unknown, deps: readonly unknown[]) {
      const slot = cell();
      if (changed(slot.deps, deps)) {
        hooks.effects.push(effect);
        slot.deps = deps;
      }
    },
  };
});

import {
  RoleReputationCardActions,
  RoleReputationPanel,
} from "../src/components/consumer/games/RoleReputationPanel";
import { publicRoleReviewModerationNotice } from "../src/lib/games-api";

type Props = Record<string, unknown>;
type Node = { type: unknown; props: Props };

function nodes(value: unknown, out: Node[] = []): Node[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((child) => nodes(child, out));
    return out;
  }
  if (isValidElement<Props>(value)) {
    out.push({ type: value.type, props: value.props });
    nodes(value.props.children, out);
  }
  return out;
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (isValidElement<Props>(value)) return textOf(value.props.children);
  return "";
}

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

function card(partial: Partial<RoleReputationCardSummary> & Pick<RoleReputationCardSummary, "role">): RoleReputationCardSummary {
  return {
    roleHandle: partial.roleHandle ?? "a".repeat(32),
    role: partial.role,
    subjectDisplayName: partial.subjectDisplayName ?? "Игрок",
    heldGamesCount: partial.heldGamesCount ?? null,
    countScope: "confirmed_history",
    historyMayBeIncomplete: true,
    publishedReviewCount: partial.publishedReviewCount ?? 0,
    projectionVersion: partial.projectionVersion ?? "v1",
    availability: partial.availability ?? "available",
  };
}

describe("#394 role reputation consumer UI — behavioral", () => {
  beforeEach(() => {
    hooks.slots = [];
    hooks.index = 0;
    hooks.effects = [];
    api.getRoleReputation.mockReset();
    api.getGameRoleReputation.mockReset();
    api.getPlayerRoleReputation.mockReset();
  });

  it("renders separate role labels, single held count with Russian cases, and review count forms", () => {
    const orgHtml = renderToStaticMarkup(
      createElement(RoleReputationPanel, {
        role: "organization",
        card: card({ role: "organization", heldGamesCount: 2, publishedReviewCount: 1 }),
      }),
    );
    expect(orgHtml).toContain("Как организатор");
    expect(orgHtml).toContain("<strong>2</strong>");
    expect(orgHtml).toContain("проведённые игры по подтверждённой истории");
    expect(orgHtml).not.toMatch(/<strong>2<\/strong>\s*2\s/);
    expect(orgHtml).toContain("1 опубликованный отзыв");

    const five = renderToStaticMarkup(
      createElement(RoleReputationPanel, {
        role: "organization",
        card: card({ role: "organization", heldGamesCount: 5, publishedReviewCount: 5 }),
      }),
    );
    expect(five).toContain("<strong>5</strong>");
    expect(five).toContain("проведённых игр по подтверждённой истории");
    expect(five).toContain("5 опубликованных отзывов");
    expect(five).not.toMatch(/<strong>5<\/strong>\s*5\s/);

    const train = renderToStaticMarkup(
      createElement(RoleReputationPanel, {
        role: "training",
        card: card({ role: "training", heldGamesCount: 2, publishedReviewCount: 2 }),
      }),
    );
    expect(train).toContain("Как тренер");
    expect(train).not.toContain("проведённые игры");
    expect(train).toContain("2 опубликованных отзыва");
  });

  it("shows public unavailable copy without inventing held/review counts", () => {
    const html = renderToStaticMarkup(
      createElement(RoleReputationPanel, {
        role: "organization",
        card: card({
          role: "organization",
          availability: "unavailable",
          heldGamesCount: 9,
          publishedReviewCount: 9,
        }),
      }),
    );
    expect(html).toContain("Публичная история этой роли сейчас недоступна");
    expect(html).not.toContain("<strong>9</strong>");
    expect(html).not.toContain("9 опубликованных");
  });

  it("explains write eligibility in ready and unavailable panels without offering write from unavailable", () => {
    const eligibility =
      "Оставить отзыв можно только о своей прошедшей игре или тренировке с подтверждённым участием и посещением.";
    const unavailable = renderToStaticMarkup(
      createElement(RoleReputationPanel, {
        role: "training",
        card: card({ role: "training", availability: "unavailable" }),
        canWrite: true,
      }),
    );
    expect(unavailable).toContain(eligibility);
    expect(unavailable).not.toContain("Поделиться опытом");
    expect(unavailable).not.toMatch(/вы можете|вам доступн|вам недоступн|не можете оставить/i);

    const ready = renderToStaticMarkup(
      createElement(RoleReputationPanel, {
        role: "organization",
        card: card({ role: "organization", heldGamesCount: 1, publishedReviewCount: 0 }),
        canWrite: false,
      }),
    );
    expect(ready).toContain(eligibility);
    expect(ready).toContain("Пока нет опубликованных отзывов по этой роли.");
    expect(ready).not.toContain("Поделиться опытом");
    expect(ready).not.toMatch(/вы можете|вам доступн|вам недоступн|не можете оставить/i);
  });

  it("card actions bind exact role handle when opening reviews", () => {
    const handle = "b".repeat(32);
    const gameId = "g0000000-0000-4000-8000-000000000001";
    hooks.index = 0;
    const tree = RoleReputationCardActions({
      gameId,
      organization: card({
        role: "organization",
        roleHandle: handle,
        heldGamesCount: 1,
        publishedReviewCount: 1,
      }),
    });
    flushEffects();
    const open = nodes(tree).find(
      (n) => n.type === "button" && textOf(n.props.children).includes("Отзывы об организации"),
    );
    expect(open).toBeTruthy();
    (open!.props.onClick as () => void)();
    hooks.index = 0;
    const again = RoleReputationCardActions({
      gameId,
      organization: card({
        role: "organization",
        roleHandle: handle,
        heldGamesCount: 1,
        publishedReviewCount: 1,
      }),
    });
    // Harness walks elements without mounting children — assert real dialog props, then invoke mock.
    const dialogEl = nodes(again).find(
      (n) =>
        n.props.roleHandle === handle &&
        n.props.role === "organization" &&
        n.props.gameId === gameId &&
        typeof n.props.onClose === "function",
    );
    expect(dialogEl).toBeTruthy();
    expect(dialogEl!.props.roleHandle).toBe(handle);
    expect(dialogEl!.props.role).toBe("organization");
    expect(dialogEl!.props.gameId).toBe(gameId);
    const rendered =
      typeof dialogEl!.type === "function"
        ? (dialogEl!.type as (props: Props) => unknown)(dialogEl!.props)
        : null;
    expect(isValidElement(rendered)).toBe(true);
    if (isValidElement<Props>(rendered)) {
      expect(rendered.props["data-testid"]).toBe("role-reviews-dialog");
      expect(rendered.props["data-handle"]).toBe(handle);
      expect(rendered.props["data-role"]).toBe("organization");
    }
    (dialogEl!.props.onClose as () => void)();
    hooks.index = 0;
    const closed = RoleReputationCardActions({
      gameId,
      organization: card({
        role: "organization",
        roleHandle: handle,
        heldGamesCount: 1,
        publishedReviewCount: 1,
      }),
    });
    const dialogAfterClose = nodes(closed).find(
      (n) =>
        n.props.roleHandle === handle &&
        n.props.role === "organization" &&
        n.props.gameId === gameId &&
        typeof n.props.onClose === "function",
    );
    expect(dialogAfterClose).toBeFalsy();
  });
});

describe("#506 B1b role-review moderation notice", () => {
  it("maps PUBLIC_TEXT_CONTENT_REJECTED fields.text without leaking categories", () => {
    const notice = publicRoleReviewModerationNotice({
      ok: false,
      status: 422,
      error: "rejected",
      problem: {
        type: "about:blank",
        title: "Измените текст и попробуйте снова",
        status: 422,
        code: "PUBLIC_TEXT_CONTENT_REJECTED",
        requestId: "synthetic",
        fields: { text: "Измените текст отзыва" },
      },
    });
    expect(notice).toBe("Измените текст отзыва");
    expect(notice).not.toMatch(/harassment|sexual|score/i);
  });

  it("maps temporary moderation unavailability", () => {
    expect(
      publicRoleReviewModerationNotice({
        ok: false,
        status: 503,
        error: "unavailable",
        problem: {
          type: "about:blank",
          title: "unavailable",
          status: 503,
          code: "MODERATION_TEMPORARILY_UNAVAILABLE",
          requestId: "synthetic",
        },
      }),
    ).toMatch(/временно недоступна/i);
  });
});

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameReview } from "../src/lib/consumer-types";
import {
  parseResultsSection,
  peerReviewHistoryLabel,
  resultsPath,
  reviewAudienceLabel,
  reviewKindLabel,
} from "../src/lib/game-results";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<{ deps: unknown[] | undefined; run: () => void }>,
  cleanups: [] as Array<(() => void) | undefined>,
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof ReactModule>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) {
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [
        hooks.slots[index],
        (value: T | ((previous: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function"
              ? (value as (previous: T) => T)(hooks.slots[index] as T)
              : value;
        },
      ];
    },
    useRef<T>(initial: T) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index] as { current: T };
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = hooks.cursor++;
      const prev = hooks.slots[index] as unknown[] | undefined;
      if (!prev || !deps || deps.some((value, offset) => value !== prev[offset])) {
        hooks.slots[index] = deps;
        hooks.effects.push({
          deps,
          run: () => {
            hooks.cleanups[index]?.();
            hooks.cleanups[index] = effect() || undefined;
          },
        });
      }
    },
  };
});

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href: string; children?: ReactNode; className?: string }) =>
      React.createElement("a", { href: props.href, className: props.className }, props.children),
  };
});

vi.mock("../src/lib/api-client", () => ({
  listMyReviews: vi.fn(),
}));

import { listMyReviews } from "../src/lib/api-client";
import { GameReviewsHistory } from "../src/components/consumer/games/GameReviewsHistory";

const review = (over: Partial<GameReview> = {}): GameReview => ({
  id: "10000000-0000-4000-8000-000000000099",
  gameId: "10000000-0000-4000-8000-000000000001",
  kind: "peer",
  subjectContextId: "10000000-0000-4000-8000-000000000011",
  recipientDisplay: "Илья",
  peerRating: "play_again",
  organizationScore: null,
  comment: "Спасибо за игру",
  tags: [],
  experienceAssertion: "i_experienced_this_game",
  discrepancyExplanation: null,
  attendanceContext: "present",
  outcomeContext: "held",
  version: 2,
  editedAt: "2026-11-01T12:00:00.000Z",
  createdAt: "2026-11-01T10:00:00.000Z",
  direction: "received",
  reply: {
    text: "Взаимно",
    version: 1,
    editedAt: null,
    updatedAt: "2026-11-01T13:00:00.000Z",
  },
  allowedActions: { canEdit: false, canReply: true },
  ...over,
});

function walk(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(walk)];
}

function labelOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labelOf).join("");
  if (isValidElement(node)) return labelOf((node.props as { children?: unknown }).children);
  return "";
}

function textOf(node: ReactNode): string {
  return labelOf(node);
}

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const entry of queued) entry.run();
}

function resetHooks() {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
}

function renderHistory() {
  hooks.cursor = 0;
  return GameReviewsHistory();
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  resetHooks();
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      addEventListener: EventTarget.prototype.addEventListener,
      removeEventListener: EventTarget.prototype.removeEventListener,
      dispatchEvent: EventTarget.prototype.dispatchEvent,
    }),
  );
});

afterEach(() => {
  resetHooks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("PG-4 review history labels and section entry", () => {
  it("uses history rating labels and validates section parse", () => {
    expect(peerReviewHistoryLabel("play_again")).toBe("Сыграл бы снова");
    expect(peerReviewHistoryLabel("neutral")).toBe("Нейтрально");
    expect(peerReviewHistoryLabel("difficulties")).toBe("Были трудности");
    expect(reviewKindLabel("peer")).toBe("Отзыв игроку");
    expect(reviewAudienceLabel("sent")).toBe("Отправленные");
    expect(parseResultsSection("feedback")).toBe("feedback");
    expect(parseResultsSection("evil")).toBe("attendance");
    expect(parseResultsSection(null)).toBe("attendance");
    expect(resultsPath("10000000-0000-4000-8000-000000000001", "feedback")).toContain(
      "section=feedback",
    );
  });

  it("lists received reviews and links to results feedback tab without fake author name", async () => {
    vi.mocked(listMyReviews).mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [review()], nextCursor: null },
    });
    renderHistory();
    flushEffects();
    await settle();
    const tree = renderHistory();
    flushEffects();
    const markup = textOf(tree);
    expect(markup).toContain("Сыграл бы снова");
    expect(markup).toContain("К итогам игры");
    expect(markup).toContain("Спасибо за игру");
    expect(markup).toContain("есть ответ");
    expect(markup).toContain("изменено");
    // recipientDisplay is the viewer for received — do not show it as a peer/author label.
    expect(markup).not.toContain("Илья");
    expect(markup).not.toMatch(/автор|reviewer name|Anonymous|для Илья/i);
    expect(
      walk(tree).some(
        (el) => typeof el.props.href === "string" && String(el.props.href).includes("section=feedback"),
      ),
    ).toBe(true);
    expect(vi.mocked(listMyReviews).mock.calls[0]?.[0]).toMatchObject({
      direction: "received",
      limit: 20,
    });
  });

  it("switches to sent list via segmented control and keeps cursor paging", async () => {
    vi.mocked(listMyReviews)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { items: [review()], nextCursor: null },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          items: [
            review({
              id: "sent-1",
              direction: "sent",
              peerRating: "neutral",
              comment: null,
              reply: null,
              editedAt: null,
            }),
          ],
          nextCursor: "next-sent",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          items: [
            review({
              id: "sent-2",
              direction: "sent",
              peerRating: "difficulties",
              recipientDisplay: "Ольга",
            }),
          ],
          nextCursor: null,
        },
      });
    renderHistory();
    flushEffects();
    await settle();
    let tree = renderHistory();
    flushEffects();
    const sentBtn = walk(tree).find(
      (el) =>
        typeof el.props.onClick === "function" &&
        Children.toArray(el.props.children as ReactNode).join("").includes("Отправленные"),
    );
    expect(sentBtn).toBeTruthy();
    (sentBtn!.props.onClick as () => void)();
    tree = renderHistory();
    flushEffects();
    await settle();
    tree = renderHistory();
    flushEffects();
    expect(textOf(tree)).toContain("Нейтрально");
    const more = walk(tree).find(
      (el) =>
        typeof el.props.onClick === "function" &&
        Children.toArray(el.props.children as ReactNode).join("").includes("Показать ещё"),
    );
    expect(more).toBeTruthy();
    (more!.props.onClick as () => void)();
    tree = renderHistory();
    flushEffects();
    await settle();
    tree = renderHistory();
    flushEffects();
    const markup = textOf(tree);
    expect(markup).toContain("Нейтрально");
    expect(markup).toContain("Были трудности");
    expect(markup).toContain("для Ольга");
    expect(vi.mocked(listMyReviews).mock.calls[2]?.[0]).toMatchObject({
      direction: "sent",
      cursor: "next-sent",
      limit: 20,
    });
  });

  it("clears rows on logout/session-changed and ignores deferred response", async () => {
    let resolvePage: (value: unknown) => void = () => undefined;
    vi.mocked(listMyReviews).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve as (value: unknown) => void;
        }) as never,
    );
    renderHistory();
    flushEffects();
    await settle();
    window.dispatchEvent(new Event("gb-private-expired"));
    await settle();
    resolvePage({
      ok: true,
      status: 200,
      data: { items: [review({ comment: "Утечка актора A" })], nextCursor: null },
    });
    await settle();
    expect(textOf(renderHistory())).not.toContain("Утечка актора A");
  });
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, GameRoleReputationCard, RoleReputationSummary } from "../src/lib/consumer-types";

const api = vi.hoisted(() => ({
  getRoleReputation: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("../src/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getRoleReputation: (...args: unknown[]) => api.getRoleReputation(...args),
    getMe: (...args: unknown[]) => api.getMe(...args),
  };
});

function polyfillDialog() {
  if (typeof HTMLDialogElement === "undefined") return;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
}

const venue = {
  id: "venue-1",
  name: "Demo Arena Izmailovo",
  cityId: "city",
  address: "Измайловский проспект, 1",
  timezone: "Europe/Moscow",
};

const trainerGame: Game = {
  id: "game-trainer-interact",
  version: 1,
  title: "Demo Morozov Coaching Hour",
  status: "published",
  visibility: "public",
  activityKind: "trainer_led",
  trainer: {
    profileId: "trainer-profile-am",
    displayName: "Alexey Morozov (demo trainer)",
    declarationSource: "self_declared",
  },
  trainingDescription: null,
  organizer: { id: "org-user-other", displayName: "Other Organizer", publicContact: "private" },
  venue,
  startsAt: "2030-11-11T16:00:00Z",
  endsAt: "2030-11-11T18:00:00Z",
  timezone: "Europe/Moscow",
  applicationDeadlineAt: "2030-11-11T12:00:00Z",
  capacity: 4,
  confirmedCount: 1,
  externalReservedCount: 0,
  availablePlaces: 3,
  formatKey: "doubles",
  levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["2.5"] },
  settlement: {
    mode: "external",
    purpose: "trainer_fee",
    priceStatus: "by_agreement",
    priceMinor: null,
    currency: null,
    terms: "Оплата тренеру по договорённости",
  },
};

const trainingHandle = "t".repeat(32);
const organizationHandle = "o".repeat(32);

const reputation: GameRoleReputationCard = {
  gameId: trainerGame.id,
  organization: {
    roleHandle: organizationHandle,
    role: "organization",
    subjectDisplayName: "Other Organizer",
    heldGamesCount: 3,
    countScope: "confirmed_history",
    historyMayBeIncomplete: true,
    publishedReviewCount: 2,
    projectionVersion: "1",
    availability: "available",
  },
  training: {
    roleHandle: trainingHandle,
    role: "training",
    subjectDisplayName: "Alexey Morozov (demo trainer)",
    heldGamesCount: 1,
    countScope: "confirmed_history",
    historyMayBeIncomplete: true,
    publishedReviewCount: 1,
    projectionVersion: "1",
    availability: "available",
  },
};

function summaryFor(
  role: "training" | "organization",
  handle: string,
  publishedReviewCount: number,
): RoleReputationSummary {
  return {
    roleHandle: handle,
    role,
    subjectDisplayName: role === "training" ? "Alexey Morozov (demo trainer)" : "Other Organizer",
    heldGamesCount: role === "organization" ? 3 : 1,
    countScope: "confirmed_history",
    historyMayBeIncomplete: true,
    publishedReviewCount,
    projectionVersion: "1",
    availability: "available",
    items: [],
    nextCursor: null,
  };
}

beforeEach(() => {
  polyfillDialog();
  api.getRoleReputation.mockReset();
  api.getMe.mockReset();
  api.getMe.mockResolvedValue({ ok: false, status: 401 });
  api.getRoleReputation.mockImplementation(async (handle: string) => {
    if (handle === trainingHandle) {
      return { ok: true, status: 200, data: summaryFor("training", trainingHandle, 1) };
    }
    if (handle === organizationHandle) {
      return { ok: true, status: 200, data: summaryFor("organization", organizationHandle, 2) };
    }
    return { ok: false, status: 404 };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Full confirmed-history sentence (count form + incomplete caveat) — not a truncated stub. */
const CONFIRMED_HISTORY =
  "Подтверждённая история: 3 проведённые игры. Может быть неполной.";

/**
 * Collapsed disclosure keeps role-details mounted with the HTML `hidden` attribute.
 * Testing Library text queries include that subtree; assert the truthful copy lives in the
 * actual hidden region instead of pretending it is absent from the DOM.
 */
function expectConfirmedHistoryInHiddenRegion() {
  const history = screen.getByText(CONFIRMED_HISTORY);
  expect(history.classList.contains("gb-discovery-card__history")).toBe(true);
  const hiddenRegion = history.closest("[hidden]");
  expect(hiddenRegion).not.toBeNull();
  expect(hiddenRegion?.classList.contains("gb-discovery-card__role-details")).toBe(true);
}

/** Expanded: same full history must be present and outside any [hidden] ancestor. */
function expectConfirmedHistoryVisible() {
  const history = screen.getByText(CONFIRMED_HISTORY);
  expect(history.classList.contains("gb-discovery-card__history")).toBe(true);
  expect(history.closest("[hidden]")).toBeNull();
}

describe("#521 discovery compact role review interactions", () => {
  it("keeps reviews/history collapsed by default with no hidden focus targets", async () => {
    const { DiscoveryGameCard } = await import(
      "../src/components/consumer/discovery/DiscoveryGameCard"
    );
    render(createElement(DiscoveryGameCard, { game: trainerGame, reputation }));

    const disclosure = screen.getByRole("button", {
      name: /Отзывы и история: Demo Morozov Coaching Hour/,
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    // Collapsed a11y tree: no review controls / focus targets (getByRole excludes [hidden]).
    expect(screen.queryByRole("button", { name: /Отзывы о тренировках/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Отзывы об организации/ })).toBeNull();
    // Collapsed: full confirmed-history sentence stays mounted inside the hidden region.
    expectConfirmedHistoryInHiddenRegion();
    expect(screen.getByText("Тренер")).toBeTruthy();
    expect(screen.getByText("Организатор")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Подробнее: Demo Morozov Coaching Hour/ })).toBeTruthy();
  });

  it("expands/collapses via click and keyboard and opens independent role dialogs", async () => {
    const { DiscoveryGameCard } = await import(
      "../src/components/consumer/discovery/DiscoveryGameCard"
    );
    render(createElement(DiscoveryGameCard, { game: trainerGame, reputation }));

    const disclosure = screen.getByRole("button", {
      name: /Отзывы и история: Demo Morozov Coaching Hour/,
    });
    disclosure.focus();
    fireEvent.keyDown(disclosure, { key: "Enter", code: "Enter" });
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    // Truthful compact copy includes held count form + incomplete caveat — visible when expanded.
    expectConfirmedHistoryVisible();

    const trainingButton = screen.getByRole("button", {
      name: "Отзывы о тренировках · 1: Alexey Morozov (demo trainer)",
    });
    expect(trainingButton.textContent).toContain("Отзывы · 1");
    trainingButton.focus();
    expect(document.activeElement).toBe(trainingButton);
    fireEvent.click(trainingButton);

    const dialog = await screen.findByRole("dialog", { name: /Отзывы о тренировках · 1/ });
    expect(dialog).toBeTruthy();
    expect(api.getRoleReputation).toHaveBeenCalledWith(
      trainingHandle,
      expect.objectContaining({ gameId: trainerGame.id }),
    );
    expect(screen.queryByRole("dialog", { name: /Отзывы об организации/ })).toBeNull();

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    // Native cancel is what ProfileDialog listens to.
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trainingButton);
    });

    const orgButton = screen.getByRole("button", {
      name: "Отзывы об организации · 2: Other Organizer",
    });
    orgButton.focus();
    expect(document.activeElement).toBe(orgButton);
    fireEvent.click(orgButton);
    const orgDialog = await screen.findByRole("dialog", { name: /Отзывы об организации · 2/ });
    expect(within(orgDialog).getByRole("heading", { name: /Отзывы об организации · 2/ })).toBeTruthy();
    fireEvent.click(within(orgDialog).getByRole("button", { name: "Закрыть" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Отзывы о тренировках/ })).toBeNull();
    expectConfirmedHistoryInHiddenRegion();
  });

  it("keeps focus valid when collapsing while a review modal is still open", async () => {
    const { DiscoveryGameCard } = await import(
      "../src/components/consumer/discovery/DiscoveryGameCard"
    );
    render(createElement(DiscoveryGameCard, { game: trainerGame, reputation }));

    const disclosure = screen.getByRole("button", {
      name: /Отзывы и история: Demo Morozov Coaching Hour/,
    });
    fireEvent.click(disclosure);
    const trainingButton = screen.getByRole("button", {
      name: "Отзывы о тренировках · 1: Alexey Morozov (demo trainer)",
    });
    // ProfileDialog captures document.activeElement at open; fireEvent.click does not focus.
    trainingButton.focus();
    expect(document.activeElement).toBe(trainingButton);
    fireEvent.click(trainingButton);
    const dialog = await screen.findByRole("dialog", { name: /Отзывы о тренировках · 1/ });
    expect(dialog).toBeTruthy();

    // Collapse request while modal open — region stays mounted for exact trigger focus return.
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Отзывы о тренировках/ })).toBeTruthy();

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // Pending collapse completes after dialog close: review trigger is no longer visible,
    // so focus must land on the disclosure (not a hidden subtree target).
    await waitFor(() => {
      expect(disclosure.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("button", { name: /Отзывы о тренировках/ })).toBeNull();
      expect(document.activeElement).toBe(disclosure);
    });
  });

  it("keeps unavailable review gates non-interactive while preserving role text and details", async () => {
    const unavailable: GameRoleReputationCard = {
      gameId: trainerGame.id,
      organization: { ...reputation.organization!, availability: "unavailable" },
      training: { ...reputation.training!, availability: "unavailable" },
    };
    const { DiscoveryGameCard } = await import(
      "../src/components/consumer/discovery/DiscoveryGameCard"
    );
    render(createElement(DiscoveryGameCard, { game: trainerGame, reputation: unavailable }));

    expect(screen.getByRole("button", { name: /Отзывы и история/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Отзывы и история/ }));
    expect(screen.queryByRole("button", { name: /Отзывы о тренировках/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Отзывы об организации/ })).toBeNull();
    expect(screen.getAllByText("Отзывы сейчас недоступны.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Тренер")).toBeTruthy();
    expect(screen.queryByText("Тренер · самостоятельно указано")).toBeNull();
    expect(screen.getByText("Alexey Morozov (demo trainer)")).toBeTruthy();
    expect(screen.getByText("Организатор")).toBeTruthy();
    expect(screen.getByText("Other Organizer")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Подробнее: Demo Morozov Coaching Hour/ })).toBeTruthy();
    expect(api.getRoleReputation).not.toHaveBeenCalled();
  });
});

import { isValidElement } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotMetricsPanel } from "../src/components/PilotMetrics";
import {
  PILOT_FILTER_LABELS,
  formatRate,
  pilotFilterKey,
  shouldApplyPilotResult,
} from "../src/lib/pilot-metrics";
import { visibleNavigation, type Session } from "../src/lib/admin-client";
import type * as AdminClientModule from "../src/lib/admin-client";

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
    return !previous || previous.length !== next.length || next.some((value, index) => !Object.is(previous[index], value));
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

const transport = vi.hoisted(() => ({
  calls: [] as string[],
  handler: null as null | ((path: string) => unknown | Promise<unknown>),
}));

vi.mock("../src/lib/admin-client", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminClientModule>();
  return {
    ...actual,
    adminRequest: async (pathName: string) => {
      transport.calls.push(pathName);
      if (!transport.handler) throw new Error("missing handler");
      return transport.handler(pathName);
    },
  };
});

type Props = Record<string, unknown>;
type Node = { type: unknown; props: Props };

function nodes(value: unknown, out: Node[] = []): Node[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((child) => nodes(child, out));
    return out;
  }
  if (isValidElement(value)) {
    out.push({ type: value.type, props: value.props as Props });
    nodes((value.props as Props).children, out);
  }
  return out;
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (isValidElement(value)) return textOf((value.props as Props).children);
  return "";
}

const session: Session = {
  principalId: "p1",
  userId: "u1",
  status: "active",
  version: 1,
  roles: ["superadmin"],
  sessionId: "s1",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  stepUpAt: new Date().toISOString(),
  csrfToken: "csrf",
};

describe("pilot metrics filter identity helper", () => {
  it("matches only when generation and filter key stay current on the same mount", () => {
    const keyA = pilotFilterKey({
      cityId: "a0000000-0000-4000-8000-000000000001",
      from: "2026-10-01",
      to: "2026-11-01",
    });
    const keyB = pilotFilterKey({
      cityId: "a0000000-0000-4000-8000-000000000001",
      from: "2026-10-15",
      to: "2026-11-01",
    });
    expect(keyA).not.toBe(keyB);
    expect(
      shouldApplyPilotResult({
        mounted: true,
        requestGeneration: 3,
        currentGeneration: 3,
        requestedKey: keyA,
        currentKey: keyA,
      }),
    ).toBe(true);
    expect(
      shouldApplyPilotResult({
        mounted: true,
        requestGeneration: 3,
        currentGeneration: 4,
        requestedKey: keyA,
        currentKey: keyA,
      }),
    ).toBe(false);
    expect(
      shouldApplyPilotResult({
        mounted: true,
        requestGeneration: 3,
        currentGeneration: 3,
        requestedKey: keyA,
        currentKey: keyB,
      }),
    ).toBe(false);
    expect(
      shouldApplyPilotResult({
        mounted: false,
        requestGeneration: 3,
        currentGeneration: 3,
        requestedKey: keyA,
        currentKey: keyA,
      }),
    ).toBe(false);
  });
});

describe("pilot metrics UI markup", () => {
  beforeEach(() => {
    hooks.index = 0;
    hooks.slots = [];
    hooks.effects = [];
    transport.calls = [];
    transport.handler = async (path) => {
      if (path === "pilot-metrics" || path.startsWith("pilot-metrics?")) {
        return {
          city: { id: "a0000000-0000-4000-8000-000000000001", nameRu: "Москва" },
          window: { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" },
          asOf: "2026-11-04T00:00:00.000Z",
          formulas: { applications: "Заявки: попытки" },
          exclusionPolicy: {
            demoUuidNamespace: "d0f0",
            demoIssuerNamespace: "demo:synthetic:foundation-v001",
            draftExcluded: true,
            cancellationsDisclosedSeparately: true,
            unmarkedManualTestLimitation: "limitation",
          },
          coverage: { sufficient: false, notes: ["мало данных"], participationsWithoutAttemptProof: 0, gamesDueInWindow: 0 },
          games: {
            dueInWindow: 0,
            publishedEligible: 2,
            cancelledDisclosed: 0,
            draftExcluded: 0,
            demoExcluded: 0,
            held: 0,
            notHeld: 0,
            unknownOutcome: 0,
            heldRate: null,
          },
          applications: {
            count: 1,
            confirmations: 0,
            confirmationRate: null,
            currentStatus: { pending: 1, confirmed: 0, withdrawn: 0, rejected: 0, removed: 0, expired: 0 },
            withdrawnAttempts: 0,
            rejectedAttempts: 0,
            removedAttempts: 0,
            expiredAttempts: 0,
          },
          attendance: { present: 0, absent: 0, unknown: 0, eligibleOnHeldGames: 0 },
          repeatAttendance: { usersWithAtLeastOnePresent: 0, usersWithRepeatPresent: 0, rate: null },
          organizers: { withEligiblePublishedGames: 1, withHeldGames: 0, withRepeatEligibleGames: 0 },
          cities: [{ id: "a0000000-0000-4000-8000-000000000001", nameRu: "Москва" }],
        };
      }
      throw new Error(path);
    };
  });

  it("exposes filter labels, empty coverage, formulas and superadmin-only navigation", () => {
    expect(formatRate(null)).toMatch(/н\/д/);
    expect(PILOT_FILTER_LABELS.dueInWindow).toMatch(/ends_at/);
    expect(PILOT_FILTER_LABELS.publishedEligible).toMatch(/starts_at/);
    expect(PILOT_FILTER_LABELS.dueEmpty).toMatch(/завершённых due/);
    expect(PILOT_FILTER_LABELS.dueEmpty).not.toMatch(/подходящих игр/);
    expect(visibleNavigation(["superadmin"]).some((item) => item.id === "pilot")).toBe(true);
    expect(visibleNavigation(["moderator"]).some((item) => item.id === "pilot")).toBe(false);
    const tree = PilotMetricsPanel({
      session,
      busy: false,
      run: async (work) => {
        await work();
      },
      onAuthorityLoss: () => undefined,
    });
    for (const effect of hooks.effects.splice(0)) effect();
    const markup = textOf(tree);
    expect(markup).toContain("Сводка пилота");
    expect(markup).toContain(PILOT_FILTER_LABELS.city);
    expect(markup).toContain(PILOT_FILTER_LABELS.from);
    const all = nodes(tree);
    expect(all.some((node) => node.props["aria-label"] === PILOT_FILTER_LABELS.city)).toBe(true);
  });
});

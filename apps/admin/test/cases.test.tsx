import { isValidElement } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cases } from "../src/components/Cases";
import type { Session } from "../src/lib/admin-client";
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

vi.mock("../src/components/AttendanceDisputes", () => ({ AttendanceDisputes: () => null }));
vi.mock("../src/components/RoleReputationCases", () => ({ RoleReputationCases: () => null }));
vi.mock("../src/components/VenueReviewCases", () => ({ VenueReviewCases: () => null }));
vi.mock("../src/components/VenueCommunityCases", () => ({ VenueCommunityCases: () => null }));

const transport = vi.hoisted(() => ({
  calls: [] as { path: string }[],
  handler: null as null | ((path: string) => unknown | Promise<unknown>),
}));

vi.mock("../src/lib/admin-client", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminClientModule>();
  return {
    ...actual,
    adminRequest: async (pathName: string) => {
      transport.calls.push({ path: pathName });
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

const CASE_A = "a0000000-0000-4000-8000-000000000001";
const CASE_B = "a0000000-0000-4000-8000-000000000002";
const REPORT_A = "b0000000-0000-4000-8000-000000000001";
const PRIVATE_COMMENT = "PRIVATE_PEER_BODY_SHOULD_NOT_LEAK";
/** Actual adminRequest contract: relative path, no leading slash. */
const REVIEW_PATH_A = `cases/${CASE_A}/review-reports/${REPORT_A}`;

const detailA = {
  id: CASE_A,
  status: "in_review" as const,
  version: 3,
  assignedTo: "principal",
  links: [{ id: "link-1", sourceKind: "report" as const, sourceId: REPORT_A, targetKind: "game_review" }],
  history: [],
  nextHistoryBeforeVersion: null,
};

const detailB = {
  ...detailA,
  id: CASE_B,
  version: 1,
  links: [{ id: "link-2", sourceKind: "report" as const, sourceId: "b0000000-0000-4000-8000-000000000099", targetKind: "game_review" }],
};

const reviewPayload = {
  reportId: REPORT_A,
  reviewId: "c0000000-0000-4000-8000-000000000001",
  version: 2,
  peerRating: "neutral",
  comment: PRIVATE_COMMENT,
  tags: ["tone"],
  reasonCode: "peer_complaint",
  recordedAt: "2026-11-01T12:00:00.000Z",
};

const session: Session = {
  principalId: "principal",
  userId: "u1",
  status: "active",
  version: 1,
  roles: ["moderator"],
  sessionId: "s1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  stepUpAt: "2026-11-01T12:00:00.000Z",
  csrfToken: "csrf",
};

// useState order in Cases.tsx
const SLOT = { detail: 4, reviewSource: 16 } as const;

let work: Promise<void> | undefined;
let freshFlag = true;

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

function renderTree() {
  hooks.index = 0;
  return Cases({
    session,
    busy: false,
    fresh: freshFlag,
    run: (fn) => {
      work = fn().catch(() => undefined);
      return work;
    },
    stepup: async () => undefined,
  });
}

function treeText() {
  return textOf(renderTree());
}

function openReviewButton() {
  const button = nodes(renderTree()).find(
    (n) => n.type === "button" && textOf(n.props.children) === "Открыть источник отзыва",
  );
  expect(button).toBeTruthy();
  return button!;
}

describe("Admin Cases private review-source read race", () => {
  beforeEach(() => {
    hooks.slots = [];
    hooks.index = 0;
    hooks.effects = [];
    transport.calls = [];
    transport.handler = null;
    work = undefined;
    freshFlag = true;
    vi.stubGlobal("window", {
      addEventListener() {},
      removeEventListener() {},
    });
  });

  it("does not render private review body from a late success after fresh expiry or case change", async () => {
    renderTree();
    hooks.slots[SLOT.detail]!.value = detailA;
    flushEffects();
    renderTree();
    flushEffects();

    // Positive control: fresh + current case, completed read really shows private body
    // (proves the race assertions are not merely hiding all review views).
    transport.handler = (path) => {
      if (path === REVIEW_PATH_A) return reviewPayload;
      throw new Error(`unexpected path ${path}`);
    };
    (openReviewButton().props.onClick as () => void)();
    expect(transport.calls.some((c) => c.path === REVIEW_PATH_A)).toBe(true);
    await work;
    expect(treeText()).toContain(PRIVATE_COMMENT);

    // Mid-request step-up expiry: effect clears source; late success must not reintroduce body.
    transport.calls = [];
    hooks.slots[SLOT.reviewSource]!.value = null;
    renderTree();
    flushEffects();

    let resolveRead!: (value: typeof reviewPayload) => void;
    const held = new Promise<typeof reviewPayload>((resolve) => {
      resolveRead = resolve;
    });
    transport.handler = (path) => {
      if (path === REVIEW_PATH_A) return held;
      throw new Error(`unexpected path ${path}`);
    };

    (openReviewButton().props.onClick as () => void)();
    expect(transport.calls.some((c) => c.path === REVIEW_PATH_A)).toBe(true);

    freshFlag = false;
    renderTree();
    flushEffects();
    resolveRead(reviewPayload);
    await work;
    expect(treeText()).not.toContain(PRIVATE_COMMENT);
    expect(hooks.slots[SLOT.reviewSource]!.value).toBe(null);

    // Restoring fresh must not resurrect the superseded late response.
    freshFlag = true;
    renderTree();
    flushEffects();
    expect(treeText()).not.toContain(PRIVATE_COMMENT);
    expect(hooks.slots[SLOT.reviewSource]!.value).toBe(null);

    // Second phase: case change while a prior read is still outstanding.
    hooks.slots[SLOT.detail]!.value = detailA;
    hooks.slots[SLOT.reviewSource]!.value = null;
    renderTree();
    flushEffects();

    let resolveStale!: (value: typeof reviewPayload) => void;
    const stale = new Promise<typeof reviewPayload>((resolve) => {
      resolveStale = resolve;
    });
    transport.handler = (path) => {
      if (path === REVIEW_PATH_A) return stale;
      throw new Error(`unexpected path ${path}`);
    };
    (openReviewButton().props.onClick as () => void)();

    hooks.slots[SLOT.detail]!.value = detailB;
    renderTree();
    flushEffects();
    resolveStale(reviewPayload);
    await work;
    expect(treeText()).not.toContain(PRIVATE_COMMENT);
    const stored = hooks.slots[SLOT.reviewSource]!.value as { caseId?: string; comment?: string } | null;
    expect(stored === null || stored.caseId !== CASE_A).toBe(true);
    expect(treeText()).not.toContain(PRIVATE_COMMENT);

    // Restoring prior case + fresh still must not resurrect the superseded CASE_A body.
    hooks.slots[SLOT.detail]!.value = detailA;
    freshFlag = true;
    renderTree();
    flushEffects();
    expect(treeText()).not.toContain(PRIVATE_COMMENT);
  });
});

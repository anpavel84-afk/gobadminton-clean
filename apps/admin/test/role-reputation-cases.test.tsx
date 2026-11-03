import { isValidElement } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleReputationCases } from "../src/components/RoleReputationCases";
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

const transport = vi.hoisted(() => ({
  calls: [] as { path: string; body?: unknown }[],
  handler: null as null | ((path: string, body?: unknown) => unknown | Promise<unknown>),
}));

vi.mock("../src/lib/admin-client", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminClientModule>();
  return {
    ...actual,
    adminRequest: async (pathName: string, body?: unknown) => {
      transport.calls.push({ path: pathName, body });
      if (!transport.handler) throw new Error("missing handler");
      return transport.handler(pathName, body);
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
const REV_A = "c0000000-0000-4000-8000-000000000001";
const PRIVATE = "PRIVATE_ROLE_REVIEW_BODY_SHOULD_NOT_LEAK";
const SOURCE_PATH_A = `cases/${CASE_A}/role-review-source`;

const caseA = {
  id: CASE_A,
  status: "open",
  version: 2,
  assignedTo: "principal",
  roleReputation: {
    pendingKind: "review_submit",
    role: "organization",
    slotStatus: "submitted",
    intakeStatus: "linked",
  },
};

const caseB = {
  ...caseA,
  id: CASE_B,
  version: 1,
  roleReputation: {
    pendingKind: "report",
    role: "organization",
    slotStatus: "published",
    intakeStatus: "linked",
  },
};

const sourcePayload = {
  caseId: CASE_A,
  caseVersion: 2,
  assignedTo: "principal",
  pendingKind: "review_submit",
  slot: {
    id: "s0000000-0000-4000-8000-000000000001",
    reviewHandle: "a".repeat(32),
    role: "organization",
    status: "submitted",
    version: 3,
  },
  reviewRevision: {
    id: REV_A,
    resourceVersion: 1,
    text: PRIVATE,
    topics: ["agreements"],
    projectionHash: "b".repeat(64),
    lifecycle: "pending",
    proofRef: {
      gameId: "g0000000-0000-4000-8000-000000000001",
      role: "organization",
      version: 2,
    },
  },
  replyRevision: null,
};

const session: Session = {
  principalId: "principal",
  userId: "u1",
  status: "active",
  version: 1,
  roles: ["superadmin"],
  sessionId: "s1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  stepUpAt: "2026-11-01T12:00:00.000Z",
  csrfToken: "csrf",
};

// useState order in RoleReputationCases.tsx
const SLOT = {
  caseHint: 4,
  source: 5,
  decision: 7,
  rationale: 8,
  confirmed: 10,
} as const;

let work: Promise<void> | undefined;
let freshFlag = true;

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

function renderTree() {
  hooks.index = 0;
  return RoleReputationCases({
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

function openSourceButton() {
  const button = nodes(renderTree()).find(
    (n) => n.type === "button" && textOf(n.props.children) === "Открыть источник для разбора",
  );
  expect(button).toBeTruthy();
  return button!;
}

describe("Admin RoleReputationCases source privacy + decision binding", () => {
  beforeEach(() => {
    hooks.slots = [];
    hooks.index = 0;
    hooks.effects = [];
    transport.calls = [];
    transport.handler = null;
    work = undefined;
    freshFlag = true;
  });

  it("renders source on explicit read and drops late success after fresh expiry or case change", async () => {
    renderTree();
    hooks.slots[SLOT.caseHint]!.value = caseA;
    flushEffects();
    renderTree();
    flushEffects();

    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return sourcePayload;
      throw new Error(`unexpected path ${path}`);
    };
    (openSourceButton().props.onClick as () => void)();
    expect(transport.calls.some((c) => c.path === SOURCE_PATH_A)).toBe(true);
    await work;
    expect(treeText()).toContain(PRIVATE);
    expect(treeText()).toContain("Записать решение");

    // Mid-request fresh expiry: late success must not reintroduce body.
    transport.calls = [];
    hooks.slots[SLOT.source]!.value = null;
    renderTree();
    flushEffects();

    let resolveRead!: (value: typeof sourcePayload) => void;
    const held = new Promise<typeof sourcePayload>((resolve) => {
      resolveRead = resolve;
    });
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return held;
      throw new Error(`unexpected path ${path}`);
    };
    (openSourceButton().props.onClick as () => void)();
    freshFlag = false;
    renderTree();
    flushEffects();
    resolveRead(sourcePayload);
    await work;
    expect(treeText()).not.toContain(PRIVATE);
    expect(hooks.slots[SLOT.source]!.value).toBe(null);

    freshFlag = true;
    renderTree();
    flushEffects();
    expect(treeText()).not.toContain(PRIVATE);

    // Case change while prior read outstanding.
    hooks.slots[SLOT.caseHint]!.value = caseA;
    hooks.slots[SLOT.source]!.value = null;
    renderTree();
    flushEffects();
    let resolveStale!: (value: typeof sourcePayload) => void;
    const stale = new Promise<typeof sourcePayload>((resolve) => {
      resolveStale = resolve;
    });
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return stale;
      throw new Error(`unexpected path ${path}`);
    };
    (openSourceButton().props.onClick as () => void)();
    hooks.slots[SLOT.caseHint]!.value = caseB;
    renderTree();
    flushEffects();
    resolveStale(sourcePayload);
    await work;
    expect(treeText()).not.toContain(PRIVATE);
    const stored = hooks.slots[SLOT.source]!.value as { boundCaseId?: string } | null;
    expect(stored === null || stored.boundCaseId !== CASE_A).toBe(true);
  });

  it("binds decide command to exact current revision and case version", async () => {
    // Explicit source-read flow: seeding source then flushEffects re-runs caseHint
    // lifecycle and drops protected payload — do not short-circuit that path.
    renderTree();
    hooks.slots[SLOT.caseHint]!.value = caseA;
    flushEffects();
    renderTree();
    flushEffects();

    transport.handler = (path, body) => {
      if (path === SOURCE_PATH_A) return sourcePayload;
      if (path === `cases/${CASE_A}/commands`) {
        expect(body).toMatchObject({
          action: "role_review_decide",
          expectedCaseVersion: 2,
          expectedResourceVersion: 1,
          targetKind: "review",
          exactRevisionId: REV_A,
          decision: "approve",
        });
        return { caseId: CASE_A, caseVersion: 3, decision: "approve", auditId: "audit" };
      }
      if (path === `cases/${CASE_A}`) return { ...caseA, version: 3 };
      throw new Error(`unexpected path ${path}`);
    };

    (openSourceButton().props.onClick as () => void)();
    await work;
    expect(treeText()).toContain(PRIVATE);

    hooks.slots[SLOT.decision]!.value = "approve";
    hooks.slots[SLOT.rationale]!.value = "Публикуем текущую ожидающую редакцию";
    hooks.slots[SLOT.confirmed]!.value = true;

    const decideForm = nodes(renderTree()).find(
      (n) =>
        n.type === "form" &&
        textOf(n.props.children).includes("Решение человека") &&
        typeof n.props.onSubmit === "function",
    );
    expect(decideForm).toBeTruthy();
    (decideForm!.props.onSubmit as (e: { preventDefault(): void }) => void)({
      preventDefault() {},
    });
    await work;
    expect(transport.calls.some((c) => c.path === `cases/${CASE_A}/commands`)).toBe(true);
  });

  it("does not offer source read affordance to pure moderator", () => {
    const modSession = { ...session, roles: ["moderator"] };
    hooks.index = 0;
    const tree = RoleReputationCases({
      session: modSession,
      busy: false,
      fresh: true,
      run: async (fn) => {
        await fn();
      },
      stepup: async () => undefined,
    });
    hooks.slots[SLOT.caseHint]!.value = caseA;
    hooks.index = 0;
    const again = RoleReputationCases({
      session: modSession,
      busy: false,
      fresh: true,
      run: async (fn) => {
        await fn();
      },
      stepup: async () => undefined,
    });
    void tree;
    expect(textOf(again)).toContain("support или superadmin");
    expect(textOf(again)).not.toContain("Открыть источник для разбора");
  });
});

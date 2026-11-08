/**
 * Co-located Cases message-source clearing harness (allowlisted path).
 * Mirrors apps/admin/test/cases.test.tsx review-source race coverage for message reports.
 */
import { isValidElement } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cases } from "./Cases";
import type { Session } from "../lib/admin-client";
import type * as AdminClientModule from "../lib/admin-client";

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

vi.mock("./AttendanceDisputes", () => ({ AttendanceDisputes: () => null }));
vi.mock("./RoleReputationCases", () => ({ RoleReputationCases: () => null }));
vi.mock("./VenueReviewCases", () => ({ VenueReviewCases: () => null }));

const transport = vi.hoisted(() => ({
  calls: [] as { path: string }[],
  handler: null as null | ((path: string) => unknown | Promise<unknown>),
}));

vi.mock("../lib/admin-client", async (importOriginal) => {
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
const PRIVATE_TEXT = "PRIVATE_MESSAGE_BODY_SHOULD_NOT_LEAK";
const MESSAGE_PATH_A = `cases/${CASE_A}/message-reports/${REPORT_A}`;

const detailA = {
  id: CASE_A,
  status: "in_review" as const,
  version: 3,
  assignedTo: "principal",
  links: [{ id: "link-1", sourceKind: "report" as const, sourceId: REPORT_A, targetKind: "message" }],
  history: [],
  nextHistoryBeforeVersion: null,
};

const detailB = {
  ...detailA,
  id: CASE_B,
  version: 1,
  links: [{ id: "link-2", sourceKind: "report" as const, sourceId: "b0000000-0000-4000-8000-000000000099", targetKind: "message" }],
};

const messagePayload = {
  reportId: REPORT_A,
  messageId: "c0000000-0000-4000-8000-000000000001",
  conversationId: "d0000000-0000-4000-8000-000000000001",
  conversationKind: "direct",
  gameId: null,
  seq: "2",
  sourceAvailable: true,
  unavailableReason: null,
  text: PRIVATE_TEXT,
  reasonCode: "harassment",
  recordedAt: "2026-11-08T04:00:00.000Z",
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

// useState order in Cases.tsx: detail=4, reviewSource=16, messageSource=17
const SLOT = { detail: 4, messageSource: 17 } as const;

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

function openMessageButton() {
  const button = nodes(renderTree()).find(
    (n) => n.type === "button" && textOf(n.props.children) === "Открыть источник сообщения",
  );
  expect(button).toBeTruthy();
  return button!;
}

describe("Admin Cases private message-source clearing", () => {
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

  it("clears message body on fresh expiry or case change and shows limited availability honestly", async () => {
    renderTree();
    hooks.slots[SLOT.detail]!.value = detailA;
    flushEffects();
    renderTree();
    flushEffects();

    transport.handler = (path) => {
      if (path === MESSAGE_PATH_A) return messagePayload;
      throw new Error(`unexpected path ${path}`);
    };
    (openMessageButton().props.onClick as () => void)();
    await work;
    expect(treeText()).toContain(PRIVATE_TEXT);

    transport.calls = [];
    hooks.slots[SLOT.messageSource]!.value = null;
    renderTree();
    flushEffects();

    let resolveRead!: (value: typeof messagePayload) => void;
    const held = new Promise<typeof messagePayload>((resolve) => {
      resolveRead = resolve;
    });
    transport.handler = (path) => {
      if (path === MESSAGE_PATH_A) return held;
      throw new Error(`unexpected path ${path}`);
    };
    (openMessageButton().props.onClick as () => void)();
    freshFlag = false;
    renderTree();
    flushEffects();
    resolveRead(messagePayload);
    await work;
    expect(treeText()).not.toContain(PRIVATE_TEXT);
    expect(hooks.slots[SLOT.messageSource]!.value).toBe(null);

    hooks.slots[SLOT.detail]!.value = detailA;
    hooks.slots[SLOT.messageSource]!.value = null;
    freshFlag = true;
    renderTree();
    flushEffects();
    transport.handler = (path) => {
      if (path === MESSAGE_PATH_A) {
        return {
          ...messagePayload,
          sourceAvailable: false,
          unavailableReason: "null_expiry",
          text: null,
        };
      }
      throw new Error(`unexpected path ${path}`);
    };
    (openMessageButton().props.onClick as () => void)();
    await work;
    expect(treeText()).toMatch(/не задан|недоступен/i);
    expect(treeText()).not.toContain(PRIVATE_TEXT);

    hooks.slots[SLOT.detail]!.value = detailB;
    renderTree();
    flushEffects();
    expect(treeText()).not.toContain(PRIVATE_TEXT);
  });
});

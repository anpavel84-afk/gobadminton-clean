import { isValidElement } from "react";
import type * as ReactModule from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceDisputes } from "../src/components/AttendanceDisputes";
import { isDefiniteAdminFailure, AdminError, type Session } from "../src/lib/admin-client";
import type * as AdminClientModule from "../src/lib/admin-client";

const hooks = vi.hoisted(() => ({
  index: 0,
  slots: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.index++;
      if (!(index in hooks.slots)) {
        hooks.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      return [
        hooks.slots[index],
        (next: unknown) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (previous: unknown) => unknown)(hooks.slots[index]) : next;
        },
      ];
    },
  };
});

const transport = vi.hoisted(() => ({
  calls: [] as { path: string; body: unknown; key?: string }[],
  handler: null as null | ((path: string, body: unknown, key?: string) => unknown | Promise<unknown>),
}));

vi.mock("../src/lib/admin-client", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminClientModule>();
  return {
    ...actual,
    adminRequest: async (pathName: string, body?: unknown, _csrf?: string, key?: string) => {
      transport.calls.push({
        path: pathName,
        body: body === undefined ? null : JSON.parse(JSON.stringify(body)),
        key,
      });
      if (!transport.handler) throw new Error("missing handler");
      return transport.handler(pathName, body, key);
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

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const baseDetail = {
  caseId: "case-1",
  caseVersion: 1,
  assignedTo: "principal",
  caseStatus: "open",
  dispute: {
    id: "dispute-1",
    gameId: "game-1",
    contextId: "p1",
    status: "open",
    version: 2,
    challengedVersion: 1,
    explanation: "disputed",
    helpProgress: null,
    subjectDisplay: "Player",
    challengedAssertion: null,
    currentAssertion: { value: "absent", version: 3, late: false, source: "manager_explicit" },
    history: [],
  },
  allowedActions: { canResolve: true },
};

const intakeReceipt = {
  caseId: "case-1",
  disputeId: "dispute-1",
  disputeVersion: 2,
  caseVersion: 1,
  assignedTo: "principal",
};

const session: Session = {
  principalId: "principal",
  userId: "u1",
  status: "active",
  version: 1,
  roles: ["moderator"],
  sessionId: "s1",
  expiresAt: new Date().toISOString(),
  stepUpAt: new Date().toISOString(),
  csrfToken: "csrf",
};

// Slot map matches AttendanceDisputes useState order.
const SLOT = {
  intakeDisputeId: 2,
  intakeVersion: 3,
  detail: 4,
  notice: 9,
  uncertain: 10,
  pending: 11,
} as const;

let work: Promise<void> | undefined;

function renderTree() {
  hooks.index = 0;
  return AttendanceDisputes({
    session,
    busy: false,
    fresh: true,
    run: (fn) => {
      work = fn().catch(() => undefined);
      return work;
    },
    stepup: async () => undefined,
  });
}

async function submitIntake() {
  const forms = nodes(renderTree()).filter((n) => n.type === "form");
  const form = forms[0];
  expect(form).toBeTruthy();
  (form!.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
  await work;
}

async function retryPending() {
  const button = nodes(renderTree()).find(
    (n) => n.type === "button" && n.props.children === "Повторить проверку действия",
  );
  expect(button).toBeTruthy();
  (button!.props.onClick as () => void)();
  await work;
}

function resetSlots(actor = "principal") {
  hooks.slots = [];
  transport.calls = [];
  session.principalId = actor;
  renderTree();
  // Match frozen receipt identity (button length gate is UI-only; submit path is invoked directly).
  hooks.slots[SLOT.intakeDisputeId] = "dispute-1";
  hooks.slots[SLOT.intakeVersion] = "1";
}

describe("Admin AttendanceDisputes PG-2 UI", () => {
  beforeEach(() => {
    hooks.slots = [];
    hooks.index = 0;
    transport.calls = [];
    transport.handler = null;
    session.principalId = "principal";
  });

  it("does not offer resolve when canResolve is false and shows truthful pending help intake", () => {
    session.roles = ["support"];
    const htmlNodes = nodes(renderTree());
    const text = JSON.stringify(htmlNodes.map((n) => n.props.children));
    expect(text).toContain("Уточнение посещения");
    expect(text).toContain("Только назначенное обращение");
    expect(text).not.toContain("Создать обращение по возражению");
    session.roles = ["moderator"];
  });

  it("moderator sees intake without mock checkbox authority for resolution before open", () => {
    const tree = renderTree();
    const text = JSON.stringify(nodes(tree).map((n) => n.props.children));
    expect(text).toContain("Служебный приём возражения");
  });

  it("classifies definite 4xx vs transport/timeout UNKNOWN; recover dispatches pending.kind", () => {
    expect(isDefiniteAdminFailure(new AdminError("CASE_VERSION_CONFLICT", 409))).toBe(true);
    expect(isDefiniteAdminFailure(new AdminError("SERVER_ERROR", 500))).toBe(false);
    expect(isDefiniteAdminFailure(new AdminError("TIMEOUT", 408))).toBe(false);
    expect(isDefiniteAdminFailure(new TypeError("Failed to fetch"))).toBe(false);
    const source = readFileSync(
      path.resolve(__dirname, "../src/components/AttendanceDisputes.tsx"),
      "utf8",
    );
    expect(source).toContain('kind: "intake" | "resolve"');
    expect(source).toContain("async function recover()");
    expect(source).toContain('pendingRef.kind === "intake"');
    expect(source).toContain("validateResolveReceipt");
    expect(source).toContain("validateIntakeReceipt");
    expect(source).not.toContain("void resolve(true)");
    expect(source).toContain("detail.dispute.version < receipt.disputeVersion");
    expect(source).toContain("detail.caseVersion < receipt.caseVersion");
  });

  it("lost intake response → same-key valid receipt → later current versions clears UNKNOWN without third request", async () => {
    resetSlots();
    transport.handler = () => {
      throw new Error("lost intake response");
    };
    await submitIntake();
    expect(hooks.slots[SLOT.uncertain]).toBe(true);
    expect(transport.calls[0]).toBeTruthy();
    const frozen = clone(transport.calls[0]!);
    expect(frozen.body).toMatchObject({
      disputeId: "dispute-1",
      expectedDisputeVersion: 1,
      assignToSelf: true,
    });

    const later = {
      ...clone(baseDetail),
      dispute: { ...clone(baseDetail.dispute), version: 3 },
    };
    // Receipt stays exact historical intake (dispute v2); authorized reread is later v3.
    transport.handler = (p, b) => (b ? intakeReceipt : later);
    await retryPending();

    expect(hooks.slots[SLOT.uncertain]).toBe(false);
    expect(hooks.slots[SLOT.pending]).toBe(null);
    expect(hooks.slots[SLOT.notice]).toBe("Обращение по возражению создано и назначено вам.");
    expect(hooks.slots[SLOT.detail]).toMatchObject({
      caseId: "case-1",
      dispute: { id: "dispute-1", version: 3 },
    });
    const posts = transport.calls.filter((c) => c.body !== null);
    expect(posts).toEqual([frozen, frozen]);
    expect(posts).toHaveLength(2);
  });

  it("intake recovery rejects wrong identity and stale lower versions; keeps frozen pending", async () => {
    const cases: { label: string; read: Record<string, unknown> }[] = [
      {
        label: "wrong case",
        read: { ...clone(baseDetail), caseId: "other-case" },
      },
      {
        label: "wrong dispute",
        read: {
          ...clone(baseDetail),
          dispute: { ...clone(baseDetail.dispute), id: "other-dispute" },
        },
      },
      {
        label: "wrong assignee",
        read: { ...clone(baseDetail), assignedTo: "other" },
      },
      {
        label: "lower dispute version",
        read: {
          ...clone(baseDetail),
          dispute: { ...clone(baseDetail.dispute), version: 1 },
        },
      },
      {
        label: "lower case version",
        read: { ...clone(baseDetail), caseVersion: 0 },
      },
    ];

    for (const sample of cases) {
      resetSlots();
      transport.handler = () => {
        throw new Error("lost");
      };
      await submitIntake();
      expect(transport.calls[0]).toBeTruthy();
      const frozen = clone(transport.calls[0]!);
      transport.handler = (p, b) => (b ? intakeReceipt : sample.read);
      await retryPending();
      expect(hooks.slots[SLOT.uncertain], sample.label).toBe(true);
      expect(hooks.slots[SLOT.pending], sample.label).not.toBe(null);
      expect(hooks.slots[SLOT.notice], sample.label).toBe(
        "Повторное чтение не подтвердило приём. Проверим то же действие.",
      );
      expect(transport.calls.filter((c) => c.body !== null), sample.label).toEqual([frozen, frozen]);
    }
  });

  it("exact same-version authorized reread still confirms intake", async () => {
    resetSlots();
    transport.handler = () => {
      throw new Error("lost");
    };
    await submitIntake();
    expect(transport.calls[0]).toBeTruthy();
    const frozen = clone(transport.calls[0]!);
    transport.handler = (p, b) => (b ? intakeReceipt : clone(baseDetail));
    await retryPending();
    expect(hooks.slots[SLOT.uncertain]).toBe(false);
    expect(hooks.slots[SLOT.pending]).toBe(null);
    expect(transport.calls.filter((c) => c.body !== null)).toEqual([frozen, frozen]);
  });
});

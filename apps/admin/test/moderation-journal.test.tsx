import { isValidElement } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModerationJournal } from "../src/components/ModerationJournal";
import { freshStepUp, visibleNavigation, type Session } from "../src/lib/admin-client";
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

const now = Date.now();
const session: Session = {
  principalId: "p1",
  userId: "u1",
  status: "active",
  version: 1,
  roles: ["superadmin"],
  sessionId: "s1",
  expiresAt: new Date(now + 3600000).toISOString(),
  stepUpAt: new Date(now - 1000).toISOString(),
  csrfToken: "csrf",
};

/** useState order in ModerationJournal.tsx */
const SLOT = {
  page: 0,
  surface: 1,
  decision: 2,
  policy: 3,
  model: 4,
  applied: 5,
} as const;

const pageOne = {
  historyScope: "saved",
  historyNote: "Первая страница",
  items: [
    {
      approvalId: "a1",
      surface: "game_title",
      decision: "allow",
      providerKey: "fake",
      providerModel: "fake",
      policyVersion: "p1",
      localPolicyVersion: "l1",
      checkedAt: "2026-11-01T12:00:00.000Z",
      bindingStatus: "bound" as const,
      bindings: [],
    },
  ],
  nextBeforeCheckedAt: "2026-11-01T11:00:00.000Z",
  nextBeforeId: "cursor-1",
};

const pageTwo = {
  historyScope: "saved",
  historyNote: "Вторая страница",
  items: [
    {
      approvalId: "a2",
      surface: "game_title",
      decision: "review",
      providerKey: "fake",
      providerModel: "fake",
      policyVersion: "p1",
      localPolicyVersion: "l1",
      checkedAt: "2026-11-01T10:00:00.000Z",
      bindingStatus: "unbound_or_legacy" as const,
      bindings: [],
    },
  ],
  nextBeforeCheckedAt: null,
  nextBeforeId: null,
};

const refreshed = {
  historyScope: "saved",
  historyNote: "Новый фильтр",
  items: [
    {
      approvalId: "b1",
      surface: "comment_body",
      decision: "allow",
      providerKey: "fake",
      providerModel: "fake",
      policyVersion: "p1",
      localPolicyVersion: "l1",
      checkedAt: "2026-11-02T12:00:00.000Z",
      bindingStatus: "bound" as const,
      bindings: [],
    },
  ],
  nextBeforeCheckedAt: null,
  nextBeforeId: null,
};

let work: Promise<void> | undefined;

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

function renderTree(busy = false) {
  hooks.index = 0;
  return ModerationJournal({
    session,
    busy,
    now,
    run: (fn) => {
      work = fn().catch(() => undefined);
      return work!;
    },
    stepup: async () => undefined,
    onAuthorityLoss: () => undefined,
  });
}

function button(label: string) {
  const found = nodes(renderTree()).find(
    (n) => n.type === "button" && textOf(n.props.children) === label,
  );
  expect(found).toBeTruthy();
  return found!;
}

describe("ModerationJournal affordances", () => {
  it("clears metadata view semantics when step-up is stale", () => {
    const fresh: Session = {
      principalId: "p",
      userId: "u",
      status: "active",
      version: 1,
      roles: ["superadmin"],
      sessionId: "s",
      expiresAt: new Date(now + 3600000).toISOString(),
      stepUpAt: new Date(now - 1000).toISOString(),
      csrfToken: "csrf",
    };
    const stale = { ...fresh, stepUpAt: new Date(now - 11 * 60 * 1000).toISOString() };
    expect(freshStepUp(fresh, now)).toBe(true);
    expect(freshStepUp(stale, now)).toBe(false);
  });

  it("keeps security nav superadmin-only and never treats metadata as raw Cases source", () => {
    // Navigation affordance only — API enforces audit.security.read + step-up.
    expect(visibleNavigation(["superadmin"]).some((i) => i.id === "security")).toBe(true);
    expect(visibleNavigation(["moderator"]).some((i) => i.id === "security")).toBe(false);
    expect(visibleNavigation(["support"]).some((i) => i.id === "security")).toBe(false);
    expect(visibleNavigation(["pilot_viewer"]).some((i) => i.id === "security")).toBe(false);
    expect(visibleNavigation(["content_manager"]).some((i) => i.id === "security")).toBe(false);
  });
});

describe("ModerationJournal applied-filter load-more scope", () => {
  beforeEach(() => {
    hooks.slots = [];
    hooks.index = 0;
    hooks.effects = [];
    transport.calls = [];
    transport.handler = null;
    work = undefined;
  });

  it("ties More to applied filters and requires refresh after draft change", async () => {
    transport.handler = async (path) => {
      if (path === "audit/moderation?surface=game_title") return pageOne;
      if (
        path ===
        "audit/moderation?surface=game_title&beforeCheckedAt=2026-11-01T11%3A00%3A00.000Z&beforeId=cursor-1"
      ) {
        return pageTwo;
      }
      if (path === "audit/moderation?surface=comment_body") return refreshed;
      throw new Error(path);
    };

    renderTree();
    hooks.slots[SLOT.surface]!.value = "game_title";
    renderTree(); // sync draftRef before initial refresh effect
    flushEffects();
    await work;
    renderTree();
    expect(transport.calls).toEqual(["audit/moderation?surface=game_title"]);
    expect(hooks.slots[SLOT.page]!.value).toEqual(pageOne);
    expect(hooks.slots[SLOT.applied]!.value).toEqual({
      surface: "game_title",
      decision: "",
      policy: "",
      model: "",
    });

    // Edit draft surface without refresh — More must stay disabled (no mixed cursor).
    hooks.slots[SLOT.surface]!.value = "comment_body";
    const moreWhileDirty = button("Ещё");
    expect(moreWhileDirty.props.disabled).toBe(true);
    expect(transport.calls).toEqual(["audit/moderation?surface=game_title"]);
    expect(hooks.slots[SLOT.page]!.value).toEqual(pageOne);

    // Restore draft to applied, then More uses applied filters + old cursor and appends.
    hooks.slots[SLOT.surface]!.value = "game_title";
    const more = button("Ещё");
    expect(more.props.disabled).toBe(false);
    (more.props.onClick as () => void)();
    await work;
    renderTree();
    expect(transport.calls.at(-1)).toBe(
      "audit/moderation?surface=game_title&beforeCheckedAt=2026-11-01T11%3A00%3A00.000Z&beforeId=cursor-1",
    );
    expect(hooks.slots[SLOT.page]!.value).toEqual({
      ...pageTwo,
      items: [...pageOne.items, ...pageTwo.items],
    });

    // Draft new filter + Refresh → first page replace, no cursor, no mixed rows.
    hooks.slots[SLOT.surface]!.value = "comment_body";
    const refresh = button("Обновить");
    (refresh.props.onClick as () => void)();
    await work;
    renderTree();
    expect(transport.calls.at(-1)).toBe("audit/moderation?surface=comment_body");
    expect(hooks.slots[SLOT.page]!.value).toEqual(refreshed);
    expect(hooks.slots[SLOT.applied]!.value).toEqual({
      surface: "comment_body",
      decision: "",
      policy: "",
      model: "",
    });
    expect((hooks.slots[SLOT.page]!.value as typeof refreshed).items.map((i) => i.approvalId)).toEqual([
      "b1",
    ]);
  });
});

import { isValidElement } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModerationJournal } from "../src/components/ModerationJournal";
import { AdminError, freshStepUp, visibleNavigation, type Session } from "../src/lib/admin-client";
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

const emptyStart = {
  historyScope: "saved",
  historyNote: "Старт без фильтра",
  items: [] as const,
  nextBeforeCheckedAt: null,
  nextBeforeId: null,
};

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

const currentScope = {
  historyScope: "saved",
  historyNote: "Текущий principal",
  items: [
    {
      approvalId: "cur1",
      surface: "comment_body",
      decision: "allow",
      providerKey: "fake",
      providerModel: "fake",
      policyVersion: "p1",
      localPolicyVersion: "l1",
      checkedAt: "2026-11-03T12:00:00.000Z",
      bindingStatus: "bound" as const,
      bindings: [],
    },
  ],
  nextBeforeCheckedAt: null,
  nextBeforeId: null,
};

let work: Promise<void> | undefined;
let activeSession: Session = session;

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

function renderTree(busy = false) {
  hooks.index = 0;
  return ModerationJournal({
    session: activeSession,
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

function treeText(busy = false) {
  return textOf(renderTree(busy));
}

function button(label: string, busy = false) {
  const found = nodes(renderTree(busy)).find(
    (n) => n.type === "button" && textOf(n.props.children) === label,
  );
  expect(found).toBeTruthy();
  return found!;
}

function control(label: string, busy = false) {
  const parent = nodes(renderTree(busy)).find(
    (n) =>
      n.type === "label" &&
      nodes(n.props.children).some((child) => child.type === "span" && textOf(child.props.children) === label),
  );
  expect(parent).toBeTruthy();
  const field = nodes(parent!.props.children).find((n) => n.type === "input" || n.type === "select");
  expect(field).toBeTruthy();
  return field!;
}

function change(label: string, value: string) {
  const field = control(label);
  expect(field.props.disabled).toBe(false);
  (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

async function click(label: string) {
  const node = button(label);
  expect(node.props.disabled).toBe(false);
  (node.props.onClick as () => void)();
  await work;
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
    activeSession = session;
  });

  it("ties More to applied filters via mounted input events and replaces rows on refresh", async () => {
    transport.handler = async (path) => {
      if (path === "audit/moderation") return emptyStart;
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
    flushEffects();
    await work;
    renderTree();
    expect(transport.calls).toEqual(["audit/moderation"]);
    expect(treeText()).toContain("Старт без фильтра");
    expect(treeText()).toContain("Сохранённых allow/review записей по фильтру нет.");

    change("Поверхность", "game_title");
    await click("Обновить");
    expect(transport.calls).toEqual([
      "audit/moderation",
      "audit/moderation?surface=game_title",
    ]);
    expect(treeText()).toContain("Первая страница");
    expect(treeText()).toContain("game_title · Разрешено");
    expect(control("Поверхность").props.value).toBe("game_title");

    // Draft surface edit through onChange — More disabled, no mixed cursor request.
    change("Поверхность", "comment_body");
    const moreWhileDirty = button("Ещё");
    expect(moreWhileDirty.props.disabled).toBe(true);
    expect(treeText()).toContain("Фильтры изменены");
    expect(transport.calls).toEqual([
      "audit/moderation",
      "audit/moderation?surface=game_title",
    ]);
    expect(treeText()).toContain("Первая страница");
    expect(treeText()).toContain("game_title · Разрешено");
    expect(control("Поверхность").props.value).toBe("comment_body");

    // Restore draft to applied via onChange — More uses applied filters + old cursor and appends.
    change("Поверхность", "game_title");
    await click("Ещё");
    expect(transport.calls.at(-1)).toBe(
      "audit/moderation?surface=game_title&beforeCheckedAt=2026-11-01T11%3A00%3A00.000Z&beforeId=cursor-1",
    );
    expect(transport.calls).toHaveLength(3);
    expect(treeText()).toContain("Вторая страница");
    expect(treeText()).toContain("game_title · Разрешено");
    expect(treeText()).toContain("game_title · На проверку");

    // Draft new filter + Refresh → first page replace, no cursor, no mixed rows.
    change("Поверхность", "comment_body");
    await click("Обновить");
    expect(transport.calls.at(-1)).toBe("audit/moderation?surface=comment_body");
    expect(transport.calls).toHaveLength(4);
    expect(treeText()).toContain("Новый фильтр");
    expect(treeText()).toContain("comment_body · Разрешено");
    expect(treeText()).not.toContain("game_title · Разрешено");
    expect(treeText()).not.toContain("game_title · На проверку");
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("Вторая страница");
  });

  it("ignores a deferred stale response after principal change and keeps current rows", async () => {
    let resolveOld!: (value: typeof pageOne) => void;
    const deferredOld = new Promise<typeof pageOne>((resolve) => {
      resolveOld = resolve;
    });
    let phase: "boot" | "old" | "current" = "boot";

    transport.handler = async (path) => {
      if (phase === "boot" && path === "audit/moderation") return emptyStart;
      if (phase === "old" && path === "audit/moderation?surface=game_title") return deferredOld;
      if (phase === "current" && path === "audit/moderation?surface=game_title") return currentScope;
      throw new Error(`${phase}:${path}`);
    };

    renderTree();
    flushEffects();
    await work;
    renderTree();
    expect(transport.calls).toEqual(["audit/moderation"]);

    change("Поверхность", "game_title");
    phase = "old";
    const refresh = button("Обновить");
    expect(refresh.props.disabled).toBe(false);
    (refresh.props.onClick as () => void)();
    expect(transport.calls.at(-1)).toBe("audit/moderation?surface=game_title");
    expect(transport.calls).toHaveLength(2);

    // External principal change through props — authorized scope reloads.
    phase = "current";
    activeSession = {
      ...session,
      principalId: "p2",
      sessionId: "s2",
    };
    renderTree();
    flushEffects();
    await work;
    expect(transport.calls).toEqual([
      "audit/moderation",
      "audit/moderation?surface=game_title",
      "audit/moderation?surface=game_title",
    ]);
    expect(treeText()).toContain("Текущий principal");
    expect(treeText()).toContain("comment_body · Разрешено");
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("game_title · Разрешено");

    resolveOld(pageOne);
    await Promise.resolve();
    await Promise.resolve();
    expect(treeText()).toContain("Текущий principal");
    expect(treeText()).toContain("comment_body · Разрешено");
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("game_title · Разрешено");
    expect(transport.calls).toHaveLength(3);

    // Authority loss clears the journal surface; late deferred payload must not resurface after re-step-up.
    activeSession = {
      ...activeSession,
      stepUpAt: new Date(now - 11 * 60 * 1000).toISOString(),
    };
    renderTree();
    flushEffects();
    expect(treeText()).toContain("Нужно подтверждение входа");
    expect(treeText()).not.toContain("Текущий principal");
    expect(treeText()).not.toContain("comment_body · Разрешено");
    expect(treeText()).not.toContain("game_title · Разрешено");

    phase = "boot";
    transport.handler = async (path) => {
      if (path === "audit/moderation?surface=game_title") return emptyStart;
      throw new Error(path);
    };
    activeSession = {
      ...session,
      principalId: "p2",
      sessionId: "s2",
      stepUpAt: new Date(now - 500).toISOString(),
    };
    renderTree();
    flushEffects();
    await work;
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("game_title · Разрешено");
    expect(treeText()).toContain("Старт без фильтра");
  });

  it("keeps expired-step-up deferred rows absent until renewed load resolves current rows", async () => {
    let resolveStale!: (value: typeof pageOne) => void;
    const deferredStale = new Promise<typeof pageOne>((resolve) => {
      resolveStale = resolve;
    });
    let resolveRenewed!: (value: typeof currentScope) => void;
    const deferredRenewed = new Promise<typeof currentScope>((resolve) => {
      resolveRenewed = resolve;
    });
    let resolveDenied!: (reason: unknown) => void;
    const deferredDenied = new Promise<never>((_, reject) => {
      resolveDenied = reject;
    });
    let phase: "boot" | "stale" | "renew" | "deny" = "boot";

    transport.handler = async (path) => {
      if (phase === "boot" && path === "audit/moderation") return emptyStart;
      if (phase === "stale" && path === "audit/moderation?surface=game_title") return deferredStale;
      if (phase === "renew" && path === "audit/moderation?surface=game_title") return deferredRenewed;
      if (phase === "deny" && path === "audit/moderation?surface=game_title") return deferredDenied;
      throw new Error(`${phase}:${path}`);
    };

    renderTree();
    flushEffects();
    await work;
    renderTree();
    expect(transport.calls).toEqual(["audit/moderation"]);

    change("Поверхность", "game_title");
    phase = "stale";
    const refresh = button("Обновить");
    expect(refresh.props.disabled).toBe(false);
    (refresh.props.onClick as () => void)();
    expect(transport.calls.at(-1)).toBe("audit/moderation?surface=game_title");
    expect(transport.calls).toHaveLength(2);

    // Lose fresh step-up through external props before the deferred response settles.
    activeSession = {
      ...session,
      stepUpAt: new Date(now - 11 * 60 * 1000).toISOString(),
    };
    renderTree();
    flushEffects();
    expect(treeText()).toContain("Нужно подтверждение входа");
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("game_title · Разрешено");

    resolveStale(pageOne);
    await Promise.resolve();
    await Promise.resolve();
    expect(treeText()).toContain("Нужно подтверждение входа");
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("game_title · Разрешено");
    expect(transport.calls).toHaveLength(2);

    // Renew step-up; new deferred load must not show stale rows before it resolves.
    phase = "renew";
    activeSession = {
      ...session,
      stepUpAt: new Date(now - 500).toISOString(),
    };
    renderTree();
    flushEffects();
    expect(transport.calls).toEqual([
      "audit/moderation",
      "audit/moderation?surface=game_title",
      "audit/moderation?surface=game_title",
    ]);
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("game_title · Разрешено");
    expect(treeText()).not.toContain("Текущий principal");
    expect(treeText()).toContain("Загружаем метаданные");

    resolveRenewed(currentScope);
    await work;
    expect(treeText()).toContain("Текущий principal");
    expect(treeText()).toContain("comment_body · Разрешено");
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("game_title · Разрешено");

    // Late denial after a newer authorized view must not resurrect or clear into stale rows.
    phase = "deny";
    const denyRefresh = button("Обновить");
    expect(denyRefresh.props.disabled).toBe(false);
    (denyRefresh.props.onClick as () => void)();
    expect(transport.calls.at(-1)).toBe("audit/moderation?surface=game_title");
    expect(transport.calls).toHaveLength(4);
    activeSession = {
      ...session,
      stepUpAt: new Date(now - 11 * 60 * 1000).toISOString(),
    };
    renderTree();
    flushEffects();
    expect(treeText()).toContain("Нужно подтверждение входа");
    resolveDenied(new AdminError("ADMIN_PERMISSION_DENIED", 403));
    await Promise.resolve();
    await Promise.resolve();
    expect(treeText()).toContain("Нужно подтверждение входа");
    expect(treeText()).not.toContain("Первая страница");
    expect(treeText()).not.toContain("game_title · Разрешено");
    expect(treeText()).not.toContain("Текущий principal");
    expect(treeText()).not.toContain("comment_body · Разрешено");
  });
});

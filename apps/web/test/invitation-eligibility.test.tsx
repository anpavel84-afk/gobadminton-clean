import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedGame, Me } from "../src/lib/consumer-types";
import {
  invitationEligibilityBlockReason,
  invitationEligibilityNotice,
  isGameOpenForInvitation,
  nextInvitationEligibilityBoundary,
} from "../src/lib/invitation-continuation";

const now = Date.parse("2026-10-30T12:00:00.000Z");

function clock(partial: Partial<ManagedGame> & Pick<ManagedGame, "id" | "status" | "startsAt" | "applicationDeadlineAt">): ManagedGame {
  return {
    version: 1,
    title: partial.title ?? partial.id,
    visibility: "public",
    activityKind: "regular",
    trainer: null,
    trainingDescription: null,
    organizer: { id: null, displayName: "Host", publicContact: "" },
    venue: { id: "venue", name: "Зал", address: "Адрес", cityId: "city", timezone: "Europe/Moscow" },
    endsAt: partial.startsAt,
    timezone: "Europe/Moscow",
    capacity: 4,
    externalReservedCount: 0,
    confirmedCount: 0,
    availablePlaces: 4,
    formatKey: "doubles",
    levelRule: { scaleId: "t", scaleVersion: 1, allowedLevelIds: [] },
    settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" },
    management: { role: "owner", createdByMe: true },
    ...partial,
  };
}

const catalog = () => [
  clock({ id: "oct17", title: "17 октября", status: "published", startsAt: "2026-10-17T15:00:00.000Z", applicationDeadlineAt: "2026-10-17T14:00:00.000Z" }),
  clock({ id: "oct20", title: "20 октября", status: "published", startsAt: "2026-10-20T15:00:00.000Z", applicationDeadlineAt: "2026-10-20T14:00:00.000Z" }),
  clock({ id: "oct21", title: "21 октября", status: "published", startsAt: "2026-10-21T15:00:00.000Z", applicationDeadlineAt: "2026-10-21T14:00:00.000Z" }),
  clock({ id: "nov01", title: "Будущая", status: "published", startsAt: "2026-11-01T15:00:00.000Z", applicationDeadlineAt: "2026-11-01T14:00:00.000Z" }),
  clock({ id: "draft", title: "Черновик", status: "draft", startsAt: "2026-11-02T15:00:00.000Z", applicationDeadlineAt: "2026-11-02T14:00:00.000Z" }),
];

describe("invitation eligibility instants", () => {
  it("rejects past ongoing published games and keeps strictly future open ones", () => {
    const past = catalog()[0]!;
    const future = catalog()[3]!;
    expect(isGameOpenForInvitation(past, now)).toBe(false);
    expect(invitationEligibilityBlockReason(past, now)).toBe("started");
    expect(isGameOpenForInvitation(future, now)).toBe(true);
    expect(isGameOpenForInvitation({ ...future, startsAt: new Date(now).toISOString() }, now)).toBe(false);
  });

  it("rejects closed registration while start is still future", () => {
    const closed = clock({
      id: "closed",
      status: "published",
      startsAt: "2026-11-01T15:00:00.000Z",
      applicationDeadlineAt: "2026-10-29T12:00:00.000Z",
    });
    expect(isGameOpenForInvitation(closed, now)).toBe(false);
    expect(invitationEligibilityBlockReason(closed, now)).toBe("deadline");
    expect(isGameOpenForInvitation({ ...closed, applicationDeadlineAt: new Date(now).toISOString() }, now)).toBe(true);
  });

  it("rejects unpublished and invalid dates fail closed", () => {
    const draft = catalog()[4]!;
    const bad = clock({
      id: "bad",
      status: "published",
      startsAt: "not-a-date",
      applicationDeadlineAt: "2026-11-01T14:00:00.000Z",
    });
    expect(isGameOpenForInvitation(draft, now)).toBe(false);
    expect(invitationEligibilityBlockReason(draft, now)).toBe("unpublished");
    expect(isGameOpenForInvitation(bad, now)).toBe(false);
    expect(invitationEligibilityBlockReason(bad, now)).toBe("invalid");
  });

  it("schedules the next eligibility boundary from real instants", () => {
    const open = clock({
      id: "open",
      status: "published",
      startsAt: "2026-11-01T15:00:00.000Z",
      applicationDeadlineAt: "2026-10-30T18:00:00.000Z",
    });
    expect(nextInvitationEligibilityBoundary([open], now)).toBe(Date.parse(open.applicationDeadlineAt) + 1);
    expect(nextInvitationEligibilityBoundary([open], Date.parse(open.applicationDeadlineAt) + 1)).toBeNull();
  });

  it("maps fresh stale-game guard reasons to helpful notices without calling invite", () => {
    const stale = clock({
      id: "stale",
      status: "published",
      startsAt: "2026-10-30T11:00:00.000Z",
      applicationDeadlineAt: "2026-10-30T10:00:00.000Z",
    });
    const reason = invitationEligibilityBlockReason(stale, now);
    expect(reason).toBe("started");
    expect(invitationEligibilityNotice(reason!)).toContain("уже началась");
    expect(invitationEligibilityNotice("deadline")).toContain("Запись на игру закрыта");
    expect(invitationEligibilityNotice("unpublished")).toContain("не опубликована");
  });
});

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
const mutation = vi.hoisted(() => ({
  busy: false,
  pending: false,
  notice: "",
  code: "",
  setNotice: vi.fn((value: string) => { mutation.notice = value; }),
  run: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("react", async original => {
  const real = await original<typeof React>();
  return {
    ...real,
    useState(initial: unknown) {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [hooks.slots[i], (value: unknown) => {
        hooks.slots[i] = typeof value === "function" ? (value as (previous: unknown) => unknown)(hooks.slots[i]) : value;
      }];
    },
    useRef(initial: unknown) {
      const i = hooks.cursor++;
      return (hooks.slots[i] ??= { current: initial });
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const i = hooks.cursor++;
      const old = hooks.slots[i] as unknown[] | undefined;
      if (!old || deps.some((d, n) => !Object.is(d, old[n]))) {
        hooks.slots[i] = deps;
        hooks.effects.push(() => {
          hooks.cleanups[i]?.();
          const cleanup = effect();
          if (cleanup) hooks.cleanups[i] = cleanup;
        });
      }
    },
  };
});
vi.mock("../src/lib/api-client", () => ({ getGame: vi.fn(), listMyManagedGames: vi.fn() }));
vi.mock("../src/components/consumer/players/ProfileComposition", () => ({
  ProfileDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ProfileState: ({ title }: { title: string }) => <p>{title}</p>,
}));
vi.mock("../src/components/consumer/messages/MessageComposition", () => ({
  MutationNotice: ({ mutation: value }: { mutation: { notice: string } }) => value.notice ? <p role="status">{value.notice}</p> : null,
}));
vi.mock("../src/components/consumer/Button", () => ({
  Button: ({ children, href, onClick }: { children: React.ReactNode; href?: string; onClick?: () => void }) =>
    href ? <a href={href}>{children}</a> : <button type="button" onClick={onClick}>{children}</button>,
}));
vi.mock("../src/components/consumer/messages/useSocialMutation", () => ({
  useSocialMutation: () => mutation,
}));

import { getGame, listMyManagedGames } from "../src/lib/api-client";
import { InvitationChooser } from "../src/components/consumer/messages/InvitationChooser";

const peer = "10000000-0000-4000-8000-000000000001";
const me = { id: "viewer", csrfToken: "csrf" } as Me;

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown };
function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in (node as object)) return textOf((node as Node).props?.children);
  return "";
}
function elements(node: unknown, out: Node[] = []): Node[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach(child => elements(child, out));
    return out;
  }
  const value = node as Node & { props?: { children?: unknown } };
  out.push(value);
  const children = value.props?.children;
  if (Array.isArray(children)) children.forEach(child => elements(child, out));
  else if (children) elements(children, out);
  return out;
}
function renderTree(props: Partial<React.ComponentProps<typeof InvitationChooser>> = {}) {
  hooks.cursor = 0;
  return InvitationChooser({ me, playerId: peer, onClose: () => {}, onCreated: () => {}, ...props });
}
function renderChooser(props: Partial<React.ComponentProps<typeof InvitationChooser>> = {}) {
  return renderToStaticMarkup(renderTree(props));
}
function effects() { hooks.effects.splice(0).forEach(fn => fn()); }
async function settle(props: Partial<React.ComponentProps<typeof InvitationChooser>> = {}) {
  for (let i = 0; i < 12; i++) {
    renderTree(props);
    effects();
    await Promise.resolve();
  }
  return renderChooser(props);
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
  mutation.busy = false;
  mutation.pending = false;
  mutation.notice = "";
  mutation.setNotice.mockClear();
  mutation.run.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.mocked(listMyManagedGames).mockResolvedValue({ ok: true, status: 200, data: { items: catalog(), nextCursor: null } });
  vi.mocked(getGame).mockImplementation(async id => {
    const found = catalog().find(g => g.id === id);
    return found ? { ok: true, status: 200, data: found } : { ok: false, status: 404, error: "missing" };
  });
});
afterEach(() => {
  hooks.cleanups.forEach(fn => fn());
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("InvitationChooser open-for-invite filtering", () => {
  it("offers only future open published games and keeps create continuation", async () => {
    const html = await settle();
    expect(html).toContain("Будущая");
    expect(html).not.toContain("17 октября");
    expect(html).not.toContain("20 октября");
    expect(html).not.toContain("21 октября");
    expect(html).not.toContain("Черновик");
    expect(html).toContain("/games/create?invitePlayer=" + peer);
  });

  it("keeps an eligible preferred game selected and explains expired preferred games", async () => {
    expect(await settle({ preferredGameId: "nov01" })).toContain("Будущая");
    expect(await settle({ preferredGameId: "nov01" })).not.toContain("+ Создать новую игру");
    const expired = await settle({ preferredGameId: "oct17" });
    expect(expired).toContain("уже началась");
    expect(expired).not.toContain("пока не найдена");
    expect(expired).not.toContain("+ Создать новую игру");
  });

  it("drops an offered game once its open chooser boundary elapses", async () => {
    vi.mocked(listMyManagedGames).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          clock({
            id: "soon",
            title: "Скоро закрытие",
            status: "published",
            startsAt: "2026-11-01T15:00:00.000Z",
            applicationDeadlineAt: "2026-10-30T12:00:05.000Z",
          }),
        ],
        nextCursor: null,
      },
    });
    expect(await settle()).toContain("Скоро закрытие");
    await vi.advanceTimersByTimeAsync(6000);
    const html = await settle();
    expect(html).not.toContain("Скоро закрытие");
    expect(html).toContain("Нет предстоящих игр, открытых для приглашений.");
  });

  it("rechecks a freshly fetched game and rejects before mutation.run", async () => {
    await settle();
    vi.mocked(getGame).mockResolvedValue({
      ok: true,
      status: 200,
      data: clock({
        id: "nov01",
        title: "Будущая",
        status: "published",
        startsAt: "2026-10-30T11:00:00.000Z",
        applicationDeadlineAt: "2026-10-30T10:00:00.000Z",
      }),
    });
    const tree = renderTree();
    const button = elements(tree).find(node => node.type === "button" && textOf(node).includes("Будущая") && typeof node.props?.onClick === "function");
    expect(button).toBeTruthy();
    await (button!.props!.onClick as () => Promise<void>)();
    await Promise.resolve();
    await Promise.resolve();
    expect(mutation.run).not.toHaveBeenCalled();
    expect(mutation.setNotice).toHaveBeenCalledWith(expect.stringContaining("уже началась"));
  });

  it("keeps a far-future open game listed after a clamped timer tick", async () => {
    vi.mocked(listMyManagedGames).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          clock({
            id: "far",
            title: "Через полгода",
            status: "published",
            startsAt: "2027-04-30T15:00:00.000Z",
            applicationDeadlineAt: "2027-04-30T14:00:00.000Z",
          }),
        ],
        nextCursor: null,
      },
    });
    expect(await settle()).toContain("Через полгода");
    await vi.advanceTimersByTimeAsync(2147483647);
    const html = await settle();
    expect(html).toContain("Через полгода");
    expect(html).not.toContain("Загружаем игры");
  });
});

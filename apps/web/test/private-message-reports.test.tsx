import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../src/lib/consumer-types";
import {
  ConversationSafety,
  type ReportableMessage,
} from "../src/components/consumer/messages/ConversationSafety";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
}));

const mutation = vi.hoisted(() => ({
  run: vi.fn(),
  busy: false,
  pending: false,
  pendingPath: null as string | null,
  code: null as string | null,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState<T>(initial: T) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
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
      return hooks.slots[index];
    },
    useEffect(effect: () => void) {
      hooks.effects.push(effect);
    },
    useId() {
      return "test-id";
    },
    useMemo<T>(factory: () => T) {
      return factory();
    },
  };
});

vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => createElement("a", props),
}));

vi.mock("../src/components/consumer/messages/useSocialMutation", () => ({
  useSocialMutation: () => mutation,
}));

vi.mock("../src/components/consumer/messages/MessageComposition", () => ({
  MutationNotice: () => null,
}));

vi.mock("../src/components/consumer/players/ProfileComposition", () => ({
  ProfileDialog: (props: { children: ReactNode; title: string }) =>
    createElement("div", { "data-dialog": props.title }, props.children),
}));
vi.mock("../src/components/players/ProfileComposition", () => ({
  ProfileDialog: (props: { children: ReactNode; title: string }) =>
    createElement("div", { "data-dialog": props.title }, props.children),
}));

vi.mock("../src/components/consumer/Button", () => ({
  Button: (props: Record<string, unknown>) => createElement("button", props),
}));
vi.mock("../src/components/Button", () => ({
  Button: (props: Record<string, unknown>) => createElement("button", props),
}));

type Node = { type: unknown; props: Record<string, unknown> };

function nodes(value: unknown, out: Node[] = []): Node[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((child) => nodes(child, out));
    return out;
  }
  if (isValidElement(value as ReactElement)) {
    const el = value as ReactElement;
    out.push({ type: el.type, props: el.props as Record<string, unknown> });
    nodes((el.props as { children?: unknown }).children, out);
  }
  return out;
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (isValidElement(value as ReactElement)) {
    return textOf((value as ReactElement).props.children);
  }
  return "";
}

const me = { id: "me", csrfToken: "csrf" } as Me;
const peer = "p0000000-0000-4000-8000-000000000001";
const messages: ReportableMessage[] = [
  {
    id: "m0000000-0000-4000-8000-000000000001",
    text: "incoming preview body",
    contentState: "live",
    createdAt: "2026-11-08T04:00:00.000Z",
    authorPublicPlayerId: peer,
  },
  {
    id: "m0000000-0000-4000-8000-000000000002",
    text: "own message",
    contentState: "live",
    createdAt: "2026-11-08T04:01:00.000Z",
    authorPublicPlayerId: "own",
  },
];

// ConversationSafety useState order: open, dialog, reason, detail, reportMode, selectedMessageId, shareConsent, done
const SLOT = {
  dialog: 1,
  reportMode: 4,
  selectedMessageId: 5,
  shareConsent: 6,
} as const;

describe("ConversationSafety exact message report selection/consent", () => {
  beforeEach(() => {
    hooks.slots = [];
    hooks.cursor = 0;
    hooks.effects = [];
    mutation.run.mockReset();
    mutation.busy = false;
    mutation.pending = false;
  });

  function render() {
    hooks.cursor = 0;
    return ConversationSafety({
      playerId: peer,
      me,
      onBlocked: () => undefined,
      messages,
      reportContext: { kind: "direct", conversationId: "c0000000-0000-4000-8000-000000000001" },
    });
  }

  it("requires explicit message selection and consent; never defaults to latest or full thread", () => {
    render();
    hooks.slots[SLOT.dialog] = "report";
    hooks.slots[SLOT.reportMode] = "message";
    hooks.slots[SLOT.selectedMessageId] = "";
    hooks.slots[SLOT.shareConsent] = false;
    const tree = render();
    const copy = textOf(tree);
    expect(copy).toMatch(/На выбранное сообщение/);
    expect(copy).toMatch(/Выберите одно сообщение/);
    expect(copy).not.toMatch(/full thread|весь разговор/i);

    const form = nodes(tree).find((n) => n.type === "form");
    expect(form).toBeTruthy();
    (form!.props.onSubmit as (e: { preventDefault(): void }) => void)({
      preventDefault() {},
    });
    expect(mutation.run).not.toHaveBeenCalled();

    hooks.slots[SLOT.selectedMessageId] = messages[0]!.id;
    hooks.slots[SLOT.shareConsent] = false;
    const previewTree = render();
    expect(textOf(previewTree)).toContain("incoming preview body");
    const form2 = nodes(previewTree).find((n) => n.type === "form");
    (form2!.props.onSubmit as (e: { preventDefault(): void }) => void)({
      preventDefault() {},
    });
    expect(mutation.run).not.toHaveBeenCalled();

    hooks.slots[SLOT.shareConsent] = true;
    const ready = render();
    const form3 = nodes(ready).find((n) => n.type === "form");
    (form3!.props.onSubmit as (e: { preventDefault(): void }) => void)({
      preventDefault() {},
    });
    expect(mutation.run).toHaveBeenCalledWith("/v1/reports", {
      targetKind: "message",
      messageId: messages[0]!.id,
      reasonCode: "harassment",
      detail: null,
      shareMessageWithSupport: true,
      conversationId: "c0000000-0000-4000-8000-000000000001",
    });
    expect(mutation.run.mock.calls[0][1]).not.toHaveProperty("evidenceRefs");
    expect(JSON.stringify(mutation.run.mock.calls[0][1])).not.toContain("own message");
  });
});

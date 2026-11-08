import {
  Children,
  cloneElement,
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
  cleanups: [] as Array<(() => void) | undefined>,
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
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as unknown[] | undefined;
      const nextDeps = deps ?? [];
      if (!previous || nextDeps.some((value, i) => !Object.is(value, previous[i]))) {
        hooks.slots[index] = nextDeps;
        hooks.effects.push(() => {
          hooks.cleanups[index]?.();
          const cleanup = effect();
          hooks.cleanups[index] = typeof cleanup === "function" ? cleanup : undefined;
        });
      }
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
  ProfileDialog: (props: { children?: ReactNode; title: string }) =>
    createElement("div", { "data-dialog": props.title }, props.children),
}));
vi.mock("../src/components/players/ProfileComposition", () => ({
  ProfileDialog: (props: { children?: ReactNode; title: string }) =>
    createElement("div", { "data-dialog": props.title }, props.children),
}));

vi.mock("../src/components/consumer/Button", () => ({
  Button: (props: Record<string, unknown>) => createElement("button", props),
}));
vi.mock("../src/components/Button", () => ({
  Button: (props: Record<string, unknown>) => createElement("button", props),
}));

/** Sync rendered tree only — React 19 ReactNode includes Promise, which async/await would flatten. */
type RenderedTree = Exclude<ReactNode, Promise<unknown>>;

type ChangeEvent = { target: { value: string; checked?: boolean } };
type SubmitEvent = { preventDefault: () => void };

type RenderedProps = {
  children?: ReactNode;
  className?: string;
  value?: string;
  name?: string;
  type?: string;
  checked?: boolean;
  disabled?: boolean;
  "data-dialog"?: string;
  "data-testid"?: string;
  onClick?: () => void;
  onChange?: (e: ChangeEvent) => void;
  onSubmit?: (e: SubmitEvent) => void;
};

type RenderedElement = ReactElement<RenderedProps>;

function isRenderedElement(node: ReactNode): node is RenderedElement {
  return isValidElement<RenderedProps>(node);
}

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

function expand(node: ReactNode): RenderedTree {
  if (node == null || typeof node === "boolean") return node;
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return node;
  }
  if (Array.isArray(node)) return node.map(expand);
  if (!isRenderedElement(node)) return null;
  if (typeof node.type === "function") {
    return expand((node.type as (props: RenderedProps) => ReactNode)(node.props));
  }
  const { children } = node.props;
  if (children == null) return node;
  return cloneElement(
    node,
    undefined,
    Children.map(children, (child) => expand(child)),
  );
}

function walk(node: ReactNode, out: RenderedElement[] = []): RenderedElement[] {
  if (node == null || typeof node === "boolean") return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (!isRenderedElement(node)) return out;
  out.push(node);
  Children.forEach(node.props.children, (child) => walk(child, out));
  return out;
}

function textOf(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (isRenderedElement(value)) return textOf(value.props.children);
  return "";
}

function callChange(props: RenderedProps, value: string, checked?: boolean): void {
  const onChange = props.onChange;
  if (typeof onChange !== "function") {
    throw new Error("expected onChange handler");
  }
  onChange({ target: { value, checked } });
}

function callSubmit(props: RenderedProps): void {
  const onSubmit = props.onSubmit;
  if (typeof onSubmit !== "function") {
    throw new Error("expected onSubmit handler");
  }
  onSubmit({ preventDefault() {} });
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

describe("ConversationSafety exact message report selection/consent", () => {
  beforeEach(() => {
    hooks.slots = [];
    hooks.cursor = 0;
    hooks.effects = [];
    hooks.cleanups = [];
    mutation.run.mockReset();
    mutation.busy = false;
    mutation.pending = false;
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      activeElement: null,
    });
  });

  function renderTree(): RenderedTree {
    hooks.cursor = 0;
    const tree = expand(
      createElement(ConversationSafety, {
        playerId: peer,
        me,
        onBlocked: () => undefined,
        messages,
        reportContext: { kind: "direct", conversationId: "c0000000-0000-4000-8000-000000000001" },
      }),
    );
    flushEffects();
    return tree;
  }

  it("requires explicit message selection and consent; never defaults to latest or full thread", () => {
    let tree = renderTree();
    const reportButton = walk(tree).find(
      (n) => n.type === "button" && textOf(n.props.children) === "Пожаловаться",
    );
    expect(reportButton).toBeTruthy();
    reportButton!.props.onClick?.();

    tree = renderTree();
    const dialog = walk(tree).find((n) => n.props["data-dialog"] === "Пожаловаться");
    expect(dialog).toBeTruthy();
    expect(textOf(dialog)).toMatch(/На выбранное сообщение/);
    expect(textOf(dialog)).toMatch(/На игрока/);
    expect(textOf(dialog)).not.toMatch(/full thread|весь разговор/i);

    const modeRadios = walk(tree).filter(
      (n) => n.type === "input" && n.props.type === "radio" && n.props.name === "report-mode",
    );
    expect(modeRadios).toHaveLength(2);
    const messageMode = modeRadios[1]!;
    expect(messageMode.props.disabled).toBe(false);
    callChange(messageMode.props, "on");

    tree = renderTree();
    expect(textOf(tree)).toMatch(/Выберите одно сообщение/);
    expect(textOf(tree)).not.toMatch(/full thread|весь разговор/i);
    const previewMissing = walk(tree).find((n) => n.props["data-testid"] === "selected-message-preview");
    expect(previewMissing).toBeFalsy();

    const form = walk(tree).find((n) => n.type === "form");
    expect(form).toBeTruthy();
    callSubmit(form!.props);
    expect(mutation.run).not.toHaveBeenCalled();

    const select = walk(tree).find((n) => n.type === "select");
    expect(select).toBeTruthy();
    const options = walk(select!).filter((n) => n.type === "option");
    expect(options.map((n) => n.props.value)).toEqual(["", messages[0]!.id]);
    callChange(select!.props, messages[0]!.id);

    tree = renderTree();
    expect(textOf(tree)).toContain("incoming preview body");
    expect(textOf(tree)).not.toContain("own message");
    const formUnconsented = walk(tree).find((n) => n.type === "form");
    callSubmit(formUnconsented!.props);
    expect(mutation.run).not.toHaveBeenCalled();

    const consent = walk(tree).find(
      (n) => n.type === "input" && n.props.type === "checkbox",
    );
    expect(consent).toBeTruthy();
    callChange(consent!.props, "on", true);

    tree = renderTree();
    const formReady = walk(tree).find((n) => n.type === "form");
    callSubmit(formReady!.props);
    expect(mutation.run).toHaveBeenCalledWith("/v1/reports", {
      targetKind: "message",
      messageId: messages[0]!.id,
      reasonCode: "harassment",
      detail: null,
      shareMessageWithSupport: true,
      conversationId: "c0000000-0000-4000-8000-000000000001",
    });
    const firstCall = mutation.run.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = firstCall![1];
    expect(payload).toBeDefined();
    expect(payload).not.toHaveProperty("evidenceRefs");
    expect(JSON.stringify(payload)).not.toContain("own message");
  });
});

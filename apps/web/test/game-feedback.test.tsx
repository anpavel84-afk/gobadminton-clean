import type * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  stateCursor: 0,
  refs: [] as { current: unknown }[],
  refCursor: 0,
  effects: [] as Array<() => void>,
}));

vi.mock("react", async (original) => {
  const mod = await original<typeof React>();
  return {
    ...mod,
    useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] {
      const index = hooks.stateCursor++;
      if (hooks.states[index] === undefined) {
        hooks.states[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [
        hooks.states[index] as T,
        (value) => {
          hooks.states[index] =
            typeof value === "function" ? (value as (prev: T) => T)(hooks.states[index] as T) : value;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = hooks.refCursor++;
      return (hooks.refs[index] ??= { current: initial });
    },
    useEffect(effect: () => void) {
      hooks.effects.push(effect);
    },
  };
});

import { GameFeedbackPanel } from "../src/components/consumer/games/GameFeedbackPanel";
import {
  recognizeGameResultsAction,
  validateGameResultsPending,
  validateGameResultsSuccess,
} from "../src/components/consumer/games/useGameResultsMutation";
import type { GameFeedbackSlice, GamePersonalNote, GameReview } from "../src/lib/consumer-types";

const gameId = "10000000-0000-4000-8000-000000000001";
const reviewId = "10000000-0000-4000-8000-000000000099";
const contextId = "10000000-0000-4000-8000-000000000011";
const otherContextId = "10000000-0000-4000-8000-000000000012";

function basePeerReview(overrides: Partial<GameReview> = {}): GameReview {
  return {
    id: reviewId,
    gameId,
    kind: "peer",
    subjectContextId: contextId,
    recipientDisplay: "Илья",
    peerRating: "play_again",
    organizationScore: null,
    comment: null,
    tags: [],
    experienceAssertion: "i_experienced_this_game",
    discrepancyExplanation: null,
    attendanceContext: "present",
    outcomeContext: "held",
    version: 1,
    editedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    direction: "sent",
    reply: null,
    allowedActions: { canEdit: true, canReply: false },
    ...overrides,
  };
}

function peerCreatePending(body: Record<string, unknown>) {
  return {
    path: `/v1/games/${gameId}/reviews`,
    method: "POST",
    key: "k1",
    body: {
      kind: "peer",
      experienceAssertion: "i_experienced_this_game",
      subjectContextId: contextId,
      peerRating: "play_again",
      ...body,
    },
  };
}

function walk(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === "function") {
    return walk((node.type as (props: Record<string, unknown>) => ReactNode)(node.props));
  }
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(walk)];
}

function feedbackFixture(overrides: {
  canCreateNote?: boolean;
  notes?: GamePersonalNote[];
} = {}): GameFeedbackSlice {
  return {
    installed: true,
    writesEnabled: true,
    capabilities: {
      installed: true,
      writesEnabled: true,
      canCreatePeer: false,
      canCreateOrganization: false,
      canCreateTraining: false,
      canCreateNote: overrides.canCreateNote ?? false,
      peerSubjects: [],
      organizationRecipientDisplay: null,
      complaintReuse: "existing_player_report",
      remaining: ["typed_review_safety_extension"],
    },
    myNotes: overrides.notes ?? [],
    gameReviews: [],
  };
}

function ownNote(overrides: Partial<GamePersonalNote> = {}): GamePersonalNote {
  return {
    gameId,
    contextId,
    subjectDisplay: "Кирилл",
    text: "Старая заметка",
    version: 2,
    updatedAt: "2026-11-01T00:00:00.000Z",
    allowedActions: { canEdit: true, canDelete: true },
    ...overrides,
  };
}

function renderPanel(args: {
  canCreateNote?: boolean;
  notes?: GamePersonalNote[];
  run?: ReturnType<typeof vi.fn>;
}) {
  const run = args.run ?? vi.fn();
  const props = {
    gameId,
    feedback: feedbackFixture({
      canCreateNote: args.canCreateNote ?? false,
      notes: args.notes ?? [],
    }),
    mutation: { run, busy: false, pending: false } as never,
    busy: false,
    unknownOp: false,
    onLocalNotice: () => {},
    noteSubjects: [{ contextId, displayName: "Кирилл" }],
  };
  let tree: ReactNode = null;
  for (let pass = 0; pass < 3; pass += 1) {
    hooks.stateCursor = 0;
    hooks.refCursor = 0;
    hooks.effects = [];
    tree = GameFeedbackPanel(props);
    const queued = hooks.effects.splice(0);
    if (queued.length === 0) break;
    for (const effect of queued) effect();
  }
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  tree = GameFeedbackPanel(props);
  return { tree, run, nodes: walk(tree) };
}

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  hooks.effects = [];
});

describe("PG-3 feedback client mutation fencing", () => {
  it("recognizes review/note routes without substring fallback", () => {
    expect(recognizeGameResultsAction(`/v1/games/${gameId}/reviews`, "POST")).toEqual({
      kind: "reviewCreate",
      gameId,
    });
    expect(recognizeGameResultsAction(`/v1/reviews/${reviewId}`, "PATCH")).toEqual({
      kind: "reviewPatch",
      reviewId,
    });
    expect(recognizeGameResultsAction(`/v1/reviews/${reviewId}/reply`, "PUT")).toEqual({
      kind: "reviewReply",
      reviewId,
    });
    expect(recognizeGameResultsAction(`/v1/games/${gameId}/notes/${contextId}`, "PUT")).toEqual({
      kind: "notePut",
      gameId,
      contextId,
    });
    expect(recognizeGameResultsAction(`/v1/games/${gameId}/notes/${contextId}`, "DELETE")).toEqual({
      kind: "noteDelete",
      gameId,
      contextId,
    });
    expect(recognizeGameResultsAction(`/v1/games/${gameId}/reviews-extra`, "POST")).toBeNull();
  });

  it("keeps UNKNOWN when success payload is cross-game or malformed", () => {
    const pending = peerCreatePending({});
    expect(validateGameResultsPending(pending, gameId)).toBe(true);
    const review = basePeerReview({ gameId: "10000000-0000-4000-8000-000000000002" });
    expect(validateGameResultsSuccess(review, pending)).toBe(false);
    expect(validateGameResultsSuccess(basePeerReview(), pending)).toBe(true);
  });

  it("reviewCreate: same-body duplicate projection confirms; different body / cross kind-subject stay UNKNOWN", () => {
    const sameBody = peerCreatePending({
      comment: "  ок  ",
      tags: ["teamwork", "communication"],
    });
    const sameProjection = basePeerReview({
      comment: "ок",
      tags: ["teamwork", "communication"],
    });
    expect(validateGameResultsSuccess(sameProjection, sameBody)).toBe(true);

    expect(
      validateGameResultsSuccess(
        basePeerReview({
          comment: "ок",
          tags: ["teamwork", "communication"],
          peerRating: "neutral",
        }),
        sameBody,
      ),
    ).toBe(false);

    expect(
      validateGameResultsSuccess(
        basePeerReview({
          comment: "другое",
          tags: ["teamwork", "communication"],
        }),
        sameBody,
      ),
    ).toBe(false);

    expect(
      validateGameResultsSuccess(
        basePeerReview({
          comment: "ок",
          tags: ["teamwork", "communication"],
          subjectContextId: otherContextId,
        }),
        sameBody,
      ),
    ).toBe(false);

    const crossKindPending = {
      path: `/v1/games/${gameId}/reviews`,
      method: "POST",
      key: "k-org",
      body: {
        kind: "organization",
        experienceAssertion: "i_experienced_this_game",
        organizationScore: 4,
        comment: "зал",
      },
    };
    expect(
      validateGameResultsSuccess(
        basePeerReview({
          kind: "peer",
          organizationScore: null,
          comment: "зал",
          peerRating: "play_again",
        }),
        crossKindPending,
      ),
    ).toBe(false);
    expect(
      validateGameResultsSuccess(
        basePeerReview({
          kind: "organization",
          subjectContextId: null,
          peerRating: null,
          organizationScore: 4,
          comment: "зал",
          tags: [],
        }),
        crossKindPending,
      ),
    ).toBe(true);

    // Preserve exact pending key/body identity — validator does not mint a replacement key.
    expect(sameBody.key).toBe("k1");
    expect(sameBody.body.peerRating).toBe("play_again");
  });

  it("does not re-key note delete UNKNOWN; same key body validates", () => {
    const pending = {
      path: `/v1/games/${gameId}/notes/${contextId}`,
      method: "DELETE",
      key: "del-1",
      body: { expectedVersion: 2 },
    };
    expect(validateGameResultsPending(pending, gameId)).toBe(true);
    expect(
      validateGameResultsSuccess(
        { gameId, contextId, version: 3, deleted: true },
        pending,
      ),
    ).toBe(true);
    expect(
      validateGameResultsSuccess(
        { gameId: "10000000-0000-4000-8000-000000000002", contextId, version: 3, deleted: true },
        pending,
      ),
    ).toBe(false);
  });

  it("panel renders privacy copy and wires real mutation paths, not static demo", () => {
    const panel = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/games/GameFeedbackPanel.tsx"),
      "utf8",
    );
    const css = readFileSync(path.resolve(__dirname, "../src/styles/postgame.css"), "utf8");
    expect(panel).toContain("Без публичного рейтинга");
    expect(panel).toContain("mutation.run");
    expect(panel).toContain(`/v1/games/\${gameId}/reviews`);
    expect(panel).toContain("типизированное расширение Safety");
    expect(panel).not.toContain("demoReview");
    expect(css).toContain(".gb-postgame .profile-field");
    expect(css).toContain("width: 100%");
  });

  it("own note edit stays available without canCreateNote; blocked when note.canEdit is false", () => {
    const first = renderPanel({
      canCreateNote: false,
      notes: [ownNote({ allowedActions: { canEdit: true, canDelete: true } })],
    });
    const notesTab = first.nodes.find(
      (n) => n.type === "button" && n.props.role === "tab" && String(n.props.children) === "Заметки",
    );
    expect(notesTab).toBeTruthy();
    (notesTab!.props.onClick as () => void)();

    const onNotes = renderPanel({
      canCreateNote: false,
      notes: [ownNote({ allowedActions: { canEdit: true, canDelete: true } })],
      run: first.run,
    });
    expect(onNotes.nodes.some((n) => String(n.props.children) === "Изменить")).toBe(true);
    expect(onNotes.nodes.some((n) => String(n.props.children) === "Сохранить заметку")).toBe(false);

    const changeBtn = onNotes.nodes.find((n) => String(n.props.children) === "Изменить");
    expect(changeBtn).toBeTruthy();
    (changeBtn!.props.onClick as () => void)();

    const editing = renderPanel({
      canCreateNote: false,
      notes: [ownNote({ allowedActions: { canEdit: true, canDelete: true } })],
      run: first.run,
    });
    const editArea = editing.nodes.find(
      (n) => n.type === "textarea" && n.props.value === "Старая заметка",
    );
    expect(editArea).toBeTruthy();
    (editArea!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "Обновлённая заметка" },
    });

    const ready = renderPanel({
      canCreateNote: false,
      notes: [ownNote({ allowedActions: { canEdit: true, canDelete: true } })],
      run: first.run,
    });
    const saveReady = ready.nodes.find((n) => String(n.props.children) === "Сохранить изменения");
    expect(saveReady).toBeTruthy();
    (saveReady!.props.onClick as () => void)();
    expect(first.run).toHaveBeenCalledWith(
      `/v1/games/${gameId}/notes/${contextId}`,
      { expectedVersion: 2, text: "Обновлённая заметка" },
      "PUT",
    );

    hooks.states = [];
    hooks.refs = [];
    const blockedRun = vi.fn();
    const blockedStart = renderPanel({
      canCreateNote: false,
      notes: [ownNote({ allowedActions: { canEdit: false, canDelete: true } })],
      run: blockedRun,
    });
    const notesTab2 = blockedStart.nodes.find(
      (n) => n.type === "button" && n.props.role === "tab" && String(n.props.children) === "Заметки",
    );
    (notesTab2!.props.onClick as () => void)();
    const blocked = renderPanel({
      canCreateNote: false,
      notes: [ownNote({ allowedActions: { canEdit: false, canDelete: true } })],
      run: blockedRun,
    });
    expect(blocked.nodes.some((n) => String(n.props.children) === "Изменить")).toBe(false);
    expect(blocked.nodes.some((n) => String(n.props.children) === "Сохранить заметку")).toBe(false);
    expect(blockedRun).not.toHaveBeenCalled();
  });
});

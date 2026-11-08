/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VenueCommunityCases } from "../src/components/VenueCommunityCases";
import { AdminError, type Session } from "../src/lib/admin-client";
import type * as AdminClientModule from "../src/lib/admin-client";

const transport = vi.hoisted(() => ({
  calls: [] as { path: string; body?: unknown; key?: string; csrf?: string }[],
  handler: null as null | ((path: string, body?: unknown, csrf?: string, key?: string) => unknown | Promise<unknown>),
}));

vi.mock("../src/lib/admin-client", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminClientModule>();
  return {
    ...actual,
    adminRequest: async (pathName: string, body?: unknown, csrf?: string, key?: string) => {
      transport.calls.push({ path: pathName, body, key, csrf });
      if (!transport.handler) throw new Error("missing handler");
      return transport.handler(pathName, body, csrf, key);
    },
  };
});

const CASE_A = "a0000000-0000-4000-8000-000000000001";
const CASE_B = "a0000000-0000-4000-8000-000000000002";
const REPORT_A = "b0000000-0000-4000-8000-000000000001";
const VOTE_A = "c0000000-0000-4000-8000-000000000001";
const COMMENT_A = "d0000000-0000-4000-8000-000000000001";
const PRIVATE_DETAIL = "PRIVATE_COMPLAINANT_DETAIL_SHOULD_NOT_LEAK";
const PRIVATE_COMMENT = "PRIVATE_VENUE_COMMENT_BODY_SHOULD_NOT_LEAK";
const PRIVATE_RATIONALE = "PRIVATE_RATIONALE_MUST_CLEAR_ON_CONTEXT_CHANGE";
/** Synthetic-only CSRF pair that collided under the removed 32-bit FNV fingerprint. */
const SYNTHETIC_CSRF_A = "synthetic-only-csrf-pgo5pjfw7db2i1";
const SYNTHETIC_CSRF_B = "synthetic-only-csrf-ffj9vytjhh3qfg";
const CURSOR_A = "eyJjYXNlIjoiYSIsInJlcG9ydCI6ImIiLCJ2ZW51ZSI6ImMiLCJ2b3RlIjoiZCJ9.sig";
const SOURCE_PATH_A = `cases/${CASE_A}/community-reports/${REPORT_A}`;
const SOURCE_PATH_B = `cases/${CASE_B}/community-reports/${REPORT_A}`;

const aggregatePayload = {
  caseId: CASE_A,
  reportId: REPORT_A,
  subjectKind: "aggregate" as const,
  canonicalVenueId: "e0000000-0000-4000-8000-000000000001",
  reasonCode: "spam",
  reportState: "open",
  detail: PRIVATE_DETAIL,
  sourceAvailable: true,
  unavailableReason: null,
  summary: {
    venueId: "e0000000-0000-4000-8000-000000000001",
    canonicalVenueId: "e0000000-0000-4000-8000-000000000001",
    average: 4.2,
    count: 5,
    state: "available" as const,
  },
  votes: {
    items: [
      {
        voteId: VOTE_A,
        value: 2,
        version: 3,
        moderationState: "clear" as const,
        withdrawn: false,
        eligibleForPublicCount: true,
      },
    ],
    nextCursor: CURSOR_A,
    limit: 25,
  },
  decisionCapability: {
    action: "venue_community_decide" as const,
    decisions: ["retain", "withhold", "restore"] as Array<"retain" | "withhold" | "restore">,
    resourceKind: "vote" as const,
    requiresExactVoteId: true,
    expectedCaseVersion: 2,
    expectedResourceVersion: null,
  },
};

const ownVotePayload = {
  caseId: CASE_A,
  reportId: REPORT_A,
  subjectKind: "own_vote" as const,
  canonicalVenueId: "e0000000-0000-4000-8000-000000000001",
  reasonCode: "harassment",
  reportState: "open",
  detail: PRIVATE_DETAIL,
  sourceAvailable: true,
  unavailableReason: null,
  voteId: VOTE_A,
  reportedVersion: 2,
  currentVersion: 3,
  reportedValue: 1,
  reportedModerationState: "clear" as const,
  reportedWithdrawn: false,
  currentValue: 1,
  currentModerationState: "clear" as const,
  currentWithdrawn: false,
  mergedIntoVoteId: null,
  decisionCapability: {
    action: "venue_community_decide" as const,
    decisions: ["retain", "withhold"] as Array<"retain" | "withhold" | "restore">,
    resourceKind: "vote" as const,
    voteId: VOTE_A,
    expectedCaseVersion: 2,
    expectedResourceVersion: 3,
  },
};

const commentPayload = {
  caseId: CASE_A,
  reportId: REPORT_A,
  subjectKind: "venue_comment" as const,
  canonicalVenueId: "e0000000-0000-4000-8000-000000000001",
  reasonCode: "inappropriate",
  reportState: "open",
  detail: PRIVATE_DETAIL,
  sourceAvailable: true,
  unavailableReason: null,
  commentId: COMMENT_A,
  reportedVersion: 1,
  currentVersion: 2,
  text: PRIVATE_COMMENT,
  currentPublication: "edited" as const,
  decisionCapability: {
    action: "venue_community_decide" as const,
    decisions: ["retain", "withhold"] as Array<"retain" | "withhold" | "restore">,
    resourceKind: "comment" as const,
    commentId: COMMENT_A,
    expectedCaseVersion: 2,
    expectedResourceVersion: 2,
  },
};

const withheldTombstone = {
  ...commentPayload,
  text: null,
  sourceAvailable: false,
  unavailableReason: "empty_body",
  currentPublication: "deleted" as const,
  decisionCapability: null,
};

const baseSession: Session = {
  principalId: "principal",
  userId: "u1",
  status: "active",
  version: 1,
  roles: ["superadmin"],
  sessionId: "s1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  stepUpAt: "2026-11-01T12:00:00.000Z",
  csrfToken: "csrf-token-alpha",
};

type PanelProps = {
  session: Session;
  busy: boolean;
  fresh: boolean;
  caseId: string;
  caseStatus: string;
  caseVersion: number;
  assignedTo: string | null;
  reportId: string;
};

function makeProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    session: baseSession,
    busy: false,
    fresh: true,
    caseId: CASE_A,
    caseStatus: "in_review",
    caseVersion: 2,
    assignedTo: "principal",
    reportId: REPORT_A,
    ...overrides,
  };
}

function renderPanel(props: PanelProps, mutated: string[] = []) {
  const run = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      /* surface via UI notices */
    }
  };
  const view = render(
    <VenueCommunityCases
      {...props}
      run={run}
      stepup={async () => undefined}
      onCaseMutated={async (id) => {
        mutated.push(id);
      }}
    />,
  );
  return {
    ...view,
    rerenderProps(next: PanelProps) {
      view.rerender(
        <VenueCommunityCases
          {...next}
          run={run}
          stepup={async () => undefined}
          onCaseMutated={async (id) => {
            mutated.push(id);
          }}
        />,
      );
    },
  };
}

async function openSource() {
  fireEvent.click(screen.getByRole("button", { name: "Открыть источник сообщества" }));
  await waitFor(() => {
    expect(screen.getByText(PRIVATE_DETAIL)).toBeTruthy();
  });
}

async function fillCommentDecision() {
  fireEvent.change(screen.getByLabelText("Решение по сообществу площадки"), {
    target: { value: "withhold" },
  });
  fireEvent.change(screen.getByLabelText("Обоснование"), {
    target: { value: PRIVATE_RATIONALE },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("Admin VenueCommunityCases mounted DOM — full authorized context", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    transport.calls = [];
    transport.handler = null;
  });

  it("loads aggregate/own_vote/comment source with public counts and exact command payload", async () => {
    const mutated: string[] = [];
    const props = makeProps();
    const { rerenderProps } = renderPanel(props, mutated);

    transport.handler = (path, body) => {
      if (path === SOURCE_PATH_A) return aggregatePayload;
      if (path === `cases/${CASE_A}/commands`) {
        expect(body).toEqual({
          action: "venue_community_decide",
          expectedCaseVersion: 2,
          expectedResourceVersion: 3,
          reportId: REPORT_A,
          resourceKind: "vote",
          voteId: VOTE_A,
          decision: "withhold",
          rationale: "Снимаем оценку по согласованной жалобе",
          reasonCode: "venue_community",
        });
        return { caseId: CASE_A, caseVersion: 3, decision: "withhold", auditId: "audit-1", decisionId: "decision-1" };
      }
      throw new Error(`unexpected path ${path}`);
    };

    await openSource();
    expect(screen.getByText("4.2")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText(/в публичном счёте/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Точная оценка из загруженной страницы"), {
      target: { value: VOTE_A },
    });
    fireEvent.change(screen.getByLabelText("Решение по сообществу площадки"), {
      target: { value: "withhold" },
    });
    fireEvent.change(screen.getByLabelText("Обоснование"), {
      target: { value: "Снимаем оценку по согласованной жалобе" },
    });
    fireEvent.click(screen.getByRole("checkbox"));

    transport.handler = (path, body) => {
      if (path === SOURCE_PATH_A) {
        return {
          ...aggregatePayload,
          decisionCapability: { ...aggregatePayload.decisionCapability, expectedCaseVersion: 3 },
        };
      }
      if (path === `cases/${CASE_A}/commands`) {
        expect(body).toMatchObject({
          action: "venue_community_decide",
          voteId: VOTE_A,
          decision: "withhold",
          expectedResourceVersion: 3,
        });
        return { caseId: CASE_A, caseVersion: 3, decision: "withhold", auditId: "audit-1", decisionId: "decision-1" };
      }
      throw new Error(`unexpected path ${path}`);
    };

    fireEvent.click(screen.getByRole("button", { name: "Записать решение" }));
    await waitFor(() => {
      expect(screen.getByText(/Решение «Снять с публичной видимости» записано/)).toBeTruthy();
    });
    expect(mutated).toContain(CASE_A);
    expect(transport.calls.some((c) => c.path === `cases/${CASE_A}/commands` && c.key)).toBe(true);

    transport.calls = [];
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return ownVotePayload;
      throw new Error(`unexpected ${path}`);
    };
    rerenderProps(makeProps({ caseVersion: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть источник сообщества" }));
    await waitFor(() => expect(screen.getByText("Заявленная оценка")).toBeTruthy());

    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(`unexpected ${path}`);
    };
    fireEvent.click(screen.getByRole("button", { name: "Обновить источник" }));
    await waitFor(() => expect(screen.getByText(PRIVATE_COMMENT)).toBeTruthy());
    expect(screen.getByText("Текст изменён автором после жалобы")).toBeTruthy();
  });

  async function expectPrivateClearedOnFirstRender(
    rerenderProps: (next: PanelProps) => void,
    next: PanelProps,
  ) {
    await openSource();
    await fillCommentDecision();
    expect(screen.getByDisplayValue(PRIVATE_RATIONALE)).toBeTruthy();
    expect(screen.getByText(PRIVATE_COMMENT)).toBeTruthy();
    rerenderProps(next);
    expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();
    expect(screen.queryByText(PRIVATE_DETAIL)).toBeNull();
    expect(screen.queryByDisplayValue(PRIVATE_RATIONALE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Записать решение" })).toBeNull();
  }

  it("hides private DOM when principalId alone changes", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await expectPrivateClearedOnFirstRender(
      rerenderProps,
      makeProps({ session: { ...baseSession, principalId: "other-principal" } }),
    );
  });

  it("hides private DOM when sessionId alone changes", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await expectPrivateClearedOnFirstRender(
      rerenderProps,
      makeProps({ session: { ...baseSession, sessionId: "s2-new-session-only" } }),
    );
  });

  it("hides private DOM when session version alone changes", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await expectPrivateClearedOnFirstRender(
      rerenderProps,
      makeProps({ session: { ...baseSession, version: 2 } }),
    );
  });

  it("hides private DOM when CSRF alone changes, including old FNV-collision pair", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const withCsrfA = makeProps({ session: { ...baseSession, csrfToken: SYNTHETIC_CSRF_A } });
    const { rerenderProps } = renderPanel(withCsrfA);
    await expectPrivateClearedOnFirstRender(
      rerenderProps,
      makeProps({ session: { ...baseSession, csrfToken: SYNTHETIC_CSRF_B } }),
    );
  });

  it("hides private DOM when roles alone change", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await expectPrivateClearedOnFirstRender(
      rerenderProps,
      makeProps({ session: { ...baseSession, roles: ["moderator"] } }),
    );
    expect(screen.getByText(/support или superadmin/)).toBeTruthy();
  });

  it("hides private DOM when Case assignment alone changes", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await expectPrivateClearedOnFirstRender(
      rerenderProps,
      makeProps({ assignedTo: "other-principal" }),
    );
    expect(screen.getByText(/только назначенному/)).toBeTruthy();
  });

  it("hides private DOM when Case version alone changes", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await expectPrivateClearedOnFirstRender(rerenderProps, makeProps({ caseVersion: 3 }));
  });

  it("hides private DOM when fresh becomes false", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await expectPrivateClearedOnFirstRender(rerenderProps, makeProps({ fresh: false }));
    expect(screen.getByText(/Подтвердите вход/)).toBeTruthy();
  });

  it("exact CSRF memory compare blocks UNKNOWN retry for FNV-collision pair", async () => {
    const sessionA = { ...baseSession, csrfToken: SYNTHETIC_CSRF_A };
    const sessionB = { ...baseSession, csrfToken: SYNTHETIC_CSRF_B };
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const view = renderPanel(makeProps({ session: sessionA }));
    await openSource();
    await fillCommentDecision();

    let rejectOnce = true;
    const firstKey = { current: "" };
    const firstBody = { current: null as unknown };
    transport.handler = (path, body, _csrf, key) => {
      if (path === `cases/${CASE_A}/commands`) {
        if (rejectOnce) {
          rejectOnce = false;
          firstKey.current = key ?? "";
          firstBody.current = body;
          throw new Error("network");
        }
        throw new Error("must not retry under colliding CSRF fingerprint");
      }
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    fireEvent.click(screen.getByRole("button", { name: "Записать решение" }));
    await waitFor(() => expect(screen.getByText(/Ответ не получен/)).toBeTruthy());

    transport.calls = [];
    view.rerenderProps(makeProps({ session: sessionB }));
    expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();
    expect(screen.queryByText(PRIVATE_DETAIL)).toBeNull();
    expect(screen.queryByDisplayValue(PRIVATE_RATIONALE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Записать решение" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку действия" }));
    await waitFor(() => {
      expect(screen.getByText(/удерживаем без повтора|сверка истории/i)).toBeTruthy();
    });
    expect(transport.calls.some((c) => c.path === `cases/${CASE_A}/commands`)).toBe(false);
    expect(screen.getByRole("button", { name: "Повторить проверку действия" })).toBeTruthy();
  });

  it("blocks new decide and UNKNOWN retry RPC on context mismatch; same-context retry stays byte-equivalent", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await openSource();
    await fillCommentDecision();

    // Stale capability.expectedCaseVersion vs current case version — no POST.
    transport.calls = [];
    rerenderProps(makeProps({ caseVersion: 9 }));
    expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) {
        return {
          ...commentPayload,
          // Bound at case v9, but capability still names expectedCaseVersion 2.
          decisionCapability: {
            ...commentPayload.decisionCapability!,
            expectedCaseVersion: 2,
          },
        };
      }
      throw new Error(path);
    };
    fireEvent.click(screen.getByRole("button", { name: "Открыть источник сообщества" }));
    await waitFor(() => expect(screen.getByText(PRIVATE_COMMENT)).toBeTruthy());
    await fillCommentDecision();
    expect((screen.getByRole("button", { name: "Записать решение" }) as HTMLButtonElement).disabled).toBe(true);
    transport.calls = [];
    // Form submit still hits decide() guard (button disabled is not enough alone).
    fireEvent.submit(screen.getByText("Решение по ресурсу").closest("form")!);
    await waitFor(() => {
      expect(screen.getByText(/старое полномочие не отправляем/i)).toBeTruthy();
    });
    expect(transport.calls.some((c) => c.path === `cases/${CASE_A}/commands`)).toBe(false);

    // Fresh matching context decide → UNKNOWN, then mismatch HOLD without RPC.
    cleanup();
    transport.calls = [];
    const view = renderPanel(makeProps());
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      throw new Error(path);
    };
    await openSource();
    await fillCommentDecision();

    let rejectOnce = true;
    const firstKey = { current: "" };
    const firstBody = { current: null as unknown };
    transport.handler = (path, body, _csrf, key) => {
      if (path === `cases/${CASE_A}/commands`) {
        if (rejectOnce) {
          rejectOnce = false;
          firstKey.current = key ?? "";
          firstBody.current = body;
          throw new Error("network");
        }
        expect(key).toBe(firstKey.current);
        expect(body).toEqual(firstBody.current);
        return { caseId: CASE_A, caseVersion: 3, decision: "withhold", auditId: "a2", decisionId: "d2" };
      }
      if (path === SOURCE_PATH_A) return { ...commentPayload, decisionCapability: null };
      throw new Error(path);
    };
    fireEvent.click(screen.getByRole("button", { name: "Записать решение" }));
    await waitFor(() => expect(screen.getByText(/Ответ не получен/)).toBeTruthy());

    // Assignment change while UNKNOWN — HOLD, no RPC, private hidden.
    transport.calls = [];
    view.rerenderProps(makeProps({ assignedTo: "someone-else" }));
    expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();
    expect(screen.queryByDisplayValue(PRIVATE_RATIONALE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку действия" }));
    await waitFor(() => {
      expect(screen.getByText(/удерживаем без повтора|сверка истории/i)).toBeTruthy();
    });
    expect(transport.calls.some((c) => c.path === `cases/${CASE_A}/commands`)).toBe(false);
    // Still uncertain / retry affordance present (HOLD).
    expect(screen.getByRole("button", { name: "Повторить проверку действия" })).toBeTruthy();

    // Same principal, new sessionId — not same context.
    transport.calls = [];
    view.rerenderProps(
      makeProps({
        assignedTo: "principal",
        session: { ...baseSession, sessionId: "brand-new-session" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку действия" }));
    await waitFor(() => {
      expect(screen.getByText(/удерживаем без повтора|сверка истории/i)).toBeTruthy();
    });
    expect(transport.calls.some((c) => c.path === `cases/${CASE_A}/commands`)).toBe(false);

    // Restore exact original context — byte-equivalent retry.
    transport.calls = [];
    view.rerenderProps(makeProps());
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку действия" }));
    await waitFor(() => {
      expect(screen.getByText(/Решение «Снять с публичной видимости» записано/)).toBeTruthy();
    });
    const commandCalls = transport.calls.filter((c) => c.path === `cases/${CASE_A}/commands`);
    expect(commandCalls).toHaveLength(1);
    expect(commandCalls[0]?.key).toBe(firstKey.current);
    expect(commandCalls[0]?.body).toEqual(firstBody.current);
  });

  it("ignores delayed source after each context change and keeps unavailable/conflict/503 honest", async () => {
    let resolveStale!: (value: typeof commentPayload) => void;
    const stale = new Promise<typeof commentPayload>((resolve) => {
      resolveStale = resolve;
    });
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return stale;
      if (path === SOURCE_PATH_B) return { ...commentPayload, caseId: CASE_B, text: "OTHER" };
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    fireEvent.click(screen.getByRole("button", { name: "Открыть источник сообщества" }));
    rerenderProps(makeProps({ caseId: CASE_B }));
    resolveStale(commentPayload);
    await waitFor(() => {
      expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();
      expect(screen.queryByText(PRIVATE_DETAIL)).toBeNull();
    });

    // Delayed after fresh=false.
    cleanup();
    let resolveDenied!: (value: typeof commentPayload) => void;
    const held = new Promise<typeof commentPayload>((resolve) => {
      resolveDenied = resolve;
    });
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return held;
      throw new Error(path);
    };
    const denied = renderPanel(makeProps());
    fireEvent.click(screen.getByRole("button", { name: "Открыть источник сообщества" }));
    denied.rerenderProps(makeProps({ fresh: false }));
    resolveDenied(commentPayload);
    await waitFor(() => {
      expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();
      expect(screen.queryByText(PRIVATE_DETAIL)).toBeNull();
    });

    // Delayed after role change.
    cleanup();
    let resolveRole!: (value: typeof commentPayload) => void;
    const roleHeld = new Promise<typeof commentPayload>((resolve) => {
      resolveRole = resolve;
    });
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return roleHeld;
      throw new Error(path);
    };
    const roleView = renderPanel(makeProps());
    fireEvent.click(screen.getByRole("button", { name: "Открыть источник сообщества" }));
    roleView.rerenderProps(makeProps({ session: { ...baseSession, roles: ["support", "moderator"].reverse() } }));
    // Normalized role order alone must not leak; change to unqualified role.
    roleView.rerenderProps(makeProps({ session: { ...baseSession, roles: ["moderator"] } }));
    resolveRole(commentPayload);
    await waitFor(() => {
      expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();
    });

    // Unavailable tombstone + version conflict + 503.
    cleanup();
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return withheldTombstone;
      throw new Error(path);
    };
    renderPanel(makeProps());
    await openSource();
    expect(screen.getByText(/отсутствует|недоступен/i)).toBeTruthy();
    expect(screen.getByText(/удалена автором/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Записать решение" })).toBeNull();

    cleanup();
    transport.handler = () => {
      throw new AdminError("CASE_VERSION_CONFLICT", 409);
    };
    renderPanel(makeProps());
    fireEvent.click(screen.getByRole("button", { name: "Открыть источник сообщества" }));
    await waitFor(() => expect(screen.getByText(/Обновить источник/)).toBeTruthy());
    expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();

    cleanup();
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      if (path === `cases/${CASE_A}/commands`) throw new AdminError("ADMIN_UPSTREAM_UNAVAILABLE", 503);
      throw new Error(path);
    };
    renderPanel(makeProps());
    await openSource();
    await fillCommentDecision();
    fireEvent.click(screen.getByRole("button", { name: "Записать решение" }));
    await waitFor(() => {
      expect(screen.queryByText(/записано/)).toBeNull();
      expect(screen.getByText(PRIVATE_COMMENT)).toBeTruthy();
    });
  });

  it("pages with opaque report-bound cursor and does not invent zero counts", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return aggregatePayload;
      if (path.includes("cursor=")) {
        expect(path).toContain(`cursor=${encodeURIComponent(CURSOR_A)}`);
        expect(path).not.toMatch(/beforeId=/);
        return {
          ...aggregatePayload,
          votes: {
            items: [
              {
                voteId: "c0000000-0000-4000-8000-000000000099",
                value: 5,
                version: 1,
                moderationState: "clear" as const,
                withdrawn: false,
                eligibleForPublicCount: false,
              },
            ],
            nextCursor: null,
            limit: 25,
          },
        };
      }
      throw new Error(`unexpected ${path}`);
    };
    renderPanel(makeProps());
    await openSource();
    fireEvent.click(screen.getByRole("button", { name: "Ещё оценки" }));
    await waitFor(() => expect(screen.getByText(/вне публичного счёта/)).toBeTruthy());

    cleanup();
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) {
        return {
          ...aggregatePayload,
          summary: {
            venueId: aggregatePayload.summary.venueId,
            canonicalVenueId: null,
            average: null,
            count: null,
            state: "unavailable" as const,
          },
          votes: { items: [], nextCursor: null, limit: 25 },
          decisionCapability: null,
        };
      }
      throw new Error(path);
    };
    renderPanel(makeProps());
    await openSource();
    expect(screen.getAllByText("недоступно").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0$/)).toBeNull();
    const summary = screen.getByText("Число оценок").closest("div");
    expect(summary && within(summary).queryByText("0")).toBeNull();
  });

  it("dropSource clears rationale across case change so old text cannot leak", async () => {
    transport.handler = (path) => {
      if (path === SOURCE_PATH_A) return commentPayload;
      if (path === SOURCE_PATH_B) return { ...commentPayload, caseId: CASE_B, text: "CASE_B_BODY" };
      throw new Error(path);
    };
    const { rerenderProps } = renderPanel(makeProps());
    await openSource();
    await fillCommentDecision();
    expect(screen.getByDisplayValue(PRIVATE_RATIONALE)).toBeTruthy();

    rerenderProps(makeProps({ caseId: CASE_B }));
    expect(screen.queryByDisplayValue(PRIVATE_RATIONALE)).toBeNull();
    expect(screen.queryByText(PRIVATE_COMMENT)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Открыть источник сообщества" }));
    await waitFor(() => expect(screen.getByText("CASE_B_BODY")).toBeTruthy());
    expect(screen.queryByDisplayValue(PRIVATE_RATIONALE)).toBeNull();
    const rationale = screen.getByLabelText("Обоснование") as HTMLTextAreaElement;
    expect(rationale.value).toBe("");
  });
});

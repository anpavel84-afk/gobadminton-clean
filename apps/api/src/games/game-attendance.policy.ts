import { z } from "zod";
import type { AppEnv } from "../config/env";
import { badRequest, notFound, serviceUnavailable, unprocessable } from "../auth/problem";
import {
  postGameWritesEnabled,
  uuid,
  type LockedGameRow,
} from "./game-outcomes.policy";

export { postGameWritesEnabled, uuid };
export type { LockedGameRow };

export const ATTENDANCE_REASON_MAX = 500;
export const ATTENDANCE_EXPLANATION_MAX = 500;
export const ATTENDANCE_ROSTER_DEFAULT_LIMIT = 50;
export const ATTENDANCE_ROSTER_MAX_LIMIT = 100;
export const ATTENDANCE_HISTORY_DEFAULT_LIMIT = 20;
export const ATTENDANCE_HISTORY_MAX_LIMIT = 50;
export const ATTENDANCE_ME_RESULTS_DEFAULT_LIMIT = 20;
export const ATTENDANCE_ME_RESULTS_MAX_LIMIT = 50;

const plainBounded = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .refine((value) => value.length >= 1 && value.length <= max, { message: "bounds" })
    .refine((value) => {
      for (const ch of value) {
        const code = ch.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f) return false;
      }
      return true;
    }, { message: "plain text" });

export const putAttendanceRequest = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483647),
    value: z.enum(["present", "absent", "unknown"]),
    late: z.boolean().optional(),
    correctionReason: plainBounded(ATTENDANCE_REASON_MAX).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.late === true && body.value !== "present") {
      ctx.addIssue({ code: "custom", path: ["late"], message: "late only with present" });
    }
    if (body.value === "unknown" && body.expectedVersion < 1) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "unknown only as correction" });
    }
    const correction = body.expectedVersion > 0;
    if (correction && !body.correctionReason) {
      ctx.addIssue({ code: "custom", path: ["correctionReason"], message: "correctionReason required" });
    }
    if (!correction && body.correctionReason !== undefined) {
      ctx.addIssue({ code: "custom", path: ["correctionReason"], message: "correctionReason only on correction" });
    }
  });

export const bulkPresentRequest = z
  .object({
    items: z
      .array(
        z
          .object({
            contextId: uuid,
            expectedVersion: z.number().int().min(0).max(2147483647),
          })
          .strict(),
      )
      .min(1)
      .max(ATTENDANCE_ROSTER_MAX_LIMIT),
    confirmedExactSelection: z.literal(true),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of body.items.entries()) {
      if (seen.has(item.contextId)) {
        ctx.addIssue({ code: "custom", path: ["items", index, "contextId"], message: "duplicate context" });
      }
      seen.add(item.contextId);
    }
  });

export const acknowledgeAttendanceRequest = z
  .object({
    attendanceVersion: z.number().int().min(1).max(2147483647),
    resolvingDisputeId: uuid.optional(),
    expectedDisputeVersion: z.number().int().min(1).max(2147483647).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const hasDispute = body.resolvingDisputeId !== undefined;
    const hasVersion = body.expectedDisputeVersion !== undefined;
    if (hasDispute !== hasVersion) {
      ctx.addIssue({
        code: "custom",
        path: hasDispute ? ["expectedDisputeVersion"] : ["resolvingDisputeId"],
        message: "resolvingDisputeId and expectedDisputeVersion required together",
      });
    }
  });

export const disputeAttendanceRequest = z
  .object({
    attendanceVersion: z.number().int().min(1).max(2147483647),
    explanation: plainBounded(ATTENDANCE_EXPLANATION_MAX),
  })
  .strict();

export const withdrawDisputeRequest = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
    reason: plainBounded(ATTENDANCE_EXPLANATION_MAX).optional(),
  })
  .strict();

export const respondDisputeRequest = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
    explanation: plainBounded(ATTENDANCE_EXPLANATION_MAX),
    correction: z
      .object({
        expectedAttendanceVersion: z.number().int().min(1).max(2147483647),
        value: z.enum(["present", "absent", "unknown"]),
        late: z.boolean().optional(),
        correctionReason: plainBounded(ATTENDANCE_REASON_MAX),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!body.correction) return;
    if (body.correction.late === true && body.correction.value !== "present") {
      ctx.addIssue({ code: "custom", path: ["correction", "late"], message: "late only with present" });
    }
  });

export const helpDisputeRequest = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
    explanation: plainBounded(ATTENDANCE_EXPLANATION_MAX),
  })
  .strict();

export type PutAttendanceRequest = z.infer<typeof putAttendanceRequest>;
export type BulkPresentRequest = z.infer<typeof bulkPresentRequest>;
export type AttendanceValue = "present" | "absent" | "unknown";
export type AttendanceProjectionValue = AttendanceValue;
export type AttendanceSource = "manager_explicit" | "self_attested" | "case_reviewer";
export type AttendanceDisputeStatus = "open" | "withdrawn" | "resolved";
export type AttendanceDisputeHelpProgress =
  | "requested"
  | "case_opened"
  | "in_review"
  | "awaiting_information"
  | "resolved"
  | "left_open_insufficient_evidence";

export type AttendanceAssertion = {
  actorDisplay: string | null;
  source: AttendanceSource | null;
  at: string | null;
};

export type AttendanceDisputeSummary = {
  id: string;
  status: AttendanceDisputeStatus;
  challengedVersion: number;
  version: number;
};

export type AttendanceAllowedActions = {
  canSetAttendance: boolean;
  canAcknowledge: boolean;
  canDispute: boolean;
  canWithdrawDispute: boolean;
  canRespondDispute: boolean;
  canRequestHelp: boolean;
};

export type AttendanceRecordView = {
  contextId: string;
  value: AttendanceProjectionValue;
  version: number;
  late: boolean;
  assertion: AttendanceAssertion;
  acknowledgedVersion: number | null;
  dispute: AttendanceDisputeSummary | null;
  displayName: string;
  allowedActions: AttendanceAllowedActions;
};

export type AttendanceSummary = {
  rosterCount: number;
  marked: number;
  unknown: number;
  underClarification: number;
  agreed: number;
};

export type AttendanceRevisionView = {
  version: number;
  before: { value: AttendanceValue; late: boolean } | null;
  after: { value: AttendanceValue; late: boolean };
  reason: string | null;
  source: AttendanceSource;
  recordedAt: string;
  actorDisplay: string;
};

export type AttendanceChallengedSnapshot = {
  version: number;
  value: AttendanceValue;
  late: boolean;
  source: AttendanceSource;
  actorDisplay: string;
  recordedAt: string;
};

export type GameAttendanceSlice = {
  installed: boolean;
  writesEnabled: boolean;
  myAttendance: AttendanceRecordView | null;
  roster: AttendanceRecordView[] | null;
  rosterNextCursor: string | null;
  summary: AttendanceSummary | null;
  allowedActions: {
    canRecordAttendance: boolean;
    canBulkPresent: boolean;
  };
};

export type MeGameResultsItem = {
  gameId: string;
  contextId: string;
  gameTitle: string | null;
  endsAt: string | null;
  attendance: AttendanceRecordView;
  notice: {
    id: string;
    attendanceVersion: number;
    value: AttendanceValue;
    late: boolean;
    source: AttendanceSource;
    actorDisplay: string;
    createdAt: string;
    acknowledgedAt: string | null;
  } | null;
};

export type MeGameResultsPage = {
  items: MeGameResultsItem[];
  nextCursor: string | null;
};

export type AttendanceDisputeHistoryAction =
  | "opened"
  | "withdrawn"
  | "manager_responded"
  | "manager_corrected"
  | "party_acknowledged"
  | "help_requested"
  | "case_linked"
  | "reviewer_resolved"
  | "left_open_insufficient_evidence";

export type AttendanceDisputeView = {
  id: string;
  gameId: string;
  contextId: string;
  status: AttendanceDisputeStatus;
  challengedVersion: number;
  explanation: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  resolvedAt: string | null;
  resolutionKind: string | null;
  latestManagerResponse: string | null;
  helpProgress: AttendanceDisputeHelpProgress | null;
  caseProgress: {
    linked: boolean;
    status: AttendanceDisputeHelpProgress | null;
  };
  challengedAssertion: AttendanceChallengedSnapshot | null;
  currentAssertion: {
    value: AttendanceProjectionValue;
    version: number;
    late: boolean;
    assertion: AttendanceAssertion;
  };
  history: Array<{
    version: number;
    action: AttendanceDisputeHistoryAction;
    explanation: string | null;
    recordedAt: string;
  }>;
  allowedActions: {
    canWithdraw: boolean;
    canRespond: boolean;
    canRequestHelp: boolean;
    canAcknowledgeCurrent: boolean;
  };
};

export type AttendanceRow = {
  participation_id: string;
  game_id: string;
  user_id: string;
  value: AttendanceValue;
  version: number;
  late: boolean;
  source: AttendanceSource;
  actor_user_id: string;
  correction_reason: string | null;
  recorded_at: Date;
  updated_at: Date;
};

export type EligibleContext = {
  participationId: string;
  userId: string;
  displayName: string;
  eligibleProof: "current_confirmed" | "transition_as_of_start";
};

export function parse<T>(schema: z.ZodType<T>, input: unknown, code = "ATTENDANCE_INPUT_INVALID"): T {
  const result = schema.safeParse(input);
  if (!result.success) throw unprocessable(code, "Некорректный запрос посещения");
  return result.data;
}

export function parseContextId(raw: string): string {
  const result = uuid.safeParse(raw);
  if (!result.success) unavailable();
  return result.data;
}

export function unavailable(): never {
  throw notFound("GAME_NOT_FOUND", "Игра не найдена");
}

export function writesUnavailable(): never {
  throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись посещения недоступна");
}

export function assertAttendanceLifecycle(game: LockedGameRow, now: Date): void {
  if (game.status === "draft") {
    throw unprocessable("ATTENDANCE_GAME_DRAFT", "Черновик нельзя отмечать по посещению");
  }
  if (!(game.ends_at.getTime() <= now.getTime())) {
    throw unprocessable("ATTENDANCE_BEFORE_END", "Посещение доступно только после окончания игры");
  }
  if (game.status !== "published" && game.status !== "completed" && game.status !== "cancelled") {
    throw unprocessable("ATTENDANCE_GAME_STATUS", "Посещение недоступно в текущем статусе игры");
  }
}

export function canRecordAttendanceHint(
  env: AppEnv,
  role: "manager" | "participant" | "none",
  game: Pick<LockedGameRow, "status" | "ends_at"> | null,
  now: Date,
  installed: boolean,
): boolean {
  if (!installed || role !== "manager" || !game || !postGameWritesEnabled(env)) return false;
  if (!(game.ends_at.getTime() <= now.getTime())) return false;
  return game.status === "published" || game.status === "completed" || game.status === "cancelled";
}

export function emptyAttendanceSlice(
  installed: boolean,
  writesEnabled: boolean,
  canRecordAttendance: boolean,
): GameAttendanceSlice {
  return {
    installed,
    writesEnabled,
    myAttendance: null,
    roster: null,
    rosterNextCursor: null,
    summary: null,
    allowedActions: {
      canRecordAttendance,
      canBulkPresent: canRecordAttendance,
    },
  };
}

export function unknownAttendanceRecord(
  contextId: string,
  displayName: string,
  actions: AttendanceAllowedActions,
): AttendanceRecordView {
  return {
    contextId,
    value: "unknown",
    version: 0,
    late: false,
    assertion: { actorDisplay: null, source: null, at: null },
    acknowledgedVersion: null,
    dispute: null,
    displayName,
    allowedActions: {
      ...actions,
      canAcknowledge: false,
    },
  };
}

export function emptyAttendanceActions(): AttendanceAllowedActions {
  return {
    canSetAttendance: false,
    canAcknowledge: false,
    canDispute: false,
    canWithdrawDispute: false,
    canRespondDispute: false,
    canRequestHelp: false,
  };
}

export function parseLimit(
  raw: string | undefined,
  fallback: number,
  max: number,
  code = "LIMIT_INVALID",
): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw badRequest(code, "Некорректный limit");
  const value = Number.parseInt(raw, 10);
  if (value < 1 || value > max) throw badRequest(code, `limit должен быть 1–${max}`);
  return value;
}

export function encodeRosterCursor(displayName: string, contextId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, displayName, contextId }), "utf8").toString("base64url");
}

export function decodeRosterCursor(cursor: string | undefined): { displayName: string; contextId: string } | null {
  if (cursor === undefined || cursor === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v?: unknown;
      displayName?: unknown;
      contextId?: unknown;
    };
    if (
      parsed?.v !== 1 ||
      typeof parsed.displayName !== "string" ||
      typeof parsed.contextId !== "string" ||
      !uuid.safeParse(parsed.contextId).success
    ) {
      throw new Error("shape");
    }
    return { displayName: parsed.displayName, contextId: parsed.contextId.toLowerCase() };
  } catch {
    throw badRequest("CURSOR_INVALID", "Некорректный rosterCursor");
  }
}

export function encodeMeResultsCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt, id }), "utf8").toString("base64url");
}

export function decodeMeResultsCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (cursor === undefined || cursor === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v?: unknown;
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      parsed?.v !== 1 ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      !uuid.safeParse(parsed.id).success ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      throw new Error("shape");
    }
    return { createdAt: parsed.createdAt, id: parsed.id.toLowerCase() };
  } catch {
    throw badRequest("CURSOR_INVALID", "Некорректный cursor");
  }
}

const PRESTART_NON_CONFIRMED = new Set(["withdrawn", "removed", "rejected", "pending"]);

/**
 * Reconstruct confirmed-as-of-start from transition history.
 * Latest definite as-of-start transition wins; never resurrect pre-start
 * withdrawn/removed/rejected/pending via an earlier or later confirmation.
 * Owner contract: withdrawal-before-start stays unmarkable (no late-join expansion).
 * Current confirmed alone (no contradictory as-of-start status) requires a known
 * confirmed_at within the game window (not after ends). Ambiguous / incomplete
 * history → false (do not invent membership).
 */
export function eligibleFromTransitions(
  transitions: Array<{ to_status: string; at: Date; id: string }>,
  startsAt: Date,
  currentStatus: string,
  confirmedAt: Date | null,
  endsAt: Date,
): { eligible: boolean; proof: EligibleContext["eligibleProof"] | null } {
  const ordered = [...transitions].sort((a, b) => {
    const delta = a.at.getTime() - b.at.getTime();
    if (delta !== 0) return delta;
    return a.id.localeCompare(b.id);
  });
  let statusAtStart: string | null = null;
  for (const row of ordered) {
    if (row.at.getTime() <= startsAt.getTime()) statusAtStart = row.to_status;
    else break;
  }
  if (statusAtStart === "confirmed") {
    return { eligible: true, proof: "transition_as_of_start" };
  }
  // Definite non-confirmed as-of-start: do not restore eligibility from current
  // or post-start confirmation fallback (leave unmarkable unknown, not absent).
  if (statusAtStart !== null && PRESTART_NON_CONFIRMED.has(statusAtStart)) {
    return { eligible: false, proof: null };
  }
  if (statusAtStart !== null) {
    // Unrecognized as-of-start status → do not invent eligibility from partial history.
    return { eligible: false, proof: null };
  }

  if (currentStatus === "confirmed") {
    if (
      confirmedAt &&
      Number.isFinite(confirmedAt.getTime()) &&
      confirmedAt.getTime() <= endsAt.getTime()
    ) {
      return { eligible: true, proof: "current_confirmed" };
    }
    // Missing / future / after-end confirmation timestamp cannot prove membership.
    return { eligible: false, proof: null };
  }
  return { eligible: false, proof: null };
}

export function summarizeRoster(records: AttendanceRecordView[]): AttendanceSummary {
  let marked = 0;
  let unknown = 0;
  let underClarification = 0;
  let agreed = 0;
  for (const row of records) {
    if (row.value === "unknown") unknown += 1;
    else marked += 1;
    if (row.dispute?.status === "open") underClarification += 1;
    if (
      row.value !== "unknown" &&
      row.acknowledgedVersion === row.version &&
      row.dispute?.status !== "open"
    ) {
      agreed += 1;
    }
  }
  return {
    rosterCount: records.length,
    marked,
    unknown,
    underClarification,
    agreed,
  };
}

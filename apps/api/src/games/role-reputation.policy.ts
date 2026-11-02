import { createHash, randomBytes } from "node:crypto";
import { badRequest, notFound, serviceUnavailable, unprocessable } from "../auth/problem";
import { postGameWritesEnabled, uuid } from "./game-outcomes.policy";
import {
  eligibleFromTransitions,
  isPermittedPresentAssertion,
  type AttendanceSource,
  type AttendanceValue,
} from "./game-attendance.policy";

export { postGameWritesEnabled, uuid };

export const ROLE_REPUTATION_TEXT_MAX = 500;
export const ROLE_REPUTATION_TOPICS_MAX = 2;
export const ROLE_REPUTATION_PAGE_DEFAULT = 20;
export const ROLE_REPUTATION_PAGE_MAX = 50;

export const ORGANIZATION_TOPICS = ["agreements", "flow", "communication"] as const;
export const TRAINING_TOPICS = ["explanations", "attention", "session_organization"] as const;

export type RoleKind = "organization" | "training";
export type RoleSurface = "game" | "profile" | "handle" | "own";

export type AdmissionVerdict =
  | { status: "may_submit" }
  | { status: "deny"; reason: string }
  | { status: "hold"; reason: string }
  | { status: "closed_surface"; reason: string };

export type HeldCountInput = {
  endsAt: Date;
  now: Date;
  lifecycle: "draft" | "published" | "cancelled" | "completed";
  outcome: "held" | "not_held" | "unknown" | null;
  proofAccepted: boolean;
  proofPhase: "planned" | "performed" | "disputed" | "cleared" | null;
  openRoleOrHeldDispute: boolean;
};

/** Distinct confirmed historical held games for organizer count — one event, not reviews. */
export function countsTowardHeldGames(input: HeldCountInput): boolean {
  if (input.endsAt.getTime() > input.now.getTime()) return false;
  if (input.lifecycle !== "published" && input.lifecycle !== "completed") return false;
  if (input.outcome !== "held") return false;
  if (!input.proofAccepted || input.proofPhase !== "performed") return false;
  if (input.openRoleOrHeldDispute) return false;
  return true;
}

export function opaqueHandle(): string {
  return randomBytes(16).toString("hex");
}

export function projectionHash(parts: {
  subjectUserId: string;
  role: RoleKind;
  audience: "public";
  text: string;
  topics: string[];
  reviewRevision?: number;
}): string {
  const payload = JSON.stringify({
    subjectUserId: parts.subjectUserId.toLowerCase(),
    role: parts.role,
    audience: parts.audience,
    text: parts.text,
    topics: [...parts.topics].sort(),
    reviewRevision: parts.reviewRevision ?? null,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function topicsAllowedForRole(role: RoleKind, topics: string[]): boolean {
  const allowed = role === "organization" ? ORGANIZATION_TOPICS : TRAINING_TOPICS;
  if (topics.length > ROLE_REPUTATION_TOPICS_MAX) return false;
  const set = new Set<string>(allowed);
  return topics.every((t) => set.has(t));
}

export function evaluateWriteAdmission(args: {
  authorUserId: string;
  subjectUserId: string | null;
  role: RoleKind;
  activityKind: "regular" | "trainer_led" | null;
  lifecycleOk: boolean;
  outcomeHeld: boolean;
  ownEligible: boolean;
  authorConfirmedPresent: boolean;
  authorOpenDispute: boolean;
  authorAttendance: { value: AttendanceValue; source: AttendanceSource; actorUserId: string } | null;
  proofPhase: "planned" | "performed" | "disputed" | "cleared" | null;
  proofSubjectUserId: string | null;
  proofAccepted: boolean;
  openRoleDispute: boolean;
  surfaceAvailable: boolean;
}): AdmissionVerdict {
  if (!args.surfaceAvailable) {
    return { status: "closed_surface", reason: "role_surface_unavailable" };
  }
  if (!args.subjectUserId || !args.proofSubjectUserId) {
    return { status: "hold", reason: "missing_history" };
  }
  if (args.authorUserId === args.subjectUserId || args.authorUserId === args.proofSubjectUserId) {
    return { status: "deny", reason: "self_review" };
  }
  if (args.role === "training") {
    if (args.activityKind !== "trainer_led") {
      return { status: "deny", reason: "not_training_event" };
    }
  }
  if (!args.lifecycleOk) return { status: "deny", reason: "lifecycle" };
  if (!args.outcomeHeld) {
    if (args.openRoleDispute || args.proofPhase === "disputed") {
      return { status: "hold", reason: "held_or_role_dispute" };
    }
    return { status: "hold", reason: "outcome_unknown" };
  }
  if (args.openRoleDispute || args.proofPhase === "disputed") {
    return { status: "hold", reason: "held_or_role_dispute" };
  }
  if (!args.proofAccepted || args.proofPhase !== "performed") {
    if (args.proofPhase === "planned" || args.proofPhase === null) {
      return { status: "hold", reason: "missing_history" };
    }
    return { status: "hold", reason: "role_unconfirmed" };
  }
  if (args.proofSubjectUserId !== args.subjectUserId) {
    return { status: "hold", reason: "subject_mismatch" };
  }
  if (!args.ownEligible) return { status: "deny", reason: "no_eligible_participation" };
  if (args.authorOpenDispute) return { status: "hold", reason: "attendance_dispute" };
  if (!args.authorConfirmedPresent) {
    if (!args.authorAttendance) return { status: "hold", reason: "attendance_unmarked" };
    if (args.authorAttendance.value === "absent") return { status: "deny", reason: "absent" };
    if (args.authorAttendance.value === "unknown") return { status: "hold", reason: "attendance_unknown" };
    if (
      !isPermittedPresentAssertion({
        value: args.authorAttendance.value,
        source: args.authorAttendance.source,
        actorUserId: args.authorAttendance.actorUserId,
        subjectUserId: args.authorUserId,
      })
    ) {
      return { status: "deny", reason: "self_mark" };
    }
    return { status: "hold", reason: "attendance_unconfirmed" };
  }
  return { status: "may_submit" };
}

export function participationEligible(args: {
  transitions: { to_status: string; at: Date; id: string }[];
  startsAt: Date;
  endsAt: Date;
  currentStatus: string;
  confirmedAt: Date | null;
}): boolean {
  return eligibleFromTransitions(
    args.transitions,
    args.startsAt,
    args.currentStatus,
    args.confirmedAt,
    args.endsAt,
  ).eligible;
}

export function publicAuthorLabel(role: RoleKind): "Участник игры" | "Участник тренировки" {
  return role === "training" ? "Участник тренировки" : "Участник игры";
}

export function redactPublicCursor(payload: Record<string, unknown>): string {
  // Opaque cursor: only non-private pagination fields (updatedAt+handle), never game/author IDs.
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePublicCursor(raw: string | undefined): { u: string; h: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      u?: unknown;
      h?: unknown;
    };
    if (typeof parsed.u !== "string" || typeof parsed.h !== "string") return null;
    if (!/^[0-9a-f]{32}$/i.test(parsed.h)) return null;
    return { u: parsed.u, h: parsed.h.toLowerCase() };
  } catch {
    return null;
  }
}

export function parseOrThrow<T>(
  schema: { parse: (v: unknown) => T },
  input: unknown,
  code = "ROLE_REPUTATION_INPUT_INVALID",
): T {
  try {
    return schema.parse(input);
  } catch {
    throw unprocessable(code, "Некорректные данные");
  }
}

export function unavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
}

export function writesUnavailable(): never {
  throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись недоступна");
}

export function badHandle(): never {
  throw badRequest("ROLE_HANDLE_INVALID", "Некорректный идентификатор роли");
}

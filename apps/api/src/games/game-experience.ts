/**
 * Shared confirmed-experience predicates for private peer (#394) and venue experience.
 * Pure policy — callers load assertions; never trust client present/identity flags.
 */
import type { PoolClient } from "pg";
import {
  eligibleFromTransitions,
  isPermittedPresentAssertion,
  type AttendanceSource,
  type AttendanceValue,
} from "./game-attendance.policy";

export type ExperienceAttendanceAssertion = {
  value: AttendanceValue;
  source: AttendanceSource;
  actorUserId: string;
  version: number;
};

export type ConfirmedExperienceInput = {
  transitions: { to_status: string; at: Date; id: string }[];
  startsAt: Date;
  endsAt: Date;
  currentStatus: string;
  confirmedAt: Date | null;
  subjectUserId: string;
  openDispute: boolean;
  assertion: ExperienceAttendanceAssertion | null;
};

/** Historical eligibility + permitted present + no open dispute. */
export function subjectHasConfirmedExperience(input: ConfirmedExperienceInput): boolean {
  const verdict = eligibleFromTransitions(
    input.transitions,
    input.startsAt,
    input.currentStatus,
    input.confirmedAt,
    input.endsAt,
  );
  if (!verdict.eligible) return false;
  if (input.openDispute) return false;
  if (!input.assertion) return false;
  return isPermittedPresentAssertion({
    value: input.assertion.value,
    source: input.assertion.source,
    actorUserId: input.assertion.actorUserId,
    subjectUserId: input.subjectUserId,
  });
}

export type VenueExperienceAdmission =
  | { status: "may_submit" }
  | { status: "deny"; reason: string }
  | { status: "hold"; reason: string }
  | { status: "missing_history"; reason: string };

export function classifyUnconfirmedAttendance(args: {
  subjectUserId: string;
  openDispute: boolean;
  assertion: ExperienceAttendanceAssertion | null;
  ownEligible: boolean;
}): VenueExperienceAdmission {
  if (!args.ownEligible) return { status: "deny", reason: "no_eligible_participation" };
  if (args.openDispute) return { status: "hold", reason: "attendance_dispute" };
  if (!args.assertion) return { status: "hold", reason: "attendance_unmarked" };
  if (args.assertion.value === "absent") return { status: "deny", reason: "absent" };
  if (args.assertion.value === "unknown") return { status: "hold", reason: "attendance_unknown" };
  if (
    !isPermittedPresentAssertion({
      value: args.assertion.value,
      source: args.assertion.source,
      actorUserId: args.assertion.actorUserId,
      subjectUserId: args.subjectUserId,
    })
  ) {
    return { status: "deny", reason: "self_mark" };
  }
  return { status: "hold", reason: "attendance_unconfirmed" };
}

export function evaluateVenueExperienceAdmission(args: {
  lifecycleOk: boolean;
  outcomeHeld: boolean;
  openOutcomeDispute: boolean;
  ownEligible: boolean;
  authorConfirmedPresent: boolean;
  authorOpenDispute: boolean;
  authorAttendance: ExperienceAttendanceAssertion | null;
  subjectUserId: string;
  canonicalVenueId: string | null;
  canonicalResolved: boolean;
  /** Historical played-at attribution present and usable. */
  playedAtAttributed: boolean;
  venueAffiliated: boolean;
}): VenueExperienceAdmission {
  if (!args.playedAtAttributed || !args.canonicalResolved || !args.canonicalVenueId) {
    return { status: "missing_history", reason: "venue_attribution_unavailable" };
  }
  if (args.venueAffiliated) {
    return { status: "deny", reason: "venue_affiliation" };
  }
  if (!args.lifecycleOk) return { status: "deny", reason: "lifecycle" };
  if (!args.outcomeHeld) return { status: "hold", reason: "outcome_unknown" };
  if (args.openOutcomeDispute) return { status: "hold", reason: "outcome_dispute" };
  if (!args.authorConfirmedPresent) {
    return classifyUnconfirmedAttendance({
      subjectUserId: args.subjectUserId,
      openDispute: args.authorOpenDispute,
      assertion: args.authorAttendance,
      ownEligible: args.ownEligible,
    });
  }
  return { status: "may_submit" };
}

/**
 * Prospective immutable played-at venue snapshot.
 * First writer wins; later games.venue_id / merge retarget never rewrites.
 * No-ops when 0058 table is not installed yet.
 */
export async function ensurePlayedAtVenueAttribution(
  client: PoolClient,
  args: {
    gameId: string;
    sourceVenueId: string;
    gameVersion: number;
    actorUserId: string | null;
    source: "publish_freeze" | "held_confirm";
  },
): Promise<void> {
  const installed = Boolean(
    (await client.query("SELECT to_regclass('game_played_at_venue_attributions') AS name")).rows[0]
      ?.name,
  );
  if (!installed) return;
  await client.query(
    `INSERT INTO game_played_at_venue_attributions
       (game_id, source_venue_id, game_version, source, actor_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (game_id) DO NOTHING`,
    [args.gameId, args.sourceVenueId, args.gameVersion, args.source, args.actorUserId],
  );
}

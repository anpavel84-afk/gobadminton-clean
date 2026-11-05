/**
 * Shared confirmed-experience predicates for private peer (#394) and venue experience.
 * Pure policy — callers load assertions; never trust client present/identity flags.
 */
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
  ownEligible: boolean;
  authorConfirmedPresent: boolean;
  authorOpenDispute: boolean;
  authorAttendance: ExperienceAttendanceAssertion | null;
  subjectUserId: string;
  canonicalVenueId: string | null;
  canonicalResolved: boolean;
  venueAffiliated: boolean;
}): VenueExperienceAdmission {
  if (!args.canonicalResolved || !args.canonicalVenueId) {
    return { status: "missing_history", reason: "venue_attribution_unavailable" };
  }
  if (args.venueAffiliated) {
    return { status: "deny", reason: "venue_affiliation" };
  }
  if (!args.lifecycleOk) return { status: "deny", reason: "lifecycle" };
  if (!args.outcomeHeld) return { status: "hold", reason: "outcome_unknown" };
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

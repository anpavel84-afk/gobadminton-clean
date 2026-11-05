import { describe, expect, it } from "vitest";
import {
  computeAppealResumeDeadline,
  computeNotBefore,
  deriveFirstEligibleAt,
  isPubliclyVisible,
  projectionHash,
  remainingSubmitWindowMs,
  topicsAllowed,
  withinSubmitWindow,
  VENUE_APPEAL_MIN_WINDOW_MS,
  VENUE_PUBLICATION_DELAY_MS,
  VENUE_SUBMIT_WINDOW_MS,
} from "../../src/venues/venue-reviews.policy";
import {
  evaluateVenueExperienceAdmission,
  subjectHasConfirmedExperience,
} from "../../src/games/game-experience";

describe("venue-reviews.policy", () => {
  it("hashes public projection without author identity", () => {
    const a = projectionHash({
      canonicalVenueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      audience: "public_venue",
      text: "Покрытие удобное",
      topics: ["lighting", "surface"],
    });
    const b = projectionHash({
      canonicalVenueId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      audience: "public_venue",
      text: "Покрытие удобное",
      topics: ["surface", "lighting"],
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("computes notBefore as max(approvedAt, lastEdit+48h)", () => {
    const edit = new Date("2026-11-01T00:00:00Z");
    const earlyApprove = new Date("2026-11-01T01:00:00Z");
    const lateApprove = new Date("2026-11-05T00:00:00Z");
    expect(computeNotBefore(earlyApprove, edit).getTime()).toBe(
      edit.getTime() + VENUE_PUBLICATION_DELAY_MS,
    );
    expect(computeNotBefore(lateApprove, edit).getTime()).toBe(lateApprove.getTime());
  });

  it("keeps published text visible despite basis_under_review / reports", () => {
    const notBefore = new Date("2026-11-03T00:00:00Z");
    expect(
      isPubliclyVisible({
        slotStatus: "published",
        approvedRevisionId: "r1",
        notBefore,
        now: new Date("2026-11-03T00:00:01Z"),
        basisUnderReview: true,
      }),
    ).toBe(true);
    expect(
      isPubliclyVisible({
        slotStatus: "published",
        approvedRevisionId: "r1",
        notBefore,
        now: new Date("2026-11-02T23:59:59Z"),
        basisUnderReview: false,
      }),
    ).toBe(false);
    expect(
      isPubliclyVisible({
        slotStatus: "submitted_waiting",
        approvedRevisionId: "r1",
        notBefore,
        now: new Date("2026-11-04T00:00:00Z"),
        basisUnderReview: false,
      }),
    ).toBe(false);
  });

  it("keeps effective visibility under revision_waiting when visible tip not_before has passed", () => {
    const visibleTip = new Date(Date.now() - 60_000);
    expect(
      isPubliclyVisible({
        slotStatus: "revision_waiting",
        approvedRevisionId: "visible-a",
        notBefore: visibleTip,
        now: new Date(),
        basisUnderReview: false,
      }),
    ).toBe(true);
    expect(
      isPubliclyVisible({
        slotStatus: "revision_waiting",
        approvedRevisionId: "future-b",
        notBefore: new Date(Date.now() + VENUE_PUBLICATION_DELAY_MS),
        now: new Date(),
        basisUnderReview: false,
      }),
    ).toBe(false);
  });

  it("keeps 14-day window from first eligible without ordinary toggle reset", () => {
    const first = new Date("2026-11-01T12:00:00Z");
    expect(
      withinSubmitWindow({
        firstEligibleAt: first,
        now: new Date(first.getTime() + VENUE_SUBMIT_WINDOW_MS - 1),
      }),
    ).toBe(true);
    expect(
      withinSubmitWindow({
        firstEligibleAt: first,
        now: new Date(first.getTime() + VENUE_SUBMIT_WINDOW_MS + 1),
      }),
    ).toBe(false);
  });

  it("derives first eligible from immutable end/outcome/present stamps, not probe clock", () => {
    const endsAt = new Date("2026-11-01T14:00:00Z");
    const heldAt = new Date("2026-11-01T15:00:00Z");
    const presentAt = new Date("2026-11-01T16:00:00Z");
    expect(
      deriveFirstEligibleAt({
        endsAt,
        outcomeHeldRecordedAt: heldAt,
        presentPermittedRecordedAt: presentAt,
      })?.toISOString(),
    ).toBe(presentAt.toISOString());
    expect(
      deriveFirstEligibleAt({
        endsAt,
        outcomeHeldRecordedAt: null,
        presentPermittedRecordedAt: presentAt,
      }),
    ).toBeNull();
  });

  it("pauses remaining window on appeal and resumes with max(remaining,7d)", () => {
    const first = new Date("2026-11-01T00:00:00Z");
    const mid = new Date(first.getTime() + 10 * 24 * 60 * 60 * 1000);
    const remaining = remainingSubmitWindowMs({ firstEligibleAt: first, now: mid });
    expect(remaining).toBe(4 * 24 * 60 * 60 * 1000);
    expect(
      withinSubmitWindow({
        firstEligibleAt: first,
        now: new Date(mid.getTime() + 30 * 24 * 60 * 60 * 1000),
        appealOpen: true,
        remainingMsAtAppeal: remaining,
      }),
    ).toBe(true);
    const resolvedAt = new Date("2026-11-20T00:00:00Z");
    const deadline = computeAppealResumeDeadline({
      remainingMsAtAppeal: remaining,
      resolvedAt,
    });
    expect(deadline.getTime()).toBe(resolvedAt.getTime() + VENUE_APPEAL_MIN_WINDOW_MS);
    expect(
      withinSubmitWindow({
        firstEligibleAt: first,
        now: new Date(deadline.getTime() - 1),
        windowDeadlineAt: deadline,
      }),
    ).toBe(true);
    expect(
      withinSubmitWindow({
        firstEligibleAt: first,
        now: new Date(deadline.getTime() + 1),
        windowDeadlineAt: deadline,
      }),
    ).toBe(false);
  });

  it("allows only surface/lighting/amenities topics", () => {
    expect(topicsAllowed(["surface"])).toBe(true);
    expect(topicsAllowed(["surface", "lighting", "amenities", "extra"])).toBe(false);
    expect(topicsAllowed(["unknown"])).toBe(false);
  });
});

describe("game-experience venue admission", () => {
  const base = {
    lifecycleOk: true,
    outcomeHeld: true,
    openOutcomeDispute: false,
    ownEligible: true,
    authorConfirmedPresent: true,
    authorOpenDispute: false,
    authorAttendance: {
      value: "present" as const,
      source: "manager_explicit" as const,
      actorUserId: "mgr",
      version: 1,
    },
    subjectUserId: "player",
    canonicalVenueId: "venue",
    canonicalResolved: true,
    playedAtAttributed: true,
    venueAffiliated: false,
  };

  it("admits confirmed held participant at resolved attributed venue", () => {
    expect(evaluateVenueExperienceAdmission(base)).toEqual({ status: "may_submit" });
  });

  it("fail-closes missing historical played-at and holds outcome disputes", () => {
    expect(
      evaluateVenueExperienceAdmission({
        ...base,
        playedAtAttributed: false,
        canonicalResolved: false,
        canonicalVenueId: null,
      }),
    ).toMatchObject({ status: "missing_history" });
    expect(
      evaluateVenueExperienceAdmission({ ...base, openOutcomeDispute: true }),
    ).toMatchObject({ status: "hold", reason: "outcome_dispute" });
    expect(
      evaluateVenueExperienceAdmission({
        ...base,
        authorConfirmedPresent: false,
        authorAttendance: null,
      }),
    ).toMatchObject({ status: "hold", reason: "attendance_unmarked" });
    expect(
      evaluateVenueExperienceAdmission({ ...base, venueAffiliated: true }),
    ).toMatchObject({ status: "deny", reason: "venue_affiliation" });
  });

  it("requires permitted present for confirmed experience", () => {
    expect(
      subjectHasConfirmedExperience({
        transitions: [
          { to_status: "confirmed", at: new Date("2026-10-01T10:00:00Z"), id: "1" },
        ],
        startsAt: new Date("2026-10-01T12:00:00Z"),
        endsAt: new Date("2026-10-01T14:00:00Z"),
        currentStatus: "confirmed",
        confirmedAt: new Date("2026-10-01T10:00:00Z"),
        subjectUserId: "player",
        openDispute: false,
        assertion: {
          value: "present",
          source: "manager_explicit",
          actorUserId: "mgr",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      subjectHasConfirmedExperience({
        transitions: [
          { to_status: "confirmed", at: new Date("2026-10-01T10:00:00Z"), id: "1" },
        ],
        startsAt: new Date("2026-10-01T12:00:00Z"),
        endsAt: new Date("2026-10-01T14:00:00Z"),
        currentStatus: "confirmed",
        confirmedAt: new Date("2026-10-01T10:00:00Z"),
        subjectUserId: "player",
        openDispute: false,
        assertion: {
          value: "present",
          source: "self_attested",
          actorUserId: "player",
          version: 1,
        },
      }),
    ).toBe(false);
  });
});

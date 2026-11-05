import { describe, expect, it } from "vitest";
import {
  computeNotBefore,
  isPubliclyVisible,
  projectionHash,
  topicsAllowed,
  withinSubmitWindow,
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

  it("gates public visibility on status, notBefore and holds", () => {
    const notBefore = new Date("2026-11-03T00:00:00Z");
    expect(
      isPubliclyVisible({
        slotStatus: "published",
        approvedRevisionId: "r1",
        notBefore,
        now: new Date("2026-11-03T00:00:01Z"),
        basisUnderReview: false,
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
        slotStatus: "published",
        approvedRevisionId: "r1",
        notBefore,
        now: new Date("2026-11-04T00:00:00Z"),
        basisUnderReview: true,
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
    venueAffiliated: false,
  };

  it("admits confirmed held participant at resolved venue", () => {
    expect(evaluateVenueExperienceAdmission(base)).toEqual({ status: "may_submit" });
  });

  it("holds unmarked attendance and denies self-venue", () => {
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
    expect(
      evaluateVenueExperienceAdmission({
        ...base,
        canonicalResolved: false,
        canonicalVenueId: null,
      }),
    ).toMatchObject({ status: "missing_history" });
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

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVenueCommunityReportBody,
  compactCommunitySummaryText,
  fetchCommunitySummaries,
  formatCommunityAverage,
  isCommunityOwnVoteResponse,
  isCommunityRatingMutationError,
  isVenueCommunityReportReceipt,
  upsertCommunityRating,
  venueCommunityReportSubjectMatchesBody,
  voteCountLabel,
  withdrawCommunityRating,
} from "../src/lib/venue-community-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

const OWN = {
  venueId: "10000000-0000-4000-8000-000000000001",
  canonicalVenueId: "10000000-0000-4000-8000-000000000001",
  value: 4,
  version: 2,
  withdrawn: false,
  moderationState: "clear" as const,
  allowedActions: { upsert: true, update: true, withdraw: true },
};

const SUMMARY = {
  venueId: OWN.venueId,
  canonicalVenueId: OWN.canonicalVenueId,
  average: 4.0,
  count: 2,
  state: "available" as const,
};

describe("#507 I1 venue-community-api", () => {
  it("formats averages and empty/unavailable compact text honestly", () => {
    expect(formatCommunityAverage(4.2)).toBe("4,2");
    expect(voteCountLabel(1)).toBe("1 оценка");
    expect(voteCountLabel(3)).toBe("3 оценки");
    expect(voteCountLabel(5)).toBe("5 оценок");
    expect(compactCommunitySummaryText({
      venueId: "v",
      canonicalVenueId: "c",
      average: null,
      count: 0,
      state: "empty",
    })).toBe("Пока нет оценок");
    expect(compactCommunitySummaryText({
      venueId: "v",
      canonicalVenueId: null,
      average: null,
      count: null,
      state: "unavailable",
    })).toBe("Оценки недоступны");
    expect(compactCommunitySummaryText({
      venueId: "v",
      canonicalVenueId: "c",
      average: 4.2,
      count: 5,
      state: "available",
    })).toContain("4,2");
  });

  it("batches summary GET and rejects guest-shaped own-vote payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [{
          venueId: "10000000-0000-4000-8000-000000000001",
          canonicalVenueId: "10000000-0000-4000-8000-000000000001",
          average: 4.2,
          count: 5,
          state: "available",
        }],
      }),
    })));
    const page = await fetchCommunitySummaries([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000001",
    ]);
    expect(page.items).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/v1/venue-community-summaries?venueIds=");
    expect(isCommunityOwnVoteResponse({ summary: page.items[0], own: null })).toBe(true);
    expect(isCommunityOwnVoteResponse({ summary: page.items[0] })).toBe(false);
  });

  it("rejects incomplete own objects so mutation helpers cannot cast them as saved", () => {
    expect(isCommunityOwnVoteResponse({ summary: SUMMARY, own: null })).toBe(true);
    expect(isCommunityOwnVoteResponse({ summary: SUMMARY, own: OWN })).toBe(true);
    expect(isCommunityOwnVoteResponse({ summary: SUMMARY, own: { value: 4 } })).toBe(false);
    expect(isCommunityOwnVoteResponse({
      summary: SUMMARY,
      own: { ...OWN, allowedActions: { upsert: true } },
    })).toBe(false);
    expect(isCommunityOwnVoteResponse({
      summary: SUMMARY,
      own: { ...OWN, version: 1.5 },
    })).toBe(false);
    expect(isCommunityOwnVoteResponse({ summary: SUMMARY, own: { ...OWN, moderationState: "open" } })).toBe(false);
  });

  it("marks body-read and malformed 2xx mutation payloads as invalid mutation errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    })));
    await expect(upsertCommunityRating({
      venueId: OWN.venueId,
      value: 4,
      expectedVersion: 1,
      csrfToken: "csrf",
      idempotencyKey: "k1",
    })).rejects.toSatisfy((error: unknown) => (
      isCommunityRatingMutationError(error) && error.kind === "invalid" && error.status === 200
    ));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ summary: SUMMARY, own: { value: 4 } }),
    })));
    await expect(withdrawCommunityRating({
      venueId: OWN.venueId,
      expectedVersion: 1,
      csrfToken: "csrf",
      idempotencyKey: "k2",
    })).rejects.toSatisfy((error: unknown) => (
      isCommunityRatingMutationError(error) && error.kind === "invalid"
    ));
  });

  it("builds exact venue_community report bodies for aggregate/own_vote/comment", () => {
    const venueId = "10000000-0000-4000-8000-000000000001";
    const aggregate = buildVenueCommunityReportBody(
      { subjectKind: "aggregate", venueId },
      "spam",
      "  note  ",
    );
    expect(aggregate).toEqual({
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
      detail: "note",
    });
    expect(venueCommunityReportSubjectMatchesBody(
      { subjectKind: "aggregate", venueId },
      aggregate,
    )).toBe(true);
    const own = buildVenueCommunityReportBody(
      { subjectKind: "own_vote", venueId, expectedVersion: 4 },
      "other",
      null,
    );
    expect(own.expectedVersion).toBe(4);
    expect(own).not.toHaveProperty("commentId");
    const comment = buildVenueCommunityReportBody(
      {
        subjectKind: "venue_comment",
        venueId,
        commentId: "20000000-0000-4000-8000-000000000001",
        expectedVersion: 2,
      },
      "harassment",
      null,
    );
    expect(comment).toMatchObject({
      subjectKind: "venue_comment",
      commentId: "20000000-0000-4000-8000-000000000001",
      expectedVersion: 2,
    });
    expect(isVenueCommunityReportReceipt({
      reportId: "r",
      status: "submitted",
      createdAt: "2026-11-08T00:00:00.000Z",
    })).toBe(true);
    expect(isVenueCommunityReportReceipt({ reportId: "r", status: "open" })).toBe(false);
  });
});

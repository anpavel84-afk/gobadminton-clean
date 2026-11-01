import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  recognizeGameResultsAction,
  validateGameResultsPending,
  validateGameResultsSuccess,
} from "../src/components/consumer/games/useGameResultsMutation";
import type { GameReview } from "../src/lib/consumer-types";

const gameId = "10000000-0000-4000-8000-000000000001";
const reviewId = "10000000-0000-4000-8000-000000000099";
const contextId = "10000000-0000-4000-8000-000000000011";

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
    const pending = {
      path: `/v1/games/${gameId}/reviews`,
      method: "POST",
      key: "k1",
      body: {
        kind: "peer",
        experienceAssertion: "i_experienced_this_game",
        subjectContextId: contextId,
        peerRating: "play_again",
      },
    };
    expect(validateGameResultsPending(pending, gameId)).toBe(true);
    const review: GameReview = {
      id: reviewId,
      gameId: "10000000-0000-4000-8000-000000000002",
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
    };
    expect(validateGameResultsSuccess(review, pending)).toBe(false);
    expect(
      validateGameResultsSuccess(
        { ...review, gameId, direction: "sent", version: 1 },
        pending,
      ),
    ).toBe(true);
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
});

import { describe, expect, it } from "vitest";
import { isPermittedPresentAssertion } from "../../src/games/game-attendance.policy";
import {
  createReviewRequest,
  needsDiscrepancy,
  parse,
  patchReviewRequest,
  peerCreateReasonLabel,
  putNoteRequest,
  putReplyRequest,
  FEEDBACK_ACTOR_MUTATIONS_PER_GAME_MAX,
  FEEDBACK_COMMENT_MAX,
} from "../../src/games/game-feedback.policy";

const subject = "10000000-0000-4000-8000-000000000021";

describe("PG-3 feedback policy", () => {
  it("freezes text bounds and mutation budget without time windows", () => {
    expect(FEEDBACK_COMMENT_MAX).toBe(500);
    expect(FEEDBACK_ACTOR_MUTATIONS_PER_GAME_MAX).toBe(80);
  });

  it("requires experience assertion and peer rating/subject", () => {
    expect(() =>
      parse(createReviewRequest, {
        kind: "peer",
        subjectContextId: subject,
        peerRating: "play_again",
      }),
    ).toThrow();
    expect(
      parse(createReviewRequest, {
        kind: "peer",
        subjectContextId: subject,
        peerRating: "neutral",
        experienceAssertion: "i_experienced_this_game",
      }).peerRating,
    ).toBe("neutral");
  });

  it("organization requires score or comment; training requires comment only", () => {
    expect(() =>
      parse(createReviewRequest, {
        kind: "organization",
        experienceAssertion: "i_experienced_this_game",
      }),
    ).toThrow();
    expect(
      parse(createReviewRequest, {
        kind: "organization",
        organizationScore: 4,
        experienceAssertion: "i_experienced_this_game",
      }).organizationScore,
    ).toBe(4);
    expect(() =>
      parse(createReviewRequest, {
        kind: "training",
        experienceAssertion: "i_experienced_this_game",
      }),
    ).toThrow();
    expect(
      parse(createReviewRequest, {
        kind: "training",
        comment: "Хорошая тренировка",
        experienceAssertion: "i_experienced_this_game",
      }).comment,
    ).toBe("Хорошая тренировка");
  });

  it("rejects control chars and unknown fields", () => {
    expect(() =>
      parse(createReviewRequest, {
        kind: "training",
        comment: "bad\nline",
        experienceAssertion: "i_experienced_this_game",
        actorId: subject,
      }),
    ).toThrow();
  });

  it("patch and reply require expectedVersion; notes require text", () => {
    expect(
      parse(patchReviewRequest, { expectedVersion: 1, comment: "правка" }).comment,
    ).toBe("правка");
    expect(parse(putReplyRequest, { expectedVersion: 0, text: "спасибо" }).text).toBe("спасибо");
    expect(parse(putNoteRequest, { expectedVersion: 0, text: "заметка" }).text).toBe("заметка");
  });

  it("discrepancy needed except present and not_participant_manager", () => {
    expect(needsDiscrepancy("present")).toBe(false);
    expect(needsDiscrepancy("not_participant_manager")).toBe(false);
    expect(needsDiscrepancy("absent")).toBe(true);
    expect(needsDiscrepancy("unknown")).toBe(true);
    expect(needsDiscrepancy("contested")).toBe(true);
    expect(needsDiscrepancy("outcome_not_held")).toBe(true);
  });

  it("permitted present rejects self-mark and self_attested", () => {
    const subject = "10000000-0000-4000-8000-000000000001";
    const manager = "10000000-0000-4000-8000-000000000002";
    expect(
      isPermittedPresentAssertion({
        value: "present",
        source: "manager_explicit",
        actorUserId: manager,
        subjectUserId: subject,
      }),
    ).toBe(true);
    expect(
      isPermittedPresentAssertion({
        value: "present",
        source: "case_reviewer",
        actorUserId: manager,
        subjectUserId: subject,
      }),
    ).toBe(true);
    expect(
      isPermittedPresentAssertion({
        value: "present",
        source: "self_attested",
        actorUserId: subject,
        subjectUserId: subject,
      }),
    ).toBe(false);
    expect(
      isPermittedPresentAssertion({
        value: "present",
        source: "manager_explicit",
        actorUserId: subject,
        subjectUserId: subject,
      }),
    ).toBe(false);
    expect(
      isPermittedPresentAssertion({
        value: "absent",
        source: "manager_explicit",
        actorUserId: manager,
        subjectUserId: subject,
      }),
    ).toBe(false);
  });

  it("maps peerCreateReason codes to safe Russian copy", () => {
    expect(peerCreateReasonLabel("game_not_confirmed")).toBe("Игра ещё не подтверждена");
    expect(peerCreateReasonLabel("attendance_unmarked")).toBe("Посещение ещё не отмечено");
    expect(peerCreateReasonLabel("attendance_clarifying")).toBe("Уточняем посещение");
    expect(peerCreateReasonLabel("no_eligible_peers")).toBe("Пока нет участников для отзыва");
    expect(peerCreateReasonLabel(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  createEntityCommentPath,
  deleteEntityCommentPath,
  isCommentCreateBody,
  isCommentDeleteBody,
  isCommentUpdateBody,
  isCommentView,
  publicCommentModerationNotice,
  updateEntityCommentPath,
} from "../src/lib/comments-api";

describe("#394 comments-api helpers", () => {
  it("maps public-comment moderation codes to inline hints without clearing drafts", () => {
    expect(
      publicCommentModerationNotice({
        ok: false,
        status: 422,
        error: "rejected",
        problem: {
          type: "about:blank",
          title: "Измените текст и попробуйте снова",
          status: 422,
          code: "PUBLIC_TEXT_CONTENT_REJECTED",
          requestId: "synthetic",
          fields: { text: "Измените текст комментария" },
        },
      }),
    ).toBe("Измените текст комментария");
    expect(publicCommentModerationNotice({ code: "MODERATION_TEMPORARILY_UNAVAILABLE" }))
      .toMatch(/временно недоступна/);
    expect(publicCommentModerationNotice({ code: "MODERATION_RATE_LIMITED" }))
      .toMatch(/Слишком много/);
    expect(publicCommentModerationNotice({ code: "VERSION_CONFLICT" })).toBeNull();
  });

  it("builds fixed entity and comment routes", () => {
    expect(createEntityCommentPath("game", "10000000-0000-4000-8000-000000000001"))
      .toBe("/v1/games/10000000-0000-4000-8000-000000000001/comments");
    expect(createEntityCommentPath("venue", "10000000-0000-4000-8000-000000000002"))
      .toBe("/v1/venues/10000000-0000-4000-8000-000000000002/comments");
    expect(updateEntityCommentPath("10000000-0000-4000-8000-000000000099"))
      .toBe("/v1/comments/10000000-0000-4000-8000-000000000099");
    expect(deleteEntityCommentPath("10000000-0000-4000-8000-000000000099"))
      .toBe("/v1/comments/10000000-0000-4000-8000-000000000099");
  });

  it("validates comment view and mutation bodies without inventing success", () => {
    expect(isCommentView({
      id: "1",
      entityKind: "game",
      entityId: "2",
      version: 1,
      deleted: false,
      body: "ok",
    })).toBe(true);
    expect(isCommentView({ id: "1", entityKind: "player", entityId: "2", version: 1, deleted: false, body: "ok" })).toBe(false);
    expect(isCommentCreateBody({ text: "hi", parentCommentId: null })).toBe(true);
    expect(isCommentUpdateBody({ text: "hi", expectedVersion: 2 })).toBe(true);
    expect(isCommentDeleteBody({ expectedVersion: 2 })).toBe(true);
    expect(isCommentUpdateBody({ text: "hi" })).toBe(false);
  });
});

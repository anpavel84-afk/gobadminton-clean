import { describe, expect, it } from "vitest";
import {
  commentPresentationMatches,
  validCommentPhotos,
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


describe("I2c1 presentation and current-photo guards", () => {
  it("permits only equal-length positional star redaction without content approval", () => {
    expect(commentPresentationMatches("*****", "хуйня")).toBe(true);
    // Actual unchanged server presentation: NFKC-backed grapheme spans, not a client classifier.
    expect(commentPresentationMatches("***", "ⓗⓤⓨ")).toBe(true);
    expect(commentPresentationMatches("huy", "ⓗⓤⓨ")).toBe(false);
    expect(commentPresentationMatches("****", "ⓗⓤⓨ")).toBe(false);
    expect(commentPresentationMatches("***", "ⓗ ⓨ")).toBe(false);
    expect(commentPresentationMatches("**", "х\u0301")).toBe(true);
    expect(commentPresentationMatches("*\u0301", "х\u0301")).toBe(false);
    expect(commentPresentationMatches("Он сказал: *****!", "Он сказал: хуйня!")).toBe(true);
    expect(commentPresentationMatches("* * *", "х у й")).toBe(true);
    expect(commentPresentationMatches(null, "  ")).toBe(true);
    expect(commentPresentationMatches("друго", "хуйня")).toBe(false);
    expect(commentPresentationMatches("****", "хуйня")).toBe(false);
    expect(commentPresentationMatches("******", "хуйня!")).toBe(false);
    expect(commentPresentationMatches("***", "а б")).toBe(false);
    expect(commentPresentationMatches("*", "🏸")).toBe(false);
    expect(commentPresentationMatches(null, "текст")).toBe(false);
  });
  it("rejects duplicate IDs, foreign/stale and malformed public URLs", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const photoId = "10000000-0000-4000-8000-000000000002";
    const photo = { id: photoId, width: 100, height: 80, url: `/v1/comments/${id}/revisions/2/photos/${photoId}` };
    const row = { id, entityKind: "venue" as const, version: 2, deleted: false, photos: [photo] };
    expect(validCommentPhotos(row)).toBe(true);
    expect(validCommentPhotos({ ...row, photos: [photo, photo] })).toBe(false);
    expect(validCommentPhotos({ ...row, version: 3 })).toBe(false);
    expect(validCommentPhotos({ ...row, photos: [{ ...photo, url: "https://storage.invalid/raw" }] })).toBe(false);
    expect(validCommentPhotos({ ...row, photos: [{ ...photo, url: photo.url + "?raw=1" }] })).toBe(false);
    expect(validCommentPhotos({ ...row, entityKind: "game" })).toBe(false);
    expect(isCommentCreateBody({ text: "", photoIds: [photoId] })).toBe(true);
    expect(isCommentCreateBody({ text: "", photoIds: [] })).toBe(false);
    expect(isCommentUpdateBody({ text: "", photoIds: [], expectedVersion: 1 })).toBe(true);
    expect(isCommentCreateBody({ photoIds: [photoId, photoId] })).toBe(false);
  });
});

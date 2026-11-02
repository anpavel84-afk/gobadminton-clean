import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { loadEnv } from "../../src/config/env";
import { CommentsController } from "../../src/comments/comments.controller";
import {
  COMMENT_TEXT_MAX,
  createCommentRequest,
  decodeCursor,
  encodeCursor,
  normalizeCommentText,
  parse,
  parseLimit,
  parseOrder,
  unicodeLength,
  updateCommentRequest,
  deleteCommentRequest,
} from "../../src/comments/comments.policy";

const gameId = "10000000-0000-4000-8000-000000000001";
const commentId = "10000000-0000-4000-8000-000000000099";
const env = loadEnv({
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
  PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
});

describe("#394 comments policy and transport", () => {
  it("accepts bounded unicode text and rejects empty/whitespace/overlong/extra fields", () => {
    expect(normalizeCommentText("Привет")).toBe("Привет");
    expect(normalizeCommentText("a".repeat(COMMENT_TEXT_MAX))).toHaveLength(COMMENT_TEXT_MAX);
    expect(unicodeLength("🙂🙂")).toBe(2);
    expect(normalizeCommentText(`${"🙂".repeat(500)}`)).toBe(`${"🙂".repeat(500)}`);
    for (const bad of ["", "   ", "\n\t", "a".repeat(COMMENT_TEXT_MAX + 1), "🙂".repeat(COMMENT_TEXT_MAX + 1)]) {
      expect(() => normalizeCommentText(bad)).toThrow();
    }
    expect(parse(createCommentRequest, { text: "ok", parentCommentId: null })).toEqual({
      text: "ok",
      parentCommentId: null,
    });
    expect(() => parse(createCommentRequest, { text: "ok", extra: true })).toThrow();
    expect(() => parse(updateCommentRequest, { text: "ok", expectedVersion: 0 })).toThrow();
    expect(parse(deleteCommentRequest, { expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
  });

  it("validates cursor parent/kind/order and does not accept cross-list cursors", () => {
    const cursor = encodeCursor({
      createdAt: "2026-11-02T08:00:00.000Z",
      id: commentId,
      entityKind: "game",
      entityId: gameId,
      parentCommentId: null,
      order: "asc",
    });
    expect(decodeCursor(cursor, {
      entityKind: "game",
      entityId: gameId,
      parentCommentId: null,
      order: "asc",
    }).id).toBe(commentId);
    expect(() => decodeCursor(cursor, {
      entityKind: "venue",
      entityId: gameId,
      parentCommentId: null,
      order: "asc",
    })).toThrow();
    expect(() => decodeCursor(cursor, {
      entityKind: "game",
      entityId: gameId,
      parentCommentId: commentId,
      order: "asc",
    })).toThrow();
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit("99")).toBe(50);
    expect(parseOrder("desc")).toBe("desc");
    expect(() => parseOrder("random")).toThrow();
  });

  it.each([
    { headers: { origin: env.PUBLIC_WEB_ORIGIN, "x-csrf-token": "ok" }, cookies: {} },
    { headers: { origin: env.PUBLIC_WEB_ORIGIN }, cookies: { [SESSION_COOKIE]: "s" } },
    { headers: { origin: "https://evil.invalid", "x-csrf-token": "ok" }, cookies: { [SESSION_COOKIE]: "s" } },
  ])("auth rejects POST before service: %j", async (request) => {
    const auth = {
      requireCookieMutation: vi.fn().mockRejectedValue(new Error("auth")),
      optionalSession: vi.fn(),
    };
    const create = vi.fn();
    const controller = new CommentsController(
      auth as never,
      new IdempotencyService({} as never, env),
      { create } as never,
    );
    await expect(controller.createGame(request as never, { status: vi.fn() } as never, gameId)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves actor/session/idempotency on create and optional guest list", async () => {
    const a = "10000000-0000-4000-8000-000000000001";
    const s = "10000000-0000-4000-8000-000000000002";
    const auth = {
      requireCookieMutation: vi.fn().mockResolvedValue({ userId: a, sessionId: s }),
      optionalSession: vi.fn().mockResolvedValue(null),
    };
    const create = vi.fn().mockResolvedValue({
      statusCode: 201,
      body: { id: commentId, entityKind: "game", entityId: gameId },
    });
    const list = vi.fn().mockResolvedValue({ items: [], entityKind: "game", entityId: gameId });
    const controller = new CommentsController(
      auth as never,
      new IdempotencyService({} as never, env),
      { create, list } as never,
    );
    const body = { text: "Вопрос по времени", parentCommentId: null };
    const reply = { status: vi.fn() };
    await controller.createGame(
      { headers: { "idempotency-key": "comments-synthetic-key" }, body } as never,
      reply as never,
      gameId,
    );
    expect(create).toHaveBeenCalledWith("game", gameId, a, s, "comments-synthetic-key", body);
    expect(reply.status).toHaveBeenCalledWith(201);
    await controller.listGame({} as never, gameId);
    expect(list).toHaveBeenCalledWith("game", gameId, null, expect.any(Object));
  });
});

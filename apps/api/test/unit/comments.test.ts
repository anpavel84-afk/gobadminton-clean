import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { loadEnv } from "../../src/config/env";
import { CommentsService } from "../../src/comments/comments.service";
import { CommentsController } from "../../src/comments/comments.controller";
import {
  type CommentView,
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
  createVenueCommentRequest, updateVenueCommentRequest, normalizeVenueCommentText, assertCommentContent,
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


describe("#506 public comment response boundary", () => {
  const raw = 'Он написал «БЛЯДЬ», организация слабая. José 🙂';
  const masked = 'Он написал «*****», организация слабая. José 🙂';
  const actorId = "10000000-0000-4000-8000-000000000011";
  const sessionId = "10000000-0000-4000-8000-000000000012";
  const receiptBody = Object.freeze({
    id: commentId, entityKind: "game" as const, entityId: gameId,
    parentCommentId: null, body: raw, deleted: false, version: 1,
    createdAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-11-09T00:00:00.000Z",
    edited: false, mine: true, replyCount: 0,
    author: { publicPlayerId: null, displayName: "Игрок", avatar: { uploadedUrl: null, providerUrl: null }, profilePublic: false },
  });

  function fixture(body: CommentView = receiptBody, statusCode = 201) {
    const result = Object.freeze({ statusCode, body });
    const mutations = {
      runWithExternalPrepare: vi.fn().mockResolvedValue(result),
      runIdempotent: vi.fn().mockResolvedValue(result),
    };
    const moderation = { approveTexts: vi.fn(), bindTexts: vi.fn() };
    const service = new CommentsService(
      {} as never, env, mutations as never,
      new IdempotencyService({} as never, env), {} as never, moderation as never, {} as never, {} as never,
    );
    return { service, mutations, moderation, result };
  }

  it.each(["game", "venue"] as const)("masks historical %s create/reply receipt without preparing or mutating it", async (kind) => {
    const { service, moderation, result, mutations } = fixture();
    for (const parentCommentId of [null, commentId]) {
      const response = await service.create(kind, gameId, actorId, sessionId, "synthetic-replay-key", {
        text: raw, parentCommentId,
      });
      expect(response.statusCode).toBe(201);
      expect(response.body.body).toBe(masked);
      expect(response.body).toEqual({ ...receiptBody, body: masked });
      expect(result.body.body).toBe(raw);
      expect(mutations.runWithExternalPrepare.mock.calls.at(-1)?.[0].authorizeReplay).toBeTypeOf("function");
    }
    expect(moderation.approveTexts).not.toHaveBeenCalled();
    expect(moderation.bindTexts).not.toHaveBeenCalled();
  });

  it("masks a historical edit receipt and keeps its status/version", async () => {
    const { service, result } = fixture(receiptBody, 200);
    const response = await service.update(commentId, actorId, sessionId, "synthetic-update-key", {
      text: raw, expectedVersion: 1,
    });
    expect(response).toEqual({ statusCode: 200, body: { ...receiptBody, body: masked } });
    expect(result.body.body).toBe(raw);
  });

  it("keeps tombstone null even if an old receipt contains a body", async () => {
    const { service, result } = fixture(Object.freeze({ ...receiptBody, deleted: true }), 200);
    const response = await service.remove(commentId, actorId, sessionId, "synthetic-delete-key", { expectedVersion: 1 });
    expect(response.body.body).toBeNull();
    expect(result.body.body).toBe(raw);
  });

  it("propagates authorization/replay failure before returning a public body", async () => {
    const { service, mutations, moderation } = fixture();
    mutations.runWithExternalPrepare.mockRejectedValue(new Error("replay fence"));
    await expect(service.create("game", gameId, actorId, sessionId, "synthetic-denied-key", {
      text: raw, parentCommentId: null,
    })).rejects.toThrow("replay fence");
    expect(moderation.approveTexts).not.toHaveBeenCalled();
  });
});

describe("#507 I2b distinct venue content shape",()=>{
  it("preserves game strict text and attachment denial while allowing venue photo-only",()=>{
    const id="10000000-0000-4000-8000-000000000001";
    expect(()=>parse(createCommentRequest,{text:"ok",photoIds:[id]})).toThrow();
    expect(()=>parse(updateCommentRequest,{expectedVersion:1,photoIds:[id]})).toThrow();
    expect(()=>normalizeCommentText("  ")).toThrow();
    const body=parse(createVenueCommentRequest,{photoIds:[id]});
    expect(normalizeVenueCommentText(body.text)).toBeNull();
    expect(()=>assertCommentContent(null,body.photoIds!)).not.toThrow();
    expect(()=>assertCommentContent(null,[])).toThrow();
    expect(()=>parse(createVenueCommentRequest,{photoIds:[id,id.toUpperCase()]})).toThrow();
    expect(()=>normalizeVenueCommentText("🙂".repeat(1001))).toThrow();
    expect(normalizeVenueCommentText(" text ")).toBe("text");
  });
  it("keeps omitted photos distinct from explicit removal",()=>{
    expect(parse(updateVenueCommentRequest,{text:"keep",expectedVersion:1}).photoIds).toBeUndefined();
    expect(parse(updateVenueCommentRequest,{text:"remove",photoIds:[],expectedVersion:1}).photoIds).toEqual([]);
  });
});

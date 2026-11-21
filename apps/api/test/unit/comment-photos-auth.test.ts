import { describe, expect, it, vi } from "vitest";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { loadEnv } from "../../src/config/env";
import {
  COMMENT_PHOTO_RIGHTS,
  CommentPhotosController,
} from "../../src/comments/comment-photos";

const venueId = "10000000-0000-4000-8000-000000000001";
const photoId = "10000000-0000-4000-8000-000000000099";
const actor = {
  userId: "10000000-0000-4000-8000-000000000011",
  sessionId: "10000000-0000-4000-8000-000000000012",
};
const env = loadEnv({
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
  PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
});
const idem = "comment-photos-auth-key";

describe("#598 comment-photos principal auth", () => {
  it("POST/DELETE call requirePrincipalMutation; GETs call requirePrincipal; principal is the service actor", async () => {
    const auth = {
      requirePrincipalMutation: vi.fn().mockResolvedValue(actor),
      requirePrincipal: vi.fn().mockResolvedValue(actor),
      requireCookieMutation: vi.fn(),
      requireSession: vi.fn(),
    };
    const photos = {
      upload: vi.fn().mockResolvedValue({ statusCode: 201, body: { id: photoId, status: "ready" } }),
      status: vi.fn().mockResolvedValue({ id: photoId, status: "ready" }),
      content: vi.fn().mockResolvedValue(Buffer.from([137, 80, 78, 71])),
      withdraw: vi.fn().mockResolvedValue({ id: photoId, status: "withdrawn", version: 2 }),
    };
    const controller = new CommentPhotosController(
      auth as never,
      photos as never,
      new IdempotencyService({} as never, env),
    );
    const png = Buffer.from([1, 2, 3]);
    const uploadReply = { code: vi.fn(), type: vi.fn() };
    await controller.upload(
      {
        headers: {
          "idempotency-key": idem,
          "x-photo-rights": COMMENT_PHOTO_RIGHTS,
          "content-type": "image/png",
        },
        body: png,
      } as never,
      venueId,
      uploadReply as never,
    );
    expect(auth.requirePrincipalMutation).toHaveBeenCalledTimes(1);
    expect(photos.upload).toHaveBeenCalledWith(
      actor,
      venueId,
      idem,
      COMMENT_PHOTO_RIGHTS,
      png,
      "image/png",
    );
    expect(uploadReply.code).toHaveBeenCalledWith(201);

    await controller.status({ headers: {} } as never, photoId);
    expect(auth.requirePrincipal).toHaveBeenCalledTimes(1);
    expect(photos.status).toHaveBeenCalledWith(actor, photoId);

    const contentReply = {
      header: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn((body: Buffer) => body),
    };
    await controller.content({ headers: {} } as never, photoId, contentReply as never);
    expect(auth.requirePrincipal).toHaveBeenCalledTimes(2);
    expect(photos.content).toHaveBeenCalledWith(actor, photoId);
    expect(contentReply.type).toHaveBeenCalledWith("image/png");
    expect(contentReply.send).toHaveBeenCalled();

    await controller.withdraw(
      {
        headers: { "idempotency-key": idem, "x-photo-version": "1" },
        body: { expectedVersion: 1 },
      } as never,
      photoId,
    );
    expect(auth.requirePrincipalMutation).toHaveBeenCalledTimes(2);
    expect(photos.withdraw).toHaveBeenCalledWith(
      actor,
      photoId,
      idem,
      "1",
      { expectedVersion: 1 },
    );

    expect(auth.requireCookieMutation).not.toHaveBeenCalled();
    expect(auth.requireSession).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "upload",
      reject: "requirePrincipalMutation" as const,
      run: async (controller: CommentPhotosController) =>
        controller.upload(
          {
            headers: {
              "idempotency-key": idem,
              "x-photo-rights": COMMENT_PHOTO_RIGHTS,
              "content-type": "image/png",
            },
            body: Buffer.from([1]),
          } as never,
          venueId,
          { code: vi.fn(), type: vi.fn() } as never,
        ),
      service: "upload" as const,
    },
    {
      name: "status",
      reject: "requirePrincipal" as const,
      run: async (controller: CommentPhotosController) =>
        controller.status({ headers: {} } as never, photoId),
      service: "status" as const,
    },
    {
      name: "content",
      reject: "requirePrincipal" as const,
      run: async (controller: CommentPhotosController) =>
        controller.content(
          { headers: {} } as never,
          photoId,
          {
            header: vi.fn().mockReturnThis(),
            type: vi.fn().mockReturnThis(),
            send: vi.fn(),
          } as never,
        ),
      service: "content" as const,
    },
    {
      name: "withdraw",
      reject: "requirePrincipalMutation" as const,
      run: async (controller: CommentPhotosController) =>
        controller.withdraw(
          {
            headers: { "idempotency-key": idem, "x-photo-version": "1" },
            body: { expectedVersion: 1 },
          } as never,
          photoId,
        ),
      service: "withdraw" as const,
    },
  ])("NEGATIVE $name: rejecting auth propagates and service is never called", async ({ reject, run, service }) => {
    const auth = {
      requirePrincipalMutation: vi.fn(),
      requirePrincipal: vi.fn(),
      requireCookieMutation: vi.fn(),
      requireSession: vi.fn(),
    };
    auth[reject].mockRejectedValue(new Error("auth"));
    const photos = {
      upload: vi.fn(),
      status: vi.fn(),
      content: vi.fn(),
      withdraw: vi.fn(),
    };
    const controller = new CommentPhotosController(
      auth as never,
      photos as never,
      new IdempotencyService({} as never, env),
    );
    await expect(run(controller)).rejects.toThrow("auth");
    expect(photos[service]).not.toHaveBeenCalled();
    expect(auth.requireCookieMutation).not.toHaveBeenCalled();
    expect(auth.requireSession).not.toHaveBeenCalled();
  });
});

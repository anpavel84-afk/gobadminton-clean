import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { AvatarController } from "../../src/profiles/avatar.controller";
import { CoverController } from "../../src/profiles/cover.controller";
import { GameCoverController } from "../../src/games/game-cover.controller";
import {
  clientAcceptsMediaWebp,
  deriveAvatarWebp,
  deriveCoverWebp,
  MEDIA_IMAGE_PRESETS,
  resolveMediaImageResponse,
} from "../../src/profiles/media-image-response";

async function photographicCoverPng(): Promise<Buffer> {
  const width = MEDIA_IMAGE_PRESETS.cover.maxWidth;
  const height = MEDIA_IMAGE_PRESETS.cover.maxHeight;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (Math.sin(x / 17) * 80 + Math.cos(y / 11) * 60 + (x ^ y) + 128) & 255;
      raw[i + 1] = (Math.cos(x / 23) * 70 + Math.sin(y / 13) * 50 + ((x * 3 + y * 5) & 127) + 90) & 255;
      raw[i + 2] = (Math.sin((x + y) / 19) * 90 + ((x * 7) ^ (y * 11)) + 64) & 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function photographicAvatarPng(): Promise<Buffer> {
  const width = MEDIA_IMAGE_PRESETS.avatar.maxWidth;
  const height = MEDIA_IMAGE_PRESETS.avatar.maxHeight;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (Math.sin(x / 9) * 70 + Math.cos(y / 7) * 50 + (x ^ y) + 100) & 255;
      raw[i + 1] = (Math.cos(x / 11) * 60 + Math.sin(y / 5) * 40 + ((x * 5 + y * 3) & 127) + 80) & 255;
      raw[i + 2] = (Math.sin((x + y) / 13) * 80 + ((x * 3) ^ (y * 7)) + 48) & 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** 4×4 RGBA with exact alpha samples 0 / 128 / 255 at known pixels. */
async function alphaMaskPng(): Promise<{ png: Buffer; alphas: number[] }> {
  const width = 4;
  const height = 4;
  const raw = Buffer.alloc(width * height * 4);
  const alphas: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = x === 0 ? 0 : x === 1 ? 128 : 255;
      alphas.push(alpha);
      raw[i] = 200;
      raw[i + 1] = 40;
      raw[i + 2] = 40;
      raw[i + 3] = alpha;
    }
  }
  const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { png, alphas };
}

function replyCapture() {
  const headers: Record<string, string> = {};
  let contentType: string | undefined;
  let body: Buffer | undefined;
  const reply = {
    header(name: string, value: string) {
      headers[name] = value;
      return reply;
    },
    type(value: string) {
      contentType = value;
      return reply;
    },
    send(payload: Buffer) {
      body = payload;
      return reply;
    },
  };
  return { reply, headers, get contentType() { return contentType; }, get body() { return body; } };
}

describe("clientAcceptsMediaWebp", () => {
  it("reuses alpha42 Accept rules: explicit webp, q=0, bare q, wildcards", () => {
    expect(clientAcceptsMediaWebp("image/webp")).toBe(true);
    expect(clientAcceptsMediaWebp("image/png, image/webp;q=0.8")).toBe(true);
    expect(clientAcceptsMediaWebp("image/webp;q=0")).toBe(false);
    expect(clientAcceptsMediaWebp("image/webp;q")).toBe(false);
    expect(clientAcceptsMediaWebp("*/*")).toBe(false);
    expect(clientAcceptsMediaWebp("image/*")).toBe(false);
    expect(clientAcceptsMediaWebp(undefined)).toBe(false);
  });
});

describe("deriveAvatarWebp / deriveCoverWebp dimensions and weight", () => {
  it("keeps avatar at 512 square and does not apply cover 1200×400 bounds", async () => {
    const png = await photographicAvatarPng();
    const metaPng = await sharp(png).metadata();
    expect(metaPng).toMatchObject({ format: "png", width: 512, height: 512 });

    const webp = await deriveAvatarWebp(png);
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(webp.length).toBeLessThan(png.length * 0.55);
  });

  it("keeps cover at 1200×400 and reduces photographic bytes", async () => {
    const png = await photographicCoverPng();
    expect((await sharp(png).metadata())).toMatchObject({ width: 1200, height: 400 });
    const webp = await deriveCoverWebp(png);
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(1200);
    expect(meta.height).toBeLessThanOrEqual(400);
    expect(webp.length).toBeLessThan(png.length * 0.55);
  });

  it("preserves alpha 0 / partial / 255 exactly (lossless transparent preset)", async () => {
    const { png, alphas } = await alphaMaskPng();
    for (const kind of ["avatar", "cover"] as const) {
      const webp = kind === "avatar" ? await deriveAvatarWebp(png) : await deriveCoverWebp(png);
      const { data, info } = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(4);
      const out: number[] = [];
      for (let i = 0; i < info.width * info.height; i++) {
        out.push(data[i * 4 + 3]!);
      }
      expect(out).toEqual(alphas);
    }
  });

  it("serves original PNG without WebP support / q=0 / bare q, and on converter failure", async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "green" },
    }).png().toBuffer();

    const asPng = await resolveMediaImageResponse(png, "image/png", deriveAvatarWebp);
    expect(asPng).toEqual({ body: png, contentType: "image/png" });

    const q0 = await resolveMediaImageResponse(png, "image/webp;q=0", deriveAvatarWebp);
    expect(q0.contentType).toBe("image/png");
    expect(q0.body.equals(png)).toBe(true);

    const bareQ = await resolveMediaImageResponse(png, "image/webp;q", deriveCoverWebp);
    expect(bareQ.contentType).toBe("image/png");

    const fail = await resolveMediaImageResponse(png, "image/webp", async () => {
      throw new Error("converter boom");
    });
    expect(fail).toEqual({ body: png, contentType: "image/png" });
  });

  it("does not enlarge small avatar or cover sources", async () => {
    const smallAvatar = await sharp({
      create: { width: 128, height: 128, channels: 3, background: "blue" },
    }).png().toBuffer();
    const avatarWebp = await deriveAvatarWebp(smallAvatar);
    expect(await sharp(avatarWebp).metadata()).toMatchObject({ width: 128, height: 128 });

    const smallCover = await sharp({
      create: { width: 600, height: 200, channels: 3, background: "blue" },
    }).png().toBuffer();
    const coverWebp = await deriveCoverWebp(smallCover);
    expect(await sharp(coverWebp).metadata()).toMatchObject({ width: 600, height: 200 });
  });
});

describe("Avatar / profile cover / game-cover controller ordering", () => {
  it("avatar: never converts when read denies; Vary Accept + WebP after authorized read", async () => {
    const denied = Object.assign(new Error("AVATAR_UNAVAILABLE"), { status: 404 });
    const read = vi.fn().mockRejectedValue(denied);
    const resolveMod = await import("../../src/profiles/media-image-response");
    const resolveSpy = vi.spyOn(resolveMod, "resolveMediaImageResponse");
    const controller = new AvatarController({} as never, { read } as never, {} as never);
    const captured = replyCapture();

    await expect(
      controller.read(
        { headers: { accept: "image/webp" } } as never,
        "a".repeat(64) + ".png",
        captured.reply as never,
      ),
    ).rejects.toBe(denied);

    expect(read).toHaveBeenCalledOnce();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(captured.body).toBeUndefined();
    expect(captured.contentType).toBeUndefined();
    expect(captured.headers).toMatchObject({
      "Cache-Control": "no-store",
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    resolveSpy.mockRestore();

    const png = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#224466" },
    }).png().toBuffer();
    const okRead = vi.fn().mockResolvedValue(png);
    const ok = new AvatarController({} as never, { read: okRead } as never, {} as never);
    const webpCapture = replyCapture();
    await ok.read(
      { headers: { accept: "image/webp" } } as never,
      "b".repeat(64) + ".png",
      webpCapture.reply as never,
    );
    expect(webpCapture.contentType).toBe("image/webp");
    expect((await sharp(webpCapture.body!).metadata()).format).toBe("webp");
    expect((await sharp(webpCapture.body!).metadata()).width).toBe(512);
    expect(webpCapture.headers.Vary).toBe("Accept");
  });

  it("profile cover: optionalSession/read denial not converted; Cookie+Accept Vary after success", async () => {
    const denied = Object.assign(new Error("COVER_UNAVAILABLE"), { status: 404 });
    const optionalSession = vi.fn().mockResolvedValue(null);
    const readCover = vi.fn().mockRejectedValue(denied);
    const resolveMod = await import("../../src/profiles/media-image-response");
    const resolveSpy = vi.spyOn(resolveMod, "resolveMediaImageResponse");
    const controller = new CoverController(
      { optionalSession } as never,
      { readCover } as never,
      {} as never,
      {} as never,
    );
    const captured = replyCapture();

    await expect(
      controller.read(
        { headers: { accept: "image/webp" } } as never,
        "c".repeat(64) + ".png",
        captured.reply as never,
      ),
    ).rejects.toBe(denied);

    expect(optionalSession).toHaveBeenCalledOnce();
    expect(readCover).toHaveBeenCalledOnce();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(captured.body).toBeUndefined();
    expect(captured.headers.Vary).toBe("Cookie, Accept");
    resolveSpy.mockRestore();

    const sessionDenied = Object.assign(new Error("SESSION_INVALID"), { status: 401 });
    const badSession = vi.fn().mockRejectedValue(sessionDenied);
    const neverRead = vi.fn();
    const sessionController = new CoverController(
      { optionalSession: badSession } as never,
      { readCover: neverRead } as never,
      {} as never,
      {} as never,
    );
    const sessionCapture = replyCapture();
    await expect(
      sessionController.read(
        { headers: { accept: "image/webp" } } as never,
        "c".repeat(64) + ".png",
        sessionCapture.reply as never,
      ),
    ).rejects.toBe(sessionDenied);
    expect(neverRead).not.toHaveBeenCalled();
    expect(sessionCapture.body).toBeUndefined();

    const png = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: "#638122" },
    }).png().toBuffer();
    const ok = new CoverController(
      { optionalSession: vi.fn().mockResolvedValue({ userId: "u1" }) } as never,
      { readCover: vi.fn().mockResolvedValue(png) } as never,
      {} as never,
      {} as never,
    );
    const webpCapture = replyCapture();
    await ok.read(
      { headers: { accept: "image/webp" } } as never,
      "d".repeat(64) + ".png",
      webpCapture.reply as never,
    );
    expect(webpCapture.contentType).toBe("image/webp");
    expect(webpCapture.headers.Vary).toBe("Cookie, Accept");
    expect((await sharp(webpCapture.body!).metadata()).width).toBeLessThanOrEqual(1200);
  });

  it("game cover: optionalSession/read denial not converted; Cookie+Accept Vary after success", async () => {
    const denied = Object.assign(new Error("COVER_UNAVAILABLE"), { status: 404 });
    const optionalSession = vi.fn().mockResolvedValue(null);
    const read = vi.fn().mockRejectedValue(denied);
    const resolveMod = await import("../../src/profiles/media-image-response");
    const resolveSpy = vi.spyOn(resolveMod, "resolveMediaImageResponse");
    const controller = new GameCoverController(
      { optionalSession } as never,
      { read } as never,
      {} as never,
    );
    const captured = replyCapture();

    await expect(
      controller.read(
        { headers: { accept: "image/webp" } } as never,
        "e".repeat(64) + ".png",
        captured.reply as never,
      ),
    ).rejects.toBe(denied);

    expect(optionalSession).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(captured.body).toBeUndefined();
    expect(captured.headers.Vary).toBe("Cookie, Accept");
    resolveSpy.mockRestore();

    const png = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: "#112233" },
    }).png().toBuffer();
    const ok = new GameCoverController(
      { optionalSession: vi.fn().mockResolvedValue(null) } as never,
      { read: vi.fn().mockResolvedValue(png) } as never,
      {} as never,
    );
    const webpCapture = replyCapture();
    await ok.read(
      { headers: { accept: "image/webp" } } as never,
      "f".repeat(64) + ".png",
      webpCapture.reply as never,
    );
    expect(webpCapture.contentType).toBe("image/webp");
    expect(webpCapture.headers.Vary).toBe("Cookie, Accept");
    expect(webpCapture.headers["Cache-Control"]).toBe("no-store");
  });
});

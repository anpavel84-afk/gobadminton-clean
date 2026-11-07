import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { CoverController } from "../../src/profiles/cover.controller";
import {
  clientAcceptsVenueCoverWebp,
  deriveVenueCoverWebp,
  resolveVenueCoverResponse,
  VENUE_COVER_WEBP_MAX_HEIGHT,
  VENUE_COVER_WEBP_MAX_WIDTH,
} from "../../src/profiles/venue-cover-response";

async function photographicCoverPng(): Promise<Buffer> {
  const width = VENUE_COVER_WEBP_MAX_WIDTH;
  const height = VENUE_COVER_WEBP_MAX_HEIGHT;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      // Deterministic rich gradients + high-frequency detail (photographic-like entropy).
      raw[i] = (Math.sin(x / 17) * 80 + Math.cos(y / 11) * 60 + (x ^ y) + 128) & 255;
      raw[i + 1] = (Math.cos(x / 23) * 70 + Math.sin(y / 13) * 50 + ((x * 3 + y * 5) & 127) + 90) & 255;
      raw[i + 2] = (Math.sin((x + y) / 19) * 90 + ((x * 7) ^ (y * 11)) + 64) & 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("clientAcceptsVenueCoverWebp", () => {
  it("accepts explicit image/webp and rejects q=0 / wildcards / absent", () => {
    expect(clientAcceptsVenueCoverWebp("image/webp")).toBe(true);
    expect(clientAcceptsVenueCoverWebp("image/png, image/webp;q=0.8")).toBe(true);
    expect(clientAcceptsVenueCoverWebp("IMAGE/WEBP")).toBe(true);
    expect(clientAcceptsVenueCoverWebp(" image/webp ; q = 0.5 ")).toBe(true);
    expect(clientAcceptsVenueCoverWebp(["image/avif", "image/webp;q=1"])).toBe(true);

    expect(clientAcceptsVenueCoverWebp("image/webp;q=0")).toBe(false);
    expect(clientAcceptsVenueCoverWebp("image/webp;q=0.0")).toBe(false);
    expect(clientAcceptsVenueCoverWebp("IMAGE/WEBP; Q = 0 ")).toBe(false);
    expect(clientAcceptsVenueCoverWebp("image/webp;q=0, image/webp")).toBe(true);
    expect(clientAcceptsVenueCoverWebp("image/webp;q=0, image/png")).toBe(false);
    expect(clientAcceptsVenueCoverWebp("image/png")).toBe(false);
    expect(clientAcceptsVenueCoverWebp("*/*")).toBe(false);
    expect(clientAcceptsVenueCoverWebp("image/*")).toBe(false);
    expect(clientAcceptsVenueCoverWebp("image/*,*/*;q=0.8")).toBe(false);
    expect(clientAcceptsVenueCoverWebp(undefined)).toBe(false);
    expect(clientAcceptsVenueCoverWebp("")).toBe(false);
  });
});

describe("deriveVenueCoverWebp / resolveVenueCoverResponse", () => {
  it("derives a valid smaller WebP at sanitized cover dimensions from a photographic PNG", async () => {
    const png = await photographicCoverPng();
    const metaPng = await sharp(png).metadata();
    expect(metaPng).toMatchObject({ format: "png", width: 1200, height: 400 });
    expect(png.length).toBeGreaterThan(80_000);

    const webp = await deriveVenueCoverWebp(png);
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(1200);
    expect(meta.height).toBeLessThanOrEqual(400);
    expect(webp.length).toBeLessThan(png.length * 0.55);
    expect(webp.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(webp.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("serves original PNG when Accept excludes WebP, and falls back on converter failure", async () => {
    const png = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: "green" },
    }).png().toBuffer();

    const asPng = await resolveVenueCoverResponse(png, "image/png");
    expect(asPng).toEqual({ body: png, contentType: "image/png" });
    expect(asPng.body).toBe(png);

    const q0 = await resolveVenueCoverResponse(png, "image/webp;q=0");
    expect(q0.contentType).toBe("image/png");
    expect(q0.body.equals(png)).toBe(true);

    const fail = await resolveVenueCoverResponse(png, "image/webp", async () => {
      throw new Error("converter boom");
    });
    expect(fail).toEqual({ body: png, contentType: "image/png" });

    const empty = await resolveVenueCoverResponse(png, "image/webp", async () => Buffer.alloc(0));
    expect(empty.contentType).toBe("image/png");
    expect(empty.body).toBe(png);

    const ok = await resolveVenueCoverResponse(png, "image/webp", async () => Buffer.from("RIFF....WEBP"));
    expect(ok.contentType).toBe("image/webp");
    expect(ok.body.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("does not enlarge below the sanitized cover bound", async () => {
    const small = await sharp({
      create: { width: 600, height: 200, channels: 3, background: "blue" },
    }).png().toBuffer();
    const webp = await deriveVenueCoverWebp(small);
    const meta = await sharp(webp).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(200);
  });
});

describe("CoverController.readVenue ordering and headers", () => {
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

  it("never transcodes or returns image bytes when authorization/read fails", async () => {
    const denied = Object.assign(new Error("COVER_UNAVAILABLE"), { status: 404 });
    const readVenueCover = vi.fn().mockRejectedValue(denied);
    const resolveMod = await import("../../src/profiles/venue-cover-response");
    const resolveSpy = vi.spyOn(resolveMod, "resolveVenueCoverResponse");
    const controller = new CoverController(
      {} as never,
      { readVenueCover } as never,
      {} as never,
      {} as never,
    );
    const captured = replyCapture();

    await expect(
      controller.readVenue(
        { headers: { accept: "image/webp" } } as never,
        "a".repeat(64) + ".png",
        captured.reply as never,
      ),
    ).rejects.toBe(denied);

    expect(readVenueCover).toHaveBeenCalledOnce();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(captured.body).toBeUndefined();
    expect(captured.contentType).toBeUndefined();
    // Security headers are set before the throw; body must stay unset.
    expect(captured.headers).toMatchObject({
      "Cache-Control": "no-store",
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    resolveSpy.mockRestore();
  });

  it("keeps no-store + security headers and returns WebP only after authorized read", async () => {
    const png = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: "#638122" },
    }).png().toBuffer();
    const readVenueCover = vi.fn().mockResolvedValue(png);
    const controller = new CoverController(
      {} as never,
      { readVenueCover } as never,
      {} as never,
      {} as never,
    );
    const webpCapture = replyCapture();
    await controller.readVenue(
      { headers: { accept: "image/webp" } } as never,
      "b".repeat(64) + ".png",
      webpCapture.reply as never,
    );
    expect(readVenueCover).toHaveBeenCalledOnce();
    expect(webpCapture.headers).toMatchObject({
      "Cache-Control": "no-store",
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    expect(webpCapture.contentType).toBe("image/webp");
    expect(webpCapture.body).toBeInstanceOf(Buffer);
    expect((await sharp(webpCapture.body!).metadata()).format).toBe("webp");

    const pngCapture = replyCapture();
    await controller.readVenue(
      { headers: { accept: "image/png" } } as never,
      "b".repeat(64) + ".png",
      pngCapture.reply as never,
    );
    expect(pngCapture.contentType).toBe("image/png");
    expect(pngCapture.body!.equals(png)).toBe(true);
    expect(pngCapture.headers["Cache-Control"]).toBe("no-store");
    expect(pngCapture.headers.Vary).toBe("Accept");
  });
});

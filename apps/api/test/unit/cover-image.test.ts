import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sanitizeAvatar } from "../../src/profiles/avatar-image";

describe("cover derivative at existing media boundary", () => {
  it("re-encodes actual bytes to the cover shape and strips metadata", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const source = await sharp({ create: { width: 800, height: 600, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
      const bytes = await sanitizeAvatar(source, `image/${format}`, "cover");
      const meta = await sharp(bytes).metadata();
      expect(meta).toMatchObject({ format: "png", width: 1200, height: 400 });
      expect(meta.exif).toBeUndefined(); expect(meta.xmp).toBeUndefined(); expect(meta.icc).toBeUndefined();
    }
  });
  it("rejects MIME spoofing, active content, trailing polyglot and excessive pixels", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
    for (const [body, mime] of [[png, "image/jpeg"], [Buffer.from("<svg/>"), "image/png"], [Buffer.from("<html/>"), "text/html"], [Buffer.concat([png, Buffer.from("<html/>")]), "image/png"], [Buffer.alloc(5*1024*1024+1), "image/png"]] as const) {
      await expect(sanitizeAvatar(body, mime, "cover")).rejects.toThrow();
    }
    const big = await sharp({create:{width:4097,height:4097,channels:3,background:"red"}}).png().toBuffer();
    await expect(sanitizeAvatar(big, "image/png", "cover")).rejects.toThrow();
    const animated = Buffer.concat([png.subarray(0,33), Buffer.from([0,0,0,8]), Buffer.from("acTL"), Buffer.alloc(12), png.subarray(33)]);
    await expect(sanitizeAvatar(animated, "image/png", "cover")).rejects.toThrow();
  });
});

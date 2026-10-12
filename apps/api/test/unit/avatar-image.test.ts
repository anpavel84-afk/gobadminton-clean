import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AVATAR_MAX_BYTES, sanitizeAvatar } from "../../src/profiles/avatar-image";
import { safeProviderAvatar } from "../../src/profiles/avatar-presentation";

describe("avatar sanitizer", () => {
  for (const format of ["jpeg", "png", "webp"] as const) it(`re-encodes ${format}, strips metadata and crops`, async () => {
    const input = await sharp({ create: { width: 800, height: 600, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
    const output = await sanitizeAvatar(input, `image/${format}`);
    const meta = await sharp(output).metadata();
    expect(meta).toMatchObject({ format: "png", width: 512, height: 512 });
    expect(meta.exif).toBeUndefined(); expect(meta.icc).toBeUndefined(); expect(meta.xmp).toBeUndefined();
  });
  it("rejects scriptable, mismatched, truncated and oversized data", async () => {
    for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('<html>bad</html>')]) await expect(sanitizeAvatar(input, "image/png")).rejects.toMatchObject({ status: 415 });
    const png = await sharp({create:{width:10,height:10,channels:3,background:"red"}}).png().toBuffer();
    await expect(sanitizeAvatar(png, "image/jpeg")).rejects.toMatchObject({status:415});
    await expect(sanitizeAvatar(png.subarray(0,30), "image/png")).rejects.toMatchObject({status:422});
    await expect(sanitizeAvatar(Buffer.alloc(AVATAR_MAX_BYTES+1), "image/png")).rejects.toMatchObject({status:413});
  });
  it("rejects extreme dimensions and pixel bombs before full decode", async () => {
    const huge = await sharp({create:{width:8193,height:1,channels:3,background:"red"}}).png().toBuffer();
    await expect(sanitizeAvatar(huge,"image/png")).rejects.toMatchObject({status:422});
    const pixels = await sharp({create:{width:4001,height:4000,channels:3,background:"red"}}).png().toBuffer();
    await expect(sanitizeAvatar(pixels,"image/png")).rejects.toMatchObject({status:422});
  });
  it("rejects animated WebP", async () => {
    const input = await sharp(Buffer.from([...Array(12).fill(0), ...Array(12).fill(255)]), {raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0,delay:[100,100]}).toBuffer();
    await expect(sanitizeAvatar(input,"image/webp")).rejects.toMatchObject({status:422});
  });
  it("provider fallback never accepts scriptable/insecure URLs", () => {
    for (const u of ["javascript:alert(1)","data:image/svg+xml,x","http://example.org/a","https://u:p@example.org/a","/a","https://evil.invalid/a","https://avatars.yandex.net.evil.invalid/a"]) expect(safeProviderAvatar(u)).toBeNull();
    expect(safeProviderAvatar("https://avatars.yandex.net/test")).toBe("https://avatars.yandex.net/test");
  });
});

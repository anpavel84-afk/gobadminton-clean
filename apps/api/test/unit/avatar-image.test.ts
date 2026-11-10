import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import type { ConsumerAuthService } from "../../src/auth/consumer-auth.service";
import { unauthorized } from "../../src/auth/problem";
import type { ActorFenceService } from "../../src/common/actor-fence.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import type { AppEnv } from "../../src/config/env";
import { AvatarController } from "../../src/profiles/avatar.controller";
import type { AvatarService } from "../../src/profiles/avatar.service";
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
    for (const u of ["javascript:alert(1)","data:image/svg+xml,x","http://example.org/a","https://u:p@example.org/a","/a","https://evil.invalid/a","https://avatars.yandex.net.evil.invalid/a","https:///@avatars.yandex.net/a","https:///:@avatars.yandex.net/","https:////@sun9.userapi.com/a","https://avatars.yandex.net@evil.example/phish"]) expect(safeProviderAvatar(u)).toBeNull();
    expect(safeProviderAvatar("https://avatars.yandex.net/test")).toBe("https://avatars.yandex.net/test");
  });
});

describe("avatar command boundary", () => {
  const env = { AUTH_PEPPER: "avatar-unit-synthetic-pepper", USER_RESTRICTIONS_INTERNAL_ENABLED: false } as AppEnv;
  const actor = { userId: "actor", sessionId: "session" };
  for (const method of ["replace", "remove"] as const) {
    for (const key of [undefined, "", "x".repeat(15), "x".repeat(129)]) it(`${method} rejects key length ${key?.length ?? "missing"} before service effects`, async () => {
      const auth = { requireCookieMutation: vi.fn().mockResolvedValue(actor) };
      const avatars = { mutate: vi.fn() };
      const controller = new AvatarController(auth as unknown as ConsumerAuthService, avatars as unknown as AvatarService, new IdempotencyService({} as Pool, env));
      const request = { headers: { "idempotency-key": key, "x-profile-version": "7" } } as unknown as FastifyRequest;
      await expect(controller[method](request)).rejects.toMatchObject({ status: 400 });
      expect(avatars.mutate).not.toHaveBeenCalled();
    });
    for (const length of [16, 128]) it(`${method} passes a valid ${length} character key and version to the service`, async () => {
      const auth = { requireCookieMutation: vi.fn().mockResolvedValue(actor) };
      const result = { version: 8, avatar: { uploadedUrl: null, providerUrl: null } };
      const avatars = { mutate: vi.fn().mockResolvedValue(result) };
      const controller = new AvatarController(auth as unknown as ConsumerAuthService, avatars as unknown as AvatarService, new IdempotencyService({} as Pool, env));
      const body = Buffer.from([0, 255, 128, 1]);
      const request = { body, headers: { "idempotency-key": "x".repeat(length), "x-profile-version": "7", "content-type": "image/png" } } as unknown as FastifyRequest;
      expect(await controller[method](request)).toBe(result);
      expect(avatars.mutate).toHaveBeenCalledWith(actor, "x".repeat(length), "7", ...(method === "replace" ? [{ body, mime: "image/png" }] : []));
    });
  }

  it("preflight returns only a currently authorized receipt and never reserves on a miss", async () => {
    let active = true;
    let saved = true;
    const body = { version: 8, avatar: { uploadedUrl: "/v1/media/avatars/original.png", providerUrl: null } };
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("FROM idempotency_records") && saved ? [{
      request_hash: "same-hash", reservation_state: "completed", status_code: 200, response_body: body,
      expires_at: new Date(Date.now() + 60_000),
    }] : [], rowCount: 0 }));
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    const fence = { assertActiveConsumerInTransaction: vi.fn(async () => { if (!active) throw unauthorized(); }) };
    const runner = new MutationRunner(pool, new IdempotencyService(pool, env), fence as unknown as ActorFenceService, env);
    const authorizeReplay = vi.fn(async () => undefined);
    const input = { actorId: actor.userId, sessionId: actor.sessionId, operation: "profiles.avatar.mutate", key: "unit-avatar-key-16", requestHash: "same-hash", authorizeReplay };
    expect(await runner.findReplay(input)).toEqual({ statusCode: 200, body });
    expect(authorizeReplay).toHaveBeenCalledWith(client, body);
    active = false;query.mockClear();authorizeReplay.mockClear();
    await expect(runner.findReplay(input)).rejects.toMatchObject({ status: 401 });
    expect(query.mock.calls.some(([sql]) => sql.includes("idempotency_records"))).toBe(false);
    expect(authorizeReplay).not.toHaveBeenCalled();
    active = true;saved = false;query.mockClear();
    expect(await runner.findReplay(input)).toBeUndefined();
    expect(query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
    expect(authorizeReplay).not.toHaveBeenCalled();
  });
});

describe("community_photo full-frame sanitizer", () => {
  it("preserves landscape/portrait frame and strips orientation/metadata without upscaling", async () => {
    for (const [width, height, expected] of [[2400,1200,[1600,800]], [400,800,[400,800]]] as const) {
      const input = await sharp({create:{width,height,channels:3,background:"red"}})
        .withMetadata().jpeg().toBuffer();
      const bytes = await sanitizeAvatar(input, "image/jpeg", "community_photo");
      const meta = await sharp(bytes).metadata();
      expect([meta.width,meta.height]).toEqual(expected);
      expect(meta.exif).toBeUndefined(); expect(meta.icc).toBeUndefined(); expect(meta.xmp).toBeUndefined();
    }
    const rotated = await sharp({create:{width:200,height:400,channels:3,background:"blue"}})
      .withMetadata({orientation:6}).jpeg().toBuffer();
    expect(await sharp(await sanitizeAvatar(rotated,"image/jpeg","community_photo")).metadata()).toMatchObject({width:400,height:200});
  });
  it("keeps both edge colors (no crop) and bounds high-entropy output by reduction", async () => {
    const raw = Buffer.alloc(2400*1200*3);
    for (let y=0;y<1200;y++) for (let x=0;x<2400;x++) raw[(y*2400+x)*3+(x<1200?0:2)] = 255;
    const image = await sharp(raw,{raw:{width:2400,height:1200,channels:3}}).png().toBuffer();
    const bytes = await sanitizeAvatar(image,"image/png","community_photo");
    const decoded = await sharp(bytes).raw().toBuffer({resolveWithObject:true});
    expect(decoded.data[0]).toBe(255);
    expect(decoded.data[(decoded.info.width-1)*3+2]).toBe(255);
    // Fixed deterministic noise exercises the bounded ladder rather than a flat-color shortcut.
    const noise = Buffer.alloc(1600*1600*3); let seed=507;
    for (let i=0;i<noise.length;i++) { seed=(Math.imul(seed,1664525)+1013904223)>>>0; noise[i]=seed>>>24; }
    const compressed = await sharp(noise,{raw:{width:1600,height:1600,channels:3}}).jpeg({quality:90}).toBuffer();
    const reduced = await sanitizeAvatar(compressed,"image/jpeg","community_photo");
    expect(reduced.length).toBeLessThanOrEqual(2*1024*1024);
    expect((await sharp(reduced).metadata()).width).toBeLessThan(1600);
  });
  it("rejects trailing/truncated containers, APNG, animation, type and dimension violations", async () => {
    for (const format of ["png","jpeg","webp"] as const) {
      const input = await sharp({create:{width:40,height:20,channels:3,background:"red"}}).toFormat(format).toBuffer();
      await expect(sanitizeAvatar(Buffer.concat([input,Buffer.from("trailing")]),`image/${format}`,"community_photo")).rejects.toMatchObject({status:422});
      await expect(sanitizeAvatar(input.subarray(0,input.length-3),`image/${format}`,"community_photo")).rejects.toMatchObject({status:422});
      await expect(sanitizeAvatar(input,"image/gif","community_photo")).rejects.toMatchObject({status:415});
    }
    const png = await sharp({create:{width:10,height:10,channels:3,background:"red"}}).png().toBuffer();
    const actl = Buffer.alloc(20);actl.writeUInt32BE(8);actl.write("acTL",4);actl.writeUInt32BE(2,8);
    await expect(sanitizeAvatar(Buffer.concat([png.subarray(0,33),actl,png.subarray(33)]),"image/png","community_photo")).rejects.toMatchObject({status:422});
    const animated = await sharp(Buffer.from([...Array(12).fill(0),...Array(12).fill(255)]),{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0,delay:[100,100]}).toBuffer();
    await expect(sanitizeAvatar(animated,"image/webp","community_photo")).rejects.toMatchObject({status:422});
    const huge = await sharp({create:{width:8193,height:1,channels:3,background:"red"}}).png().toBuffer();
    await expect(sanitizeAvatar(huge,"image/png","community_photo")).rejects.toMatchObject({status:422});
    const pixels = await sharp({create:{width:4001,height:4000,channels:3,background:"red"}}).png().toBuffer();
    await expect(sanitizeAvatar(pixels,"image/png","community_photo")).rejects.toMatchObject({status:422});
    await expect(sanitizeAvatar(Buffer.alloc(AVATAR_MAX_BYTES+1),"image/png","community_photo")).rejects.toMatchObject({status:413});
  });
  it("retains the exact historical avatar/cover transforms", async () => {
    const input = await sharp({create:{width:900,height:600,channels:3,background:"green"}}).withMetadata({orientation:6}).jpeg().toBuffer();
    for (const [slot,width,height] of [["avatar",512,512],["cover",1200,400]] as const) {
      const historical = await sharp(input,{failOn:"warning",limitInputPixels:16_000_000,limitInputChannels:4})
        .rotate().resize(width,height,{fit:"cover"}).png().timeout({seconds:10}).toBuffer();
      expect((await sanitizeAvatar(input,"image/jpeg",slot)).equals(historical)).toBe(true);
    }
  });
});

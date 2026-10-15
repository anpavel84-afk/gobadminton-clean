import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { avatarForGameCreator, safeUploadedAvatar, emptyAvatar } from "../../src/profiles/avatar-presentation";

describe("game creator avatar projection", () => {
  it("uses creator authorization before reading current media; never returns identity or keys", async () => {
    const key = "a".repeat(64) + ".png";
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ user_id: "creator" }] })
      .mockResolvedValueOnce({ rows: [{ avatar_key: key, provider_url: "https://avatars.yandex.net/photo" }] });
    const avatar = await avatarForGameCreator({ query } as unknown as Pool, "game", true, "viewer");
    expect(query.mock.calls[0]![1]).toEqual(["game", "viewer"]);
    const sql = query.mock.calls[0]![0];
    expect(sql).toContain("p.user_id = g.created_by_user_id");
    expect(sql).not.toContain("organizer_id");
    expect(sql).not.toContain("trainer");
    for (const guard of ["u.status = 'active'", "p.directory_visible", "p.social_eligible", "user_restrictions", "profile.public", "user_blocks", "b.blocker_user_id = $2", "b.blocked_user_id = $2"]) expect(sql).toContain(guard);
    expect(query.mock.calls[1]![1]).toEqual(["creator"]);
    expect(avatar).toEqual({ uploadedUrl: `/v1/media/avatars/${key}`, providerUrl: "https://avatars.yandex.net/photo" });
    expect(JSON.stringify(avatar)).not.toContain("creator");
  });
  it("fails closed when creator profile is unavailable", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    expect(await avatarForGameCreator({ query } as unknown as Pool, "game", true)).toEqual(emptyAvatar());
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each(["../../private.png", "<img>.png", "https://evil.test/a", "x.png", null])("does not expose an invalid/private key %s", key => {
    expect(safeUploadedAvatar(key)).toBeNull();
  });
  it("reads replacement and removal afresh without a projection cache", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ user_id: "creator" }] })
      .mockResolvedValueOnce({ rows: [{ avatar_key: "b".repeat(64) + ".png", provider_url: null }] })
      .mockResolvedValueOnce({ rows: [{ user_id: "creator" }] })
      .mockResolvedValueOnce({ rows: [{ avatar_key: null, provider_url: null }] });
    const db = { query } as unknown as Pool;
    expect((await avatarForGameCreator(db, "game", true)).uploadedUrl).toContain("b".repeat(64));
    expect(await avatarForGameCreator(db, "game", true)).toEqual(emptyAvatar());
  });
});

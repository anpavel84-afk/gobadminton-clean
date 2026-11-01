import { describe, expect, it, vi } from "vitest";
import {
  DIRECTORY_VISIBILITY_PROVENANCE,
  SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
  ensureDefaultSocialProfile,
} from "../../src/profiles/social-profile-defaults";

describe("ensureDefaultSocialProfile (#448)", () => {
  it("inserts owner_default ON + requests with safe name and no consent/city invention", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await ensureDefaultSocialProfile({ query } as never, { userId: "user-1" });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql)).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/i);
    expect(String(sql)).not.toMatch(/UPDATE/i);
    expect(params).toEqual([
      "user-1",
      SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
      null,
      DIRECTORY_VISIBILITY_PROVENANCE.OWNER_DEFAULT,
    ]);
  });

  it("uses provided display name and optional city without inventing consent", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await ensureDefaultSocialProfile({ query } as never, {
      userId: "user-2",
      displayName: "  Provider Name  ",
      cityId: "city-uuid",
    });
    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([
      "user-2",
      "Provider Name",
      "city-uuid",
      DIRECTORY_VISIBILITY_PROVENANCE.OWNER_DEFAULT,
    ]);
  });

  it("truncates oversized names and rejects empty provided name via fallback", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await ensureDefaultSocialProfile({ query } as never, {
      userId: "user-3",
      displayName: "x".repeat(100),
    });
    expect(query.mock.calls[0]![1][1]).toHaveLength(80);
    query.mockClear();
    await ensureDefaultSocialProfile({ query } as never, {
      userId: "user-4",
      displayName: "   ",
    });
    expect(query.mock.calls[0]![1][1]).toBe(SOCIAL_PROFILE_SAFE_DISPLAY_NAME);
  });
});

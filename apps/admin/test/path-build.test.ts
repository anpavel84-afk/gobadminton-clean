import { afterEach, expect, it, vi } from "vitest";
import { adminPath } from "../src/lib/admin-path";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("compiles optional basePath with matching browser URLs and keeps default root", async () => {
  for (const flag of ["0", "1"]) {
    vi.stubEnv("ADMIN_DEV_PATH_BUILD", flag); vi.resetModules();
    const {default: config} = await import("../next.config");
    const prefix = flag === "1" ? "/admin" : "";
    expect(config.basePath).toBe(prefix);
    expect(config.skipTrailingSlashRedirect).toBe(flag === "1");
    expect(config.env?.NEXT_PUBLIC_ADMIN_BASE_PATH).toBe(prefix);
    vi.stubEnv("NEXT_PUBLIC_ADMIN_BASE_PATH", prefix);
    for (const path of ["/", "/v1/admin/auth/me", "/internal/auth-ticket", "/brand/go-badminton.svg"])
      expect(adminPath(path)).toBe(prefix+path);
  }
});
it("rejects non-exact build opt-in", async () => {
  vi.stubEnv("ADMIN_DEV_PATH_BUILD", "true");
  await expect(import("../next.config")).rejects.toThrow("Invalid Admin path build opt-in");
});

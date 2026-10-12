import { afterEach, describe, expect, it, vi } from "vitest";

describe("API base URL boundary", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.API_BASE_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
  });

  it("rejects raw IP origins", async () => {
    process.env.API_BASE_URL = "http://169.58.183.182:18080";
    const { fetchApiHealth } = await import("../src/lib/api");
    const result = await fetchApiHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/raw non-loopback IP/i);
    }
  });

  it("requires configuration", async () => {
    const { fetchApiHealth } = await import("../src/lib/api");
    const result = await fetchApiHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/API_BASE_URL/);
    }
  });
});

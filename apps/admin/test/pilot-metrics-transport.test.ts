import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/v1/admin/[...path]/route";
import { buildPilotMetricsPath } from "../src/lib/pilot-metrics";

const origin = "http://localhost:18920";
function enabled() {
  vi.stubEnv("ADMIN_INTERNAL_APP_ENABLED", "1");
  vi.stubEnv("ADMIN_TEST_ORIGIN", origin);
  vi.stubEnv("ADMIN_TEST_API_URL", "http://127.0.0.1:18921");
}
function ctx(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pilot metrics admin transport", () => {
  it("forwards only the exact GET pilot-metrics read with bounded query", async () => {
    enabled();
    const fetch = vi.fn().mockResolvedValue(Response.json({ cities: [] }));
    vi.stubGlobal("fetch", fetch);
    const path = buildPilotMetricsPath({
      cityId: "a0000000-0000-4000-8000-000000000001",
      from: "2026-10-01",
      to: "2026-11-01",
    });
    const result = await GET(
      new Request(origin + "/v1/admin/" + path, {
        headers: { "sec-fetch-site": "same-origin", cookie: "__Host-gb_admin_session=admin" },
      }),
      ctx("pilot-metrics"),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const [url] = fetch.mock.calls[0]!;
    expect(url.href).toContain("/v1/admin/pilot-metrics?");
    expect(url.searchParams.get("cityId")).toBe("a0000000-0000-4000-8000-000000000001");
    expect(url.searchParams.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-11-01T00:00:00.000Z");
  });

  it("rejects POST and unknown query keys for pilot-metrics", async () => {
    enabled();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await POST(
          new Request(origin + "/v1/admin/pilot-metrics", {
            method: "POST",
            headers: { origin },
            body: "{}",
          }),
          ctx("pilot-metrics"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await GET(
          new Request(origin + "/v1/admin/pilot-metrics?cityId=a0000000-0000-4000-8000-000000000001&hack=1", {
            headers: { "sec-fetch-site": "same-origin" },
          }),
          ctx("pilot-metrics"),
        )
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

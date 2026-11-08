import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/v1/admin/[...path]/route";

const origin = "http://localhost:18920";
const api = "http://127.0.0.1:18921";
const CASE_ID = "a0000000-0000-4000-8000-000000000001";
const REPORT_ID = "b0000000-0000-4000-8000-000000000001";
const REVIEW_PATH = `cases/${CASE_ID}/review-reports/${REPORT_ID}`;
const MESSAGE_PATH = `cases/${CASE_ID}/message-reports/${REPORT_ID}`;
const PRIVATE_BODY = { comment: "PRIVATE_PEER_BODY_SHOULD_NOT_PERSIST", reportId: REPORT_ID };

function enabled() {
  vi.stubEnv("ADMIN_INTERNAL_APP_ENABLED", "1");
  vi.stubEnv("ADMIN_TEST_ORIGIN", origin);
  vi.stubEnv("ADMIN_TEST_API_URL", api);
}
function ctx(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Admin case source BFF transport", () => {
  it("forwards exact review-report and message-report GETs with Admin cookie and Origin only", async () => {
    enabled();
    const fetch = vi.fn().mockImplementation(async () => Response.json(PRIVATE_BODY));
    vi.stubGlobal("fetch", fetch);

    for (const path of [REVIEW_PATH, MESSAGE_PATH]) {
      const result = await GET(
        new Request(origin + "/v1/admin/" + path, {
          headers: {
            "sec-fetch-site": "same-origin",
            cookie: "__Host-gb_session=consumer; __Host-gb_admin_session=admin",
            authorization: "Bearer consumer",
          },
        }),
        ctx(path),
      );
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.json()).toEqual(PRIVATE_BODY);
      const [url, options] = fetch.mock.calls.at(-1)!;
      expect(url.href).toBe(`${api}/v1/admin/${path}`);
      expect(url.search).toBe("");
      expect(options.method).toBe("GET");
      expect(options.cache).toBe("no-store");
      expect(options.redirect).toBe("manual");
      expect(options.headers.get("origin")).toBe(origin);
      expect(options.headers.get("cookie")).toBe("__Host-gb_admin_session=admin");
      expect(options.headers.has("authorization")).toBe(false);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("propagates denied upstream 401/403/404 without caching private source", async () => {
    enabled();
    for (const status of [401, 403, 404] as const) {
      const body = status === 401 ? { code: "ADMIN_SESSION_REQUIRED" } : status === 403 ? { code: "ADMIN_FORBIDDEN" } : { code: "NOT_FOUND" };
      const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
      vi.stubGlobal("fetch", fetch);
      const result = await GET(
        new Request(origin + "/v1/admin/" + REVIEW_PATH, {
          headers: { "sec-fetch-site": "same-origin", cookie: "__Host-gb_admin_session=admin" },
        }),
        ctx(REVIEW_PATH),
      );
      expect(result.status).toBe(status);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.json()).toEqual(body);
      expect(fetch.mock.calls[0]![0].href).toBe(`${api}/v1/admin/${REVIEW_PATH}`);
    }
  });

  it("never fetches malformed IDs, unknown Cases suffix, POST, query, cross-site, or wrong host", async () => {
    enabled();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const malformed = [
      `cases/not-a-uuid/review-reports/${REPORT_ID}`,
      `cases/${CASE_ID}/review-reports/not-a-uuid`,
      `cases/${CASE_ID}/message-reports/b0000000-0000-4000-8000-00000000000g`,
      `cases/${CASE_ID}/unknown-reports/${REPORT_ID}`,
      `cases/${CASE_ID}/review-reports/${REPORT_ID}/extra`,
      `cases/${CASE_ID}/review-reports`,
    ];
    for (const path of malformed) {
      expect(
        (
          await GET(
            new Request(origin + "/v1/admin/" + path, { headers: { "sec-fetch-site": "same-origin" } }),
            ctx(path),
          )
        ).status,
      ).toBe(404);
    }

    expect(
      (
        await POST(
          new Request(origin + "/v1/admin/" + REVIEW_PATH, { method: "POST", headers: { origin }, body: "{}" }),
          ctx(REVIEW_PATH),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await POST(
          new Request(origin + "/v1/admin/" + MESSAGE_PATH, { method: "POST", headers: { origin }, body: "{}" }),
          ctx(MESSAGE_PATH),
        )
      ).status,
    ).toBe(404);

    expect(
      (
        await GET(
          new Request(origin + "/v1/admin/" + REVIEW_PATH + "?beforeId=1", {
            headers: { "sec-fetch-site": "same-origin" },
          }),
          ctx(REVIEW_PATH),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request(origin + "/v1/admin/" + MESSAGE_PATH + "?limit=1&limit=2", {
            headers: { "sec-fetch-site": "same-origin" },
          }),
          ctx(MESSAGE_PATH),
        )
      ).status,
    ).toBe(400);

    expect(
      (
        await GET(
          new Request(origin + "/v1/admin/" + REVIEW_PATH, { headers: { "sec-fetch-site": "cross-site" } }),
          ctx(REVIEW_PATH),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request("http://evil.test/v1/admin/" + MESSAGE_PATH, {
            headers: { "sec-fetch-site": "same-origin", origin },
          }),
          ctx(MESSAGE_PATH),
        )
      ).status,
    ).toBe(403);

    expect(fetch).not.toHaveBeenCalled();
  });
});

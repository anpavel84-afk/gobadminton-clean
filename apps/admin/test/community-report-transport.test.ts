import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/v1/admin/[...path]/route";

const origin = "http://localhost:18920";
const api = "http://127.0.0.1:18921";
const CASE_ID = "a0000000-0000-4000-8000-000000000001";
const REPORT_ID = "b0000000-0000-4000-8000-000000000001";
const COMMUNITY_PATH = `cases/${CASE_ID}/community-reports/${REPORT_ID}`;
const REVIEW_PATH = `cases/${CASE_ID}/review-reports/${REPORT_ID}`;
const MESSAGE_PATH = `cases/${CASE_ID}/message-reports/${REPORT_ID}`;
const PRIVATE_BODY = {
  subjectKind: "venue_comment",
  detail: "PRIVATE_COMPLAINANT_DETAIL",
  text: "PRIVATE_REPORTED_COMMENT",
  reportId: REPORT_ID,
};

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

describe("Admin community-report BFF transport", () => {
  it("forwards exact community-report GET with Admin cookie, Origin, and bounded query only", async () => {
    enabled();
    // Fresh Response per mocked fetch — body can only be consumed once.
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(Response.json(PRIVATE_BODY)),
    );
    vi.stubGlobal("fetch", fetch);

    const plain = await GET(
      new Request(origin + "/v1/admin/" + COMMUNITY_PATH, {
        headers: {
          "sec-fetch-site": "same-origin",
          cookie: "__Host-gb_session=consumer; __Host-gb_admin_session=admin",
          authorization: "Bearer consumer",
        },
      }),
      ctx(COMMUNITY_PATH),
    );
    expect(plain.status).toBe(200);
    expect(plain.headers.get("cache-control")).toBe("no-store");
    expect(await plain.json()).toEqual(PRIVATE_BODY);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url.href).toBe(`${api}/v1/admin/${COMMUNITY_PATH}`);
    expect(url.search).toBe("");
    expect(options.method).toBe("GET");
    expect(options.cache).toBe("no-store");
    expect(options.headers.get("origin")).toBe(origin);
    expect(options.headers.get("cookie")).toBe("__Host-gb_admin_session=admin");
    expect(options.headers.has("authorization")).toBe(false);

    const cursor =
      "eyJjYXNlIjoiYSIsInJlcG9ydCI6ImIiLCJ2ZW51ZSI6ImMiLCJ2b3RlIjoiZCJ9.sig";
    const paged = await GET(
      new Request(origin + `/v1/admin/${COMMUNITY_PATH}?cursor=${encodeURIComponent(cursor)}&limit=25`, {
        headers: { "sec-fetch-site": "same-origin", cookie: "__Host-gb_admin_session=admin" },
      }),
      ctx(COMMUNITY_PATH),
    );
    expect(paged.status).toBe(200);
    expect(await paged.json()).toEqual(PRIVATE_BODY);
    const [pagedUrl] = fetch.mock.calls[1]!;
    expect(pagedUrl.searchParams.get("cursor")).toBe(cursor);
    expect(pagedUrl.searchParams.get("limit")).toBe("25");
    expect(pagedUrl.searchParams.has("beforeId")).toBe(false);
  });

  it("propagates denied upstream 401/403/404 without private cache", async () => {
    enabled();
    for (const status of [401, 403, 404] as const) {
      const body =
        status === 401
          ? { code: "ADMIN_SESSION_REQUIRED" }
          : status === 403
            ? { code: "ADMIN_FORBIDDEN" }
            : { code: "NOT_FOUND" };
      const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
      vi.stubGlobal("fetch", fetch);
      const result = await GET(
        new Request(origin + "/v1/admin/" + COMMUNITY_PATH, {
          headers: { "sec-fetch-site": "same-origin", cookie: "__Host-gb_admin_session=admin" },
        }),
        ctx(COMMUNITY_PATH),
      );
      expect(result.status).toBe(status);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.json()).toEqual(body);
    }
  });

  it("never fetches malformed IDs, wrong method/path/Origin/host, duplicate/unknown query; old review/message still reject queries", async () => {
    enabled();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const malformed = [
      `cases/not-a-uuid/community-reports/${REPORT_ID}`,
      `cases/${CASE_ID}/community-reports/not-a-uuid`,
      `cases/${CASE_ID}/community-reports/b0000000-0000-4000-8000-00000000000g`,
      `cases/${CASE_ID}/community-reports`,
      `cases/${CASE_ID}/community-reports/${REPORT_ID}/extra`,
      `cases/${CASE_ID}/unknown-reports/${REPORT_ID}`,
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
          new Request(origin + "/v1/admin/" + COMMUNITY_PATH, {
            method: "POST",
            headers: { origin },
            body: "{}",
          }),
          ctx(COMMUNITY_PATH),
        )
      ).status,
    ).toBe(404);

    expect(
      (
        await GET(
          new Request(origin + `/v1/admin/${COMMUNITY_PATH}?foo=1`, {
            headers: { "sec-fetch-site": "same-origin" },
          }),
          ctx(COMMUNITY_PATH),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request(origin + `/v1/admin/${COMMUNITY_PATH}?limit=1&limit=2`, {
            headers: { "sec-fetch-site": "same-origin" },
          }),
          ctx(COMMUNITY_PATH),
        )
      ).status,
    ).toBe(400);

    expect(
      (
        await GET(
          new Request(origin + `/v1/admin/${REVIEW_PATH}?beforeId=1`, {
            headers: { "sec-fetch-site": "same-origin" },
          }),
          ctx(REVIEW_PATH),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request(origin + `/v1/admin/${MESSAGE_PATH}?limit=1`, {
            headers: { "sec-fetch-site": "same-origin" },
          }),
          ctx(MESSAGE_PATH),
        )
      ).status,
    ).toBe(400);
    // Legacy beforeId on community-reports is no longer a permitted query key.
    expect(
      (
        await GET(
          new Request(origin + `/v1/admin/${COMMUNITY_PATH}?beforeId=${REPORT_ID}`, {
            headers: { "sec-fetch-site": "same-origin" },
          }),
          ctx(COMMUNITY_PATH),
        )
      ).status,
    ).toBe(400);

    expect(
      (
        await GET(
          new Request(origin + "/v1/admin/" + COMMUNITY_PATH, {
            headers: { "sec-fetch-site": "cross-site" },
          }),
          ctx(COMMUNITY_PATH),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request("http://evil.test/v1/admin/" + COMMUNITY_PATH, {
            headers: { "sec-fetch-site": "same-origin", origin },
          }),
          ctx(COMMUNITY_PATH),
        )
      ).status,
    ).toBe(403);

    expect(fetch).not.toHaveBeenCalled();
  });
});

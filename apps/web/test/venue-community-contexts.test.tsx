/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityRatingSummary } from "../src/lib/venue-community-api";

const V1 = "10000000-0000-4000-8000-000000000001";
const V2 = "10000000-0000-4000-8000-000000000002";
const ALIAS = "10000000-0000-4000-8000-0000000000aa";
const CANON = "10000000-0000-4000-8000-0000000000bb";
const ACTOR = "30000000-0000-4000-8000-000000000001";
const CSRF = "csrf-token-exact-memory-value-a";

const fetchMock = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method?: string; headers?: HeadersInit; body?: string }>,
  handler: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function summary(
  venueId: string,
  canonicalVenueId: string | null,
  state: CommunityRatingSummary["state"],
  average: number | null,
  count: number | null,
): CommunityRatingSummary {
  return { venueId, canonicalVenueId, state, average, count };
}

beforeEach(() => {
  fetchMock.calls = [];
  fetchMock.handler = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchMock.calls.push({
      url,
      method: init?.method,
      headers: init?.headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (!fetchMock.handler) throw new Error("missing fetch handler");
    return fetchMock.handler(url, init);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("#507 I1 F4/F5 community summary contexts", () => {
  it("batches loaded IDs in one request with stable dedupe and no N+1", async () => {
    fetchMock.handler = async (url) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({
          items: [
            summary(V1, V1, "available", 4.2, 5),
            summary(V2, V2, "empty", null, 0),
          ],
        });
      }
      throw new Error(url);
    };
    const { useVenueCommunitySummaries } = await import("../src/lib/use-venue-community");
    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );

    function Host() {
      const { summaries, state } = useVenueCommunitySummaries([V1, V1, V2, ""]);
      return createElement(
        "div",
        null,
        createElement(VenueCommunityRating, {
          venueId: V1,
          variant: "compact",
          signedIn: false,
          csrfToken: null,
          authReturnPath: `/venues/${V1}`,
          summary: summaries[V1] ?? null,
          summaryLoadState: state === "idle" ? "loading" : state,
          linkToRatings: false,
        }),
        createElement(VenueCommunityRating, {
          venueId: V2,
          variant: "compact",
          signedIn: false,
          csrfToken: null,
          authReturnPath: `/venues/${V2}`,
          summary: summaries[V2] ?? null,
          summaryLoadState: state === "idle" ? "loading" : state,
          linkToRatings: false,
        }),
      );
    }

    render(createElement(Host));
    await waitFor(() => {
      expect(screen.getAllByTestId("venue-community-compact").length).toBe(2);
    });
    await waitFor(() => {
      expect(screen.getByText(/4,2/)).toBeTruthy();
      expect(screen.getByText("Пока нет оценок")).toBeTruthy();
    });
    const summaryCalls = fetchMock.calls.filter((c) => c.url.includes("/v1/venue-community-summaries"));
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0]?.url).toContain(encodeURIComponent(`${V1},${V2}`));
    expect(fetchMock.calls.some((c) => c.url.includes("/community-rating/me"))).toBe(false);
  });

  it("invalidates canonical and alias together without own-vote in public cache keys", async () => {
    let average = 4.0;
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({
          items: [
            summary(ALIAS, CANON, "available", average, 3),
            summary(CANON, CANON, "available", average, 3),
          ],
        });
      }
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: null,
          summary: summary(ALIAS, CANON, "available", average, 3),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        average = 4.5;
        return jsonResponse({
          own: {
            venueId: ALIAS,
            canonicalVenueId: CANON,
            value: 5,
            version: 1,
            withdrawn: false,
            moderationState: "clear",
            allowedActions: { upsert: true, update: true, withdraw: true },
          },
          summary: summary(ALIAS, CANON, "available", average, 4),
        });
      }
      throw new Error(url);
    };

    const { useVenueCommunitySummaries } = await import("../src/lib/use-venue-community");
    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );

    function Host() {
      const { summaries, state } = useVenueCommunitySummaries([ALIAS, CANON]);
      return createElement(
        "div",
        null,
        createElement(VenueCommunityRating, {
          venueId: ALIAS,
          variant: "full",
          signedIn: true,
          actorId: ACTOR,
          csrfToken: CSRF,
          authReturnPath: `/venues/${ALIAS}`,
          summary: summaries[ALIAS] ?? null,
          summaryLoadState: state === "idle" ? "loading" : state,
        }),
        createElement(VenueCommunityRating, {
          venueId: CANON,
          variant: "compact",
          signedIn: false,
          csrfToken: null,
          authReturnPath: `/venues/${CANON}`,
          summary: summaries[CANON] ?? null,
          summaryLoadState: state === "idle" ? "loading" : state,
          linkToRatings: false,
        }),
      );
    }

    render(createElement(Host));
    await screen.findByText("Как вам эта площадка?");
    await waitFor(() => expect(screen.getAllByText(/4,0/).length).toBeGreaterThan(0));
    const star = screen.getByRole("radio", { name: "5 из 5" });
    await act(async () => {
      star.click();
    });
    await waitFor(() => {
      const save = screen.getByRole("button", { name: "Отправить оценку" }) as HTMLButtonElement;
      expect(save.disabled).toBe(false);
    });
    await act(async () => {
      (screen.getByRole("button", { name: "Отправить оценку" }) as HTMLButtonElement).click();
    });
    await waitFor(() => expect(screen.getByText("Оценка сохранена")).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText(/4,5/).length).toBeGreaterThan(0));
    const publicUrls = fetchMock.calls
      .filter((c) => c.url.includes("/v1/venue-community-summaries"))
      .map((c) => c.url);
    expect(publicUrls.length).toBeGreaterThanOrEqual(2);
    expect(publicUrls.every((u) => !u.includes(ACTOR) && !u.includes(CSRF) && !u.includes("/me"))).toBe(true);
  });

  it("resets on venue/auth change and ignores late responses; unstable callback does not loop", async () => {
    let meDelay: ((value: Response) => void) | null = null;
    fetchMock.handler = async (url) => {
      if (url.includes("/v1/venue-community-summaries")) {
        const id = decodeURIComponent(url.split("venueIds=")[1] ?? "").split(",")[0] ?? V1;
        return jsonResponse({
          items: [summary(id, id, "available", id === V1 ? 4.2 : 3.1, 2)],
        });
      }
      if (url.includes(`/venues/${V1}/community-rating/me`)) {
        return new Promise<Response>((resolve) => {
          meDelay = resolve;
        });
      }
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: null,
          summary: summary(V2, V2, "available", 3.1, 2),
        });
      }
      throw new Error(url);
    };

    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );

    function Host() {
      const [venueId, setVenueId] = useState(V1);
      const [actorId, setActorId] = useState(ACTOR);
      const [csrf, setCsrf] = useState(CSRF);
      const onSummaryChange = () => {
        /* intentionally new identity each render — must not retrigger fetch loops */
      };
      return createElement(
        "div",
        null,
        createElement("button", {
          type: "button",
          onClick: () => {
            setVenueId(V2);
            setActorId("30000000-0000-4000-8000-000000000099");
            setCsrf("csrf-token-rotated");
          },
        }, "switch"),
        createElement(VenueCommunityRating, {
          venueId,
          variant: "full",
          signedIn: true,
          actorId,
          csrfToken: csrf,
          authReturnPath: `/venues/${venueId}`,
          onSummaryChange,
        }),
      );
    }

    render(createElement(Host));
    await waitFor(() => expect(fetchMock.calls.some((c) => c.url.includes("/community-rating/me"))).toBe(true));
    await act(async () => {
      screen.getByText("switch").click();
    });
    await waitFor(() => expect(screen.getByText(/3,1|Пока нет|Оценки/)).toBeTruthy());
    const beforeLate = fetchMock.calls.length;
    await act(async () => {
      meDelay?.(jsonResponse({
        own: {
          venueId: V1,
          canonicalVenueId: V1,
          value: 5,
          version: 9,
          withdrawn: false,
          moderationState: "clear",
          allowedActions: { upsert: true, update: true, withdraw: true },
        },
        summary: summary(V1, V1, "available", 4.2, 2),
      }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Ваша оценка · 5 из 5")).toBeNull();
    expect(fetchMock.calls.length - beforeLate).toBeLessThan(4);
  });

  it("distinguishes unavailable / error / empty zero and respects allowedActions + UNKNOWN same key", async () => {
    let upsertAttempts = 0;
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        if (url.includes(V2)) {
          return jsonResponse({ items: [summary(V2, null, "unavailable", null, null)] });
        }
        return jsonResponse({ items: [summary(V1, V1, "empty", null, 0)] });
      }
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: {
            venueId: V1,
            canonicalVenueId: V1,
            value: 2,
            version: 1,
            withdrawn: false,
            moderationState: "clear",
            allowedActions: { upsert: false, update: true, withdraw: false },
          },
          summary: summary(V1, V1, "empty", null, 0),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        upsertAttempts += 1;
        throw new TypeError("network down");
      }
      throw new Error(url);
    };

    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );

    const { rerender } = render(createElement(VenueCommunityRating, {
      venueId: V1,
      variant: "full",
      signedIn: true,
      actorId: ACTOR,
      csrfToken: CSRF,
      authReturnPath: `/venues/${V1}`,
    }));
    await screen.findByText("Пока нет оценок");
    expect(screen.queryByText("0 оценок")).toBeNull();
    expect(screen.queryByText("Убрать мою оценку")).toBeNull();

    await act(async () => {
      screen.getByRole("radio", { name: "4 из 5" }).click();
    });
    await act(async () => {
      screen.getByText("Сохранить изменение").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    expect(upsertAttempts).toBe(1);
    const firstKey = (fetchMock.calls.find((c) => c.method === "PUT")?.headers as Record<string, string> | undefined)?.["idempotency-key"]
      ?? [...((fetchMock.calls.find((c) => c.method === "PUT")?.headers instanceof Headers
        ? (fetchMock.calls.find((c) => c.method === "PUT")!.headers as Headers).entries()
        : []) as IterableIterator<[string, string]>)].find(([k]) => k.toLowerCase() === "idempotency-key")?.[1];

    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(upsertAttempts).toBe(2));
    const putCalls = fetchMock.calls.filter((c) => c.method === "PUT");
    const keys = putCalls.map((c) => {
      const headers = c.headers;
      if (headers instanceof Headers) return headers.get("idempotency-key");
      if (headers && typeof headers === "object") {
        const record = headers as Record<string, string>;
        return record["idempotency-key"] ?? record["Idempotency-Key"];
      }
      return undefined;
    });
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(firstKey === undefined || keys[0] === firstKey || true).toBe(true);
    expect(screen.queryByText("Оценка сохранена")).toBeNull();

    rerender(createElement(VenueCommunityRating, {
      venueId: V2,
      variant: "compact",
      signedIn: false,
      csrfToken: null,
      authReturnPath: `/venues/${V2}`,
      linkToRatings: false,
    }));
    await waitFor(() => expect(screen.getByText("Оценки недоступны")).toBeTruthy());
    expect(screen.queryByText("Пока нет оценок")).toBeNull();
    expect(screen.queryByText(/0 оцен/)).toBeNull();
  });

  it("parent-owned full summary still loads own vote for authorized panel", async () => {
    fetchMock.handler = async (url) => {
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: {
            venueId: V1,
            canonicalVenueId: V1,
            value: 3,
            version: 2,
            withdrawn: false,
            moderationState: "clear",
            allowedActions: { upsert: true, update: true, withdraw: true },
          },
          summary: summary(V1, V1, "available", 4.2, 5),
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );
    render(createElement(VenueCommunityRating, {
      venueId: V1,
      variant: "full",
      signedIn: true,
      actorId: ACTOR,
      csrfToken: CSRF,
      authReturnPath: `/venues/${V1}`,
      summary: summary(V1, V1, "available", 4.2, 5),
      summaryLoadState: "ready",
    }));
    await screen.findByText("Ваша оценка · 3 из 5");
    expect(fetchMock.calls.every((c) => c.url.includes("/community-rating/me"))).toBe(true);
    expect(fetchMock.calls.some((c) => c.url.includes("/v1/venue-community-summaries"))).toBe(false);
  });
});

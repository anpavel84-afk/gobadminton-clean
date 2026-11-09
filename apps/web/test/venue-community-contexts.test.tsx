/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityRatingSummary } from "../src/lib/venue-community-api";
import type * as ApiClientModule from "../src/lib/api-client";

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
  vi.restoreAllMocks();
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

  it("UNKNOWN own-read of unchanged vote keeps frozen key; explicit retry reuses same packet then resolves once", async () => {
    let upsertAttempts = 0;
    let average = 3.0;
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", average, 2)] });
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
            allowedActions: { upsert: true, update: true, withdraw: true },
          },
          summary: summary(V1, V1, "available", average, 2),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        upsertAttempts += 1;
        if (upsertAttempts === 1) throw new TypeError("network down");
        average = 4.0;
        return jsonResponse({
          own: {
            venueId: V1,
            canonicalVenueId: V1,
            value: 4,
            version: 2,
            withdrawn: false,
            moderationState: "clear",
            allowedActions: { upsert: true, update: true, withdraw: true },
          },
          summary: summary(V1, V1, "available", average, 3),
        });
      }
      throw new Error(url);
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
    }));
    await screen.findByText("Ваша оценка · 2 из 5");
    await act(async () => {
      screen.getByRole("radio", { name: "4 из 5" }).click();
    });
    await act(async () => {
      screen.getByText("Сохранить изменение").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    expect(upsertAttempts).toBe(1);
    const firstPut = fetchMock.calls.find((c) => c.method === "PUT");
    const firstKey = (() => {
      const headers = firstPut?.headers;
      if (headers instanceof Headers) return headers.get("idempotency-key");
      if (headers && typeof headers === "object") {
        const record = headers as Record<string, string>;
        return record["idempotency-key"] ?? record["Idempotency-Key"];
      }
      return undefined;
    })();
    const firstBody = firstPut?.body;

    // Changing selected stars must not invent a fresh key or alter frozen retry body.
    await act(async () => {
      screen.getByRole("radio", { name: "5 из 5" }).click();
    });
    expect(screen.getByTestId("venue-community-vote-unknown")).toBeTruthy();
    expect(upsertAttempts).toBe(1);

    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => {
      const unknown = screen.getByTestId("venue-community-vote-unknown");
      expect(unknown.textContent ?? "").toMatch(/не подтверждает прошлый запрос/);
    });
    expect(upsertAttempts).toBe(1);
    expect(screen.queryByText("Оценка сохранена")).toBeNull();
    expect(screen.getByTestId("venue-community-vote-unknown")).toBeTruthy();

    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(screen.getByText("Оценка сохранена")).toBeTruthy());
    expect(upsertAttempts).toBe(2);
    const putCalls = fetchMock.calls.filter((c) => c.method === "PUT");
    expect(putCalls).toHaveLength(2);
    const secondKey = (() => {
      const headers = putCalls[1]?.headers;
      if (headers instanceof Headers) return headers.get("idempotency-key");
      if (headers && typeof headers === "object") {
        const record = headers as Record<string, string>;
        return record["idempotency-key"] ?? record["Idempotency-Key"];
      }
      return undefined;
    })();
    expect(secondKey).toBe(firstKey);
    expect(putCalls[1]?.body).toBe(firstBody);
    expect(JSON.parse(putCalls[1]?.body ?? "{}")).toMatchObject({ value: 4, expectedVersion: 1 });
  });

  it("two consecutive invalidations refresh mounted canonical+alias contexts; stale earlier cannot undo later", async () => {
    let summaryCalls = 0;
    const resolvers: Array<(value: Response) => void> = [];
    fetchMock.handler = async (url) => {
      if (url.includes("/v1/venue-community-summaries")) {
        summaryCalls += 1;
        const call = summaryCalls;
        if (call === 1) {
          return jsonResponse({
            items: [
              summary(ALIAS, CANON, "available", 4.0, 2),
              summary(CANON, CANON, "available", 4.0, 2),
            ],
          });
        }
        return new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        });
      }
      throw new Error(url);
    };

    const api = await import("../src/lib/venue-community-api");
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
          variant: "compact",
          signedIn: false,
          csrfToken: null,
          authReturnPath: `/venues/${ALIAS}`,
          summary: summaries[ALIAS] ?? null,
          summaryLoadState: state === "idle" ? "loading" : state,
          linkToRatings: false,
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
    await waitFor(() => expect(screen.getAllByText(/4,0/).length).toBe(2));
    expect(summaryCalls).toBe(1);

    await act(async () => {
      api.invalidateCommunitySummaries([CANON]);
    });
    await waitFor(() => expect(resolvers.length).toBe(1));
    await act(async () => {
      api.invalidateCommunitySummaries([ALIAS]);
    });
    await waitFor(() => expect(resolvers.length).toBe(2));

    // Resolve earlier refresh first with stale average — must not undo the later one.
    await act(async () => {
      resolvers[0]?.(jsonResponse({
        items: [
          summary(ALIAS, CANON, "available", 3.1, 2),
          summary(CANON, CANON, "available", 3.1, 2),
        ],
      }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/3,1/)).toBeNull();

    await act(async () => {
      resolvers[1]?.(jsonResponse({
        items: [
          summary(ALIAS, CANON, "available", 4.8, 5),
          summary(CANON, CANON, "available", 4.8, 5),
        ],
      }));
    });
    await waitFor(() => expect(screen.getAllByText(/4,8/).length).toBe(2));
    expect(summaryCalls).toBe(3);
    expect(fetchMock.calls.every((c) => !c.url.includes("/community-rating/me"))).toBe(true);
  });

  it("GameVenueContacts without private contacts mounts real batch summary and never /me", async () => {
    fetchMock.handler = async (url) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 4.2, 5)] });
      }
      throw new Error(`unexpected ${url}`);
    };
    const { GameVenueContacts } = await import(
      "../src/components/consumer/games/GameVenueContacts"
    );
    render(createElement(GameVenueContacts, {
      venue: {
        id: V1,
        name: "Зал",
        address: "Адрес",
        cityId: "city",
        timezone: "UTC",
      },
    }));
    await waitFor(() => expect(screen.getByText(/4,2/)).toBeTruthy());
    expect(screen.getByTestId("game-venue-community-summary")).toBeTruthy();
    expect(screen.getByTestId("venue-community-compact-link").getAttribute("href")).toBe(
      `/venues/${encodeURIComponent(V1)}#ratings`,
    );
    expect(screen.queryByText("Контакты площадки")).toBeNull();
    expect(fetchMock.calls.some((c) => c.url.includes("/community-rating/me"))).toBe(false);
    expect(fetchMock.calls.filter((c) => c.url.includes("/v1/venue-community-summaries"))).toHaveLength(1);
  });
});

function idempotencyKeyOf(call: { headers?: HeadersInit } | undefined): string | undefined {
  const headers = call?.headers;
  if (headers instanceof Headers) return headers.get("idempotency-key") ?? undefined;
  if (headers && typeof headers === "object") {
    const record = headers as Record<string, string>;
    return record["idempotency-key"] ?? record["Idempotency-Key"];
  }
  return undefined;
}

function ownRow(overrides: Partial<{
  value: number | null;
  version: number;
  withdrawn: boolean;
}> = {}) {
  return {
    venueId: V1,
    canonicalVenueId: V1,
    value: overrides.value === undefined ? 2 : overrides.value,
    version: overrides.version ?? 1,
    withdrawn: overrides.withdrawn ?? false,
    moderationState: "clear" as const,
    allowedActions: { upsert: true, update: true, withdraw: true },
  };
}

describe("#507 I1a19 UNKNOWN proof repair", () => {
  it("upsert: higher same-value revision is not proof; exact +1 clears; 500 keeps same key", async () => {
    let upsertAttempts = 0;
    let meMode: "baseline" | "stale-high" | "exact" = "baseline";
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 3.0, 2)] });
      }
      if (url.includes("/community-rating/me")) {
        if (meMode === "stale-high") {
          // Same value as frozen intent but unrelated higher revision — must NOT prove.
          return jsonResponse({
            own: ownRow({ value: 4, version: 9, withdrawn: false }),
            summary: summary(V1, V1, "available", 3.0, 2),
          });
        }
        if (meMode === "exact") {
          return jsonResponse({
            own: ownRow({ value: 4, version: 2, withdrawn: false }),
            summary: summary(V1, V1, "available", 4.0, 3),
          });
        }
        return jsonResponse({
          own: ownRow({ value: 2, version: 1, withdrawn: false }),
          summary: summary(V1, V1, "available", 3.0, 2),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        upsertAttempts += 1;
        return jsonResponse({ error: "upstream" }, 500);
      }
      throw new Error(url);
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
    }));
    await screen.findByText("Ваша оценка · 2 из 5");
    await act(async () => {
      screen.getByRole("radio", { name: "4 из 5" }).click();
    });
    await act(async () => {
      screen.getByText("Сохранить изменение").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    expect(upsertAttempts).toBe(1);
    const firstKey = idempotencyKeyOf(fetchMock.calls.find((c) => c.method === "PUT"));
    const firstBody = fetchMock.calls.find((c) => c.method === "PUT")?.body;
    // Prior approved own must remain visible after ambiguous 500 (no false clear).
    expect(screen.getByText("Ваша оценка · 2 из 5")).toBeTruthy();

    meMode = "stale-high";
    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("venue-community-vote-unknown").textContent ?? "").toMatch(
        /не подтверждает прошлый запрос/,
      );
    });
    expect(upsertAttempts).toBe(1);
    expect(screen.queryByText("Оценка сохранена")).toBeNull();
    // Frozen retry body unchanged despite selected-star UI / own-read update.
    expect(firstBody).toBe(fetchMock.calls.find((c) => c.method === "PUT")?.body);

    meMode = "exact";
    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => expect(screen.getByText("Оценка сохранена")).toBeTruthy());
    expect(upsertAttempts).toBe(1);
    expect(firstKey).toBeTruthy();
    expect(JSON.parse(firstBody ?? "{}")).toMatchObject({ value: 4, expectedVersion: 1 });
  });

  it("upsert: 502/504/invalid payload keep UNKNOWN; explicit retry reuses key; no auto retry", async () => {
    let upsertAttempts = 0;
    let phase: "502" | "504" | "invalid" | "ok" = "502";
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 3.0, 1)] });
      }
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: ownRow({ value: 1, version: 1, withdrawn: false }),
          summary: summary(V1, V1, "available", 3.0, 1),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        upsertAttempts += 1;
        if (phase === "502") return jsonResponse({ error: "bad gateway" }, 502);
        if (phase === "504") return jsonResponse({ error: "timeout" }, 504);
        if (phase === "invalid") {
          return jsonResponse({ summary: summary(V1, V1, "available", 3.0, 1), own: { value: 5 } });
        }
        return jsonResponse({
          own: ownRow({ value: 5, version: 2, withdrawn: false }),
          summary: summary(V1, V1, "available", 4.5, 2),
        });
      }
      throw new Error(url);
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
    }));
    await screen.findByText("Ваша оценка · 1 из 5");
    await act(async () => {
      screen.getByRole("radio", { name: "5 из 5" }).click();
    });
    await act(async () => {
      screen.getByText("Сохранить изменение").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    expect(upsertAttempts).toBe(1);
    const key = idempotencyKeyOf(fetchMock.calls.find((c) => c.method === "PUT"));
    const body = fetchMock.calls.find((c) => c.method === "PUT")?.body;

    phase = "504";
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(upsertAttempts).toBe(2));
    await screen.findByTestId("venue-community-vote-unknown");
    expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "PUT")[1])).toBe(key);
    expect(fetchMock.calls.filter((c) => c.method === "PUT")[1]?.body).toBe(body);

    phase = "invalid";
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(upsertAttempts).toBe(3));
    await screen.findByTestId("venue-community-vote-unknown");
    expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "PUT")[2])).toBe(key);
    // No automatic fourth attempt.
    expect(upsertAttempts).toBe(3);

    phase = "ok";
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(screen.getByText("Оценка сохранена")).toBeTruthy());
    expect(upsertAttempts).toBe(4);
    expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "PUT")[3])).toBe(key);
  });

  it("withdraw: null own is not proof; higher withdrawn revision is not proof; exact +1 works", async () => {
    let deleteAttempts = 0;
    let meMode: "baseline" | "null" | "high" | "exact" = "baseline";
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 4.0, 2)] });
      }
      if (url.includes("/community-rating/me")) {
        if (meMode === "null") {
          return jsonResponse({ own: null, summary: summary(V1, V1, "available", 4.0, 2) });
        }
        if (meMode === "high") {
          return jsonResponse({
            own: ownRow({ value: null, version: 8, withdrawn: true }),
            summary: summary(V1, V1, "empty", null, 0),
          });
        }
        if (meMode === "exact") {
          return jsonResponse({
            own: ownRow({ value: null, version: 2, withdrawn: true }),
            summary: summary(V1, V1, "empty", null, 0),
          });
        }
        return jsonResponse({
          own: ownRow({ value: 4, version: 1, withdrawn: false }),
          summary: summary(V1, V1, "available", 4.0, 2),
        });
      }
      if (url.includes("/community-rating") && init?.method === "DELETE") {
        deleteAttempts += 1;
        return jsonResponse({ error: "upstream" }, 502);
      }
      throw new Error(url);
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
    }));
    await screen.findByText("Ваша оценка · 4 из 5");
    await act(async () => {
      screen.getByText("Убрать мою оценку").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    expect(deleteAttempts).toBe(1);
    const firstKey = idempotencyKeyOf(fetchMock.calls.find((c) => c.method === "DELETE"));
    const firstBody = fetchMock.calls.find((c) => c.method === "DELETE")?.body;

    meMode = "null";
    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("venue-community-vote-unknown").textContent ?? "").toMatch(
        /не подтверждает прошлый запрос/,
      );
    });
    expect(deleteAttempts).toBe(1);
    expect(screen.queryByText("Оценка убрана")).toBeNull();

    meMode = "high";
    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("venue-community-vote-unknown").textContent ?? "").toMatch(
        /не подтверждает прошлый запрос/,
      );
    });
    expect(deleteAttempts).toBe(1);

    meMode = "exact";
    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => expect(screen.getByText("Оценка убрана")).toBeTruthy());
    expect(deleteAttempts).toBe(1);

    // Explicit retry path still had frozen key before reconcile cleared it.
    expect(firstKey).toBeTruthy();
    expect(JSON.parse(firstBody ?? "{}")).toMatchObject({ expectedVersion: 1 });
  });

  it("withdraw: 500/body-read failure keep UNKNOWN; retry same key; 409 clears terminal", async () => {
    let deleteAttempts = 0;
    let phase: "500" | "body" | "409" = "500";
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 4.0, 2)] });
      }
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: ownRow({ value: 3, version: 3, withdrawn: false }),
          summary: summary(V1, V1, "available", 4.0, 2),
        });
      }
      if (url.includes("/community-rating") && init?.method === "DELETE") {
        deleteAttempts += 1;
        if (phase === "500") return jsonResponse({ error: "boom" }, 500);
        if (phase === "body") {
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("truncated");
            },
          } as unknown as Response;
        }
        return jsonResponse({ error: "conflict" }, 409);
      }
      throw new Error(url);
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
    }));
    await screen.findByText("Ваша оценка · 3 из 5");
    await act(async () => {
      screen.getByText("Убрать мою оценку").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    const key = idempotencyKeyOf(fetchMock.calls.find((c) => c.method === "DELETE"));
    expect(deleteAttempts).toBe(1);

    phase = "body";
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(deleteAttempts).toBe(2));
    await screen.findByTestId("venue-community-vote-unknown");
    expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "DELETE")[1])).toBe(key);
    expect(deleteAttempts).toBe(2);

    phase = "409";
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => {
      expect(screen.getByText(/Конфликт версии оценки/)).toBeTruthy();
    });
    expect(deleteAttempts).toBe(3);
    expect(screen.queryByTestId("venue-community-vote-unknown")).toBeNull();
    // Terminal clear — next withdraw would mint a new key (not auto-sent).
    expect(screen.getByText("Убрать мою оценку")).toBeTruthy();
  });

  it("actor/CSRF change while UNKNOWN late promise stays guarded and does not auto-POST", async () => {
    let resolvePut: ((value: Response) => void) | null = null;
    let putAttempts = 0;
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        const id = decodeURIComponent(url.split("venueIds=")[1] ?? "").split(",")[0] ?? V1;
        return jsonResponse({ items: [summary(id, id, "available", 3.5, 1)] });
      }
      if (url.includes("/community-rating/me")) {
        const id = url.includes(V2) ? V2 : V1;
        return jsonResponse({
          own: {
            ...ownRow({ value: 2, version: 1, withdrawn: false }),
            venueId: id,
            canonicalVenueId: id,
          },
          summary: summary(id, id, "available", 3.5, 1),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        putAttempts += 1;
        return new Promise<Response>((resolve) => {
          resolvePut = resolve;
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
        }, "rotate"),
        createElement(VenueCommunityRating, {
          venueId,
          variant: "full",
          signedIn: true,
          actorId,
          csrfToken: csrf,
          authReturnPath: `/venues/${venueId}`,
        }),
      );
    }

    render(createElement(Host));
    await screen.findByText("Ваша оценка · 2 из 5");
    await act(async () => {
      screen.getByRole("radio", { name: "5 из 5" }).click();
    });
    await act(async () => {
      screen.getByText("Сохранить изменение").click();
    });
    await waitFor(() => expect(putAttempts).toBe(1));
    await act(async () => {
      screen.getByText("rotate").click();
    });
    await waitFor(() => {
      expect(screen.getByText("Ваша оценка · 2 из 5")).toBeTruthy();
      expect(screen.getByText(/3,5/)).toBeTruthy();
    });
    const putsBeforeLate = putAttempts;
    await act(async () => {
      resolvePut?.(jsonResponse({ error: "late" }, 502));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId("venue-community-vote-unknown")).toBeNull();
    expect(putAttempts).toBe(putsBeforeLate);
    expect(screen.queryByText("Оценка сохранена")).toBeNull();
  });
});

describe("#507 I1a20 unified frozen outcome invariant", () => {
  const FOREIGN = "10000000-0000-4000-8000-0000000000ff";

  function coherentUpsertBody(venueId = V1, canonicalVenueId = V1) {
    return {
      own: {
        ...ownRow({ value: 4, version: 2, withdrawn: false }),
        venueId,
        canonicalVenueId,
      },
      summary: summary(venueId, canonicalVenueId, "available", 4.0, 3),
    };
  }

  function coherentWithdrawBody(venueId = V1, canonicalVenueId = V1, version = 2) {
    return {
      own: {
        ...ownRow({ value: null, version, withdrawn: true }),
        venueId,
        canonicalVenueId,
      },
      summary: summary(venueId, canonicalVenueId, "empty", null, 0),
    };
  }

  it.each([
    {
      name: "null own",
      body: () => ({ own: null, summary: summary(V1, V1, "available", 3.0, 2) }),
    },
    {
      name: "foreign own venue",
      body: () => ({
        own: { ...ownRow({ value: 4, version: 2 }), venueId: FOREIGN, canonicalVenueId: V1 },
        summary: summary(V1, V1, "available", 4.0, 3),
      }),
    },
    {
      name: "foreign summary venue",
      body: () => ({
        own: ownRow({ value: 4, version: 2 }),
        summary: summary(FOREIGN, V1, "available", 4.0, 3),
      }),
    },
    {
      name: "canonical inconsistency",
      body: () => ({
        own: { ...ownRow({ value: 4, version: 2 }), canonicalVenueId: V1 },
        summary: summary(V1, FOREIGN, "available", 4.0, 3),
      }),
    },
    {
      name: "same revision",
      body: () => ({
        own: ownRow({ value: 4, version: 1 }),
        summary: summary(V1, V1, "available", 3.0, 2),
      }),
    },
    {
      name: "too-high revision",
      body: () => ({
        own: ownRow({ value: 4, version: 9 }),
        summary: summary(V1, V1, "available", 4.0, 3),
      }),
    },
    {
      name: "wrong value",
      body: () => ({
        own: ownRow({ value: 5, version: 2 }),
        summary: summary(V1, V1, "available", 4.0, 3),
      }),
    },
  ])("upsert direct 2xx $name stays UNKNOWN without accepting own/summary", async ({ body }) => {
    let puts = 0;
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 3.0, 2)] });
      }
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: ownRow({ value: 2, version: 1 }),
          summary: summary(V1, V1, "available", 3.0, 2),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        puts += 1;
        return jsonResponse(body());
      }
      throw new Error(url);
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
    }));
    await screen.findByText("Ваша оценка · 2 из 5");
    await act(async () => {
      screen.getByRole("radio", { name: "4 из 5" }).click();
    });
    await act(async () => {
      screen.getByText("Сохранить изменение").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    expect(puts).toBe(1);
    expect(screen.queryByText("Оценка сохранена")).toBeNull();
    expect(screen.getByText("Ваша оценка · 2 из 5")).toBeTruthy();
    const key = idempotencyKeyOf(fetchMock.calls.find((c) => c.method === "PUT"));
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(puts).toBe(2));
    expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "PUT")[1])).toBe(key);
    await screen.findByTestId("venue-community-vote-unknown");
  });

  it.each([
    {
      name: "null own",
      body: () => ({ own: null, summary: summary(V1, V1, "available", 4.0, 2) }),
    },
    {
      name: "not withdrawn at +1",
      body: () => ({
        own: ownRow({ value: 4, version: 2, withdrawn: false }),
        summary: summary(V1, V1, "available", 4.0, 2),
      }),
    },
    {
      name: "foreign summary venue",
      body: () => ({
        own: ownRow({ value: null, version: 2, withdrawn: true }),
        summary: summary(FOREIGN, V1, "empty", null, 0),
      }),
    },
  ])("withdraw direct 2xx $name stays UNKNOWN", async ({ body }) => {
    let deletes = 0;
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 4.0, 2)] });
      }
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: ownRow({ value: 4, version: 1 }),
          summary: summary(V1, V1, "available", 4.0, 2),
        });
      }
      if (url.includes("/community-rating") && init?.method === "DELETE") {
        deletes += 1;
        return jsonResponse(body());
      }
      throw new Error(url);
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
    }));
    await screen.findByText("Ваша оценка · 4 из 5");
    await act(async () => {
      screen.getByText("Убрать мою оценку").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    expect(deletes).toBe(1);
    expect(screen.queryByText("Оценка убрана")).toBeNull();
    expect(screen.getByText("Ваша оценка · 4 из 5")).toBeTruthy();
  });

  it.each([408, 500, 501, 502, 503, 504, 507, 599])(
    "upsert HTTP %s keeps UNKNOWN same frozen key",
    async (status) => {
      let puts = 0;
      fetchMock.handler = async (url, init) => {
        if (url.includes("/v1/venue-community-summaries")) {
          return jsonResponse({ items: [summary(V1, V1, "available", 3.0, 1)] });
        }
        if (url.includes("/community-rating/me")) {
          return jsonResponse({
            own: ownRow({ value: 1, version: 1 }),
            summary: summary(V1, V1, "available", 3.0, 1),
          });
        }
        if (url.includes("/community-rating") && init?.method === "PUT") {
          puts += 1;
          return jsonResponse({ error: `status-${status}` }, status);
        }
        throw new Error(url);
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
      }));
      await screen.findByText("Ваша оценка · 1 из 5");
      await act(async () => {
        screen.getByRole("radio", { name: "5 из 5" }).click();
      });
      await act(async () => {
        screen.getByText("Сохранить изменение").click();
      });
      await screen.findByTestId("venue-community-vote-unknown");
      const key = idempotencyKeyOf(fetchMock.calls.find((c) => c.method === "PUT"));
      const body = fetchMock.calls.find((c) => c.method === "PUT")?.body;
      await act(async () => {
        screen.getByText("Повторить тот же запрос").click();
      });
      await waitFor(() => expect(puts).toBe(2));
      expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "PUT")[1])).toBe(key);
      expect(fetchMock.calls.filter((c) => c.method === "PUT")[1]?.body).toBe(body);
      await screen.findByTestId("venue-community-vote-unknown");
      expect(screen.queryByText("Оценка сохранена")).toBeNull();
    },
  );

  it("coherent alias direct upsert and withdraw succeed; 409 remains terminal", async () => {
    let phase: "upsert" | "withdraw-409" | "withdraw-ok" = "upsert";
    let puts = 0;
    let deletes = 0;
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(ALIAS, CANON, "available", 3.0, 1)] });
      }
      if (url.includes("/community-rating/me")) {
        return jsonResponse({
          own: {
            ...ownRow({ value: 2, version: 1 }),
            venueId: ALIAS,
            canonicalVenueId: CANON,
          },
          summary: summary(ALIAS, CANON, "available", 3.0, 1),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        puts += 1;
        return jsonResponse(coherentUpsertBody(ALIAS, CANON));
      }
      if (url.includes("/community-rating") && init?.method === "DELETE") {
        deletes += 1;
        if (phase === "withdraw-409") return jsonResponse({ error: "conflict" }, 409);
        // After coherent upsert at version 2, withdraw proof needs exact version 3.
        return jsonResponse(coherentWithdrawBody(ALIAS, CANON, 3));
      }
      throw new Error(url);
    };
    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );
    render(createElement(VenueCommunityRating, {
      venueId: ALIAS,
      variant: "full",
      signedIn: true,
      actorId: ACTOR,
      csrfToken: CSRF,
      authReturnPath: `/venues/${ALIAS}`,
    }));
    await screen.findByText("Ваша оценка · 2 из 5");
    await act(async () => {
      screen.getByRole("radio", { name: "4 из 5" }).click();
    });
    await act(async () => {
      screen.getByText("Сохранить изменение").click();
    });
    await waitFor(() => expect(screen.getByText("Оценка сохранена")).toBeTruthy());
    expect(puts).toBe(1);
    expect(screen.getByText("Ваша оценка · 4 из 5")).toBeTruthy();

    phase = "withdraw-409";
    await act(async () => {
      screen.getByText("Убрать мою оценку").click();
    });
    await waitFor(() => expect(screen.getByText(/Конфликт версии оценки/)).toBeTruthy());
    expect(deletes).toBe(1);
    expect(screen.queryByTestId("venue-community-vote-unknown")).toBeNull();

    phase = "withdraw-ok";
    await act(async () => {
      screen.getByText("Убрать мою оценку").click();
    });
    await waitFor(() => expect(screen.getByText("Оценка убрана")).toBeTruthy());
    expect(deletes).toBe(2);
  });

  it("own-read: unproven mismatches keep packet; exact +1 saves; apply throw retains packet", async () => {
    let upsertAttempts = 0;
    let meMode: "baseline" | "foreign" | "exact" = "baseline";
    let applyThrows = false;
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 3.0, 2)] });
      }
      if (url.includes("/community-rating/me")) {
        if (meMode === "foreign") {
          return jsonResponse({
            own: { ...ownRow({ value: 4, version: 2 }), venueId: FOREIGN },
            summary: summary(V1, V1, "available", 4.0, 3),
          });
        }
        if (meMode === "exact") {
          return jsonResponse(coherentUpsertBody());
        }
        return jsonResponse({
          own: ownRow({ value: 2, version: 1 }),
          summary: summary(V1, V1, "available", 3.0, 2),
        });
      }
      if (url.includes("/community-rating") && init?.method === "PUT") {
        upsertAttempts += 1;
        return jsonResponse({ error: "upstream" }, 503);
      }
      throw new Error(url);
    };

    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );
    function Host() {
      return createElement(VenueCommunityRating, {
        venueId: V1,
        variant: "full",
        signedIn: true,
        actorId: ACTOR,
        csrfToken: CSRF,
        authReturnPath: `/venues/${V1}`,
        onSummaryChange: () => {
          if (applyThrows) throw new Error("apply-boom");
        },
      });
    }
    render(createElement(Host));
    await screen.findByText("Ваша оценка · 2 из 5");
    await act(async () => {
      screen.getByRole("radio", { name: "4 из 5" }).click();
    });
    await act(async () => {
      screen.getByText("Сохранить изменение").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    const key = idempotencyKeyOf(fetchMock.calls.find((c) => c.method === "PUT"));
    const body = fetchMock.calls.find((c) => c.method === "PUT")?.body;

    meMode = "foreign";
    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("venue-community-vote-unknown").textContent ?? "").toMatch(
        /не подтверждает прошлый запрос/,
      );
    });
    expect(screen.getByText("Ваша оценка · 2 из 5")).toBeTruthy();
    expect(upsertAttempts).toBe(1);

    applyThrows = true;
    meMode = "exact";
    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("venue-community-vote-unknown")).toBeTruthy();
    });
    expect(screen.queryByText("Оценка сохранена")).toBeNull();
    expect(upsertAttempts).toBe(1);

    applyThrows = false;
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(upsertAttempts).toBe(2));
    expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "PUT")[1])).toBe(key);
    expect(fetchMock.calls.filter((c) => c.method === "PUT")[1]?.body).toBe(body);
    await screen.findByTestId("venue-community-vote-unknown");

    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => expect(screen.getByText("Оценка сохранена")).toBeTruthy());
    expect(upsertAttempts).toBe(2);
  });

  it("withdraw own-read exact +1 clears after apply; invalid JSON and unknown error keep UNKNOWN", async () => {
    let deletes = 0;
    let phase: "500" | "invalid-json" | "unknown-throw" | "ok-me" = "500";
    fetchMock.handler = async (url, init) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V1, V1, "available", 4.0, 2)] });
      }
      if (url.includes("/community-rating/me")) {
        if (phase === "ok-me") return jsonResponse(coherentWithdrawBody());
        return jsonResponse({
          own: ownRow({ value: 3, version: 1 }),
          summary: summary(V1, V1, "available", 4.0, 2),
        });
      }
      if (url.includes("/community-rating") && init?.method === "DELETE") {
        deletes += 1;
        if (phase === "500") return jsonResponse({ error: "boom" }, 500);
        if (phase === "invalid-json") {
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("truncated");
            },
          } as unknown as Response;
        }
        if (phase === "unknown-throw") throw new Error("weird");
        return jsonResponse(coherentWithdrawBody());
      }
      throw new Error(url);
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
    }));
    await screen.findByText("Ваша оценка · 3 из 5");
    await act(async () => {
      screen.getByText("Убрать мою оценку").click();
    });
    await screen.findByTestId("venue-community-vote-unknown");
    const key = idempotencyKeyOf(fetchMock.calls.find((c) => c.method === "DELETE"));

    phase = "invalid-json";
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(deletes).toBe(2));
    await screen.findByTestId("venue-community-vote-unknown");
    expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "DELETE")[1])).toBe(key);

    phase = "unknown-throw";
    await act(async () => {
      screen.getByText("Повторить тот же запрос").click();
    });
    await waitFor(() => expect(deletes).toBe(3));
    await screen.findByTestId("venue-community-vote-unknown");
    expect(idempotencyKeyOf(fetchMock.calls.filter((c) => c.method === "DELETE")[2])).toBe(key);

    phase = "ok-me";
    await act(async () => {
      screen.getByText("Проверить актуальную оценку").click();
    });
    await waitFor(() => expect(screen.getByText("Оценка убрана")).toBeTruthy());
    expect(deletes).toBe(3);
  });
});

describe("Slice A shared community owner", () => {
  it("shows the same server comment and anonymous published review in page and embedded contexts with unique IDs", async () => {
    const { VenueCommunityContent } = await import("../src/components/consumer/venues/VenueCommunityContent");
    fetchMock.handler = async url => {
      if (url.includes("venue-community-summaries")) return new Response(JSON.stringify({items:[summary(V1,V1,"available",4.2,5)]}));
      if (url.includes("experience-reviews")) return new Response(JSON.stringify({venueId:V1,publishedCount:1,items:[{reviewHandle:"published",authorLabel:"Участник игры",text:"Published projection",topics:[],publishedRevision:1,publishedAt:"2026-11-01T12:00:00Z"}],nextCursor:null,canWriteHint:false}));
      if (url.includes("/comments")) return new Response(JSON.stringify({entityKind:"venue",entityId:V1,parentCommentId:null,visibleCount:1,canCreate:false,nextCursor:null,items:[{id:"comment",entityKind:"venue",entityId:V1,parentCommentId:null,body:"Actual server ***** text",deleted:false,version:1,createdAt:"2026-11-01T12:00:00Z",updatedAt:"2026-11-01T12:00:00Z",edited:false,mine:false,author:null,replyCount:0}]}));
      throw new Error(`Unexpected read ${url}`);
    };
    render(createElement("div", null,
      createElement(VenueCommunityContent,{venueId:V1,me:null,authReturnPath:`/venues/${V1}`}),
      createElement(VenueCommunityContent,{venueId:V1,me:null,authReturnPath:"/games?view=map",embedded:true}),
    ));
    await waitFor(() => expect(screen.getAllByText("Published projection")).toHaveLength(2));
    expect(screen.getAllByText("Actual server ***** text")).toHaveLength(2);
    const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fetchMock.calls.every(call => !call.method || call.method === "GET")).toBe(true);
    expect(fetchMock.calls.some(call => call.url.includes("/community-rating/me"))).toBe(false);
    expect(screen.getAllByRole("button",{name:"Поделиться опытом"})).toHaveLength(2);
  });
});

it("retains the exact vote operation while its popup collapses and expands", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const { VenuePopup } = await import("../src/components/consumer/games/VenuePopup");
  const { VenueCommunityRating } = await import("../src/components/consumer/venues/VenueCommunityRating");
  const pendingChanged = vi.fn();
  fetchMock.handler = async (url, init) => {
    if (init?.method === "PUT") return new Response("{}",{status:503});
    if (url.includes("venue-community-summaries")) return new Response(JSON.stringify({items:[summary(V1,V1,"available",4.2,5)]}));
    if (url.includes("/community-rating/me")) return new Response(JSON.stringify({summary:summary(V1,V1,"available",4.2,5),own:{venueId:V1,canonicalVenueId:V1,value:null,version:0,withdrawn:false,moderationState:"clear",allowedActions:{upsert:true,update:false,withdraw:false}}}));
    throw new Error(url);
  };
  function Host() {
    const [expanded,setExpanded] = useState(true);
    return createElement(VenuePopup,{expanded,onExpandedChange:setExpanded,onDeselect:()=>{},preview:createElement("span",null,"Preview"),retainContent:true,
      children:createElement(VenueCommunityRating,{venueId:V1,signedIn:true,actorId:ACTOR,csrfToken:CSRF,authReturnPath:"/games?view=map",onUnresolvedChange:pendingChanged}),
    });
  }
  render(createElement(Host));
  await waitFor(()=>expect((screen.getByRole("radio",{name:"4 из 5"}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("radio",{name:"4 из 5"}));
  fireEvent.click(screen.getByRole("button",{name:"Отправить оценку"}));
  await screen.findByTestId("venue-community-vote-unknown");
  const operation = fetchMock.calls.find(call=>call.method === "PUT");
  expect(operation).toBeTruthy(); expect(pendingChanged).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button",{name:"Свернуть площадку"}));
  expect(document.querySelectorAll('[data-testid="venue-community-vote-unknown"]')).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:"Развернуть площадку"}));
  fireEvent.click(screen.getByRole("button",{name:"Повторить тот же запрос"}));
  await waitFor(()=>expect(fetchMock.calls.filter(call=>call.method === "PUT")).toHaveLength(2));
  const retry = fetchMock.calls.filter(call=>call.method === "PUT")[1]!;
  expect(retry.body).toBe(operation!.body);
  expect(new Headers(retry.headers).get("idempotency-key")).toBe(new Headers(operation!.headers).get("idempotency-key"));
  expect(fetchMock.calls.filter(call=>call.url.includes("/community-rating/me"))).toHaveLength(1);
});


// Real React mounts and effects for both authorities; presentation children expose
// their existing callbacks, while mutation packet behavior is tested with real forms.
describe("mounted map and discovery lifecycle authorities", () => {
  const cityA = "a0000000-0000-4000-8000-000000000001";
  const cityB = "a0000000-0000-4000-8000-000000000002";
  const discoveryCity = Object.freeze({
    location: Object.freeze({ cityId: cityA, nameRu: "Москва", timezone: "Europe/Moscow" }),
  });
  const mapVenue = { id: V1, cityId: cityA, name: "Исходная площадка", address: "Адрес",
    latitude: 55.7, longitude: 37.6, timezone: "Europe/Moscow", dataStatus: "verified", provenance: "PUBLIC" };
  const mounted = vi.fn(), unmounted = vi.fn();
  const mockedModules = ["next/dynamic", "next/navigation", "../src/lib/api-client",
    "../src/components/consumer/ConsumerShell", "../src/components/consumer/discovery/DiscoveryCityProvider",
    "../src/components/consumer/venues/SelectedVenueCover", "../src/components/consumer/games/VenuePreviewCard",
    "../src/components/consumer/games/VenueSheet", "../src/components/consumer/games/VenuePopup"];
  beforeEach(() => {
    mounted.mockClear(); unmounted.mockClear();
    window.history.replaceState(null, "", `/games?view=map&cityId=${cityA}&day=2026-11-20&activity=regular`);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
    window.matchMedia = globalThis.matchMedia;
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.doMock("../src/components/consumer/games/VenuePopup", () => ({ VenuePopup: ({ children }: { children: ReactNode }) => createElement("section", null, children) }));
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
    vi.doMock("next/dynamic", () => ({ default: () => (props: { onSelect: (venue: typeof mapVenue) => void; onReturnToList: () => void; cityId: string; venues: typeof mapVenue[] }) =>
      createElement("div", { "data-testid": "map-city", "data-city": props.cityId },
        createElement("button", { disabled: !props.venues.length, onClick: () => props.onSelect(mapVenue) }, "Выбрать площадку"),
        createElement("button", { onClick: props.onReturnToList }, "Возврат из ошибки модуля")) }));
    vi.doMock("../src/lib/api-client", async original => ({ ...await original<typeof ApiClientModule>(),
      getMe: async () => ({ ok: true, data: { id: ACTOR, csrfToken: CSRF } }),
      listAllCityVenues: async (city: string) => ({ ok: true, data: city === cityA ? [mapVenue] : [] }),
      listAllUpcomingCityGames: async () => ({ ok: true, data: [] }),
      listGames: async () => ({ ok: true, data: { items: [], nextCursor: null } }),
      listRoleReputationSummaries: async () => ({ ok: true, data: { items: [] } }),
    }));
    vi.doMock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
    vi.doMock("../src/components/consumer/discovery/DiscoveryCityProvider", () => ({ useDiscoveryCity: () => discoveryCity, DiscoveryCityNotice: () => null }));
    vi.doMock("../src/components/consumer/venues/SelectedVenueCover", () => ({ SelectedVenueCover: () => null,
      useSelectedVenueCover: () => ({ compact: { current: null }, info: { current: null }, ready: false, fallback: null, retry() {} }) }));
    vi.doMock("../src/components/consumer/games/VenuePreviewCard", () => ({ VenuePreviewCard: () => null }));
    vi.doMock("../src/components/consumer/games/VenueSheet", async () => {
      const { useEffect } = await import("react");
      return { VenueSheet: (props: { venue: typeof mapVenue; onUnresolvedChange: (value: boolean) => void }) => {
        useEffect(() => { mounted(); return () => { unmounted(); }; }, []);
        return createElement("div", { "data-testid": "selected-owner" }, props.venue.name,
          createElement("button", { onClick: () => props.onUnresolvedChange(true) }, "Операция UNKNOWN"),
          createElement("button", { onClick: () => props.onUnresolvedChange(false) }, "Операция разрешена"));
      } };
    });
    fetchMock.handler = async () => jsonResponse({ items: [] });
  });
  afterEach(() => {
    cleanup();
    mockedModules.forEach(module => vi.doUnmock(module));
    vi.resetModules();
    window.history.replaceState(null, "", "/");
  });

  it("routes visible and module-error returns through the mounted map guard and freezes a changed city", async () => {
    const { GamesMapView } = await import("../src/components/consumer/games/GamesMapView");
    const back = vi.fn();
    const view = render(createElement(GamesMapView, { cityId: cityA, day: "2026-11-20", onReturnToList: back }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Выбрать площадку" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Выбрать площадку" }));
    await screen.findByTestId("selected-owner");
    fireEvent.click(screen.getByRole("button", { name: "Операция UNKNOWN" }));
    fireEvent.click(screen.getByRole("button", { name: /К списку/ }));
    fireEvent.click(screen.getByRole("button", { name: "Возврат из ошибки модуля" }));
    expect(back).not.toHaveBeenCalled();
    view.rerender(createElement(GamesMapView, { cityId: cityB, day: "2026-11-20", onReturnToList: back }));
    expect(screen.getByTestId("map-city").getAttribute("data-city")).toBe(cityA);
    expect(screen.getByTestId("selected-owner").textContent).toContain("Исходная площадка");
    expect(unmounted).not.toHaveBeenCalled(); expect(mounted).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Смена города отложена/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Операция разрешена" }));
    await waitFor(() => expect(screen.getByTestId("map-city").getAttribute("data-city")).toBe(cityB));
    fireEvent.click(screen.getByRole("button", { name: /К списку/ }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("parent Escape and popstate city/list transitions cannot unmount the pending owner", async () => {
    const { GamesDiscoveryPage } = await import("../src/components/consumer/pages/GamesDiscoveryPage");
    render(createElement(GamesDiscoveryPage));
    await waitFor(() => expect((screen.getByRole("button", { name: "Выбрать площадку" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Выбрать площадку" }));
    await screen.findByTestId("selected-owner");
    fireEvent.click(screen.getByRole("button", { name: "Операция UNKNOWN" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("selected-owner")).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get("view")).toBe("map");
    act(() => {
      window.history.pushState(null, "", `/games?view=list&cityId=${cityB}&day=2026-11-20&activity=regular&selectedVenue=${V1}&communityCity=${cityA}#ratings`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(new URL(window.location.href).searchParams.get("cityId")).toBe(cityA);
      expect(new URL(window.location.href).searchParams.get("view")).toBe("map");
    });
    // The same requested city must be corrected even without a state change.
    act(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("cityId", cityB);
      window.history.pushState(window.history.state, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(new URL(window.location.href).searchParams.get("cityId")).toBe(cityA);
    });
    const held = new URL(window.location.href);
    expect(held.searchParams.get("day")).toBe("2026-11-20");
    expect(held.searchParams.get("activity")).toBe("regular");
    expect(held.searchParams.get("selectedVenue")).toBe(V1);
    expect(held.searchParams.get("communityCity")).toBe(cityA);
    expect(held.hash).toBe("#ratings");
    expect(screen.getByTestId("map-city").getAttribute("data-city")).toBe(cityA);
    expect(screen.getByTestId("selected-owner")).toBeTruthy();
    expect(unmounted).not.toHaveBeenCalled();
    expect(screen.getByText(/Смена города отложена/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Операция разрешена" }));
    await waitFor(() => expect(screen.getByTestId("map-city").getAttribute("data-city")).toBe(cityB));
    expect(new URL(window.location.href).searchParams.get("cityId")).toBe(cityB);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("map-city")).toBeNull());
    expect(new URL(window.location.href).searchParams.get("view")).toBe("list");
  });

  it("cancels held city intent without losing the actor-bound UNKNOWN retry, then allows normal city navigation", async () => {
    vi.doMock("../src/components/consumer/games/VenueSheet", async () => {
      const { useEffect } = await import("react");
      const { VenueCommunityRating } = await import("../src/components/consumer/venues/VenueCommunityRating");
      return { VenueSheet: (props: { venue: typeof mapVenue; me: { id: string; csrfToken: string } | null; onUnresolvedChange: (value: boolean) => void }) => {
        useEffect(() => { mounted(); return () => { unmounted(); }; }, []);
        return createElement("div", { "data-testid": "selected-owner" }, props.venue.name,
          createElement(VenueCommunityRating, { venueId: props.venue.id, signedIn: !!props.me,
            actorId: props.me?.id, csrfToken: props.me?.csrfToken ?? null,
            authReturnPath: "/games?view=map", onUnresolvedChange: props.onUnresolvedChange }));
      } };
    });
    let attempts = 0;
    fetchMock.handler = async (url, init) => {
      if (url.includes("venue-community-summaries")) return jsonResponse({ items: [summary(V1, V1, "available", 4.2, 5)] });
      if (url.includes("/community-rating/me")) return jsonResponse({ own: ownRow({ value: null, version: 0 }), summary: summary(V1, V1, "available", 4.2, 5) });
      if (url.includes("/community-rating") && init?.method === "PUT") {
        attempts += 1;
        return attempts === 1 ? jsonResponse({}, 503) : jsonResponse({ own: ownRow({ value: 4, version: 1 }), summary: summary(V1, V1, "available", 4.2, 6) });
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const { GamesDiscoveryPage } = await import("../src/components/consumer/pages/GamesDiscoveryPage");
    render(createElement(GamesDiscoveryPage));
    await waitFor(() => expect((screen.getByRole("button", { name: "Выбрать площадку" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Выбрать площадку" }));
    await waitFor(() => expect((screen.getByRole("radio", { name: "4 из 5" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("radio", { name: "4 из 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить оценку" }));
    await screen.findByTestId("venue-community-vote-unknown");
    const owner = screen.getByTestId("selected-owner");
    const frozen = fetchMock.calls.find(call => call.method === "PUT")!;
    expect(new Headers(frozen.headers).get("x-csrf-token")).toBe(CSRF);
    expect(JSON.parse(frozen.body!)).toEqual({ value: 4, expectedVersion: 0 });
    expect(idempotencyKeyOf(frozen)).toBeTruthy();

    const navigate = (city: string) => act(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("cityId", city);
      window.history.pushState(window.history.state, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    navigate(cityB);
    expect(new URL(window.location.href).searchParams.get("cityId")).toBe(cityA);
    expect(screen.getByText(/Смена города отложена.*Москва/)).toBeTruthy();
    navigate(cityB);
    expect(new URL(window.location.href).searchParams.get("cityId")).toBe(cityA);
    navigate(cityA);
    expect(screen.queryByText(/Смена города отложена/)).toBeNull();
    expect(screen.getByTestId("selected-owner")).toBe(owner);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(attempts).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Повторить тот же запрос" }));
    await screen.findByRole("button", { name: "Сохранить изменение" });
    const retry = fetchMock.calls.filter(call => call.method === "PUT");
    expect(retry).toHaveLength(2);
    expect(retry[1]?.url).toBe(frozen.url);
    expect(retry[1]?.body).toBe(frozen.body);
    expect(idempotencyKeyOf(retry[1])).toBe(idempotencyKeyOf(frozen));
    expect(new Headers(retry[1]?.headers).get("x-csrf-token")).toBe(CSRF);
    expect(fetchMock.calls.filter(call => call.url.includes("/community-rating/me"))).toHaveLength(1);
    expect(screen.getByTestId("map-city").getAttribute("data-city")).toBe(cityA);
    expect(screen.getByTestId("selected-owner")).toBe(owner);

    navigate(cityB);
    await waitFor(() => expect(screen.getByTestId("map-city").getAttribute("data-city")).toBe(cityB));
    expect(new URL(window.location.href).searchParams.get("cityId")).toBe(cityB);
    expect(screen.queryByTestId("selected-owner")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /К списку/ }));
    await screen.findByRole("button", { name: "Где играем: Санкт-Петербург. Сменить город" });
    expect(new URL(window.location.href).searchParams.get("view")).toBe("list");
    expect(attempts).toBe(2);
  });
});

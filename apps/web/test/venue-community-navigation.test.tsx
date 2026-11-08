/** @vitest-environment jsdom */
/**
 * #507 I1 — focused VenuePage late-hash / cleanup navigation regression.
 * jsdom geometry is not real Chrome geometry; asserts scrollIntoView contracts only.
 */
import { cleanup, render, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Venue } from "../src/lib/consumer-types";
import { resetSessionPresenceForTests } from "../src/lib/session-presence";

const scrollIntoViewMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("../src/components/consumer/ConsumerShell", () => ({
  ConsumerShell: ({ children }: { children: ReactNode }) => createElement("div", { "data-shell": "stub" }, children),
}));

vi.mock("../src/components/consumer/venues/VenueGallery", () => ({
  VenueGallery: () => createElement("div", { "data-gallery": "stub" }),
}));

vi.mock("../src/components/consumer/venues/VenuePublicProfile", () => ({
  VenuePublicProfile: () => createElement("div", { "data-profile": "stub" }),
}));

vi.mock("../src/components/consumer/games/GamesMapView", () => ({
  GamesMapView: () => createElement("div", { "data-map": "stub" }),
}));

vi.mock("../src/components/consumer/games/VenueSheet", () => ({
  VenuePublicContacts: () => createElement("div", { "data-contacts": "stub" }),
}));

vi.mock("../src/components/consumer/venues/VenueCommunityRating", () => ({
  VenueCommunityRating: ({ venueId }: { venueId: string }) =>
    createElement("section", { id: "ratings", "data-ratings": venueId }, "Оценки сообщества"),
}));

vi.mock("../src/components/consumer/comments/CommentsSection", () => ({
  CommentsSection: () => createElement("div", { "data-comments": "stub" }),
}));

vi.mock("../src/components/consumer/venues/VenueReviewsPanel", () => ({
  VenueReviewsPanel: () => createElement("div", { "data-reviews-panel": "stub" }),
}));

import { VenuePage } from "../src/components/consumer/venues/VenuePage";

const venueA: Venue = {
  id: "venue-a",
  cityId: "city",
  name: "Зал A",
  address: "Адрес A",
  timezone: "Europe/Moscow",
  latitude: 55.7,
  longitude: 37.6,
  dataStatus: "verified",
  provenance: "PUBLIC",
  cover: { uploadedUrl: null },
  profile: null,
  publicContacts: null,
};

const venueB: Venue = { ...venueA, id: "venue-b", name: "Зал B", address: "Адрес B" };

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setLocationHash(hash: string) {
  window.history.replaceState(null, "", `/venues/test${hash}`);
}

function dispatchHashChange() {
  window.dispatchEvent(new Event("hashchange"));
}

function installFetch(handler: (url: string) => Promise<Response> | Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/v1/me") return new Response("{}", { status: 401 });
      return handler(url);
    }),
  );
}

beforeEach(() => {
  scrollIntoViewMock.mockReset();
  resetSessionPresenceForTests();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
  setLocationHash("");
  installFetch((url) => {
    if (url === "/v1/venues/venue-a") return new Response(JSON.stringify(venueA), { status: 200 });
    if (url === "/v1/venues/venue-b") return new Response(JSON.stringify(venueB), { status: 200 });
    throw new Error(`Unexpected fetch ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLocationHash("");
});

describe("VenuePage community fragment navigation", () => {
  it("scrolls a known hash after late venue fetch; ignores unknown/no-hash; cleanup blocks stale venue", async () => {
    const lateA = deferred<Venue>();
    installFetch(async (url) => {
      if (url === "/v1/venues/venue-a") {
        const value = await lateA.promise;
        return new Response(JSON.stringify(value), { status: 200 });
      }
      if (url === "/v1/venues/venue-b") {
        return new Response(JSON.stringify(venueB), { status: 200 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    setLocationHash("#ratings");
    const first = render(createElement(VenuePage, { venueId: "venue-a" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    await act(async () => {
      lateA.resolve(venueA);
      await lateA.promise;
    });

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });
    const afterLate = scrollIntoViewMock.mock.calls.length;

    setLocationHash("#unknown-fragment");
    dispatchHashChange();
    await act(async () => {
      await Promise.resolve();
    });
    expect(scrollIntoViewMock.mock.calls.length).toBe(afterLate);

    setLocationHash("");
    dispatchHashChange();
    await act(async () => {
      await Promise.resolve();
    });
    expect(scrollIntoViewMock.mock.calls.length).toBe(afterLate);

    setLocationHash("#discussion");
    dispatchHashChange();
    await waitFor(() => {
      expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(afterLate);
    });

    // Cleanup: unmount before a delayed resolve so the stale venue cannot scroll.
    first.unmount();
    scrollIntoViewMock.mockClear();
    const lateStale = deferred<Venue>();
    installFetch(async (url) => {
      if (url === "/v1/venues/venue-a") {
        const value = await lateStale.promise;
        return new Response(JSON.stringify(value), { status: 200 });
      }
      if (url === "/v1/venues/venue-b") {
        return new Response(JSON.stringify(venueB), { status: 200 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    setLocationHash("#ratings");
    const staleMount = render(createElement(VenuePage, { venueId: "venue-a" }));
    staleMount.unmount();
    await act(async () => {
      lateStale.resolve(venueA);
      await lateStale.promise;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    // Fresh venue with known hash scrolls the new tree only.
    installFetch((url) => {
      if (url === "/v1/venues/venue-b") return new Response(JSON.stringify(venueB), { status: 200 });
      if (url === "/v1/venues/venue-a") return new Response(JSON.stringify(venueA), { status: 200 });
      throw new Error(`Unexpected fetch ${url}`);
    });
    setLocationHash("#ratings");
    const next = render(createElement(VenuePage, { venueId: "venue-b" }));
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });
    expect(document.getElementById("ratings")?.getAttribute("data-ratings")).toBe("venue-b");
    next.unmount();

    // Unknown / absent hash keeps natural scroll (no scrollIntoView).
    scrollIntoViewMock.mockClear();
    setLocationHash("");
    const noHash = render(createElement(VenuePage, { venueId: "venue-a" }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("Зал A");
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    noHash.unmount();
  });
});

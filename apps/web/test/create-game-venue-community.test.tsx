/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { createElement, useState, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityRatingSummary } from "../src/lib/venue-community-api";
import type { VenueSummary } from "../src/lib/consumer-types";

function renderWithPath(node: ReactNode) {
  return render(createElement(PathnameContext.Provider, { value: "/games/create" }, node));
}

const V_A = "10000000-0000-4000-8000-0000000000a1";
const V_B = "10000000-0000-4000-8000-0000000000b2";

const fetchMock = vi.hoisted(() => ({
  calls: [] as Array<{ url: string }>,
  handler: null as null | ((url: string) => Promise<Response>),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("../src/components/consumer/discovery/DiscoveryCityProvider", () => ({
  useDiscoveryCity: () => ({
    location: { cityId: "city", nameRu: "Москва", timezone: "Europe/Moscow" },
  }),
}));

vi.mock("../src/components/consumer/venues/VenueCover", async importOriginal => ({
  ...await importOriginal<typeof import("../src/components/consumer/venues/VenueCover")>(),
  VenueCover: () => createElement("span", { "data-cover": "stub" }),
}));

vi.mock("../src/components/consumer/games/VenuePickerDialog", () => ({
  VenuePickerDialog: () => null,
}));

vi.mock("../src/components/consumer/games/VenueBookingHelp", () => ({
  VenueBookingHelp: () => null,
}));

vi.mock("../src/components/consumer/games/GamePhotoSelection", () => ({
  GamePhotoSelection: () => null,
}));

vi.mock("../src/components/consumer/games/GameLevelRange", () => ({
  GameLevelRange: () => null,
}));

vi.mock("../src/components/consumer/games/GameActionBar", () => ({
  GameActionBar: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

vi.mock("../src/components/consumer/players/ProfileComposition", () => ({
  AuthEntry: () => null,
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
  state: CommunityRatingSummary["state"],
  average: number | null,
  count: number | null,
): CommunityRatingSummary {
  return { venueId, canonicalVenueId: venueId, state, average, count };
}

const venueA: VenueSummary = {
  id: V_A,
  name: "Зал A",
  address: "Адрес A",
  cityId: "city",
  timezone: "Europe/Moscow",
};
const venueB: VenueSummary = {
  id: V_B,
  name: "Зал B",
  address: "Адрес B",
  cityId: "city",
  timezone: "Europe/Moscow",
};

beforeEach(() => {
  fetchMock.calls = [];
  fetchMock.handler = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchMock.calls.push({ url });
    if (!fetchMock.handler) throw new Error("missing fetch handler");
    return fetchMock.handler(url);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("#507 I1 F4 CreateGamePage selected-venue community summary", () => {
  it("shows compact public summary for selected venue A→B, hides without selection, surfaces error", async () => {
    fetchMock.handler = async (url) => {
      if (url.includes("/v1/venue-community-summaries")) {
        if (url.includes(encodeURIComponent(V_B)) || url.includes(V_B)) {
          return jsonResponse({ items: [summary(V_B, "available", 3.5, 4)] });
        }
        if (url.includes(encodeURIComponent(V_A)) || url.includes(V_A)) {
          return jsonResponse({ items: [summary(V_A, "available", 4.2, 5)] });
        }
        return jsonResponse({ items: [] });
      }
      throw new Error(url);
    };

    const { CreateGamePresentation, emptyDraft } = await import(
      "../src/components/consumer/pages/CreateGamePage"
    );
    type PresentationProps = ComponentProps<typeof CreateGamePresentation>;

    function presentationProps(
      selected: VenueSummary | undefined,
      pickerOpen: boolean,
      setPickerOpen: (value: boolean | ((prev: boolean) => boolean)) => void,
    ): PresentationProps {
      const draft = { ...emptyDraft(), venueId: selected?.id ?? "", createNewVenue: false };
      return {
        embedded: true,
        onClose: () => {},
        step: "form",
        me: { id: "me", displayName: "Игрок", csrfToken: "csrf", locale: "ru", linkedProviders: [] },
        preferences: null,
        saveContact: false,
        setSaveContact: () => {},
        creatorSeat: null,
        trainer: null,
        setReload: () => {},
        activityKind: "regular",
        setActivityKind: () => {},
        dateChoice: "custom",
        setDateChoice: () => {},
        customDuration: false,
        setCustomDuration: () => {},
        draft,
        setDraft: () => {},
        knownVenues: [venueA, venueB],
        selectedVenue: selected,
        venueStatus: "ready",
        setVenueReload: () => {},
        venuePickerOpen: pickerOpen,
        setVenuePickerOpen: setPickerOpen,
        venueTriggerRef: { current: null },
        onVenueModeChange: () => {},
        onVenueSelect: () => {},
        created: null,
        error: null,
        busy: false,
        setBusy: () => {},
        photo: null,
        setPhoto: () => {},
        photoReady: true,
        setPhotoReady: () => {},
        photoUrl: undefined,
        contactEdited: { current: false },
        previewPayload: null,
        previewGame: null,
        location: { cityId: "city", nameRu: "Москва", timezone: "Europe/Moscow" },
        onCheck: async () => {},
        onPublish: async () => {},
        setStep: () => {},
        recoveryChecked: true,
        rereadResult: async () => {},
        returnPath: "/games/create",
        invitePlayerId: null,
      } as PresentationProps;
    }

    function Host() {
      const [selected, setSelected] = useState<VenueSummary | undefined>(venueA);
      const [pickerOpen, setPickerOpen] = useState(false);
      return createElement(
        "div",
        null,
        createElement("button", {
          type: "button",
          onClick: () => setSelected(venueB),
        }, "select-b"),
        createElement("button", {
          type: "button",
          onClick: () => setSelected(undefined),
        }, "clear"),
        createElement("button", {
          type: "button",
          onClick: () => setPickerOpen((v) => !v),
        }, "toggle-picker"),
        createElement(CreateGamePresentation, presentationProps(selected, pickerOpen, setPickerOpen)),
      );
    }

    render(createElement(Host));
    await waitFor(() => expect(screen.getByTestId("create-game-selected-venue-community")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/4,2/)).toBeTruthy());
    const firstCalls = fetchMock.calls.filter((c) => c.url.includes("/v1/venue-community-summaries"));
    expect(firstCalls).toHaveLength(1);
    expect(firstCalls[0]?.url).toContain(encodeURIComponent(V_A));
    expect(fetchMock.calls.some((c) => c.url.includes("/community-rating/me"))).toBe(false);
    expect(fetchMock.calls.some((c) => c.url.includes("venueIds=") && c.url.includes(V_A) && c.url.includes(V_B))).toBe(false);

    await act(async () => {
      screen.getByText("select-b").click();
    });
    await waitFor(() => expect(screen.getByText(/3,5/)).toBeTruthy());
    expect(screen.queryByText(/4,2/)).toBeNull();
    const afterSwitch = fetchMock.calls.filter((c) => c.url.includes("/v1/venue-community-summaries"));
    expect(afterSwitch.length).toBeGreaterThanOrEqual(2);
    expect(afterSwitch.at(-1)?.url).toContain(encodeURIComponent(V_B));
    expect(afterSwitch.at(-1)?.url).not.toContain(encodeURIComponent(V_A));

    await act(async () => {
      screen.getByText("clear").click();
    });
    await waitFor(() => expect(screen.queryByTestId("create-game-selected-venue-community")).toBeNull());

    await act(async () => {
      screen.getByText("select-b").click();
    });
    await waitFor(() => expect(screen.getByTestId("create-game-selected-venue-community")).toBeTruthy());

    await act(async () => {
      screen.getByText("toggle-picker").click();
    });
    await waitFor(() => expect(screen.queryByTestId("create-game-selected-venue-community")).toBeNull());
  });

  it("shows compact error state for selected venue when public batch fails", async () => {
    fetchMock.handler = async (url) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      throw new Error(url);
    };

    const { CreateGamePresentation, emptyDraft } = await import(
      "../src/components/consumer/pages/CreateGamePage"
    );
    type PresentationProps = ComponentProps<typeof CreateGamePresentation>;
    const draft = { ...emptyDraft(), venueId: V_A, createNewVenue: false };
    render(createElement(CreateGamePresentation, {
      embedded: true,
      onClose: () => {},
      step: "form",
      me: { id: "me", displayName: "Игрок", csrfToken: "csrf", locale: "ru", linkedProviders: [] },
      preferences: null,
      saveContact: false,
      setSaveContact: () => {},
      creatorSeat: null,
      trainer: null,
      setReload: () => {},
      activityKind: "regular",
      setActivityKind: () => {},
      dateChoice: "custom",
      setDateChoice: () => {},
      customDuration: false,
      setCustomDuration: () => {},
      draft,
      setDraft: () => {},
      knownVenues: [venueA],
      selectedVenue: venueA,
      venueStatus: "ready",
      setVenueReload: () => {},
      venuePickerOpen: false,
      setVenuePickerOpen: () => {},
      venueTriggerRef: { current: null },
      onVenueModeChange: () => {},
      onVenueSelect: () => {},
      created: null,
      error: null,
      busy: false,
      setBusy: () => {},
      photo: null,
      setPhoto: () => {},
      photoReady: true,
      setPhotoReady: () => {},
      photoUrl: undefined,
      contactEdited: { current: false },
      previewPayload: null,
      previewGame: null,
      location: { cityId: "city", nameRu: "Москва", timezone: "Europe/Moscow" },
      onCheck: async () => {},
      onPublish: async () => {},
      setStep: () => {},
      recoveryChecked: true,
      rereadResult: async () => {},
      returnPath: "/games/create",
      invitePlayerId: null,
    } as PresentationProps));

    await waitFor(() => expect(screen.getByText("Оценки временно недоступны")).toBeTruthy());
    expect(screen.getByTestId("create-game-selected-venue-community")).toBeTruthy();
    expect(fetchMock.calls.some((c) => c.url.includes("/community-rating/me"))).toBe(false);
  });

  it("embedded keeps readonly summary without #ratings navigation; full page keeps the link", async () => {
    fetchMock.handler = async (url) => {
      if (url.includes("/v1/venue-community-summaries")) {
        return jsonResponse({ items: [summary(V_A, "available", 4.0, 2)] });
      }
      throw new Error(url);
    };

    const { CreateGamePresentation, emptyDraft } = await import(
      "../src/components/consumer/pages/CreateGamePage"
    );
    type PresentationProps = ComponentProps<typeof CreateGamePresentation>;
    const draft = { ...emptyDraft(), venueId: V_A, createNewVenue: false };
    const base = {
      onClose: () => {},
      step: "form" as const,
      me: { id: "me", displayName: "Игрок", csrfToken: "csrf", locale: "ru", linkedProviders: [] },
      preferences: null,
      saveContact: false,
      setSaveContact: () => {},
      creatorSeat: null,
      trainer: null,
      setReload: () => {},
      activityKind: "regular" as const,
      setActivityKind: () => {},
      dateChoice: "custom" as const,
      setDateChoice: () => {},
      customDuration: false,
      setCustomDuration: () => {},
      draft,
      setDraft: () => {},
      knownVenues: [venueA],
      selectedVenue: venueA,
      venueStatus: "ready" as const,
      setVenueReload: () => {},
      venuePickerOpen: false,
      setVenuePickerOpen: () => {},
      venueTriggerRef: { current: null },
      onVenueModeChange: () => {},
      onVenueSelect: () => {},
      created: null,
      error: null,
      busy: false,
      setBusy: () => {},
      photo: null,
      setPhoto: () => {},
      photoReady: true,
      setPhotoReady: () => {},
      photoUrl: undefined,
      contactEdited: { current: false },
      previewPayload: null,
      previewGame: null,
      location: { cityId: "city", nameRu: "Москва", timezone: "Europe/Moscow" },
      onCheck: async () => {},
      onPublish: async () => {},
      setStep: () => {},
      recoveryChecked: true,
      rereadResult: async () => {},
      returnPath: "/games/create",
      invitePlayerId: null,
    };

    const { unmount: unmountEmbedded } = renderWithPath(createElement(CreateGamePresentation, {
      ...base,
      embedded: true,
    } as PresentationProps));
    await waitFor(() => expect(screen.getByTestId("create-game-selected-venue-community")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/4,0/)).toBeTruthy());
    expect(screen.queryByTestId("venue-community-compact-link")).toBeNull();
    expect(screen.queryByRole("link", { name: /Оценки и обсуждение/ })).toBeNull();
    unmountEmbedded();

    renderWithPath(createElement(CreateGamePresentation, {
      ...base,
      embedded: false,
    } as PresentationProps));
    await waitFor(() => expect(screen.getByTestId("create-game-selected-venue-community")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("venue-community-compact-link")).toBeTruthy());
    const link = screen.getByTestId("venue-community-compact-link");
    expect(link.getAttribute("href")).toBe(`/venues/${encodeURIComponent(V_A)}#ratings`);
    expect(link.className.split(/\s+/)).toContain("gb-venue-community__compact-link");
  });
  it("keeps picker photo and community actions outside selection while search/select/cancel still work", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { VenuePickerDialog } = await vi.importActual<typeof import("../src/components/consumer/games/VenuePickerDialog")>("../src/components/consumer/games/VenuePickerDialog");
    fetchMock.handler = async () => jsonResponse({items:[{venueId:V_A,canonicalVenueId:V_A,state:"empty",average:null,count:0},{venueId:V_B,canonicalVenueId:V_B,state:"empty",average:null,count:0}]});
    const select=vi.fn(), close=vi.fn();
    renderWithPath(createElement(VenuePickerDialog,{venues:[venueA,venueB],selectedId:"",status:"ready",onSelect:select,onClose:close,onRetry:()=>{}}));
    await screen.findAllByTestId("venue-picker-community-link");
    const row=document.querySelector(".gb-venue-picker-option-row")!;
    const option=row.querySelector(".gb-venue-picker-option")!;
    expect(option.querySelector("a,summary,button")).toBeNull();
    expect(row.querySelector(".gb-venue-picker-option-actions summary")).toBeTruthy();
    fireEvent.click(row.querySelector("summary")!); expect(select).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox",{name:"Поиск площадки"}),{target:{value:venueA.name}});
    expect(document.querySelectorAll(".gb-venue-picker-option")).toHaveLength(1);
    fireEvent.click(document.querySelector(".gb-venue-picker-option")!);expect(select).toHaveBeenCalledWith(venueA);
    fireEvent.click(screen.getByRole("button",{name:"Закрыть выбор площадки"}));expect(close).toHaveBeenCalledOnce();
  });

});

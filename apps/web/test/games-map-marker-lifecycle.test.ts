import { expect, it, vi } from "vitest";
import type { VenueSummary } from "../src/lib/consumer-types";
import { reconcileVenueMarkers, venueMarkerPresentation } from "../src/lib/games-venue-map";

it("retains the same keyboard control across clock, date, unavailable and refreshed counts", () => {
  const venue = { id: "v", name: "Зал", latitude: 55.7, longitude: 37.6 } as VenueSummary;
  const entries = new Map<string, { focused: boolean; label: string; activate: () => void }>();
  const select = vi.fn();
  let counts: Map<string, number> | null = new Map([[venue.id, 2]]);
  const adapter = {
    create: vi.fn(() => ({ focused: false, label: "", activate: () => {} })),
    update: (entry: { focused: boolean; label: string; activate: () => void }, current: VenueSummary) => {
      entry.label = venueMarkerPresentation(current, counts).label;
      entry.activate = () => select(current);
    },
    remove: vi.fn(),
  };
  reconcileVenueMarkers(entries, [venue], adapter);
  const control = entries.get(venue.id)!;
  control.focused = true;
  for (const next of [new Map([[venue.id, 2]]), new Map([[venue.id, 0]]), null, new Map([[venue.id, 1]])]) {
    counts = next;
    reconcileVenueMarkers(entries, [{ ...venue }], adapter);
    expect(entries.get(venue.id)).toBe(control);
    expect(control.focused).toBe(true);
  }
  control.activate();
  expect(select).toHaveBeenCalledWith(venue);
  expect(adapter.create).toHaveBeenCalledTimes(1);
  expect(adapter.remove).not.toHaveBeenCalled();
  reconcileVenueMarkers(entries, [], adapter);
  expect(adapter.remove).toHaveBeenCalledWith(control);
  expect(entries.size).toBe(0);
});

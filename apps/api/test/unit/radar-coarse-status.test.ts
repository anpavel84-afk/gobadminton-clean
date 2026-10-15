import { expect, it } from "vitest";
import { v2Metadata } from "../../src/radar/unified-publishing.service";
it("exposes only the published coarse center to the owning session", () => {
  const time = new Date("2030-01-01T00:00:00Z");
  const row = { user_id: "owner", owner_session_id: "session", activation_id: "activation", version: "1", region_id: "region", location_model: "regional_grid_100m_v1", grid_size_meters: 100, expires_at: time, hard_expires_at: time, foreground_until: time, location_valid_until: time, started_at: time, next_location_update_at: time, next_radius_change_at: time, coarse_latitude: 55.75, coarse_longitude: 37.61 } as Parameters<typeof v2Metadata>[0];
  expect(v2Metadata(row, "session")).toHaveProperty("coarseCenter", { latitude: 55.75, longitude: 37.61 });
  expect(v2Metadata(row, "another-session")).not.toHaveProperty("coarseCenter");
  expect(v2Metadata({ ...row, coarse_latitude: NaN }, "session")).not.toHaveProperty("coarseCenter");
});

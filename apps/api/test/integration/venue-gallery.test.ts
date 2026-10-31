import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(path.resolve(__dirname, "../../migrations/0045_venue_gallery.sql"), "utf8");
const rollback = readFileSync(path.resolve(__dirname, "../../migrations/rollback/0045_venue_gallery.sql"), "utf8");

describe("venue gallery migration contract", () => {
  it("adds bounded gallery table, description, GC/retirement hooks and legacy cover backfill", () => {
    expect(migration).toContain("CREATE TABLE venue_gallery_items");
    expect(migration).toContain("position smallint NOT NULL CHECK (position >= 0 AND position < 8)");
    expect(migration).toContain("legacy_preserved_unknown");
    expect(migration).toContain("public_description");
    expect(migration).toContain("venue_gallery_item_url");
    expect(migration).toContain("queue_venue_gallery_cleanup");
    expect(migration).toContain("retire_inactive_venue_cover");
    expect(migration).toMatch(/cover_credit_kind = 'logo'/);
    expect(migration).toMatch(/cover_credit_kind = 'illustration'/);
    expect(rollback).toContain("DROP TABLE IF EXISTS venue_gallery_items");
    expect(rollback).toContain("DROP COLUMN IF EXISTS public_description");
  });
});

import { describe, expect, it } from "vitest";
import { redactRadarMetric } from "../../src/radar/radar-telemetry";
import {
  RADAR_LOGICAL_DUMP_EXCLUDE_TABLE_DATA,
  RADAR_PG_DUMP_EXCLUDE_ARGS,
} from "../../src/radar/radar-recovery";
import { stampDiscoveryProof } from "../../src/radar/result-ref";

describe("LS-R2 radar telemetry redaction", () => {
  it("drops coordinates, proofs, cells and unknown high-cardinality keys", () => {
    const redacted = redactRadarMetric({
      op: "preview",
      outcome: "ok",
      latitude: 55.75,
      resultRef: "secret-token",
      userId: "uuid",
      cellI: 12,
      durationMs: 9,
      code: "RESOURCE_UNAVAILABLE",
    });
    expect(redacted).toEqual({
      op: "preview",
      outcome: "ok",
      durationMs: 9,
      code: "RESOURCE_UNAVAILABLE",
    });
    expect(JSON.stringify(redacted)).not.toMatch(/lat|resultRef|cell/i);
  });
});

describe("LS-R2 radar recovery dump contract", () => {
  it("names explicit presence DATA exclusion independent of UNLOGGED", () => {
    expect(RADAR_LOGICAL_DUMP_EXCLUDE_TABLE_DATA).toEqual(["radar_presences"]);
    expect(RADAR_PG_DUMP_EXCLUDE_ARGS).toEqual([
      "--exclude-table-data=radar_presences",
    ]);
  });

  it("stamps discoveryProof without retaining the raw token", () => {
    const stamp = stampDiscoveryProof("unit-test-auth-pepper-32chars!!!!", "raw.proof");
    expect(stamp).toHaveLength(32);
    expect(stamp?.includes("raw")).toBe(false);
  });
});

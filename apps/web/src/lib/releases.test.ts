import { describe, expect, it } from "vitest";
import {
  API_CONTRACT_VERSION_NOTE,
  CURRENT_APPLICATION_VERSION,
  CURRENT_NAMED_RELEASE,
  FIRST_NAMED_APPLICATION_VERSION,
  FIRST_NAMED_RELEASE,
  TRUSTED_HISTORICAL_SEED,
} from "./releases";

/** Co-located release integrity for #450 / alpha.9 (mirrored by apps/web/test/releases*.). */
describe("releases alpha.9 (#450)", () => {
  it("bumps current descriptor to alpha.9 with Russian user-facing delta and API 0.22.0", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.9");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.22.0");
    expect(FIRST_NAMED_APPLICATION_VERSION).toBe("0.1.0-alpha.1");
    expect(FIRST_NAMED_RELEASE.application_version).toBe(FIRST_NAMED_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.application_version).toBe(CURRENT_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.feature_catalogue).toBe("delta");
    expect(CURRENT_NAMED_RELEASE.title).toMatch(/имя|истори/i);
    const prose = [
      ...CURRENT_NAMED_RELEASE.additions,
      ...CURRENT_NAMED_RELEASE.fixes,
      ...CURRENT_NAMED_RELEASE.known_limitations,
    ].join(" ");
    expect(prose).toMatch(/Игрок|каталог|русск/i);
    expect(prose).not.toMatch(
      /directoryVisible|contactPolicy|owner_default|\bACTIVE\b|\bOFF\b|login\/reread|pristine|synthetic/i,
    );
    expect(prose).not.toMatch(/PROD остаётся alpha\.2|не развёрнут/i);
  });

  it("keeps accepted alpha.8 historical seed with both-site dates and prior history", () => {
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.8")).toBe(
      true,
    );
    const alpha8 = TRUSTED_HISTORICAL_SEED.find(
      (row) =>
        row.application_version === "0.1.0-alpha.8" &&
        row.source_sha === "26f3ba38d9c04730674b084c0266afc193662398",
    );
    expect(alpha8).toBeTruthy();
    expect(alpha8!.deployments).toHaveLength(2);
    expect(alpha8!.deployments[0]).toMatchObject({
      environment: "dev",
      release_id: "r41339991160-a1",
      accepted_at: "2026-11-01T19:18:15Z",
    });
    expect(alpha8!.deployments[1]).toMatchObject({
      environment: "prod",
      release_id: null,
      accepted_at: "2026-11-01T19:30:08.857934Z",
      kind: "managed_application_only",
    });
    const alpha8Prose = [
      ...alpha8!.additions,
      ...alpha8!.fixes,
      ...alpha8!.known_limitations,
      alpha8!.title,
    ].join(" ");
    expect(alpha8Prose).toMatch(/каталог|сообщени|выбор/i);
    expect(alpha8Prose).not.toMatch(
      /directoryVisible|contactPolicy=requests|owner_default|\bACTIVE\b|login\/reread|pristine/i,
    );
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === FIRST_NAMED_APPLICATION_VERSION)).toBe(
      true,
    );
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.7")).toBe(
      true,
    );
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(11);
    expect(
      TRUSTED_HISTORICAL_SEED.reduce((n, row) => n + row.deployments.length, 0),
    ).toBe(16);
  });
});

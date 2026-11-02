import { describe, expect, it } from "vitest";
import {
  API_CONTRACT_VERSION_NOTE,
  CURRENT_APPLICATION_VERSION,
  CURRENT_NAMED_RELEASE,
  FIRST_NAMED_APPLICATION_VERSION,
  FIRST_NAMED_RELEASE,
  TRUSTED_HISTORICAL_SEED,
} from "./releases";

/** Co-located release integrity for #372 PG3 / alpha.12 (mirrored by apps/web/test/releases*.). */
describe("releases alpha.12 (#372 PG3 note draft lifecycle)", () => {
  it("bumps current descriptor to alpha.12 with Russian PG3 delta and API 0.23.0", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.12");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.23.0");
    expect(FIRST_NAMED_APPLICATION_VERSION).toBe("0.1.0-alpha.1");
    expect(FIRST_NAMED_RELEASE.application_version).toBe(FIRST_NAMED_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.application_version).toBe(CURRENT_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.feature_catalogue).toBe("delta");
    expect(CURRENT_NAMED_RELEASE.title).toMatch(/заметк|удален|подтвержд/i);
    const prose = [
      ...CURRENT_NAMED_RELEASE.additions,
      ...CURRENT_NAMED_RELEASE.fixes,
      ...CURRENT_NAMED_RELEASE.known_limitations,
    ].join(" ");
    expect(prose).toMatch(/заметк|черновик|удален/i);
    expect(prose).toMatch(/PG-4|Safety|alpha\.8/i);
    expect(prose).not.toMatch(
      /directoryVisible|contactPolicy|owner_default|\bACTIVE\b|\bOFF\b|login\/reread|pristine|synthetic/i,
    );
    expect(prose).not.toMatch(/не установлен|кандидат не установлен|не развёрнут/i);
    expect(prose).not.toMatch(/PROD остаётся alpha\.2/i);
  });

  it("keeps accepted alpha.8 PROD history and accepted alpha.11 DEV seed", () => {
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
    const alpha9 = TRUSTED_HISTORICAL_SEED.find(
      (row) =>
        row.application_version === "0.1.0-alpha.9" &&
        row.source_sha === "783a1897167be1f531312b9a6812b6240181e2c3",
    );
    expect(alpha9).toBeTruthy();
    expect(alpha9!.deployments).toHaveLength(1);
    expect(alpha9!.deployments[0]).toMatchObject({
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r41345457119-a1",
      accepted_at: "2026-11-01T20:21:50Z",
    });
    const alpha10 = TRUSTED_HISTORICAL_SEED.find(
      (row) =>
        row.application_version === "0.1.0-alpha.10" &&
        row.source_sha === "1dc5000280d617c3160fc959ee87607db394410c",
    );
    expect(alpha10).toBeTruthy();
    expect(alpha10!.deployments).toHaveLength(1);
    expect(alpha10!.deployments[0]).toMatchObject({
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r41349542541-a1",
      accepted_at: "2026-11-01T21:03:36Z",
      api_digest: "sha256:a71fe6979b045a09bb348cce3e7f57ffbab952e5b52edc632849ef3776e49970",
      web_digest: "sha256:3d57f99e22af3f1fac4a64956a38745862d434abd42ce17f9ff026e7cf0a87b0",
      kind: "pipeline",
    });
    expect(alpha10!.deployments.some((d) => d.environment === "prod")).toBe(false);
    const alpha11 = TRUSTED_HISTORICAL_SEED.find(
      (row) =>
        row.application_version === "0.1.0-alpha.11" &&
        row.source_sha === "acec520281d07f30d3fa855043be7d613ba56db1",
    );
    expect(alpha11).toBeTruthy();
    expect(alpha11!.deployments).toHaveLength(1);
    expect(alpha11!.deployments[0]).toMatchObject({
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r41361963371-a1",
      accepted_at: "2026-11-01T23:30:16Z",
      api_digest: "sha256:a89e5c9c8018914c6ac6aee2bbb666c6d99a0fd892db5aad0ede730056e9667c",
      web_digest: "sha256:efcbef6285944a2ea38f1156c00dd234756cf4834d2d7edb4281d6d115ace534",
      kind: "pipeline",
    });
    expect(alpha11!.deployments.some((d) => d.environment === "prod")).toBe(false);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === FIRST_NAMED_APPLICATION_VERSION)).toBe(
      true,
    );
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.7")).toBe(
      true,
    );
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(14);
    expect(
      TRUSTED_HISTORICAL_SEED.reduce((n, row) => n + row.deployments.length, 0),
    ).toBe(19);
  });
});

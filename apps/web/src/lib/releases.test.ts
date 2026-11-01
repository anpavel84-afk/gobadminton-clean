import { describe, expect, it } from "vitest";
import {
  API_CONTRACT_VERSION_NOTE,
  CURRENT_APPLICATION_VERSION,
  CURRENT_NAMED_RELEASE,
  FIRST_NAMED_APPLICATION_VERSION,
  FIRST_NAMED_RELEASE,
  TRUSTED_HISTORICAL_SEED,
} from "./releases";

/** Co-located release integrity for #402 / alpha.10 (mirrored by apps/web/test/releases*.). */
describe("releases alpha.10 (#402)", () => {
  it("bumps current descriptor to alpha.10 with Russian user-facing delta and API 0.22.0", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.10");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.22.0");
    expect(FIRST_NAMED_APPLICATION_VERSION).toBe("0.1.0-alpha.1");
    expect(FIRST_NAMED_RELEASE.application_version).toBe(FIRST_NAMED_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.application_version).toBe(CURRENT_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.feature_catalogue).toBe("delta");
    expect(CURRENT_NAMED_RELEASE.title).toMatch(/профил|действи/i);
    const prose = [
      ...CURRENT_NAMED_RELEASE.additions,
      ...CURRENT_NAMED_RELEASE.fixes,
      ...CURRENT_NAMED_RELEASE.known_limitations,
    ].join(" ");
    expect(prose).toMatch(/Изменить профиль|Изменить обложку|Настройки/i);
    expect(prose).not.toMatch(
      /directoryVisible|contactPolicy|owner_default|\bACTIVE\b|\bOFF\b|login\/reread|pristine|synthetic/i,
    );
    expect(prose).not.toMatch(/не установлен|кандидат не установлен|не развёрнут/i);
    expect(prose).not.toMatch(/PROD остаётся alpha\.2/i);
  });

  it("keeps accepted alpha.8 PROD history and accepted alpha.9 DEV seed", () => {
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
      api_digest: "sha256:722cf29edad73ef6c30bc215a0a69801259b581b46faf12a421293c0b41f1267",
      web_digest: "sha256:d13dc563b86e7f36c2dfa168a93e25dbd9ea6d2c605904ecd0668f5832c440d1",
      kind: "pipeline",
    });
    expect(alpha9!.deployments.some((d) => d.environment === "prod")).toBe(false);
    const alpha9Prose = [
      ...alpha9!.additions,
      ...alpha9!.fixes,
      ...alpha9!.known_limitations,
      alpha9!.title,
    ].join(" ");
    expect(alpha9Prose).toMatch(/имя|истори|ссылк/i);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === FIRST_NAMED_APPLICATION_VERSION)).toBe(
      true,
    );
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.7")).toBe(
      true,
    );
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(12);
    expect(
      TRUSTED_HISTORICAL_SEED.reduce((n, row) => n + row.deployments.length, 0),
    ).toBe(17);
  });
});

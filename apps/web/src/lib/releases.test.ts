import { describe, expect, it } from "vitest";
import {
  API_CONTRACT_VERSION_NOTE,
  CURRENT_APPLICATION_VERSION,
  CURRENT_NAMED_RELEASE,
  FIRST_NAMED_APPLICATION_VERSION,
  FIRST_NAMED_RELEASE,
  TRUSTED_HISTORICAL_SEED,
} from "./releases";

/** Co-located release integrity — literals must track CURRENT_* only. */
describe("releases current descriptor literals", () => {
  it("bumps current descriptor to alpha.21 with API 0.29.0", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.21");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.29.0");
    expect(FIRST_NAMED_APPLICATION_VERSION).toBe("0.1.0-alpha.1");
    expect(FIRST_NAMED_RELEASE.application_version).toBe(FIRST_NAMED_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.application_version).toBe(CURRENT_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.feature_catalogue).toBe("delta");
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
    const prose = [
      CURRENT_NAMED_RELEASE.title,
      ...CURRENT_NAMED_RELEASE.additions,
      ...CURRENT_NAMED_RELEASE.fixes,
      ...CURRENT_NAMED_RELEASE.known_limitations,
    ].join(" ");
    expect(prose).toMatch(/уведомлен|сообщен/i);
    expect(prose).toMatch(/iPhone|Домой|устройств/i);
    expect(prose).not.toMatch(/\b15\/20\b|PROD|READY|ACTIVE/i);
  });

  it("preserves alpha.19/alpha.20 historical seeds and prior alphas", () => {
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.20" &&
          row.source_sha === "9db516ce96499d440a49e7e35029137c33a11429" &&
          row.deployments[0]?.release_id === "r41562101222-a1",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.19" &&
          row.source_sha === "7f33e9da0cf7b52d260567bbfb37114a3613d479",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === FIRST_NAMED_APPLICATION_VERSION),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.18"),
    ).toBe(true);
  });
});

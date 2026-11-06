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
  it("bumps current descriptor to alpha.32 with API 0.36.0", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.32");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.36.0");
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
    expect(prose).toMatch(/карточка|площадк|адрес/i);
    expect(prose).toMatch(/приёмк/i);
    expect(prose).not.toMatch(/\b15\/20\b|PROD|READY|ACTIVE|DEV|operator|alias/i);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.31" &&
          row.source_sha === "1dbd135ae3af27dbc2bd8771a432d32489791a9c" &&
          row.deployments[0]?.release_id === "r42268408755-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-06T18:25:52Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.30" &&
          row.source_sha === "9e7b1fcb7dddd7706e5902b755883d48b3cf945b" &&
          row.deployments[0]?.release_id === "r42259332272-a1",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.29" &&
          row.source_sha === "76490b2be720e9f6b923bd3db477fb6065d6d13c" &&
          row.deployments[0]?.release_id === "r41954344736-a1",
      ),
    ).toBe(true);
  });

  it("preserves alpha.19/alpha.20/alpha.21 historical seeds and prior alphas", () => {
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
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.21" &&
          row.source_sha === "faa236ab8b52716d6e0fbed0d7fefa87334ee02f" &&
          row.deployments[0]?.release_id === "r41574322192-a1",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.21" &&
          row.source_sha === "98f765c39d4f9cd4c6ef7005884f84b1af197d45" &&
          row.deployments[0]?.release_id === "r41747908212-a1",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.22" &&
          row.source_sha === "e637e937d7fa780983daaac92cbe22e26c82ef1b" &&
          row.deployments[0]?.release_id === "r41818484518-a1",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.23" &&
          row.source_sha === "cc771c3700accae431e7bff9131433cd7be694ae" &&
          row.deployments[0]?.release_id === "r41825585671-a1",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.24" &&
          row.source_sha === "002d09c981c7f899db15beb90618a11b53b973b1" &&
          row.deployments[0]?.release_id === "r41839403532-a1",
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

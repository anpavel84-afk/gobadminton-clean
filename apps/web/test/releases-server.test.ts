import { afterEach, describe, expect, it } from "vitest";
import {
  TRUSTED_DEV_API_BASE_URL,
  buildHistoryRows,
  evaluateAcceptance,
  isTrustedDevApiBase,
  isTrustedDevReleasesRuntime,
  loadReleasesPageModel,
  normalizeFinishedAt,
  parseApiMeta,
  parseReleaseProjection,
  parseWebHealth,
} from "../src/lib/releases-server";
import {
  CURRENT_APPLICATION_VERSION,
  FIRST_ALPHA_FEATURES,
  TRUSTED_HISTORICAL_SEED,
  formatReleaseDateRu,
  normalizeRepoSha40,
} from "../src/lib/releases";

const VALID_SHA = "11558239cf284a2f20e3c1c6906ae217c703325f";
const VALID_SHA_UPPER = "11558239CF284A2F20E3C1C6906AE217C703325F";
const OTHER_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("releases DEV runtime guard", () => {
  afterEach(() => {
    delete process.env.API_BASE_URL;
  });

  it("requires exact DEV host and trusted API_BASE_URL=http://api:3000", () => {
    process.env.API_BASE_URL = TRUSTED_DEV_API_BASE_URL;
    expect(isTrustedDevReleasesRuntime({ host: "dev.gobadminton.ru" })).toBe(true);
    expect(isTrustedDevReleasesRuntime({ host: "dev.gobadminton.ru:443" })).toBe(true);
    expect(isTrustedDevReleasesRuntime({ host: "gobadminton.ru" })).toBe(false);
    expect(isTrustedDevReleasesRuntime({ host: "dev.gobadminton.ru.evil" })).toBe(false);
    expect(isTrustedDevReleasesRuntime({ host: "dev.gobadminton.ru", apiBaseUrl: "https://gobadminton.ru" })).toBe(false);
    expect(isTrustedDevApiBase("http://api:3000/")).toBe(true);
    expect(isTrustedDevApiBase("https://dev-api.gobadminton.ru")).toBe(false);
  });

  it("does not treat appEnv or public URL alone as DEV admission", () => {
    expect(isTrustedDevReleasesRuntime({
      host: "dev.gobadminton.ru",
      apiBaseUrl: "https://dev.gobadminton.ru",
    })).toBe(false);
  });
});

describe("release projection format", () => {
  const good = {
    environment: "dev",
    observed_at: 1793491358,
    pending: false,
    accepted: {
      release_id: "r41254244816-a1",
      source_sha: VALID_SHA,
      status: "ACCEPTED",
      finished_at: "2026-11-01T00:02:38Z",
      api_digest: "sha256:7dbefb76c0a08fed45ae502e6cb8eb9642239e4e89f470b610ab85c96e7f1ebd",
      web_digest: "sha256:5173cdd6a65c5ecc3d6609cb22d1f3fdfe0c6a161244dd5f63b509e51c4402c6",
    },
  };

  it("parses sanitized projection and normalizes unix observed_at", () => {
    const parsed = parseReleaseProjection(good, "dev");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.accepted?.source_sha).toBe(VALID_SHA);
    expect(parsed.data.observed_at).toBe(new Date(1793491358 * 1000).toISOString());
    expect(normalizeFinishedAt(1793491487.8117852)).toMatch(/^2026-11-01T/);
  });

  it("rejects malformed, missing, and wrong-environment projections", () => {
    expect(parseReleaseProjection(null, "dev").ok).toBe(false);
    expect(parseReleaseProjection("nope", "dev").ok).toBe(false);
    expect(parseReleaseProjection({ ...good, environment: "prod" }, "dev").ok).toBe(false);
    expect(parseReleaseProjection({ ...good, accepted: { ...good.accepted, source_sha: "" } }, "dev").ok).toBe(false);
    expect(parseReleaseProjection({ environment: "dev", observed_at: "bad", pending: false, accepted: null }, "dev").ok).toBe(false);
  });

  it("fail-softs finite out-of-range observed_at / finished_at including 1e30 numeric strings", () => {
    expect(normalizeFinishedAt(1e30)).toBeNull();
    expect(normalizeFinishedAt("1e30")).toBeNull();
    expect(normalizeFinishedAt(Number.MAX_VALUE)).toBeNull();
    expect(() => normalizeFinishedAt(1e30)).not.toThrow();

    const hugeObserved = parseReleaseProjection({ ...good, observed_at: 1e30 }, "dev");
    expect(hugeObserved.ok).toBe(false);
    if (!hugeObserved.ok) expect(hugeObserved.reason).toBe("malformed");

    const hugeFinished = parseReleaseProjection({
      ...good,
      accepted: { ...good.accepted, finished_at: 1e30 },
    }, "dev");
    expect(hugeFinished.ok).toBe(false);
    if (!hugeFinished.ok) expect(hugeFinished.reason).toBe("malformed");

    const hugeFinishedStr = parseReleaseProjection({
      ...good,
      accepted: { ...good.accepted, finished_at: "1e30" },
    }, "dev");
    expect(hugeFinishedStr.ok).toBe(false);
  });

  it("does not crash loadReleasesPageModel path when projection dates are damaged", async () => {
    const damaged = parseReleaseProjection({
      environment: "dev",
      observed_at: 1e30,
      pending: false,
      accepted: {
        ...good.accepted,
        finished_at: 1e30,
      },
    }, "dev");
    expect(damaged.ok).toBe(false);
    expect(() => buildHistoryRows(TRUSTED_HISTORICAL_SEED, [null, null])).not.toThrow();
    expect(typeof loadReleasesPageModel).toBe("function");
  });
});

describe("full 40-hex source SHA honesty", () => {
  it("normalizes case and rejects garbage/blank/truncated/unknown", () => {
    expect(normalizeRepoSha40(VALID_SHA_UPPER)).toBe(VALID_SHA);
    expect(normalizeRepoSha40("unknown")).toBeNull();
    expect(normalizeRepoSha40("")).toBeNull();
    expect(normalizeRepoSha40("abc123")).toBeNull();
    expect(normalizeRepoSha40("11558239cf284a2f20e3c1c6906ae217c703325")).toBeNull();
    expect(normalizeRepoSha40("not-a-real-sha-value-xxxxxxxxxxxx")).toBeNull();
  });

  it("marks invalid live gitSha as unknown and invalid projection sha as malformed", () => {
    expect(parseWebHealth({ status: "ok", gitSha: "garbage" }).state).toBe("unknown");
    expect(parseWebHealth({ status: "ok", gitSha: "unknown" }).state).toBe("unknown");
    expect(parseApiMeta({ gitSha: "garbage" }).state).toBe("unknown");
    expect(parseApiMeta({ gitSha: VALID_SHA_UPPER })).toMatchObject({ state: "ok", gitSha: VALID_SHA });

    const badProj = parseReleaseProjection({
      environment: "dev",
      observed_at: "2026-11-01T00:00:00Z",
      pending: false,
      accepted: {
        release_id: "r1",
        source_sha: "garbage",
        status: "ACCEPTED",
        finished_at: "2026-11-01T00:00:00Z",
        api_digest: null,
        web_digest: null,
      },
    }, "dev");
    expect(badProj.ok).toBe(false);
    if (!badProj.ok) expect(badProj.reason).toBe("malformed");
  });

  it("equal garbage across projection+/health+/v1/meta never becomes accepted_current; valid 40 still can", () => {
    const garbage = "unknown";
    const accepted = {
      release_id: "r1-a1",
      source_sha: garbage,
      status: "ACCEPTED",
      finished_at: "2026-11-01T00:00:00Z",
      api_digest: null,
      web_digest: null,
    };
    const projection = { environment: "dev" as const, observed_at: "2026-11-01T00:00:00Z", pending: false, accepted };
    const equalGarbage = evaluateAcceptance(
      projection,
      null,
      { state: "ok", gitSha: garbage, checkedAt: "t" },
      { state: "ok", gitSha: garbage, checkedAt: "t" },
    );
    expect(equalGarbage.state).not.toBe("accepted_current");

    const webGarbage = parseWebHealth({ status: "ok", gitSha: garbage });
    const apiGarbage = parseApiMeta({ gitSha: garbage });
    const projGarbage = parseReleaseProjection({
      environment: "dev",
      observed_at: "2026-11-01T00:00:00Z",
      pending: false,
      accepted: { ...accepted, source_sha: garbage },
    }, "dev");
    expect(webGarbage.state).toBe("unknown");
    expect(apiGarbage.state).toBe("unknown");
    expect(projGarbage.ok).toBe(false);

    const positive = evaluateAcceptance(
      {
        environment: "dev",
        observed_at: "2026-11-01T00:00:00Z",
        pending: false,
        accepted: { ...accepted, source_sha: VALID_SHA },
      },
      null,
      { state: "ok", gitSha: VALID_SHA_UPPER, checkedAt: "t" },
      { state: "ok", gitSha: VALID_SHA, checkedAt: "t" },
    );
    expect(positive.state).toBe("accepted_current");
    if (positive.state === "accepted_current") {
      expect(positive.accepted.source_sha).toBe(VALID_SHA);
    }
  });
});

describe("live health/meta honesty", () => {
  it("marks legacy health without gitSha as unknown", () => {
    const legacy = parseWebHealth({ status: "ok", service: "gobadminton-web", timestamp: "2026-11-01T00:00:00Z" });
    expect(legacy.state).toBe("unknown");
  });

  it("reads applicationVersion+gitSha from web health and apiVersion+gitSha from meta", () => {
    const web = parseWebHealth({
      status: "ok",
      applicationVersion: CURRENT_APPLICATION_VERSION,
      gitSha: VALID_SHA,
    });
    expect(web).toMatchObject({ state: "ok", gitSha: VALID_SHA, applicationVersion: CURRENT_APPLICATION_VERSION });
    const api = parseApiMeta({ apiVersion: "0.20.0", gitSha: VALID_SHA });
    expect(api).toMatchObject({ state: "ok", gitSha: VALID_SHA, apiVersion: "0.20.0" });
  });

  it("does not claim ACCEPTED current on mismatch or missing live SHA", () => {
    const accepted = {
      release_id: "r1-a1",
      source_sha: OTHER_SHA,
      status: "ACCEPTED",
      finished_at: "2026-11-01T00:00:00Z",
      api_digest: null,
      web_digest: null,
    };
    const projection = { environment: "dev" as const, observed_at: "2026-11-01T00:00:00Z", pending: false, accepted };
    const mismatch = evaluateAcceptance(
      projection,
      null,
      { state: "ok", gitSha: VALID_SHA, checkedAt: "t" },
      { state: "ok", gitSha: VALID_SHA, checkedAt: "t" },
    );
    expect(mismatch.state).toBe("mismatch");
    const unavailable = evaluateAcceptance(
      projection,
      null,
      { state: "unknown", detail: "legacy", checkedAt: "t" },
      { state: "ok", gitSha: accepted.source_sha, checkedAt: "t" },
    );
    expect(unavailable.state).toBe("projection_only");
    const current = evaluateAcceptance(
      projection,
      null,
      { state: "ok", gitSha: accepted.source_sha, checkedAt: "t" },
      { state: "ok", gitSha: accepted.source_sha, checkedAt: "t" },
    );
    expect(current.state).toBe("accepted_current");
  });
});

describe("history seed integrity", () => {
  it("keeps four confirmed seed deployments and dedupes identical live rows", () => {
    const seedCount = TRUSTED_HISTORICAL_SEED.reduce((n, row) => n + row.deployments.length, 0);
    expect(seedCount).toBe(4);
    const live = {
      environment: "dev" as const,
      observed_at: "2026-11-01T00:06:00Z",
      pending: false,
      accepted: {
        release_id: "r41254244816-a1",
        source_sha: VALID_SHA,
        status: "ACCEPTED",
        finished_at: "2026-11-01T00:02:38.000Z",
        api_digest: null,
        web_digest: null,
      },
    };
    const rows = buildHistoryRows(TRUSTED_HISTORICAL_SEED, [live, null]);
    expect(rows.filter((row) => row.source_sha.startsWith("11558239") && row.environment === "dev")).toHaveLength(1);
    expect(rows.every((row) => row.application_version == null || row.application_version === CURRENT_APPLICATION_VERSION)).toBe(true);
    expect(FIRST_ALPHA_FEATURES).toHaveLength(35);
    expect(TRUSTED_HISTORICAL_SEED.every((row) => row.application_version == null)).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.flatMap((row) => row.deployments).map((d) => d.accepted_at)).toEqual([
      "2026-10-31T20:28:18Z",
      "2026-10-31T23:22:12.477839Z",
      "2026-11-01T00:02:38Z",
      "2026-11-01T00:04:47.811785Z",
    ]);
  });

  it("keeps same SHA redeploy on a different date as a separate row", () => {
    const live = {
      environment: "dev" as const,
      observed_at: "2026-11-02T00:00:00Z",
      pending: false,
      accepted: {
        release_id: "r999-a1",
        source_sha: VALID_SHA,
        status: "ACCEPTED",
        finished_at: "2026-11-02T12:00:00.000Z",
        api_digest: null,
        web_digest: null,
      },
    };
    const rows = buildHistoryRows(TRUSTED_HISTORICAL_SEED, [live]);
    expect(rows.filter((row) => row.source_sha.startsWith("11558239") && row.environment === "dev")).toHaveLength(2);
  });

  it("formats history dates in ru-RU UTC without inventing values", () => {
    const readable = formatReleaseDateRu("2026-11-01T00:02:38Z");
    expect(readable).toMatch(/2026/);
    expect(readable).toMatch(/UTC|GMT/i);
    expect(formatReleaseDateRu(null)).toBe("—");
    expect(formatReleaseDateRu("not-a-date")).toBe("—");
  });
});

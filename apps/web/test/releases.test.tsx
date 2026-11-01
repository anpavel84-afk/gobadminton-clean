import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesktopFooter } from "../src/components/consumer/DesktopFooter";
import { ReleaseLink, isDevReleasesHost } from "../src/components/consumer/ReleaseLink";
import {
  CURRENT_APPLICATION_VERSION,
  CURRENT_NAMED_RELEASE,
  FIRST_ALPHA_FEATURES,
  FIRST_NAMED_APPLICATION_VERSION,
  FIRST_NAMED_RELEASE,
  SWITCHED_OFF_INTERNAL,
  TRUSTED_HISTORICAL_SEED,
  groupFeatures,
  runtimeBuildGitSha,
  shortSha,
} from "../src/lib/releases";
import "../src/lib/releases.test";
import { GET as healthGet } from "../src/app/health/route";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));

describe("releases catalogue integrity", () => {
  it("keeps first alpha.1 baseline literal while current descriptor is alpha.9 delta", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.9");
    expect(FIRST_NAMED_APPLICATION_VERSION).toBe("0.1.0-alpha.1");
    expect(FIRST_NAMED_RELEASE.application_version).toBe(FIRST_NAMED_APPLICATION_VERSION);
    expect(FIRST_NAMED_RELEASE.application_version).not.toBe(CURRENT_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.application_version).toBe(CURRENT_APPLICATION_VERSION);
    expect(FIRST_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(FIRST_NAMED_RELEASE.feature_catalogue).toBe("full_baseline");
    expect(CURRENT_NAMED_RELEASE.feature_catalogue).toBe("delta");
    const currentProse = [
      ...CURRENT_NAMED_RELEASE.additions,
      ...CURRENT_NAMED_RELEASE.fixes,
      ...CURRENT_NAMED_RELEASE.known_limitations,
      CURRENT_NAMED_RELEASE.title,
    ].join(" ");
    expect(currentProse).toMatch(/Игрок|каталог|истори/i);
    expect(currentProse).not.toMatch(
      /directoryVisible|contactPolicy|owner_default|\bACTIVE\b|\bOFF\b|login\/reread|pristine|synthetic/i,
    );
    expect(currentProse).not.toMatch(/PROD остаётся alpha\.2|не развёрнут/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/приёмк|НЕ выполн|#445|alpha\.9/i);
    expect(FIRST_ALPHA_FEATURES).toHaveLength(35);
    expect(SWITCHED_OFF_INTERNAL).toHaveLength(6);
    expect(groupFeatures(FIRST_ALPHA_FEATURES).length).toBeGreaterThan(5);
    expect(TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version == null)).toHaveLength(2);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === FIRST_NAMED_APPLICATION_VERSION)).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.2")).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.3")).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.4"
      && row.source_sha === "7a36b8d94a5df412426155e5852fddd9da7b0045",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.5"
      && row.source_sha === "06991b099317a702dc102eeef53ee64cfa841f0e",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.5"
      && row.source_sha === "84cedf79ec6d0582ef1197589acd808f9470f62c",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.6"
      && row.source_sha === "4fdf232ac576b7c830c77405267795634b9ae43b"
      && row.deployments[0]?.release_id === "r41329378049-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T17:07:45Z",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.7"
      && row.source_sha === "dd3839814fdb4ed8e05a64301e4aaaacff5cf0cc"
      && row.deployments[0]?.release_id === "r41331655353-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T17:33:52Z",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.8"
      && row.source_sha === "26f3ba38d9c04730674b084c0266afc193662398"
      && row.deployments[0]?.release_id === "r41339991160-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T19:18:15Z"
      && row.deployments[1]?.environment === "prod"
      && row.deployments[1]?.accepted_at === "2026-11-01T19:30:08.857934Z",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(11);
    expect(SWITCHED_OFF_INTERNAL.some((row) => row.id === "f36")).toBe(true);
    expect(shortSha("11558239cf284a2f20e3c1c6906ae217c703325f")).toBe("11558239cf28");
    expect(shortSha("unknown")).toBe("неизвестно");
    expect(FIRST_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(/sanitized projection|live SHA|runtime.?допуск|postgame/i);
    expect(FIRST_NAMED_RELEASE.additions.join(" ")).not.toMatch(/sanitized projection|live SHA/i);
  });

  it("does not invent GIT_SHA when unset", () => {
    const previous = process.env.GIT_SHA;
    delete process.env.GIT_SHA;
    expect(runtimeBuildGitSha()).toBe("unknown");
    process.env.GIT_SHA = "  deadbeef  ";
    expect(runtimeBuildGitSha()).toBe("deadbeef");
    if (previous == null) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = previous;
  });
});

describe("health applicationVersion + gitSha", () => {
  it("reports current application version and runtime gitSha without secrets", async () => {
    process.env.GIT_SHA = "11558239cf284a2f20e3c1c6906ae217c703325f";
    const response = healthGet();
    const body = await response.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "gobadminton-web",
      applicationVersion: CURRENT_APPLICATION_VERSION,
      gitSha: "11558239cf284a2f20e3c1c6906ae217c703325f",
    });
    expect(JSON.stringify(body)).not.toMatch(/password|token|secret|DATABASE/i);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("DEV-only release link and footer version badge", () => {
  it("keeps ReleaseLink empty on SSR and exposes host helper", () => {
    expect(isDevReleasesHost("dev.gobadminton.ru")).toBe(true);
    expect(isDevReleasesHost("gobadminton.ru")).toBe(false);
    const html = renderToStaticMarkup(createElement(ReleaseLink));
    expect(html).toBe("");
  });

  it("shows plain version badge without a PROD /releases href", () => {
    const html = renderToStaticMarkup(createElement(DesktopFooter));
    expect(html).toContain(CURRENT_APPLICATION_VERSION);
    expect(html).toContain("gb-site-footer-version");
    expect(html).not.toContain('href="/releases"');
    expect(html).toContain('href="/about"');
  });
});

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
import { GET as healthGet } from "../src/app/health/route";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));

describe("releases catalogue integrity", () => {
  it("keeps first alpha.1 baseline literal while current descriptor is alpha.6 delta", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.6");
    expect(FIRST_NAMED_APPLICATION_VERSION).toBe("0.1.0-alpha.1");
    expect(FIRST_NAMED_RELEASE.application_version).toBe(FIRST_NAMED_APPLICATION_VERSION);
    expect(FIRST_NAMED_RELEASE.application_version).not.toBe(CURRENT_APPLICATION_VERSION);
    expect(CURRENT_NAMED_RELEASE.application_version).toBe(CURRENT_APPLICATION_VERSION);
    expect(FIRST_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(FIRST_NAMED_RELEASE.feature_catalogue).toBe("full_baseline");
    expect(CURRENT_NAMED_RELEASE.feature_catalogue).toBe("delta");
    expect(CURRENT_NAMED_RELEASE.additions.join(" ")).toMatch(/отзыв|заметк|приватн/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/OFF|alpha\.2|NOT_TESTED|alpha\.6/i);
    expect(FIRST_ALPHA_FEATURES).toHaveLength(35);
    expect(SWITCHED_OFF_INTERNAL).toHaveLength(6);
    expect(groupFeatures(FIRST_ALPHA_FEATURES).length).toBeGreaterThan(5);
    expect(TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version == null)).toHaveLength(2);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === FIRST_NAMED_APPLICATION_VERSION)).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.2")).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.3")).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.4")).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) => row.application_version === "0.1.0-alpha.5")).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(7);
    expect(SWITCHED_OFF_INTERNAL.some((row) => row.id === "f36")).toBe(true);
    expect(shortSha("11558239cf284a2f20e3c1c6906ae217c703325f")).toBe("11558239cf28");
    expect(shortSha("unknown")).toBe("неизвестно");
    expect(FIRST_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(/sanitized projection|live SHA|runtime.?допуск|postgame/i);
    expect(FIRST_NAMED_RELEASE.additions.join(" ")).not.toMatch(/sanitized projection|live SHA/i);
  });

  it("keeps distinct accepted alpha.4 PG-2 and alpha.5 SMTP history seeds", () => {
    const alpha4 = TRUSTED_HISTORICAL_SEED.find((row) => row.application_version === "0.1.0-alpha.4");
    const alpha5 = TRUSTED_HISTORICAL_SEED.find((row) => row.application_version === "0.1.0-alpha.5");
    expect(alpha4).toMatchObject({
      source_sha: "7a36b8d94a5df412426155e5852fddd9da7b0045",
      api_contract_version: "0.22.0",
      owner_uat: "NOT_TESTED",
      title: expect.stringMatching(/PG-2|возражен/i),
    });
    expect(alpha4?.deployments).toEqual([
      expect.objectContaining({
        environment: "dev",
        status: "ACCEPTED",
        release_id: "r41310911419-a1",
        accepted_at: "2026-11-01T13:34:38Z",
        api_digest: "sha256:dd88f39038e53a9c31ed39ae4460f0029f2ea04aa643d0c01bc4d580a77d5bd3",
        web_digest: "sha256:e108bd3e17ca7eb0edbedcbc31fd938cde5ab02c880bac6c9c4b9ec09d3270d0",
      }),
    ]);
    expect(alpha4?.additions.join(" ")).toMatch(/спор|Cases|соглас/i);
    expect(alpha5).toMatchObject({
      source_sha: "06991b099317a702dc102eeef53ee64cfa841f0e",
      api_contract_version: "0.22.0",
      owner_uat: "NOT_TESTED",
      title: expect.stringMatching(/почтов|код/i),
    });
    expect(alpha5?.deployments).toEqual([
      expect.objectContaining({
        environment: "dev",
        status: "ACCEPTED",
        release_id: "r41317332177-a1",
        accepted_at: "2026-11-01T14:52:56Z",
        api_digest: "sha256:2280fd8640411adef252d36a923b186e4d0b66bf6bab188bcdaadedaf786d64c",
        web_digest: "sha256:8664904fc2a4f111cf73ac528e85ea87407ff6bc3f134e3a1bdee5776ef2761e",
      }),
    ]);
    expect(alpha5?.additions.join(" ")).toMatch(/SMTP|email-code|очеред/i);
    expect(alpha5?.known_limitations.join(" ")).toMatch(/email=false|alpha\.2/i);
    expect(alpha5?.known_limitations.join(" ")).not.toMatch(/PG-3|отзыв|заметк/i);
    expect(CURRENT_NAMED_RELEASE.application_version).toBe("0.1.0-alpha.6");
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
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

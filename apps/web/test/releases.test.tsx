import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopFooter } from "../src/components/consumer/DesktopFooter";
import { ReleaseLink, isDevReleasesHost } from "../src/components/consumer/ReleaseLink";
import {
  API_CONTRACT_VERSION_NOTE,
  CURRENT_APPLICATION_VERSION,
  CURRENT_NAMED_RELEASE,
  FIRST_ALPHA_FEATURES,
  FIRST_ALPHA_KNOWN_LIMITATIONS,
  FIRST_NAMED_APPLICATION_VERSION,
  FIRST_NAMED_RELEASE,
  SWITCHED_OFF_INTERNAL,
  TRUSTED_HISTORICAL_SEED,
  groupFeatures,
  runtimeBuildGitSha,
  shortSha,
  visibleKnownLimitations,
} from "../src/lib/releases";
import { GET as healthGet } from "../src/app/health/route";
import type * as ReleasesServer from "../src/lib/releases-server";

const loadReleasesPageModelMock = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "host" || name === "x-forwarded-host" ? "dev.gobadminton.ru" : null),
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("../src/components/consumer/ConsumerShell", () => ({
  ConsumerShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/lib/releases-server", async (importOriginal) => {
  const actual = await importOriginal<typeof ReleasesServer>();
  return {
    ...actual,
    isTrustedDevReleasesRuntime: () => true,
    loadReleasesPageModel: loadReleasesPageModelMock,
  };
});

describe("releases catalogue integrity", () => {
  it("keeps first alpha.1 baseline literal while current descriptor is alpha.28 delta", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.28");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.34.0");
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
    expect(currentProse).toMatch(/опыт|площадк/i);
    expect(currentProse).toMatch(/подтвержд|пояснен|види/i);
    expect(currentProse).not.toMatch(/\bSafety\b|PG-4|PG-3|\bPROD\b|MutationRunner|OpenAPI|Cases|legacy|replay/i);
    expect(currentProse).not.toMatch(
      /directoryVisible|contactPolicy|owner_default|\bACTIVE\b|\bOFF\b|login\/reread|pristine|synthetic/i,
    );
    expect(currentProse).not.toMatch(/PROD остаётся alpha\.2|не развёрнут|не установлен|DEV remains/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/приёмк|НЕ выполн/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(
      /электронной почте недоступен|после игры не запущен|Push-уведомления не активны|push-уведомления не активны/i,
    );
    expect(CURRENT_NAMED_RELEASE.additions.join(" ")).toMatch(/опыт|площадк/i);
    expect(visibleKnownLimitations(CURRENT_NAMED_RELEASE)).toEqual(CURRENT_NAMED_RELEASE.known_limitations);
    expect(visibleKnownLimitations(CURRENT_NAMED_RELEASE).join(" ")).not.toMatch(
      /электронной почте недоступен|после игры не запущен|push-уведомления не активны/i,
    );
    expect(visibleKnownLimitations(FIRST_NAMED_RELEASE)).toEqual([
      ...FIRST_ALPHA_KNOWN_LIMITATIONS,
      ...FIRST_NAMED_RELEASE.known_limitations.filter((item) => !FIRST_ALPHA_KNOWN_LIMITATIONS.includes(item)),
    ]);
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
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.9"
      && row.source_sha === "783a1897167be1f531312b9a6812b6240181e2c3"
      && row.deployments[0]?.release_id === "r41345457119-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T20:21:50Z"
      && row.deployments.length === 1,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.10"
      && row.source_sha === "1dc5000280d617c3160fc959ee87607db394410c"
      && row.deployments[0]?.release_id === "r41349542541-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T21:03:36Z"
      && row.deployments.length === 1,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.11"
      && row.source_sha === "acec520281d07f30d3fa855043be7d613ba56db1"
      && row.deployments[0]?.release_id === "r41361963371-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T23:30:16Z"
      && row.deployments.length === 1,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.12"
      && row.source_sha === "6383ef406f5944a299843939d391ab7886fdb5dd"
      && row.deployments[0]?.release_id === "r41368959239-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T00:59:40Z"
      && row.deployments[0]?.api_digest === "sha256:82ab7826723a89ec035c1777190fcef1134441b0f9ed6ddae6952507dc63fb82"
      && row.deployments[0]?.web_digest === "sha256:4be8fe110f56f05469f30ecd2961a0a98ad704f7cfb6496b7aa37caf0e128f11"
      && row.deployments.length === 1
      && row.api_contract_version === "0.23.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.13"
      && row.source_sha === "c936031114f57c23f6faa9a01757374b912819ed"
      && row.deployments[0]?.release_id === "r41394102899-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T05:32:06Z"
      && row.deployments[0]?.api_digest === "sha256:5bfc4c1139d6edceebfc4b2e3f49203daa08d56448847c1db2783c56d0f6fdb7"
      && row.deployments[0]?.web_digest === "sha256:573d6792e5c5d51629c1328348f209fb0785b10d87da13b38282366cd603177a"
      && row.deployments.length === 1
      && row.api_contract_version === "0.23.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.14"
      && row.source_sha === "8113359533e5a4cfb85c4520a7af1fff1571c9e4"
      && row.deployments[0]?.release_id === "r41408629901-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T07:58:39Z"
      && row.deployments[0]?.api_digest === "sha256:e2a46301cee91589647ede9d1ecb6f69024918450dfbb261d81fcf83b1c1aeb8"
      && row.deployments[0]?.web_digest === "sha256:81f4706494cf2cf1d2d1e1defae896e4d8ddb54fe2ce149ed820eff8b9b70705"
      && row.deployments.length === 1
      && row.api_contract_version === "0.24.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.15"
      && row.source_sha === "36fd4b4cf4632efa3cc96e93f20a33c220b9708b"
      && row.deployments[0]?.release_id === "r41434833713-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T11:23:40Z"
      && row.deployments[0]?.api_digest === "sha256:c28855a6c8fee6ddbd53cf2e254cb34f08bb4d26c0a7b71ad738aff75f9a7505"
      && row.deployments[0]?.web_digest === "sha256:3e56ffbe64c2092342a105a35f622260d472ac829e0a13734154ffd299ce0ba5"
      && row.deployments.length === 1
      && row.api_contract_version === "0.25.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.16"
      && row.source_sha === "841bbec37739f56e9561a756731490891ed70d19"
      && row.deployments[0]?.release_id === "r41445689826-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T12:47:49Z"
      && row.deployments[0]?.api_digest === "sha256:9de709055304dc3c668e74ab71c3569e300c08aea75ef4ec264263e49bd02f1a"
      && row.deployments[0]?.web_digest === "sha256:4b3012934ce4f9ab4bf68c5738a29e84edbb359fe8fa4390d9705e664f161e12"
      && row.deployments.length === 1
      && row.api_contract_version === "0.26.0"
      && row.title === "Подтверждённый совместный опыт и уточнение посещения",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.17"
      && row.source_sha === "b28ce4bed4ba33f7fe1e90ebc1b7a86495e8806e"
      && row.deployments[0]?.release_id === "r41452395940-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T13:28:07Z"
      && row.deployments[0]?.api_digest === "sha256:f4a4d7a038d67b66ecf9829cdb396bb589ee5109350acec11ccee2857be3886a"
      && row.deployments[0]?.web_digest === "sha256:fff841c229641f53e55a14ed6860a113e5bb148eb8c869247c9d83b5eae94d48"
      && row.deployments.length === 1
      && row.api_contract_version === "0.26.0"
      && row.title === "Уточнения действий в комментариях и пояснений после игры",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.18"
      && row.source_sha === "6cd66a77068d6ab2faa283867d6320896b0c5177"
      && row.deployments[0]?.release_id === "r41456359306-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T13:55:41Z"
      && row.deployments[0]?.api_digest === "sha256:a48a7bebe6cc86b56a0ed08760f94f8db4aac2bd55f8d262354cab77a066e34b"
      && row.deployments[0]?.web_digest === "sha256:81fc859c425688f551f5f427362a5e49dd55cc28665337ee904db634efb1bd69"
      && row.deployments.length === 1
      && row.api_contract_version === "0.26.0"
      && row.title === "Мобильные кнопки комментариев",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.19"
      && row.source_sha === "7f33e9da0cf7b52d260567bbfb37114a3613d479"
      && row.deployments[0]?.release_id === "r41479055286-a2"
      && row.deployments[0]?.accepted_at === "2026-11-02T16:28:48Z"
      && row.deployments[0]?.api_digest === "sha256:22d423424f8ca916e056ae785c7acbc3916b9a0a426105d82ef94f8630d40fb4"
      && row.deployments[0]?.web_digest === "sha256:414ce175c6f81fd722159f143c0f6c42f409a7938f7e0ab6b2caf3d52d22c174"
      && row.deployments.length === 1
      && row.api_contract_version === "0.27.0"
      && row.title === "Жалоба на полученный приватный отзыв",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(31);
    expect(
      TRUSTED_HISTORICAL_SEED.reduce((n, row) => n + row.deployments.length, 0),
    ).toBe(36);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.26"
      && row.source_sha === "360001c6231157f30fdf11606ef8111c291fb099"
      && row.deployments[0]?.release_id === "r41935663994-a2"
      && row.deployments[0]?.accepted_at === "2026-11-04T23:55:28Z"
      && row.deployments[0]?.api_digest === "sha256:5cf215fe32cb69b75fb8a7b74c265d808088d576b362fa82b24425b70df79b31"
      && row.deployments[0]?.web_digest === "sha256:446f880c9f7747452aafc4d84fd4b2ec4c7e35fc779e90d78da11f4296bd1d94"
      && row.api_contract_version === "0.33.0"
      && row.title === "Отдельный доступ для проверки сводки пилота",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.27"
      && row.source_sha === "1354cceaa38b2ec629fabc3ae366d0c3b05e047f"
      && row.deployments[0]?.release_id === "r41941603234-a1"
      && row.deployments[0]?.accepted_at === "2026-11-05T00:34:19Z"
      && row.api_contract_version === "0.33.0"
      && row.title === "Понятные пояснения к отзывам",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.20"
      && row.source_sha === "9db516ce96499d440a49e7e35029137c33a11429"
      && row.deployments[0]?.release_id === "r41562101222-a1"
      && row.deployments[0]?.accepted_at === "2026-11-03T02:01:14Z"
      && row.deployments[0]?.api_digest === "sha256:7f84a7cd5a01abfb3752a8fc2de2d87311e6e5c1e61b076863eb6666b697002e"
      && row.deployments[0]?.web_digest === "sha256:3b576868391ea2d808f13d1e1cf559392c284bff53074cc80733fd88cde57c0d"
      && row.api_contract_version === "0.28.0"
      && row.additions.some((line) => line.includes("автор может снять свой отзыв с публикации"))
      && !row.additions.some((line) => line.includes("отзыв публикации")),
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.21"
      && row.source_sha === "faa236ab8b52716d6e0fbed0d7fefa87334ee02f"
      && row.deployments[0]?.release_id === "r41574322192-a1"
      && row.deployments[0]?.accepted_at === "2026-11-03T04:02:27Z"
      && row.deployments.length === 1
      && row.api_contract_version === "0.29.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.21"
      && row.source_sha === "98f765c39d4f9cd4c6ef7005884f84b1af197d45"
      && row.deployments[0]?.release_id === "r41747908212-a1"
      && row.deployments[0]?.accepted_at === "2026-11-04T00:49:07Z"
      && row.deployments.length === 1
      && row.api_contract_version === "0.29.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.22"
      && row.source_sha === "e637e937d7fa780983daaac92cbe22e26c82ef1b"
      && row.deployments[0]?.release_id === "r41818484518-a1"
      && row.deployments[0]?.accepted_at === "2026-11-04T11:17:16Z"
      && row.deployments[0]?.api_digest === "sha256:ffa1c8e8447ee2c0b5c99ddce7a8b490780b41aade215c8493122ecf95476cbf"
      && row.deployments[0]?.web_digest === "sha256:a28d441946607160b4967abb72f78f6a09ac5b2c374b596bac6e4bb5a3c30314"
      && row.deployments.length === 1
      && row.api_contract_version === "0.30.0"
      && row.title === "Напоминания организатору подвести итоги",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.23"
      && row.source_sha === "cc771c3700accae431e7bff9131433cd7be694ae"
      && row.deployments[0]?.release_id === "r41825585671-a1"
      && row.deployments[0]?.accepted_at === "2026-11-04T12:06:05Z"
      && row.deployments[0]?.api_digest === "sha256:5f53f6d607df355366ea555c94bc3cd094a35706119637c83f8adc5b4fc3c1ef"
      && row.deployments[0]?.web_digest === "sha256:8993a62acac4239f74d7469ff01d00b3b84730006f1ff944f47cf075c8c0d1cc"
      && row.deployments.length === 1
      && row.api_contract_version === "0.30.0"
      && row.title === "Помощь с выбором игрового уровня",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.24"
      && row.source_sha === "002d09c981c7f899db15beb90618a11b53b973b1"
      && row.deployments[0]?.release_id === "r41839403532-a1"
      && row.deployments[0]?.accepted_at === "2026-11-04T13:45:22Z"
      && row.deployments[0]?.api_digest === "sha256:f962f5429792f13a440aeb9ecd7afe8971da386de3f052a44eb1ad96d3fcc699"
      && row.deployments[0]?.web_digest === "sha256:48a881b728829c8404b8490f8c13870c29decd5a75da077a678e32956e86dbeb"
      && row.deployments.length === 1
      && row.api_contract_version === "0.31.0"
      && row.title === "Карта Санкт-Петербурга",
    )).toBe(true);
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

describe("releases page current known limitations SSR (#473)", () => {
  beforeEach(() => {
    loadReleasesPageModelMock.mockReset();
    loadReleasesPageModelMock.mockResolvedValue({
      build: { applicationVersion: CURRENT_APPLICATION_VERSION, gitSha: "unknown" },
      named: { ...CURRENT_NAMED_RELEASE, source_sha: null },
      environments: [],
      history: [],
      checkedAt: "2026-11-05T00:00:00.000Z",
    });
  });

  it("renders current named limits, not first-alpha false email/postgame/push claims", async () => {
    const ReleasesPage = (await import("../src/app/releases/page")).default;
    const tree = await ReleasesPage();
    const html = renderToStaticMarkup(tree);
    for (const item of CURRENT_NAMED_RELEASE.known_limitations) {
      expect(html).toContain(item);
    }
    expect(html).toContain("Техническая установка выпуска на тестовом сайте не означает");
    expect(html).toContain("Раздел Admin и тестовая геопозиция остаются служебными");
    expect(html).not.toMatch(/Вход по электронной почте недоступен/);
    expect(html).not.toMatch(/Результаты и отзывы после игры не запущены/);
    expect(html).not.toMatch(/Push-уведомления не активны/);
    expect(html).not.toContain(FIRST_ALPHA_KNOWN_LIMITATIONS[4]!);
  });
});

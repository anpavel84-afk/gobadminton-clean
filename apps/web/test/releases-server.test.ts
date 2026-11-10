import { createHash } from "node:crypto";
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
  API_CONTRACT_VERSION_NOTE,
  CURRENT_APPLICATION_VERSION,
  CURRENT_NAMED_RELEASE,
  FIRST_ALPHA_FEATURES,
  FIRST_NAMED_APPLICATION_VERSION,
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
  it("preserves the exact trusted alpha.67 receipt before the accepted alpha.68 receipt", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.67");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(3408);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "9e29ba2f9283a98ffa316158f17c47fa08a15ca0cbd968c3acd2f381f5e3232f",
    );
    expect(row.source_sha).toBe("04fdc58b53e79996ccdb21a7396c5d1525cfbd10");
    expect(row.deployments[0]?.release_id).toBe("r42613449482-a1");
    expect(row.deployments[0]?.accepted_at).toBe("2026-11-09T12:05:53Z");
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.66")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(row.fixes).toHaveLength(1);
    expect(row.title).toBe("Начало загрузки фотографии площадки при открытии страницы");
    expect(row.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field trusted alpha.68 receipt before the accepted alpha.69 receipt", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.68");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(3477);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "aaae52c792c34f83c85dc6237750770691e743fd36ed085b716a2f978b73aaaf",
    );
    expect(row.source_sha).toBe("2c33ce49d5b8ad704bf78524b8149c94e4d3e62e");
    expect(row.version_label).toBe("0.1.0-alpha.68");
    expect(row.api_contract_version).toBe("0.40.0");
    expect(row.deployments).toHaveLength(1);
    expect(row.deployments[0]?.release_id).toBe("r42627002935-a1");
    expect(row.deployments[0]?.accepted_at).toBe("2026-11-09T13:42:50Z");
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.67")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(row.title).toBe("Порядок ролей и действий в карточке тренировки");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(1);
    expect(row.fixes.join(" ")).toMatch(/В нижней строке карточки тренировки сначала показан тренер, затем организатор и «Отзывы и история»/i);
    expect(row.fixes.join(" ")).toMatch(/кнопки «Подробнее» и «Поделиться» расположены у правого края/i);
    expect(row.known_limitations).toHaveLength(10);
    expect(row.known_limitations[0]).toBe("Общее состояние сообщества на карте площадок, вход в отзыв после конкретной игры и снятие публичного автора без замены ещё не доступны");
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(84);
  });

  it("preserves the exact ten-field trusted alpha.69 receipt before the accepted alpha.70 receipt", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.69");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(4067);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "ae17a1bd172bf9d94a38e99472ea9ea94510016faad35e1e4d06cd61a806db7d",
    );
    expect(row.source_sha).toBe("5568044d725d306e3bb3ce032e767cf7d3586c60");
    expect(row.version_label).toBe("0.1.0-alpha.69");
    expect(row.api_contract_version).toBe("0.40.0");
    expect(row.deployments).toHaveLength(1);
    expect(row.deployments[0]).toEqual({
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r42697926974-a1",
      accepted_at: "2026-11-09T21:03:51Z",
      api_digest: "sha256:a40c533540a039b9bc8bce6609626e8a3329456e1c759aae5ebc206892c06d27",
      web_digest: "sha256:e8393097a4d20cdba625372211ba6dfdb6c2c9411b8d1ff820c4076e227db527",
      kind: "pipeline",
    });
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.68")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.slice(-8).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.68", "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74", "0.1.0-alpha.75",
    ]);
    expect(row.title).toBe("Компактные фильтры на экране «Игры»");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(1);
    const fixes = row.fixes.join(" ");
    expect(fixes).toMatch(/существующая кнопка с иконкой ползунков без видимой подписи.*доступным именем «Фильтры»/i);
    expect(fixes).toMatch(/компактное окно.*«По времени» убрана/i);
    expect(fixes).toMatch(/Большая панель уровня, пояснения и «Выходите на корт» по умолчанию скрыты/i);
    expect(fixes).toMatch(/Прежний фильтр уровня применяется сразу.*нижней панели на телефоне/i);
    expect(fixes).toMatch(/выбранный уровень сохраняется после закрытия.*сброс затрагивает только уровень/i);
    expect(fixes).toMatch(/Выбор города, дня и типа игры, уровень в профиле и работа сервера остаются прежними/i);
    expect(row.known_limitations).toHaveLength(10);
    expect(row.known_limitations[0]).toBe("Общее состояние сообщества на карте площадок, вход в отзыв после конкретной игры и снятие публичного автора без замены ещё не доступны");
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(84);
  });

  it("preserves the exact ten-field trusted alpha.70 receipt before the accepted alpha.71 receipt", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.70");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(3700);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "7de04d63d698dc847de90a2ea817abd3acee4131d88fd5e97d2ccdfb83793d1f",
    );
    expect(row.source_sha).toBe("0968028ad7755a8087afbcb0fd8d3a09d7ddb97d");
    expect(row.version_label).toBe("0.1.0-alpha.70");
    expect(row.api_contract_version).toBe("0.40.0");
    expect(row.deployments).toHaveLength(1);
    expect(row.deployments[0]).toEqual({
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r42714053715-a1",
      accepted_at: "2026-11-09T22:46:55Z",
      api_digest: "sha256:32d9bccad1304937cc314722cb260c7ac2569c3363c1219a158221654176f3bc",
      web_digest: "sha256:db845f02a30cd84ceb6b6444008d3e1cbf3fdfc929a84a7e3eb3ecae2aa8db91",
      kind: "pipeline",
    });
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.69")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.slice(-7).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74", "0.1.0-alpha.75",
    ]);
    expect(row.title).toBe("Оценки, обсуждение и отзывы в карточке площадки на карте");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(1);
    expect(row.fixes.join(" ")).toMatch(/Незавершённые отправки и их точный повтор сохраняются.*явное восстановление/i);
    expect(row.known_limitations).toHaveLength(10);
    expect(row.known_limitations[0]).toBe("Общее состояние сообщества на карте площадок, вход в отзыв после конкретной игры и снятие публичного автора без замены ещё не доступны");
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(84);
  });

  it("preserves the exact ten-field accepted alpha.71 receipt before the accepted alpha.72 receipt", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.71");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(4142);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "e0586b64cf87dfeb84a22f7ecc5f03a923cc2b496d4008cd7fe537fbf86744a4",
    );
    expect(row.source_sha).toBe("aeaee2dc4de8a0972015df039a153fa4ef06027f");
    expect(row.version_label).toBe("0.1.0-alpha.71");
    expect(row.api_contract_version).toBe("0.40.0");
    expect(row.deployments).toEqual([{
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r42719450513-a1",
      accepted_at: "2026-11-09T23:24:13Z",
      api_digest: "sha256:188f4f74e4d40c6569d25742b0ce43d8c184086712ffe9516f860c2a4d9968c6",
      web_digest: "sha256:1283daafd31b8ca62a2dec15ae14591b10009db30a65eaa9d7561df8c2280921",
      kind: "pipeline",
    }]);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.70")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.slice(-7).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74", "0.1.0-alpha.75",
    ]);
    expect(row.title).toBe("Поиск участников Radar и отображение фильтров игр");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(2);
    const [radarFix, gamesFix] = row.fixes;
    expect(radarFix).toMatch(/После включения Radar и подтверждения активации.*короткая строка поиска/i);
    expect(radarFix).toMatch(/Поиск завершается после ответа на текущий запрос ближайших игроков.*ближайшие участники.*едином списке.*когда расстояние известно.*иначе.*порядок по городу/i);
    expect(radarFix).toMatch(/При задержке или ошибке.*краткий статус/i);
    expect(gamesFix).toMatch(/заголовка и счётчика на телефоне.*отступы горизонтальных переключателей типа игры.*даты на компьютере.*размеры элементов компактного фильтра/i);
    expect(row.known_limitations).toHaveLength(10);
    expect(row.known_limitations[0]).toBe("Общее состояние сообщества на карте площадок, вход в отзыв после конкретной игры и снятие публичного автора без замены ещё не доступны");
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(84);
  });


  it("preserves the exact ten-field accepted alpha.75 seed before unaccepted alpha.76", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.75");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(3484);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "ad82dc20765c173f52869f9f49c49baca5f2dfd0d3cf0cd4add37196e2892b27",
    );
    expect(row.source_sha).toBe("0d8a23f782bd33f993d3a1b7b4850719307fae1b");
    expect(row.version_label).toBe("0.1.0-alpha.75");
    expect(row.api_contract_version).toBe("0.40.0");
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(row.deployments).toEqual([
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42754460186-a1",
        "accepted_at": "2026-11-10T04:23:21Z",
        "api_digest": "sha256:2fb3604d12d7f59353b4a12fffbbcc799115725b731f45b3eb23388afc469908",
        "web_digest": "sha256:aeb8850736af9454c05a07f8f0874c8b5ad8248074f7e7eb8a55135d23a3c654",
        "kind": "pipeline"
      }
    ]);
    expect(row.title).toEqual("Свои отзывы о площадках в профиле");
    expect(row.additions).toEqual([
      "В своём профиле можно посмотреть свои отзывы о площадках и отозвать публикацию. Раздел доступен только владельцу аккаунта."
    ]);
    expect(row.fixes).toEqual([
      "На комментарий или ответ в обсуждении можно пожаловаться. Для отправки жалобы нужен вход в аккаунт."
    ]);
    expect(row.known_limitations).toHaveLength(10);
    expect(row.known_limitations[0]).toBe("Редактирование опубликованного отзыва в пользовательском интерфейсе ещё не доступно");
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual(row.known_limitations.slice(1));
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.74")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.at(-1)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(84);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.76")).toBe(false);
  });

  it("preserves the exact ten-field accepted alpha.74 receipt before the accepted alpha.75 receipt", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.74");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(3566);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "bd1047c5d4a27eb91391ea917a12ab4a0428becfad16980bbdd5156809d6ad11",
    );
    expect(row.source_sha).toBe("a2e18dc96f36d80979a667ee47752ff60667a318");
    expect(row.version_label).toBe("0.1.0-alpha.74");
    expect(row.api_contract_version).toBe("0.40.0");
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(row.deployments).toEqual([{
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r42747213508-a1",
      accepted_at: "2026-11-10T03:11:36Z",
      api_digest: "sha256:21b5fdd93b65c89643fd9662fd8ac99163503821fc0d5e8aa0850ec3e93a6295",
      web_digest: "sha256:094c8357fdbd5791bcc0b87ac9965670c12864f27021bb8e25e018909006330b",
      kind: "pipeline",
    }]);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.73")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.at(-2)).toBe(row);
    expect(row.title).toBe("Прокрутка типов игр без обрезанных кнопок");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toEqual(["На экране «Игры» край списка типов игр подсказывает возможность прокрутки, а последний переключатель виден целиком. При переходе с клавиатуры список прокручивается так, чтобы переключатель в фокусе оставался полностью видимым."]);
    expect(row.known_limitations[0]).toBe("Управление опубликованным отзывом — редактирование и отзыв публикации — в пользовательском интерфейсе ещё не доступно");
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(84);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.76")).toBe(false);
  });

  it("preserves the exact ten-field accepted alpha.73 receipt before the accepted alpha.74 receipt", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.73");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(3719);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "e36d7d982cf5f47cf0e295196320bfaffa952e42ffc223cba6a71dff258a6731",
    );
    expect(row.source_sha).toBe("c157c3b1a5cabc539a8ae1a6c2c468825336df7f");
    expect(row.version_label).toBe("0.1.0-alpha.73");
    expect(row.api_contract_version).toBe("0.40.0");
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(row.deployments).toEqual([{
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r42742161818-a1",
      accepted_at: "2026-11-10T02:27:39Z",
      api_digest: "sha256:918ac96b16ee0b7d1c200df57f8e631a82e4f77d3f0c6221968e9eb542f73d3f",
      web_digest: "sha256:8b850824ccef621eb4824353c1e6e991218c9836ae9b513e3226cd4e28d4b962",
      kind: "pipeline",
    }]);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.72")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.at(-3)).toBe(row);
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(84);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.76")).toBe(false);
  });

  it("preserves the exact ten-field accepted alpha.72 receipt before the accepted alpha.73 receipt", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.72");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(3542);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "40e376d51b1f701e7dad67f95ffb7fba9f49d0a6fdd4acf4e1c9b29539f6284d",
    );
    expect(row.source_sha).toBe("ff3cb00c62c1206530bcc95aba13d196d5266474");
    expect(row.version_label).toBe("0.1.0-alpha.72");
    expect(row.api_contract_version).toBe("0.40.0");
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(row.deployments).toEqual([{
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r42724583100-a1",
      accepted_at: "2026-11-10T00:03:08Z",
      api_digest: "sha256:5c61af0bfc066b5ec520ed9ffb3e3251e565864ad0c43eb7f9009089b45b1a3c",
      web_digest: "sha256:401db641895eb8aa7b7f45f35f3c7a94e9b60cae6e4425891edd7e83b951c9b5",
      kind: "pipeline",
    }]);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.71")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(row.title).toBe("Отзыв о площадке из итогов конкретной игры");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toEqual([
      "Отзыв о площадке теперь открывается из итогов конкретной игры при подтверждённом сервером допуске. Общая кнопка и выбор другой игры на публичной площадке убраны; опубликованные отзывы остаются доступны для чтения.",
    ]);
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(84);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.76")).toBe(false);
  });

  it("keeps eighty-four confirmed seed deployments including accepted alpha.1–alpha.75 and dedupes identical live rows", () => {
    const seedCount = TRUSTED_HISTORICAL_SEED.reduce((n, row) => n + row.deployments.length, 0);
    expect(seedCount).toBe(84);
    const alpha63 = buildHistoryRows(TRUSTED_HISTORICAL_SEED, []).filter(
      (row) => row.application_version === "0.1.0-alpha.63",
    );
    expect(alpha63).toEqual([{
      environment: "dev",
      source_sha: "6ca9ce29a116984c8114f36223895611ab34821a",
      application_version: "0.1.0-alpha.63",
      version_label: "0.1.0-alpha.63",
      title: "Единая кнопка «На карте» в мобильном каталоге игроков",
      release_id: "r42582796773-a1",
      accepted_at: "2026-11-09T08:06:21.000Z",
      status: "ACCEPTED",
      kind: "pipeline",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    }]);
    const alpha64 = buildHistoryRows(TRUSTED_HISTORICAL_SEED, []).filter(
      (row) => row.application_version === "0.1.0-alpha.64",
    );
    expect(alpha64).toEqual([{
      environment: "dev",
      source_sha: "9660409cea06718ef13ec3fbb792679f11619ece",
      application_version: "0.1.0-alpha.64",
      version_label: "0.1.0-alpha.64",
      title: "Профиль без мерцания при открытии страниц",
      release_id: "r42594145053-a1",
      accepted_at: "2026-11-09T09:37:22.000Z",
      status: "ACCEPTED",
      kind: "pipeline",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    }]);
    const alpha65 = buildHistoryRows(TRUSTED_HISTORICAL_SEED, []).filter(
      (row) => row.application_version === "0.1.0-alpha.65",
    );
    expect(alpha65).toEqual([{
      environment: "dev",
      source_sha: "9efe1bc4467a1a74379aee9d4fe870b134130754",
      application_version: "0.1.0-alpha.65",
      version_label: "0.1.0-alpha.65",
      title: "Маскирование нецензурных выражений в открытых обсуждениях",
      release_id: "r42598731549-a1",
      accepted_at: "2026-11-09T10:21:55.000Z",
      status: "ACCEPTED",
      kind: "pipeline",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    }]);
    const alpha66 = buildHistoryRows(TRUSTED_HISTORICAL_SEED, []).filter(
      (row) => row.application_version === "0.1.0-alpha.66",
    );
    expect(alpha66).toEqual([{
      environment: "dev",
      source_sha: "0bbac73f6fba25bb2211e0f564c7416282e70ea0",
      application_version: "0.1.0-alpha.66",
      version_label: "0.1.0-alpha.66",
      title: "Карточка тренировки и подтверждение дружеского матча",
      release_id: "r42608499355-a1",
      accepted_at: "2026-11-09T11:28:13.000Z",
      status: "ACCEPTED",
      kind: "pipeline",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    }]);
    const ordered = buildHistoryRows(TRUSTED_HISTORICAL_SEED, []);
    expect(ordered.slice(0, 9).map((row) => row.application_version)).toEqual([
      "0.1.0-alpha.75", "0.1.0-alpha.74", "0.1.0-alpha.73", "0.1.0-alpha.72", "0.1.0-alpha.71", "0.1.0-alpha.70", "0.1.0-alpha.69", "0.1.0-alpha.68", "0.1.0-alpha.67",
    ]);
    expect(ordered[0]).toMatchObject({
      application_version: "0.1.0-alpha.75",
      source_sha: "0d8a23f782bd33f993d3a1b7b4850719307fae1b",
      release_id: "r42754460186-a1",
      accepted_at: "2026-11-10T04:23:21.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    expect(ordered[1]).toMatchObject({
      application_version: "0.1.0-alpha.74",
      source_sha: "a2e18dc96f36d80979a667ee47752ff60667a318",
      release_id: "r42747213508-a1",
      accepted_at: "2026-11-10T03:11:36.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    expect(ordered[2]).toMatchObject({
      application_version: "0.1.0-alpha.73",
      source_sha: "c157c3b1a5cabc539a8ae1a6c2c468825336df7f",
      release_id: "r42742161818-a1",
      accepted_at: "2026-11-10T02:27:39.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    const alpha73 = TRUSTED_HISTORICAL_SEED.find((row) => row.application_version === "0.1.0-alpha.73")!;
    const receipt73 = alpha73.deployments[0]!;
    const withLive73 = buildHistoryRows(TRUSTED_HISTORICAL_SEED, [{
      environment: "dev",
      observed_at: receipt73.accepted_at,
      pending: false,
      accepted: {
        release_id: receipt73.release_id!,
        source_sha: alpha73.source_sha,
        status: receipt73.status,
        finished_at: receipt73.accepted_at,
        api_digest: receipt73.api_digest,
        web_digest: receipt73.web_digest,
      },
    }]);
    expect(withLive73).toHaveLength(84);
    expect(withLive73.filter((row) => row.application_version === "0.1.0-alpha.73")).toEqual([ordered[2]]);
    expect(ordered[3]).toMatchObject({
      application_version: "0.1.0-alpha.72",
      source_sha: "ff3cb00c62c1206530bcc95aba13d196d5266474",
      release_id: "r42724583100-a1",
      accepted_at: "2026-11-10T00:03:08.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    expect(ordered[4]).toMatchObject({
      application_version: "0.1.0-alpha.71",
      source_sha: "aeaee2dc4de8a0972015df039a153fa4ef06027f",
      release_id: "r42719450513-a1",
      accepted_at: "2026-11-09T23:24:13.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    expect(ordered[5]).toMatchObject({
      application_version: "0.1.0-alpha.70",
      source_sha: "0968028ad7755a8087afbcb0fd8d3a09d7ddb97d",
      release_id: "r42714053715-a1",
      accepted_at: "2026-11-09T22:46:55.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    expect(ordered[6]).toMatchObject({
      application_version: "0.1.0-alpha.69",
      source_sha: "5568044d725d306e3bb3ce032e767cf7d3586c60",
      release_id: "r42697926974-a1",
      accepted_at: "2026-11-09T21:03:51.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    expect(ordered[7]).toMatchObject({
      source_sha: "2c33ce49d5b8ad704bf78524b8149c94e4d3e62e",
      release_id: "r42627002935-a1",
      accepted_at: "2026-11-09T13:42:50.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    expect(ordered[8]).toMatchObject({
      source_sha: "04fdc58b53e79996ccdb21a7396c5d1525cfbd10",
      release_id: "r42613449482-a1",
      accepted_at: "2026-11-09T12:05:53.000Z",
      status: "ACCEPTED",
      owner_uat: "NOT_TESTED",
      origin: "seed",
    });
    expect(buildHistoryRows(TRUSTED_HISTORICAL_SEED, []).some(
      (row) => row.application_version === CURRENT_APPLICATION_VERSION,
    )).toBe(false);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(79);
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
    expect(rows.every((row) =>
      row.application_version == null
      || row.application_version === FIRST_NAMED_APPLICATION_VERSION
      || row.application_version === "0.1.0-alpha.2"
      || row.application_version === "0.1.0-alpha.3"
      || row.application_version === "0.1.0-alpha.4"
      || row.application_version === "0.1.0-alpha.5"
      || row.application_version === "0.1.0-alpha.6"
      || row.application_version === "0.1.0-alpha.7"
      || row.application_version === "0.1.0-alpha.8"
      || row.application_version === "0.1.0-alpha.9"
      || row.application_version === "0.1.0-alpha.10"
      || row.application_version === "0.1.0-alpha.11"
      || row.application_version === "0.1.0-alpha.12"
      || row.application_version === "0.1.0-alpha.13"
      || row.application_version === "0.1.0-alpha.14"
      || row.application_version === "0.1.0-alpha.15"
      || row.application_version === "0.1.0-alpha.16"
      || row.application_version === "0.1.0-alpha.17"
      || row.application_version === "0.1.0-alpha.18"
      || row.application_version === "0.1.0-alpha.19"
      || row.application_version === "0.1.0-alpha.20"
      || row.application_version === "0.1.0-alpha.21"
      || row.application_version === "0.1.0-alpha.22"
      || row.application_version === "0.1.0-alpha.23"
      || row.application_version === "0.1.0-alpha.24"
      || row.application_version === "0.1.0-alpha.25"
      || row.application_version === "0.1.0-alpha.26"
      || row.application_version === "0.1.0-alpha.27"
      || row.application_version === "0.1.0-alpha.28"
      || row.application_version === "0.1.0-alpha.29"
      || row.application_version === "0.1.0-alpha.30"
      || row.application_version === "0.1.0-alpha.31"
      || row.application_version === "0.1.0-alpha.32"
      || row.application_version === "0.1.0-alpha.33"
      || row.application_version === "0.1.0-alpha.34"
      || row.application_version === "0.1.0-alpha.35"
      || row.application_version === "0.1.0-alpha.36"
      || row.application_version === "0.1.0-alpha.37"
      || row.application_version === "0.1.0-alpha.38"
      || row.application_version === "0.1.0-alpha.39"
      || row.application_version === "0.1.0-alpha.40"
      || row.application_version === "0.1.0-alpha.41"
      || row.application_version === "0.1.0-alpha.42"
      || row.application_version === "0.1.0-alpha.43"
      || row.application_version === "0.1.0-alpha.44"
      || row.application_version === "0.1.0-alpha.45"
      || row.application_version === "0.1.0-alpha.46"
      || row.application_version === "0.1.0-alpha.47"
      || row.application_version === "0.1.0-alpha.48"
      || row.application_version === "0.1.0-alpha.49"
      || row.application_version === "0.1.0-alpha.50"
      || row.application_version === "0.1.0-alpha.51"
      || row.application_version === "0.1.0-alpha.52"
      || row.application_version === "0.1.0-alpha.53"
      || row.application_version === "0.1.0-alpha.54"
      || row.application_version === "0.1.0-alpha.55"
      || row.application_version === "0.1.0-alpha.56"
      || row.application_version === "0.1.0-alpha.57"
      || row.application_version === "0.1.0-alpha.58"
      || row.application_version === "0.1.0-alpha.59"
      || row.application_version === "0.1.0-alpha.60"
      || row.application_version === "0.1.0-alpha.61"
      || row.application_version === "0.1.0-alpha.62"
      || row.application_version === "0.1.0-alpha.63"
      || row.application_version === "0.1.0-alpha.64"
      || row.application_version === "0.1.0-alpha.65"
      || row.application_version === "0.1.0-alpha.66"
      || row.application_version === "0.1.0-alpha.67"
      || row.application_version === "0.1.0-alpha.68"
      || row.application_version === "0.1.0-alpha.69"
      || row.application_version === "0.1.0-alpha.70"
      || row.application_version === "0.1.0-alpha.71"
      || row.application_version === "0.1.0-alpha.72"
      || row.application_version === "0.1.0-alpha.73"
      || row.application_version === "0.1.0-alpha.74"
      || row.application_version === "0.1.0-alpha.75",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.55"
      && row.source_sha === "edc6744ce0f96dcaa922dafcd373fdab8e482bf8"
      && row.deployments[0]?.release_id === "r42455870420-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T06:58:58Z",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.56"
      && row.source_sha === "524088767e2b7e77d569c2f0a47689db854ab7b0"
      && row.deployments[0]?.release_id === "r42465159954-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T09:11:48Z"
      && row.api_contract_version === "0.39.0"
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.57"
      && row.source_sha === "895e97fd5f60e4eaaa493cb911cd7d3d7fdd4c22"
      && row.deployments[0]?.release_id === "r42486594258-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T13:53:05Z"
      && row.api_contract_version === "0.39.0"
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.58"
      && row.source_sha === "190187919cb3e36839aabc543e2c85d206de0cb4"
      && row.deployments[0]?.release_id === "r42508393660-a3"
      && row.deployments[0]?.accepted_at === "2026-11-08T18:34:32Z"
      && row.api_contract_version === "0.40.0"
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.59"
      && row.source_sha === "360e308199da1fd58afda631cef9e432c427ff07"
      && row.deployments[0]?.release_id === "r42521707427-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T20:50:15Z"
      && row.api_contract_version === "0.40.0"
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.60"
      && row.source_sha === "2db4aafece41939f9e209bae9015f90da1d8ca7a"
      && row.deployments[0]?.release_id === "r42528128745-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T22:07:51Z"
      && row.api_contract_version === "0.40.0"
      && row.owner_uat === "NOT_TESTED"
      && row.known_limitations.some((item) => /визуальный дефект|узкие колонки/i.test(item)),
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.61"
      && row.source_sha === "23a3d2dba33d79da55151e5d1eff8ff54d9d74ce"
      && row.deployments[0]?.release_id === "r42532364094-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T22:56:54Z"
      && row.api_contract_version === "0.40.0"
      && row.owner_uat === "NOT_TESTED"
      && row.known_limitations.some((item) => /мобильная кнопка|унификация действий/i.test(item)),
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.62"
      && row.source_sha === "65b987116184dada309b87054b5cbe42c0f21578"
      && row.deployments[0]?.release_id === "r42540492310-a1"
      && row.deployments[0]?.accepted_at === "2026-11-09T00:42:02Z"
      && row.deployments[0]?.api_digest === "sha256:0508f4747bd38eebdd465b5d14c1fd29962c9bb2fe1b3c3a2a20a90da9ac333b"
      && row.deployments[0]?.web_digest === "sha256:cac3c8981b7444f8c91752db7a3fd4001e1514521b2aad8ec1cc42343b3a6e15"
      && row.api_contract_version === "0.40.0"
      && row.owner_uat === "NOT_TESTED"
      && row.fixes.length === 3
      && row.fixes.some((item) => /не требует подтверждать.*самому себе/i.test(item))
      && row.fixes.some((item) => /не разрывается внутри слова/i.test(item)),
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.54"
      && row.source_sha === "cce49ce72daed8c81f89ddc845deabbb8ac5d7aa"
      && row.deployments[0]?.release_id === "r42449222181-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T05:18:57Z",
    )).toBe(true);
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.76");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.41.0");
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
    expect(CURRENT_NAMED_RELEASE.fixes).toEqual([
      "Если отзыв или условия его отправки изменились, нужно перечитать выбранный отзыв и подтвердить отправку заново.",
      "Если результат отправки неизвестен, форма сохраняет отправленные данные для повторной проверки. После смены аккаунта данные прежнего пользователя скрываются.",
    ]);
    expect(CURRENT_NAMED_RELEASE.title).toBe("Редактирование своих отзывов о площадках");
    expect(CURRENT_NAMED_RELEASE.additions).toEqual([
      "В своём профиле можно отредактировать свой отзыв о площадке и сохранить новую редакцию. Форма открывает сохранённые текст, темы и видимость выбранного отзыва; раздел доступен только владельцу аккаунта.",
      "Перед отправкой публичной редакции нужно просмотреть, что будет опубликовано, и заново подтвердить согласие.",
    ]);
    const currentDelta = [...CURRENT_NAMED_RELEASE.additions, ...CURRENT_NAMED_RELEASE.fixes].join(" ");
    expect(currentDelta).not.toMatch(/нов.*(?:допуск|срок|окн)|медиа|нативн|автоматическ.*удал|модераци.*(?:заверш|выполн)|приёмк.*пройдена/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(/(?:просмотр|отзыв публикации).*ещё не доступ/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations).toHaveLength(9);
    expect(CURRENT_NAMED_RELEASE.known_limitations).not.toContain(
      "Редактирование опубликованного отзыва в пользовательском интерфейсе ещё не доступно",
    );
    const currentLimitations = CURRENT_NAMED_RELEASE.known_limitations.join(" ");
    expect(currentLimitations).not.toMatch(/вход.*отзыв.*ещё не\s*доступ/i);
    expect(currentLimitations).not.toMatch(/карте площадок.*ещё не\s*доступ/i);
    expect(currentLimitations).not.toMatch(/публичного автора без замены/i);
    expect(FIRST_ALPHA_FEATURES).toHaveLength(35);
    expect(TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version == null)).toHaveLength(2);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === FIRST_NAMED_APPLICATION_VERSION
      && row.source_sha === "8733578a2f8a6cfd860371e8a2c2aa39f1b885bb",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.2"
      && row.source_sha === "38a4700c68ed85189007dcab3c859c98eb37bf46",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.3"
      && row.source_sha === "7b75fbed6b2582c9594ff71566566df625b5672d",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.4"
      && row.source_sha === "7a36b8d94a5df412426155e5852fddd9da7b0045",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.5")).toHaveLength(2);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.5"
      && row.source_sha === "06991b099317a702dc102eeef53ee64cfa841f0e"
      && row.deployments[0]?.release_id === "r41317332177-a1",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.5"
      && row.source_sha === "84cedf79ec6d0582ef1197589acd808f9470f62c"
      && row.deployments[0]?.release_id === "r41319296538-a1",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.6"
      && row.source_sha === "4fdf232ac576b7c830c77405267795634b9ae43b"
      && row.deployments[0]?.release_id === "r41329378049-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T17:07:45Z"
      && row.deployments[0]?.api_digest === "sha256:753b6ba373560b59cb0840b3d69ed19100629d8332004e208ac9fdced762c0c0"
      && row.deployments[0]?.web_digest === "sha256:7a8c300478d2a2ab428cee687f5e64cfb3db294eb38f25f3f48dae9a16163e40",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.7"
      && row.source_sha === "dd3839814fdb4ed8e05a64301e4aaaacff5cf0cc"
      && row.deployments[0]?.release_id === "r41331655353-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T17:33:52Z"
      && row.deployments[0]?.api_digest === "sha256:c11807e1d7d9661f284a64236288c98f8afc1a53d1029c59ec51c9121b9f3705"
      && row.deployments[0]?.web_digest === "sha256:25a6f51d6d5b5a5218a9b8e2ae84fdf3561dde274e1ff6705bb07501f1e9fba1",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.8"
      && row.source_sha === "26f3ba38d9c04730674b084c0266afc193662398"
      && row.deployments[0]?.release_id === "r41339991160-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T19:18:15Z"
      && row.deployments[0]?.api_digest === "sha256:343c821a5525c2e3ecff8906ac9838ba632867011d4b2ce07d111193f93442e0"
      && row.deployments[1]?.environment === "prod"
      && row.deployments[1]?.accepted_at === "2026-11-01T19:30:08.857934Z"
      && row.deployments[1]?.kind === "managed_application_only",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.9"
      && row.source_sha === "783a1897167be1f531312b9a6812b6240181e2c3"
      && row.deployments[0]?.release_id === "r41345457119-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T20:21:50Z"
      && row.deployments[0]?.api_digest === "sha256:722cf29edad73ef6c30bc215a0a69801259b581b46faf12a421293c0b41f1267"
      && row.deployments[0]?.web_digest === "sha256:d13dc563b86e7f36c2dfa168a93e25dbd9ea6d2c605904ecd0668f5832c440d1"
      && row.deployments.length === 1,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.10"
      && row.source_sha === "1dc5000280d617c3160fc959ee87607db394410c"
      && row.deployments[0]?.release_id === "r41349542541-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T21:03:36Z"
      && row.deployments[0]?.api_digest === "sha256:a71fe6979b045a09bb348cce3e7f57ffbab952e5b52edc632849ef3776e49970"
      && row.deployments[0]?.web_digest === "sha256:3d57f99e22af3f1fac4a64956a38745862d434abd42ce17f9ff026e7cf0a87b0"
      && row.deployments.length === 1,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.11"
      && row.source_sha === "acec520281d07f30d3fa855043be7d613ba56db1"
      && row.deployments[0]?.release_id === "r41361963371-a1"
      && row.deployments[0]?.accepted_at === "2026-11-01T23:30:16Z"
      && row.deployments[0]?.api_digest === "sha256:a89e5c9c8018914c6ac6aee2bbb666c6d99a0fd892db5aad0ede730056e9667c"
      && row.deployments[0]?.web_digest === "sha256:efcbef6285944a2ea38f1156c00dd234756cf4834d2d7edb4281d6d115ace534"
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
      && row.api_contract_version === "0.26.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.17"
      && row.source_sha === "b28ce4bed4ba33f7fe1e90ebc1b7a86495e8806e"
      && row.deployments[0]?.release_id === "r41452395940-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T13:28:07Z"
      && row.deployments[0]?.api_digest === "sha256:f4a4d7a038d67b66ecf9829cdb396bb589ee5109350acec11ccee2857be3886a"
      && row.deployments[0]?.web_digest === "sha256:fff841c229641f53e55a14ed6860a113e5bb148eb8c869247c9d83b5eae94d48"
      && row.deployments.length === 1
      && row.api_contract_version === "0.26.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.18"
      && row.source_sha === "6cd66a77068d6ab2faa283867d6320896b0c5177"
      && row.deployments[0]?.release_id === "r41456359306-a1"
      && row.deployments[0]?.accepted_at === "2026-11-02T13:55:41Z"
      && row.deployments[0]?.api_digest === "sha256:a48a7bebe6cc86b56a0ed08760f94f8db4aac2bd55f8d262354cab77a066e34b"
      && row.deployments[0]?.web_digest === "sha256:81fc859c425688f551f5f427362a5e49dd55cc28665337ee904db634efb1bd69"
      && row.deployments.length === 1
      && row.api_contract_version === "0.26.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.19"
      && row.source_sha === "7f33e9da0cf7b52d260567bbfb37114a3613d479"
      && row.deployments[0]?.release_id === "r41479055286-a2"
      && row.deployments[0]?.accepted_at === "2026-11-02T16:28:48Z"
      && row.deployments[0]?.api_digest === "sha256:22d423424f8ca916e056ae785c7acbc3916b9a0a426105d82ef94f8630d40fb4"
      && row.deployments[0]?.web_digest === "sha256:414ce175c6f81fd722159f143c0f6c42f409a7938f7e0ab6b2caf3d52d22c174"
      && row.deployments.length === 1
      && row.api_contract_version === "0.27.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.20"
      && row.source_sha === "9db516ce96499d440a49e7e35029137c33a11429"
      && row.deployments[0]?.release_id === "r41562101222-a1"
      && row.deployments[0]?.accepted_at === "2026-11-03T02:01:14Z"
      && row.deployments[0]?.api_digest === "sha256:7f84a7cd5a01abfb3752a8fc2de2d87311e6e5c1e61b076863eb6666b697002e"
      && row.deployments[0]?.web_digest === "sha256:3b576868391ea2d808f13d1e1cf559392c284bff53074cc80733fd88cde57c0d"
      && row.deployments.length === 1
      && row.api_contract_version === "0.28.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.21"
      && row.source_sha === "faa236ab8b52716d6e0fbed0d7fefa87334ee02f"
      && row.deployments[0]?.release_id === "r41574322192-a1"
      && row.deployments[0]?.accepted_at === "2026-11-03T04:02:27Z"
      && row.api_contract_version === "0.29.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.21"
      && row.source_sha === "98f765c39d4f9cd4c6ef7005884f84b1af197d45"
      && row.deployments[0]?.release_id === "r41747908212-a1"
      && row.deployments[0]?.accepted_at === "2026-11-04T00:49:07Z"
      && row.api_contract_version === "0.29.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.22"
      && row.source_sha === "e637e937d7fa780983daaac92cbe22e26c82ef1b"
      && row.deployments[0]?.release_id === "r41818484518-a1"
      && row.deployments[0]?.accepted_at === "2026-11-04T11:17:16Z"
      && row.deployments[0]?.api_digest === "sha256:ffa1c8e8447ee2c0b5c99ddce7a8b490780b41aade215c8493122ecf95476cbf"
      && row.deployments[0]?.web_digest === "sha256:a28d441946607160b4967abb72f78f6a09ac5b2c374b596bac6e4bb5a3c30314"
      && row.api_contract_version === "0.30.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.flatMap((row) => row.deployments).map((d) => d.accepted_at)).toEqual([
      "2026-10-31T20:28:18Z",
      "2026-10-31T23:22:12.477839Z",
      "2026-11-01T00:02:38Z",
      "2026-11-01T00:04:47.811785Z",
      "2026-11-01T00:45:11Z",
      "2026-11-01T00:47:25.574224Z",
      "2026-11-01T08:17:46Z",
      "2026-11-01T08:19:28.308318Z",
      "2026-11-01T10:54:33Z",
      "2026-11-01T13:34:38Z",
      "2026-11-01T14:52:56Z",
      "2026-11-01T15:08:02Z",
      "2026-11-01T17:07:45Z",
      "2026-11-01T17:33:52Z",
      "2026-11-01T19:18:15Z",
      "2026-11-01T19:30:08.857934Z",
      "2026-11-01T20:21:50Z",
      "2026-11-01T21:03:36Z",
      "2026-11-01T23:30:16Z",
      "2026-11-02T00:59:40Z",
      "2026-11-02T05:32:06Z",
      "2026-11-02T07:58:39Z",
      "2026-11-02T11:23:40Z",
      "2026-11-02T12:47:49Z",
      "2026-11-02T13:28:07Z",
      "2026-11-02T13:55:41Z",
      "2026-11-02T16:28:48Z",
      "2026-11-03T02:01:14Z",
      "2026-11-03T04:02:27Z",
      "2026-11-04T00:49:07Z",
      "2026-11-04T11:17:16Z",
      "2026-11-04T12:06:05Z",
      "2026-11-04T13:45:22Z",
      "2026-11-04T14:53:12Z",
      "2026-11-04T23:55:28Z",
      "2026-11-05T00:34:19Z",
      "2026-11-05T02:00:50Z",
      "2026-11-05T02:24:52Z",
      "2026-11-06T17:26:22Z",
      "2026-11-06T18:25:52Z",
      "2026-11-06T19:34:49Z",
      "2026-11-06T20:43:19Z",
      "2026-11-06T21:08:02Z",
      "2026-11-07T01:05:19Z",
      "2026-11-07T01:45:38Z",
      "2026-11-07T02:10:06Z",
      "2026-11-07T04:27:56Z",
      "2026-11-07T09:34:34Z",
      "2026-11-07T10:09:04Z",
      "2026-11-07T11:13:52Z",
      "2026-11-07T11:55:54Z",
      "2026-11-07T12:33:39Z",
      "2026-11-07T13:41:23Z",
      "2026-11-07T17:12:03Z",
      "2026-11-07T18:20:21Z",
      "2026-11-07T19:05:58Z",
      "2026-11-07T20:59:58Z",
      "2026-11-07T22:12:06Z",
      "2026-11-07T23:32:15Z",
      "2026-11-08T00:08:42Z",
      "2026-11-08T01:56:35Z",
      "2026-11-08T03:29:11Z",
      "2026-11-08T05:18:57Z",
      "2026-11-08T06:58:58Z",
      "2026-11-08T09:11:48Z",
      "2026-11-08T13:53:05Z",
      "2026-11-08T18:34:32Z",
      "2026-11-08T20:50:15Z",
      "2026-11-08T22:07:51Z",
      "2026-11-08T22:56:54Z",
      "2026-11-09T00:42:02Z",
      "2026-11-09T08:06:21Z",
      "2026-11-09T09:37:22Z",
      "2026-11-09T10:21:55Z",
      "2026-11-09T11:28:13Z",
      "2026-11-09T12:05:53Z",
      "2026-11-09T13:42:50Z",
      "2026-11-09T21:03:51Z",
      "2026-11-09T22:46:55Z",
      "2026-11-09T23:24:13Z",
      "2026-11-10T00:03:08Z",
      "2026-11-10T02:27:39Z",
      "2026-11-10T03:11:36Z",
      "2026-11-10T04:23:21Z",
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

import { createHash } from "node:crypto";
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
  it("keeps alpha.63 map changes in its accepted historical row", () => {
    const row = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.63");
    expect(row).toMatchObject({
      application_version: "0.1.0-alpha.63",
      version_label: "0.1.0-alpha.63",
      source_sha: "6ca9ce29a116984c8114f36223895611ab34821a",
      title: "Единая кнопка «На карте» в мобильном каталоге игроков",
      api_contract_version: "0.40.0",
      owner_uat: "NOT_TESTED",
      additions: [],
      deployments: [{
        environment: "dev",
        status: "ACCEPTED",
        release_id: "r42582796773-a1",
        accepted_at: "2026-11-09T08:06:21Z",
        api_digest: "sha256:809b872e969e7930d297513b76696a90c7fcc506ef88b39278f4dc35deb2bd4a",
        web_digest: "sha256:4cc56bf69a905d6750cdb3ae7ecf9a4e95b18c5de6b0b78fb10714d768318576",
        kind: "pipeline",
      }],
    });
    expect(Object.keys(row!)).toHaveLength(10);
    expect(row!.fixes).toHaveLength(2);
    expect(row!.fixes.join(" ")).toMatch(/На карте.*сложенной карты|сложенной карты.*На карте/);
    expect(row!.fixes.join(" ")).toMatch(/унифицированы кнопки действий.*не компоновка целиком/);
    expect(row!.known_limitations).toHaveLength(6);
  });

  it("preserves the exact ten-field trusted alpha.64 receipt and historical header fix", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.64");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(2805);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "5657197cd227b028993775f205f9675639bcb41b64f2683ca0ec8a76cafab752",
    );
    expect(row.title).toBe("Профиль без мерцания при открытии страниц");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(1);
    const fixes = row.fixes.join(" ");
    expect(fixes).toMatch(/первом открытии и перезагрузке.*публичное имя и аватар в шапке.*без мерцания/i);
    expect(fixes).toMatch(/после выхода из аккаунта или смены пользователя.*актуальное состояние входа/i);
    expect(fixes).not.toMatch(/На карте|сложенной карты|Radar|унифицированы кнопки действий|alpha\.62/i);
    expect(row.known_limitations).toHaveLength(7);
    expect(row.known_limitations.join(" ")).toMatch(/реальным аккаунтом.*перезагрузке.*390 и 1280.*ещё не выполнена/i);
    expect(row.known_limitations.join(" ")).toMatch(/#506.*пока не доступно пользователям/i);
    expect(row.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field trusted alpha.65 receipt and historical public comment mask", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.65");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(3075);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "dbf3195231dcbea1dee7a363698d3f9133599fd9c5584c21e84247a08bb2469f",
    );
    expect(row.title).toBe("Маскирование нецензурных выражений в открытых обсуждениях");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(1);
    const fixes = row.fixes.join(" ");
    expect(fixes).toMatch(/обсуждениях игр и площадок.*нецензурные выражения показываются замаскированными/i);
    expect(fixes).toMatch(/в ответах.*после редактирования.*повторной отправке того же комментария/i);
    expect(fixes).not.toMatch(/На карте|сложенной карты|Radar|унифицированы кнопки действий|alpha\.62/i);
    expect(row.known_limitations).toHaveLength(8);
    expect(row.known_limitations.join(" ")).toMatch(/#506.*проверка маскирования.*ещё не выполнена/i);
    expect(row.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field trusted alpha.66 receipt and historical trainer and match fixes", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.66");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(4013);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "ce994d29970fd5dfe15db23f08f326c189b989595719f2ce0b977ce6deb59b54",
    );
    expect(row.title).toBe("Карточка тренировки и подтверждение дружеского матча");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(2);
    const fixes = row.fixes.join(" ");
    expect(fixes).toMatch(/роли тренера и организатора показаны согласованно/i);
    expect(fixes).toMatch(/«Отзывы и история» изначально свёрнут.*раскрывает отзывы и историю отдельно по ролям/i);
    expect(fixes).toMatch(/метка «С тренером» читается целиком/i);
    expect(fixes).toMatch(/квадратные фотографии на широком экране и мобильные кнопки действий/i);
    expect(fixes).toMatch(/подтверждённом взаимном желании сыграть.*«Дружеский матч».*именами обоих игроков и продолжением поиска/i);
    expect(fixes).toMatch(/переход к общению зависит от текущих прав/i);
    expect(fixes).toMatch(/высоту экрана и безопасные отступы/i);
    expect(row.known_limitations).toHaveLength(9);
    expect(row.owner_uat).toBe("NOT_TESTED");
  });

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
    expect(CURRENT_NAMED_RELEASE.known_limitations.slice(1)).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(78);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(83);
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
    expect(TRUSTED_HISTORICAL_SEED.slice(-7).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.68", "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74",
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
    expect(CURRENT_NAMED_RELEASE.known_limitations.slice(1)).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(78);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(83);
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
    expect(TRUSTED_HISTORICAL_SEED.slice(-6).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74",
    ]);
    expect(row.title).toBe("Оценки, обсуждение и отзывы в карточке площадки на карте");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(1);
    expect(row.fixes.join(" ")).toMatch(/Незавершённые отправки и их точный повтор сохраняются.*явное восстановление/i);
    expect(row.known_limitations).toHaveLength(10);
    expect(row.known_limitations[0]).toBe("Общее состояние сообщества на карте площадок, вход в отзыв после конкретной игры и снятие публичного автора без замены ещё не доступны");
    expect(CURRENT_NAMED_RELEASE.known_limitations.slice(1)).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(78);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(83);
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
    expect(TRUSTED_HISTORICAL_SEED.slice(-6).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74",
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
    expect(CURRENT_NAMED_RELEASE.known_limitations.slice(1)).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(78);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(83);
  });


  it("preserves the exact ten-field accepted alpha.74 receipt before unaccepted alpha.75", () => {
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
    expect(TRUSTED_HISTORICAL_SEED.at(-1)).toBe(row);
    expect(row.title).toBe("Прокрутка типов игр без обрезанных кнопок");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toEqual(["На экране «Игры» край списка типов игр подсказывает возможность прокрутки, а последний переключатель виден целиком. При переходе с клавиатуры список прокручивается так, чтобы переключатель в фокусе оставался полностью видимым."]);
    expect(row.known_limitations[0]).toBe("Управление опубликованным отзывом — редактирование и отзыв публикации — в пользовательском интерфейсе ещё не доступно");
    expect(CURRENT_NAMED_RELEASE.known_limitations.slice(1)).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(78);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(83);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.75")).toBe(false);
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
    expect(TRUSTED_HISTORICAL_SEED.at(-2)).toBe(row);
    expect(CURRENT_NAMED_RELEASE.known_limitations.slice(1)).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(78);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(83);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.75")).toBe(false);
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
    expect(CURRENT_NAMED_RELEASE.known_limitations.slice(1)).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(78);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(83);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.75")).toBe(false);
  });

  it("keeps first alpha.1 baseline literal while current descriptor is alpha.75 delta", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.75");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.40.0");
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
    expect(currentProse).toMatch(/Свои отзывы о площадках в профиле/i);
    expect(currentProse).toContain("На комментарий или ответ в обсуждении можно пожаловаться.");
    expect(currentProse).toContain("Для отправки жалобы нужен вход в аккаунт.");
    expect(currentProse).toMatch(/1 января 2027|2027 UTC/i);
    expect(currentProse).toMatch(/приёмк|iPhone|GoBad|#506|#522/i);
    expect(currentProse).not.toMatch(/\bDEV\b|operator|alias/i);
    expect(currentProse).not.toMatch(/\bSafety\b|PG-4|PG-3|\bPROD\b|MutationRunner|OpenAPI|Cases|legacy|replay/i);
    expect(currentProse).not.toMatch(
      /directoryVisible|contactPolicy|owner_default|\bACTIVE\b|\bOFF\b|login\/reread|pristine|synthetic/i,
    );
    expect(currentProse).not.toMatch(/PROD остаётся alpha\.2|не развёрнут|не установлен|DEV remains/i);
    expect(currentProse).not.toMatch(/опрос каталога в простое|селектор города|idle polling/i);
    expect(currentProse).not.toMatch(/уже изменены|уже применены|Цех №1|Старая деревня/i);
    expect(currentProse).not.toMatch(/134|138|140|Slow4G|5555|8656|все фото|prefetch|переписан|переписать|Изменить/i);
    expect(currentProse).not.toMatch(/новых типов уведомлен|новой модели разрешен|все файлы переименова/i);
    expect(currentProse).not.toMatch(/nonce|claim_nonce|Idempotency|WebP|#507|Mode B|независим.*зал|RBAC|\bSQL\b/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/приёмк|НЕ выполн|iPhone|GoBad/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(
      /электронной почте недоступен|после игры не запущен|Push-уведомления не активны|push-уведомления не активны/i,
    );
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/юридическ|контакт поддержки|удаление аккаунта/i);
    expect(CURRENT_NAMED_RELEASE.additions).toEqual([
      "В своём профиле можно посмотреть свои отзывы о площадках и отозвать публикацию. Раздел доступен только владельцу аккаунта.",
    ]);
    const currentDelta = [...CURRENT_NAMED_RELEASE.additions, ...CURRENT_NAMED_RELEASE.fixes].join(" ");
    expect(currentDelta).not.toMatch(/редактир|нов.*(?:допуск|срок|окн)|медиа|нативн|автоматическ.*удал|модераци.*(?:заверш|выполн)|приёмк.*пройдена/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(/(?:просмотр|отзыв публикации).*ещё не доступ/i);
    expect(CURRENT_NAMED_RELEASE.title).toBe("Свои отзывы о площадках в профиле");
    expect(CURRENT_NAMED_RELEASE.fixes).toEqual([
      "На комментарий или ответ в обсуждении можно пожаловаться. Для отправки жалобы нужен вход в аккаунт.",
    ]);
    const fixes = CURRENT_NAMED_RELEASE.fixes.join(" ");
    expect(fixes).not.toMatch(/меню/i);
    expect(fixes).toMatch(/На комментарий или ответ в обсуждении можно пожаловаться\./i);
    expect(fixes).toMatch(/Для отправки жалобы нужен вход в аккаунт/i);
    expect(fixes).not.toMatch(/автоматическ|автоотправ|сам.*публику|14.*дн|I2|I3|UGC|#549|нативн.*прилож|#507.*(?:DONE|заверш|выполн)/i);
    // D1 cause remains UNKNOWN; reset 2.0/session-only checks do not prove a repaired cause or persistence.
    expect(fixes).not.toMatch(/D1|причин|сброс|reset|2\.0|сесси|session|URL|storage|после перезагрузки|сохраняется после закрытия/i);
    expect(fixes).not.toMatch(/фотограф|фото|галере/i);
    expect(fixes).not.toMatch(/По времени|Прежний фильтр уровня|после конкретной игры|фотограф|галере|нативн.*прилож|#507.*(?:заверш|выполн)/i);
    expect(fixes).not.toMatch(/#507A|#530|Порядок ролей|В нижней строке карточки тренировки|Отзывы и история|Подробнее|Поделиться/i);
    expect(fixes).not.toMatch(/исходного HTML|подтверждённом взаимном желании|роли тренера и организатора показаны согласованно|квадратные фотографии|маскирование|публичного автора/i);
    expect(fixes).not.toMatch(/быстрее|ускорен|\d+\s*(мс|ms|сек|%)/i);
    expect(fixes).not.toMatch(/нецензурные выражения.*замаскированными|Маскирование/i);
    expect(fixes).not.toMatch(/Единая кнопка «На карте»|сложенной карты|унифицированы кнопки действий|alpha\.62/i);
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/карточки тренировки.*«Дружеский матч».*реальными ролями, обычным входом и сетевыми ответами ещё не выполнена/i);
    expect(CURRENT_NAMED_RELEASE).not.toHaveProperty("accepted_at");
    expect(CURRENT_NAMED_RELEASE).not.toHaveProperty("deployments");
    expect(CURRENT_NAMED_RELEASE).not.toHaveProperty("api_digest");
    expect(CURRENT_NAMED_RELEASE).not.toHaveProperty("web_digest");
    expect(fixes).not.toMatch(/публичное имя и аватар в шапке|без мерцания|после выхода из аккаунта/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(/маскирование.*пока не доступно пользователям/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/личных сообщений и закрытых чатов не заявляется завершённой/i);
    expect(currentProse).not.toMatch(/проверки (входа|авторизации).*отменены|постоянно.*(кэш|сохранён)|приёмка.*пройдена/i);
    expect(currentProse).not.toMatch(/\bOPS\b|cache.?scope|admission|ownership|\bwriter\b|кэш/i);
    expect(CURRENT_NAMED_RELEASE.fixes.join(" ")).not.toMatch(
      /не требует подтверждать.*самому себе|не разрывается внутри слова|собственн.*посещени/i,
    );
    expect(CURRENT_NAMED_RELEASE.known_limitations).toHaveLength(10);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/проверка загрузки фотографии площадки в установленной версии ещё не выполнена/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/реальным аккаунтом.*перезагрузке.*390 и 1280.*ещё не выполнена/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/#506.*проверка маскирования.*редактирования с действующими правами.*разбора жалоб.*ещё не выполнена/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations[0]).toBe(
      "Редактирование опубликованного отзыва в пользовательском интерфейсе ещё не доступно",
    );
    const currentLimitations = CURRENT_NAMED_RELEASE.known_limitations.join(" ");
    expect(currentLimitations).not.toMatch(/вход.*отзыв.*ещё не\s*доступ/i);
    expect(currentLimitations).not.toMatch(/карте площадок.*ещё не\s*доступ/i);
    expect(currentLimitations).not.toMatch(/публичного автора без замены/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(
      /проверк|приёмк|юридическ|2027|iPhone|GoBad|фотограф|#506|#522|карт/i,
    );
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(
      /\bB2b\b|\bB2a\b|\bMode B\b|nonce|claim_nonce|Idempotency/i,
    );
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
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(78);
    expect(
      TRUSTED_HISTORICAL_SEED.reduce((n, row) => n + row.deployments.length, 0),
    ).toBe(83);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.55"
      && row.source_sha === "edc6744ce0f96dcaa922dafcd373fdab8e482bf8"
      && row.deployments[0]?.release_id === "r42455870420-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T06:58:58Z"
      && row.deployments[0]?.api_digest === "sha256:59d94a8d7a0a199693e1aa388e7a5ca5b032df6735a19b716612477460703b06"
      && row.deployments[0]?.web_digest === "sha256:e2cba1cdaddd2b2779c7075e487b428239ea6e5d5c0988e9b88dcdd4a6721ee5"
      && row.api_contract_version === "0.38.0"
      && row.title === "Жалоба на выбранное сообщение с явным согласием и чтением источника в обращении"
      && row.additions.length === 1
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.56"
      && row.version_label === "0.1.0-alpha.56"
      && row.source_sha === "524088767e2b7e77d569c2f0a47689db854ab7b0"
      && row.deployments[0]?.release_id === "r42465159954-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T09:11:48Z"
      && row.deployments[0]?.api_digest === "sha256:58e9c86acd10434b1e748c4dfffe7aac0bd375070559c8458a40ffbd1113927c"
      && row.deployments[0]?.web_digest === "sha256:7457fe35b99d31b9bc48e1dbf862ff39a23eb1a11cf471dfeb2dd1e5cb2932e4"
      && row.deployments[0]?.environment === "dev"
      && row.deployments[0]?.status === "ACCEPTED"
      && row.deployments[0]?.kind === "pipeline"
      && row.deployments.length === 1
      && row.api_contract_version === "0.39.0"
      && row.title === "Скрытие непроверенных фото из VK/Яндекс и журнал метаданных модерации"
      && row.additions.length === 2
      && row.fixes.length === 0
      && row.known_limitations.length === 4
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.57"
      && row.version_label === "0.1.0-alpha.57"
      && row.source_sha === "895e97fd5f60e4eaaa493cb911cd7d3d7fdd4c22"
      && row.deployments[0]?.release_id === "r42486594258-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T13:53:05Z"
      && row.deployments[0]?.api_digest === "sha256:dde4e16f576ec4df2c69cee584dbfa91bba89afe99fa338378f9a629bc148b55"
      && row.deployments[0]?.web_digest === "sha256:e9824a215dbc8746331d02181e38441883a6fc4348e1ded143c878c363fd6e2f"
      && row.deployments[0]?.environment === "dev"
      && row.deployments[0]?.status === "ACCEPTED"
      && row.deployments[0]?.kind === "pipeline"
      && row.deployments.length === 1
      && row.api_contract_version === "0.39.0"
      && row.title === "Карточка тренера в ленте и выравнивание кнопок действий в карточках игроков"
      && row.additions.length === 0
      && row.fixes.length === 2
      && row.known_limitations.length === 3
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.58"
      && row.version_label === "0.1.0-alpha.58"
      && row.source_sha === "190187919cb3e36839aabc543e2c85d206de0cb4"
      && row.deployments[0]?.release_id === "r42508393660-a3"
      && row.deployments[0]?.accepted_at === "2026-11-08T18:34:32Z"
      && row.deployments[0]?.api_digest === "sha256:ef01bfb584eedb24f5a0a9836053a7f0ba0ee9f3db2ff66ad345fd1c9246053c"
      && row.deployments[0]?.web_digest === "sha256:8bd2a2f5134b6fe8ee919697b24fb8af546385e2be8a4501fff7473d6082fe10"
      && row.deployments[0]?.environment === "dev"
      && row.deployments[0]?.status === "ACCEPTED"
      && row.deployments[0]?.kind === "pipeline"
      && row.deployments.length === 1
      && row.api_contract_version === "0.40.0"
      && row.title === "Оценки сообщества площадки и открытое обсуждение"
      && row.additions.length === 3
      && row.fixes.length === 1
      && row.known_limitations.length === 4
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.59"
      && row.version_label === "0.1.0-alpha.59"
      && row.source_sha === "360e308199da1fd58afda631cef9e432c427ff07"
      && row.deployments[0]?.release_id === "r42521707427-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T20:50:15Z"
      && row.deployments[0]?.api_digest === "sha256:981251536f36cdc169412b7c21a02cd366d87a422e4be1072155cb577574a80e"
      && row.deployments[0]?.web_digest === "sha256:5bba49aff868559292c91740d294eda69a492b7e7da5a6be812fb05caf35f47e"
      && row.deployments[0]?.environment === "dev"
      && row.deployments[0]?.status === "ACCEPTED"
      && row.deployments[0]?.kind === "pipeline"
      && row.deployments.length === 1
      && row.api_contract_version === "0.40.0"
      && row.title === "Перенос жалобы на сводку на узком экране, якоря разделов площадки и стабильная личность в шапке"
      && row.additions.length === 0
      && row.fixes.length === 3
      && row.known_limitations.length === 4
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.60"
      && row.version_label === "0.1.0-alpha.60"
      && row.source_sha === "2db4aafece41939f9e209bae9015f90da1d8ca7a"
      && row.deployments[0]?.release_id === "r42528128745-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T22:07:51Z"
      && row.deployments[0]?.api_digest === "sha256:1e111f7338350cfb3418d5cb77a1ec66c160b79fb10ff76008aaec0f73a7e74e"
      && row.deployments[0]?.web_digest === "sha256:a5c995635405ac5f15b2be19a212f77c4a771a8ccb58cb5918b9ec3d56eb0547"
      && row.deployments[0]?.environment === "dev"
      && row.deployments[0]?.status === "ACCEPTED"
      && row.deployments[0]?.kind === "pipeline"
      && row.deployments.length === 1
      && row.api_contract_version === "0.40.0"
      && row.title === "Выбор площадки, обсуждение, первая оценка и карточка тренера по макету Astra"
      && row.additions.length === 0
      && row.fixes.length === 4
      && row.known_limitations.length === 7
      && row.known_limitations.some((item) => /визуальный дефект|узкие колонки/i.test(item))
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.61"
      && row.version_label === "0.1.0-alpha.61"
      && row.source_sha === "23a3d2dba33d79da55151e5d1eff8ff54d9d74ce"
      && row.deployments[0]?.release_id === "r42532364094-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T22:56:54Z"
      && row.deployments[0]?.api_digest === "sha256:701c336b8ba179e8c77fea86e5a78d24ce44986cfedfa5750f1eff600e7f4aea"
      && row.deployments[0]?.web_digest === "sha256:cd6b4327e306b02968488d3687069ed485af08f1296a9d989cb78536db0c9837"
      && row.deployments[0]?.environment === "dev"
      && row.deployments[0]?.status === "ACCEPTED"
      && row.deployments[0]?.kind === "pipeline"
      && row.deployments.length === 1
      && row.api_contract_version === "0.40.0"
      && row.title === "Ремонт сетки ролей в карточке тренера"
      && row.additions.length === 0
      && row.fixes.length === 1
      && row.known_limitations.length === 7
      && row.known_limitations.some((item) => /мобильная кнопка|унификация действий/i.test(item))
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.62"
      && row.version_label === "0.1.0-alpha.62"
      && row.source_sha === "65b987116184dada309b87054b5cbe42c0f21578"
      && row.deployments[0]?.release_id === "r42540492310-a1"
      && row.deployments[0]?.accepted_at === "2026-11-09T00:42:02Z"
      && row.deployments[0]?.api_digest === "sha256:0508f4747bd38eebdd465b5d14c1fd29962c9bb2fe1b3c3a2a20a90da9ac333b"
      && row.deployments[0]?.web_digest === "sha256:cac3c8981b7444f8c91752db7a3fd4001e1514521b2aad8ec1cc42343b3a6e15"
      && row.deployments[0]?.environment === "dev"
      && row.deployments[0]?.status === "ACCEPTED"
      && row.deployments[0]?.kind === "pipeline"
      && row.deployments.length === 1
      && row.api_contract_version === "0.40.0"
      && row.title === "Мобильные карточки игр и тренировок, собственная отметка посещения и кнопка блокировки"
      && row.additions.length === 0
      && row.fixes.length === 3
      && row.fixes.some((item) => /одинаковую компоновку и действия|стрелка 44px|Подробнее/i.test(item))
      && row.fixes.some((item) => /не требует подтверждать.*самому себе/i.test(item))
      && row.fixes.some((item) => /не разрывается внутри слова/i.test(item))
      && row.known_limitations.length === 6
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.54"
      && row.source_sha === "cce49ce72daed8c81f89ddc845deabbb8ac5d7aa"
      && row.deployments[0]?.release_id === "r42449222181-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T05:18:57Z"
      && row.deployments[0]?.api_digest === "sha256:03cdab10c3c780b0bcd69b12bf8fbc013742e21f017fa2b076acd1c77b00bf3c"
      && row.deployments[0]?.web_digest === "sha256:fbc040efc941c25dc238ab51b986962f818d901e17a797a7e232193a51754896"
      && row.api_contract_version === "0.37.0"
      && row.title === "Локальная защита личных сообщений и сохранение черновика при отказе"
      && row.additions.length === 1
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.53"
      && row.source_sha === "79e51ff2b0b4846a9fee3be0f429f3f3d6c822ab"
      && row.deployments[0]?.release_id === "r42441987882-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T03:29:11Z"
      && row.deployments[0]?.api_digest === "sha256:fb05d669436562d669059604d9a4c7d1a4624d78a840d3a1891e95e4fba21f68"
      && row.deployments[0]?.web_digest === "sha256:7f80fa109b4695188b7f7c7ff4dc8bdc633d82c75c2c462f61c8a0950470450c"
      && row.api_contract_version === "0.37.0"
      && row.title === "Проверка описания площадки при импорте и подписей к фото галереи"
      && row.additions.length === 1
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.52"
      && row.source_sha === "aa222e469c4125abf1e8fe08eaba4e05575ead72"
      && row.deployments[0]?.release_id === "r42435428393-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T01:56:35Z"
      && row.deployments[0]?.api_digest === "sha256:8903f05d967fa575e99af1a20f2f7e8910fb0cacb60c52098c680df84118f066"
      && row.deployments[0]?.web_digest === "sha256:e6ac26251db8dea9e30a54c0c79571659dedddb20cd4ee1103e92ee16ab616ba"
      && row.api_contract_version === "0.37.0"
      && row.title === "Проверка публичных названия, адреса и описания площадки до публикации"
      && row.additions.length === 1
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.51"
      && row.source_sha === "4cefe7a6ef780da13796c1df85eca6fdc27a50ef"
      && row.deployments[0]?.release_id === "r42427559664-a1"
      && row.deployments[0]?.accepted_at === "2026-11-08T00:08:42Z"
      && row.deployments[0]?.api_digest === "sha256:55b2753ad3debb76583a8c56a49fd42acd8619b0d667820d68b2a709be719330"
      && row.deployments[0]?.web_digest === "sha256:0f17742f15f5533986409abfa49ca9fe569defa99fe3d205ec69f494f6265fa7"
      && row.api_contract_version === "0.37.0"
      && row.title === "Временно сняты количественные ограничения проверок на тестовом стенде"
      && row.additions.length === 1
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.50"
      && row.source_sha === "3153e3cd1fd1e1f1936e60ea27f7632589701bea"
      && row.deployments[0]?.release_id === "r42424550031-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T23:32:15Z"
      && row.deployments[0]?.api_digest === "sha256:a60b517a4c340ee7588354396ecea31179f282bdaeba2e018fee86cced5b5508"
      && row.deployments[0]?.web_digest === "sha256:6c196b8fdb9dbc053df91bc8867e5861507de0bea779fa4f3d7ba4832398499c"
      && row.api_contract_version === "0.37.0"
      && row.title === "Отзывы о площадке: проверка текста до решения человека"
      && row.additions.length === 1
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.49"
      && row.source_sha === "519489d9d0944619b29107b212dc09012e5b418b"
      && row.deployments[0]?.release_id === "r42418500085-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T22:12:06Z"
      && row.deployments[0]?.api_digest === "sha256:662bcd70dfa500766bfd6cc64dc836fb8a60307ae188e198a9146a34f89760c4"
      && row.deployments[0]?.web_digest === "sha256:4c2ed4faadbecb22745cd76dbb7ebbe9b513f0f72ab76dc9b758ef5d60fc8707"
      && row.api_contract_version === "0.37.0"
      && row.title === "Подпись к фото площадки и обслуживание галереи"
      && row.additions.length === 3
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.48"
      && row.source_sha === "608f44e9af26da7ea24881fe31c2c7e49ed8aeb3"
      && row.deployments[0]?.release_id === "r42412760323-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T20:59:58Z"
      && row.deployments[0]?.api_digest === "sha256:0145f018db57417491b262c83e88dd5cf779860faca64762f3e92bfc34c86295"
      && row.deployments[0]?.web_digest === "sha256:cd91420354aaee9b2a78bd8502d31804296e5ed474410b909604f32224f491df"
      && row.api_contract_version === "0.37.0"
      && row.title === "Отзывы об организаторе и тренере: проверка текста до решения человека"
      && row.additions.length === 1
      && row.fixes.length === 1
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.47"
      && row.source_sha === "cf0349ad52d5caf10a8b40e209e8c837e9c4da43"
      && row.deployments[0]?.release_id === "r42403605993-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T19:05:58Z"
      && row.deployments[0]?.api_digest === "sha256:d0dca6a3f0a036a452758393806fc582f8827a8be8734fec30f52f29a4cdb52b"
      && row.deployments[0]?.web_digest === "sha256:f4b63b48aef27f64c5da14ca381ca4cc2786689d8247931ab1a4e8e0e0144ac5"
      && row.api_contract_version === "0.37.0"
      && row.title === "Комментарии к игре: проверка текста до публикации"
      && row.additions.length === 1
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.46"
      && row.source_sha === "264d9e1cf63b4272732b2b9ad2317e9f9b9d320f"
      && row.deployments[0]?.release_id === "r42400302014-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T18:20:21Z"
      && row.deployments[0]?.api_digest === "sha256:d62283d142aa89344a104e1505a5ccca01cbf57da6867919a223f07812779879"
      && row.deployments[0]?.web_digest === "sha256:375944a55af9e1c16b2c08aa28d22d4fefade2dd453d36c0e29b2c286f474f97"
      && row.api_contract_version === "0.37.0"
      && row.title === "Площадка без фото: готовая иллюстрация вместо текстовой заглушки"
      && row.additions.length === 0
      && row.fixes.length === 1
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.45"
      && row.source_sha === "2650fcbe21976564b8b1ff90aac67ea4eca5b569"
      && row.deployments[0]?.release_id === "r42393881246-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T17:12:03Z"
      && row.deployments[0]?.api_digest === "sha256:7d36c35471bbef9162414311781644f31fbba79f6e4444ed1fdb108cd2d47882"
      && row.deployments[0]?.web_digest === "sha256:ce8562e9d36d2c5e929412c7185fdb7270c6d6e64dab50344bc1bbe04161d29e"
      && row.api_contract_version === "0.37.0"
      && row.title === "Проверка публичного текста; состояния и стрелки галереи площадки"
      && row.additions.length === 1
      && row.fixes.length === 1
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.44"
      && row.source_sha === "b27f91beceee24029311b9be2e26eca12b343ccb"
      && row.deployments[0]?.release_id === "r42376945998-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T13:41:23Z"
      && row.deployments[0]?.api_digest === "sha256:811d7a10338a7096293a5b31db88bfbd1c31206387e1c24de16ba4889345ec98"
      && row.deployments[0]?.web_digest === "sha256:ba98fda9f2b39a5dc78b7b709ace4a3347769fce34fdadc4c55f5bfc5ab6c1f1"
      && row.api_contract_version === "0.37.0"
      && row.title === "Компактный WebP аватаров и обложек; подсказки уведомлений при запрете браузера"
      && row.additions.length === 1
      && row.fixes.length === 1
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.43"
      && row.source_sha === "4614a0006d0e080bca4c8c5cb6335056a80d5a21"
      && row.deployments[0]?.release_id === "r42372648654-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T12:33:39Z"
      && row.deployments[0]?.api_digest === "sha256:534eefc04dae07ceb91bbc6e8500ea27e25d94fe0919658a9e818bf9cb146486"
      && row.deployments[0]?.web_digest === "sha256:4472803d6383ea182d19ccb575109b07ae5c2a00487a302587fc536435ad2dbf"
      && row.api_contract_version === "0.37.0"
      && row.title === "Уведомления: пояснение выбора событий и подсказка iPhone"
      && row.additions.length === 2
      && row.fixes.length === 0
      && row.owner_uat === "NOT_TESTED",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.42"
      && row.source_sha === "a72905b82e3d82ba0c08df44da8046e7db6e31ff"
      && row.deployments[0]?.release_id === "r42369478229-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T11:55:54Z"
      && row.deployments[0]?.api_digest === "sha256:cdf1783b1d1a13c207ea323d8382ec12a3129fb4e34eb73941be1ad83e0ad9b2"
      && row.deployments[0]?.web_digest === "sha256:052235f38705584fb63b82095fcf5123e38be993677472e2758ce86a09652190"
      && row.api_contract_version === "0.37.0"
      && row.title === "Публичные фото площадок: меньший WebP при явной поддержке"
      && row.additions.length === 2
      && row.fixes.length === 0,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.41"
      && row.source_sha === "3dbf8e04b978ba5f8a0379379ef46b054008ec44"
      && row.deployments[0]?.release_id === "r42366434024-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T11:13:52Z"
      && row.deployments[0]?.api_digest === "sha256:2d76fa61dfc02ef8943b48f108b9d9189460b14cffcb4c47eeb55738e8b47c04"
      && row.deployments[0]?.web_digest === "sha256:46189a35c68cd29842138059eb78cbb9fcbab1e32a1f5ddb20feb3d751fc35cc"
      && row.api_contract_version === "0.37.0"
      && row.title === "Площадки: правка имени и адреса, выравнивание переключателей"
      && row.additions.length === 0
      && row.fixes.length === 3,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.40"
      && row.source_sha === "0d6dd4852db26e0cb9feea03c78119cf5e2b04e4"
      && row.deployments[0]?.release_id === "r42362366120-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T10:09:04Z"
      && row.deployments[0]?.api_digest === "sha256:2aef121fea64641a8f4d6d7b42be789d49c7195b966a9694c3d305638808187f"
      && row.deployments[0]?.web_digest === "sha256:effe1b06111ef1762d88772647c7c5b903a1934650553ccd8dcbc281b6de15fa"
      && row.api_contract_version === "0.37.0"
      && row.title === "Карта: поздняя загрузка и переключатели уведомлений"
      && row.additions.length === 0
      && row.fixes.length === 2,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.39"
      && row.source_sha === "01ea6f2f490c9d8efbbf6b9c58d30d844096ee14"
      && row.deployments[0]?.release_id === "r42359322474-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T09:34:34Z"
      && row.deployments[0]?.api_digest === "sha256:dad8252ab11627e9144fd91395012302de3c34f4e249363309e0fd1214425414"
      && row.deployments[0]?.web_digest === "sha256:2c1f1a40e0007b232e1f4dbf99d982266ab1815dbfa382a7b41aeeed08e6a50b"
      && row.api_contract_version === "0.37.0"
      && row.title === "Push по шести событиям игры"
      && row.additions.length === 5
      && row.fixes.length === 0,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.38"
      && row.source_sha === "298917fe49ccc57e8891e68a04e6408e4aa3a0d1"
      && row.deployments[0]?.release_id === "r42338172236-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T04:27:56Z"
      && row.deployments[0]?.api_digest === "sha256:0cdadb25832079fa29299750f4621354479579820abb9e4778e790870442d6b7"
      && row.deployments[0]?.web_digest === "sha256:fadd2e445240ea6643a6bdb9c793a3c1a9a1210428ddb330e04d8d7f1a77e0ff"
      && row.api_contract_version === "0.36.0"
      && row.title === "Карта площадок без лишнего опроса каталога в простое"
      && row.fixes.length === 1,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.37"
      && row.source_sha === "859bb6a635ad704ad0971f8a7ad748b02eda0017"
      && row.deployments[0]?.release_id === "r42327405382-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T02:10:06Z"
      && row.deployments[0]?.api_digest === "sha256:aae0566a1a4f9bc9143d73765fca35776ef56e57416fa6bfc26e9dd8652921ed"
      && row.deployments[0]?.web_digest === "sha256:ca74a876933daee80aa65103dae5732d851e96fefe311d319678caac209da3a0"
      && row.api_contract_version === "0.36.0"
      && row.title === "Общие кнопки закрытия и маркеры карты площадок"
      && row.fixes.length === 2,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.36"
      && row.source_sha === "9af6482afeb0e5552c20af25a04dd6503957202d"
      && row.deployments[0]?.release_id === "r42325229441-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T01:45:38Z"
      && row.deployments[0]?.api_digest === "sha256:0e5e09cb63a5737f84bdf045da5c08ff8a3f23b4a8ab21797a19b31e11a3adb5"
      && row.deployments[0]?.web_digest === "sha256:bbdcfa9f9ec128712275589c504698215860f1c24058269b1625654c049724e6"
      && row.api_contract_version === "0.36.0"
      && row.title === "Гостевой запрос на странице площадки"
      && row.fixes.length === 1,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.35"
      && row.source_sha === "5c75185408042d7d119a7f63304c9ac609b68cbc"
      && row.deployments[0]?.release_id === "r42321599702-a1"
      && row.deployments[0]?.accepted_at === "2026-11-07T01:05:19Z"
      && row.deployments[0]?.api_digest === "sha256:26423380b7c1e96205c934d177f12557fcc7aac28286a35026d2d7530887978b"
      && row.deployments[0]?.web_digest === "sha256:c7a56b4e234c64742b051a98b2014872955a57f182512ced3515b04960ac3e50"
      && row.api_contract_version === "0.36.0"
      && row.title === "Мгновенная заглушка обложки и гостевые запросы"
      && row.fixes.length === 2,
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.34"
      && row.source_sha === "d96df8096a0b4c6394fa5ab1f3e6e26ad378710e"
      && row.deployments[0]?.release_id === "r42293392235-a1"
      && row.deployments[0]?.accepted_at === "2026-11-06T21:08:02Z"
      && row.deployments[0]?.api_digest === "sha256:f46169694bfdc138db9e19b3109b5caf54c45ea2f1ab9ebb1ee94c9b6b9affdd"
      && row.deployments[0]?.web_digest === "sha256:42ddb11df947961a339235afa0ef53f82efa9651ed1c2e4f02d4deeb47776186"
      && row.api_contract_version === "0.36.0"
      && row.title === "Имя тренера на телефоне",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.33"
      && row.source_sha === "ebebea18f216260f8ecd7de8e4c450d157b21a5b"
      && row.deployments[0]?.release_id === "r42290038408-a1"
      && row.deployments[0]?.accepted_at === "2026-11-06T20:43:19Z"
      && row.deployments[0]?.api_digest === "sha256:ca0e416f2bb09ef43fe7008a4478440886c429baf0cdb33cdb184eae9b8ccaa6"
      && row.deployments[0]?.web_digest === "sha256:4004b085adafc4bae0cada62310266a53d787a858875a7f37b3ff15e3a15a59d"
      && row.api_contract_version === "0.36.0"
      && row.title === "Приватные функции игры и загрузка обложек",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.32"
      && row.source_sha === "9b07e77fcf300b0265e2151478c45d2881b389d0"
      && row.deployments[0]?.release_id === "r42280047435-a1"
      && row.deployments[0]?.accepted_at === "2026-11-06T19:34:49Z"
      && row.deployments[0]?.api_digest === "sha256:9f0b07204b6907849188abce8863a735d9b90148dd9b06fa435ab1eeea8c19de"
      && row.deployments[0]?.web_digest === "sha256:b06268f74eb4edee8c90806c94c7bbf27495ed9edd1a4087026cb2320f29f1eb"
      && row.api_contract_version === "0.36.0"
      && row.title === "Карточка площадки и уточнённые адреса",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.31"
      && row.source_sha === "1dbd135ae3af27dbc2bd8771a432d32489791a9c"
      && row.deployments[0]?.release_id === "r42268408755-a1"
      && row.deployments[0]?.accepted_at === "2026-11-06T18:25:52Z"
      && row.deployments[0]?.api_digest === "sha256:ee7a063b3d40fc013b6e2d34c2e5625aea6ac7f7d121dcaa48c16c5069ab9bbb"
      && row.deployments[0]?.web_digest === "sha256:c94bedd3d55e7e363b2823b573ead1a0224e8acb4f3e1614304daff76174cdb5"
      && row.api_contract_version === "0.36.0"
      && row.title === "Выбор города для поиска",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.29"
      && row.source_sha === "76490b2be720e9f6b923bd3db477fb6065d6d13c"
      && row.deployments[0]?.release_id === "r41954344736-a1"
      && row.deployments[0]?.accepted_at === "2026-11-05T02:24:52Z"
      && row.deployments[0]?.api_digest === "sha256:e64b5c6f9ea34c69fe7d87ef3d6d21e52facf4bac370a48570b1d4eecde36a1b"
      && row.deployments[0]?.web_digest === "sha256:6c500ba801385cb62e8a753c9d5d86912bf4953ea53c86dbddc1f6f4bc62451c"
      && row.api_contract_version === "0.34.0",
    )).toBe(true);
    expect(TRUSTED_HISTORICAL_SEED.some((row) =>
      row.application_version === "0.1.0-alpha.30"
      && row.source_sha === "9e7b1fcb7dddd7706e5902b755883d48b3cf945b"
      && row.deployments[0]?.release_id === "r42259332272-a1"
      && row.deployments[0]?.accepted_at === "2026-11-06T17:26:22Z"
      && row.deployments[0]?.api_digest === "sha256:bfc21680a8a761490689c4d9c2e27da5782c4abc76211616fe98f4bcb4a9587b"
      && row.deployments[0]?.web_digest === "sha256:9c9bce96000be81d90adb251e1a74c28d4c990ef2c53c9053b0708011276d3dc"
      && row.api_contract_version === "0.35.0"
      && row.title === "Региональные карты и источник площадок",
    )).toBe(true);
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

  it("renders private own reviews and the discussion-report copy clarification without stale release claims", async () => {
    const ReleasesPage = (await import("../src/app/releases/page")).default;
    const tree = await ReleasesPage();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Свои отзывы о площадках в профиле");
    for (const fix of CURRENT_NAMED_RELEASE.fixes) {
      expect(html).toContain(fix);
      expect(html.split(fix).length - 1).toBe(1);
    }
    expect(html).toContain("На комментарий или ответ в обсуждении можно пожаловаться. Для отправки жалобы нужен вход в аккаунт.");
    expect(html).toContain("В своём профиле можно посмотреть свои отзывы о площадках и отозвать публикацию. Раздел доступен только владельцу аккаунта.");
    expect(html.split("В своём профиле можно посмотреть свои отзывы о площадках и отозвать публикацию. Раздел доступен только владельцу аккаунта.").length - 1).toBe(1);
    expect(html).not.toContain("Прокрутка типов игр без обрезанных кнопок");
    expect(html).not.toContain("На экране «Игры» край списка типов игр подсказывает возможность прокрутки, а последний переключатель виден целиком. При переходе с клавиатуры список прокручивается так, чтобы переключатель в фокусе оставался полностью видимым.");
    expect(html).not.toContain("Компактная карточка площадки и действия на карте");
    expect(html).not.toContain("Восстановлен компактный вид карточки площадки на карте. В раскрытой карточке оценки и обсуждение показаны рядом с информацией о площадке; кнопка «Создать игру на этой площадке» закреплена внизу и доступна только в раскрытом виде. Кнопки действий на карте оформлены единообразно на телефоне и компьютере.");
    expect(html).not.toContain("Отзыв о площадке из итогов конкретной игры");
    expect(html).not.toContain("Отзыв о площадке теперь открывается из итогов конкретной игры");
    expect(html).not.toContain("Поиск участников Radar и отображение фильтров игр");
    expect(html).not.toContain("После включения Radar и подтверждения активации");
    expect(html).not.toContain("отступы горизонтальных переключателей типа игры");
    expect(html).not.toContain("Оценки, обсуждение и отзывы в карточке площадки на карте");
    expect(html).not.toContain("Незавершённые отправки и их точный повтор сохраняются");
    expect(html).not.toContain("Компактные фильтры на экране «Игры»");
    expect(html).not.toContain("Прежний фильтр уровня применяется сразу");
    expect(html).not.toContain("подпись «По времени» убрана");
    expect(html).not.toContain("Порядок ролей и действий в карточке тренировки");
    expect(html).not.toContain("сначала показан тренер, затем организатор и «Отзывы и история»");
    expect(html).not.toContain("кнопки «Подробнее» и «Поделиться» расположены у правого края");
    expect(html).not.toMatch(/#507A|#530/);
    expect(html).not.toContain("Начало загрузки фотографии площадки при открытии страницы");
    expect(html).not.toContain("исходного HTML страницы");
    expect(html).not.toContain("Карточка тренировки и подтверждение дружеского матча");
    expect(html).not.toContain("роли тренера и организатора показаны согласованно");
    expect(html).not.toContain("При подтверждённом взаимном желании сыграть");
    expect(html).toContain("Дружеский матч");
    expect(html).not.toContain("Маскирование нецензурных выражений в открытых обсуждениях");
    expect(html).not.toContain("нецензурные выражения показываются замаскированными");
    expect(html).not.toContain("в ответах, после редактирования и при повторной отправке того же комментария");
    expect(html).not.toContain("Профиль без мерцания при открытии страниц");
    expect(html).not.toContain("публичное имя и аватар в шапке");
    expect(html).toContain("реальным аккаунтом");
    expect(html).toContain("390 и 1280");
    expect(html).toContain("ещё не выполнена");
    expect(html).not.toContain("На карте");
    expect(html).not.toContain("сложенной карты");
    expect(html).not.toContain("унифицированы кнопки действий");
    expect(html).not.toContain("не компоновка целиком");
    expect(html).not.toContain("не требует подтверждать её самому себе");
    expect(html).not.toContain("не разрывается внутри слова");
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

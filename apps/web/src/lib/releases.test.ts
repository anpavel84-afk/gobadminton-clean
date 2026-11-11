import { createHash } from "node:crypto";
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
  it("preserves the exact ten-field trusted alpha.63 receipt and historical map fixes", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.63");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toHaveLength(10);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(2950);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "1454dd194e24bf9cb6ff60bbd22eb0bc32f7aabe91c0934b1c2d4f9cdcab1d63",
    );
    expect(row.fixes).toHaveLength(2);
    expect(row.fixes.join(" ")).toMatch(/На карте/);
    expect(row.fixes.join(" ")).toMatch(/сложенной карты/);
    expect(row.fixes.join(" ")).toMatch(/унифицированы кнопки действий.*не компоновка целиком/);
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
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
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
    expect(TRUSTED_HISTORICAL_SEED.slice(-16).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.68", "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74", "0.1.0-alpha.75", "0.1.0-alpha.76", "0.1.0-alpha.77", "0.1.0-alpha.78", "0.1.0-alpha.79", "0.1.0-alpha.80", "0.1.0-alpha.81", "0.1.0-alpha.82", "0.1.0-alpha.83",
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
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
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
    expect(TRUSTED_HISTORICAL_SEED.slice(-15).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74", "0.1.0-alpha.75", "0.1.0-alpha.76", "0.1.0-alpha.77", "0.1.0-alpha.78", "0.1.0-alpha.79", "0.1.0-alpha.80", "0.1.0-alpha.81", "0.1.0-alpha.82", "0.1.0-alpha.83",
    ]);
    expect(row.title).toBe("Оценки, обсуждение и отзывы в карточке площадки на карте");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toHaveLength(1);
    expect(row.fixes.join(" ")).toMatch(/Незавершённые отправки и их точный повтор сохраняются.*явное восстановление/i);
    expect(row.known_limitations).toHaveLength(10);
    expect(row.known_limitations[0]).toBe("Общее состояние сообщества на карте площадок, вход в отзыв после конкретной игры и снятие публичного автора без замены ещё не доступны");
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
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
    expect(TRUSTED_HISTORICAL_SEED.slice(-15).map((item) => item.application_version)).toEqual([
      "0.1.0-alpha.69", "0.1.0-alpha.70", "0.1.0-alpha.71", "0.1.0-alpha.72", "0.1.0-alpha.73", "0.1.0-alpha.74", "0.1.0-alpha.75", "0.1.0-alpha.76", "0.1.0-alpha.77", "0.1.0-alpha.78", "0.1.0-alpha.79", "0.1.0-alpha.80", "0.1.0-alpha.81", "0.1.0-alpha.82", "0.1.0-alpha.83",
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
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
  });



  it("preserves the exact ten-field accepted alpha.83 seed before unaccepted alpha.84", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter(row => row.application_version === "0.1.0-alpha.83");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(6842);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "e3c768569afa7d3dd8d340336d61160caf077be76fba338d1b6b2ff78235f7ee",
    );
    expect(row.source_sha).toBe("6c551d21ac57847db62e916d74914ef3bd14e409");
    expect(row.version_label).toBe("0.1.0-alpha.83");
    expect(row.title).toBe("Фотография новой площадки и её рассмотрение в Admin");
    expect(row.api_contract_version).toBe("0.43.0");
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(row.additions).toHaveLength(6);
    expect(row.fixes).toEqual([]);
    expect(row.known_limitations).toHaveLength(9);
    expect(row.deployments).toEqual([
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42889702522-a1",
        "accepted_at": "2026-11-10T19:59:30Z",
        "api_digest": "sha256:42a28aee23369d3549b538463bc9796c844d16b92c25ace429c75d23756f6bbf",
        "web_digest": "sha256:5e205723783c0ef25f2fb41e83ea847d7409af892990e7883fc2dfdc0f0b6ecd",
        "kind": "pipeline"
      }
    ]);
    const previous = TRUSTED_HISTORICAL_SEED.find(item => item.application_version === "0.1.0-alpha.82")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.at(-1)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((count, item) => count + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some(item => item.application_version === "0.1.0-alpha.84")).toBe(false);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field accepted alpha.82 seed before the accepted alpha.83 seed", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter(row => row.application_version === "0.1.0-alpha.82");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(5449);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "1abfbd1b7cf5e8aa6eace129fb4f689764a40d4f2f9cd02cc6b0ab931583b6eb",
    );
    expect(row.title).toBe("Серверная подготовка фотографий от создателя площадки");
    expect(row.source_sha).toBe("17a9c596cd7a5c3c9f95b4c7f4c14acbf2f221cb");
    expect(row.version_label).toBe("0.1.0-alpha.82");
    expect(row.api_contract_version).toBe("0.43.0");
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(row.additions).toHaveLength(5);
    expect(row.fixes).toEqual([]);
    expect(row.known_limitations.join(" ")).toMatch(/только серверная часть.*пользовательский интерфейс.*ещё не реализован/);
    expect(row.deployments).toEqual([
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42863201852-a1",
        "accepted_at": "2026-11-10T17:33:38Z",
        "api_digest": "sha256:764afcc7c4b398f0fefe00137766d179ce12d2a0f20f04c1ee0b2576d264059f",
        "web_digest": "sha256:9c7dcac9a900272ab0ed708d90627332063b25012e9dd9220a76b3ddbe0efecc",
        "kind": "pipeline"
      }
    ]);
    const previous = TRUSTED_HISTORICAL_SEED.find(item => item.application_version === "0.1.0-alpha.81")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.at(-2)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((count, item) => count + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some(item => item.application_version === "0.1.0-alpha.84")).toBe(false);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field accepted alpha.81 seed before the accepted alpha.82 seed", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.81");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(5991);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "8cb577da21770f974ab19e406e07437e79e2e52ba14f4e6c2b5104c028c285ac",
    );
    expect(row.source_sha).toBe("d9c1e57d6350b7b9e3f0d76db6ac5e535112fd95");
    expect(row.version_label).toBe("0.1.0-alpha.81");
    expect(row.api_contract_version).toBe("0.42.0");
    expect(row.title).toBe("Галерея фотографий сообщества площадки");
    expect(row.additions).toHaveLength(5);
    expect(row.fixes).toHaveLength(3);
    expect(row.known_limitations).toHaveLength(9);
    expect(row.deployments).toEqual([{
      environment: "dev", status: "ACCEPTED", release_id: "r42850039504-a1",
      accepted_at: "2026-11-10T16:05:00Z",
      api_digest: "sha256:eac601f8299d7d6f6f7ea5b3f22c2a32decd09d106599bd4a92909e5a0e946cc",
      web_digest: "sha256:5e93ef3ac1336d4139d9c0c2bcb959b97b8258e414adec3c80cc6842713f303f",
      kind: "pipeline",
    }]);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.80")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED.at(-3)).toBe(row);
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual([
      row.known_limitations[0],
      "Кнопка загрузки, добавление фотографий к комментариям площадок и показ текущих одобренных фотографий внутри комментариев реализованы в alpha.80. Нижняя постраничная галерея фотографий сообщества, полноэкранный просмотр и переход к текущей публикации реализованы в alpha.81. В alpha.82 реализована серверная часть предложения фотографии создателем площадки; в alpha.83 добавлены пользовательская форма при создании новой площадки и служебное рассмотрение предложений выбранной площадки. Проверка этого сценария с обычным аккаунтом и служебной ролью ещё не выполнена.",
      ...row.known_limitations.slice(2),
    ]);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field accepted alpha.80 seed before the accepted alpha.81 seed", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.80");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(5294);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "ea4d8aa1b98a70654406c2c66a147ba39ee04c6864d8d2c1c8849bd594b362cf",
    );
    expect(row.source_sha).toBe("d4c6e04374fa98412174994536f95f529b153f4c");
    expect(row.version_label).toBe("0.1.0-alpha.80");
    expect(row.api_contract_version).toBe("0.42.0");
    expect(row.title).toBe("Фотографии в обсуждениях площадок");
    expect(row.additions).toHaveLength(4);
    expect(row.fixes).toHaveLength(2);
    expect(row.deployments).toEqual([{
      environment: "dev", status: "ACCEPTED", release_id: "r42832327907-a1",
      accepted_at: "2026-11-10T14:22:08Z",
      api_digest: "sha256:617720695e9d76637e3a4ac657a22e9a8749e97a3b3be8c4b2d58c3c65d11cb3",
      web_digest: "sha256:0f6dcc39af05e062264a5a5addf977f7bb3ce28b86167af9b2097c099f545881",
      kind: "pipeline",
    }]);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.79")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED.at(-4)).toBe(row);
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual([
      row.known_limitations[0],
      "Кнопка загрузки, добавление фотографий к комментариям площадок и показ текущих одобренных фотографий внутри комментариев реализованы в alpha.80. Нижняя постраничная галерея фотографий сообщества, полноэкранный просмотр и переход к текущей публикации реализованы в alpha.81. В alpha.82 реализована серверная часть предложения фотографии создателем площадки; в alpha.83 добавлены пользовательская форма при создании новой площадки и служебное рассмотрение предложений выбранной площадки. Проверка этого сценария с обычным аккаунтом и служебной ролью ещё не выполнена.",
      ...row.known_limitations.slice(2),
    ]);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field accepted alpha.79 seed before the accepted alpha.80 seed", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.79");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(4128);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "a6bf8d2c9cf3e61343c3514cfd145b775af58652568c5768b714672d709435a7",
    );
    expect(row.source_sha).toBe("701dd73c914d075fbca5695ba67455fba84642a2");
    expect(row.version_label).toBe("0.1.0-alpha.79");
    expect(row.api_contract_version).toBe("0.42.0");
    expect(row.title).toBe("Типы игр на телефоне и заметки прошлых выпусков");
    expect(row.additions).toEqual([]);
    expect(row.fixes).toHaveLength(2);
    expect(row.fixes.join(" ")).toMatch(/390 пикселей.*«С тренером».*44 пикселя.*«Версии».*alpha\.75/);
    expect(row.deployments).toEqual([{
      environment: "dev",
      status: "ACCEPTED",
      release_id: "r42819887411-a2",
      accepted_at: "2026-11-10T13:07:47Z",
      api_digest: "sha256:69a42308fab23f15235b9cf1ab898cb67a36411549ad14ef4f7e8911904191a6",
      web_digest: "sha256:bfba28385ab336bf0c2ad0a81e23dfe714a5aa825a88d21d158938b7d99292ce",
      kind: "pipeline",
    }]);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.78")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(row.known_limitations).toEqual(previous.known_limitations);
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual([
      row.known_limitations[0],
      "Кнопка загрузки, добавление фотографий к комментариям площадок и показ текущих одобренных фотографий внутри комментариев реализованы в alpha.80. Нижняя постраничная галерея фотографий сообщества, полноэкранный просмотр и переход к текущей публикации реализованы в alpha.81. В alpha.82 реализована серверная часть предложения фотографии создателем площадки; в alpha.83 добавлены пользовательская форма при создании новой площадки и служебное рассмотрение предложений выбранной площадки. Проверка этого сценария с обычным аккаунтом и служебной ролью ещё не выполнена.",
      ...row.known_limitations.slice(2),
    ]);
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED.at(-5)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field accepted alpha.78 seed before the accepted alpha.79 seed", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.78");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(4526);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "bc8097bb5fb697d2b4d5b48b46d2221d571231db663a19dcd893d51113a5b64f",
    );
    expect(row.source_sha).toBe("db867399609190852db67650ad5c0973b5dd88e9");
    expect(row.api_contract_version).toBe("0.42.0");
    expect(row.title).toBe("Серверный API фотографий в комментариях площадок");
    expect(row.additions).toHaveLength(4);
    expect(row.fixes).toEqual([]);
    expect(row.deployments[0]?.release_id).toBe("r42813886246-a1");
    expect(row.deployments[0]?.accepted_at).toBe("2026-11-10T12:28:54Z");
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual([
      row.known_limitations[0],
      "Кнопка загрузки, добавление фотографий к комментариям площадок и показ текущих одобренных фотографий внутри комментариев реализованы в alpha.80. Нижняя постраничная галерея фотографий сообщества, полноэкранный просмотр и переход к текущей публикации реализованы в alpha.81. В alpha.82 реализована серверная часть предложения фотографии создателем площадки; в alpha.83 добавлены пользовательская форма при создании новой площадки и служебное рассмотрение предложений выбранной площадки. Проверка этого сценария с обычным аккаунтом и служебной ролью ещё не выполнена.",
      ...row.known_limitations.slice(2),
    ]);
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(TRUSTED_HISTORICAL_SEED.at(-6)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field accepted alpha.77 seed before the accepted alpha.78 seed", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.77");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(4301);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "64bd341b4ab7bf73fb3191491e35c8ba9eb9a04c8f72a91a797c2d74114ea1d3",
    );
    expect(row.source_sha).toBe("65c7e59212eab0de2a9ecd50c36ed1c1e7854ad9");
    expect(row.version_label).toBe("0.1.0-alpha.77");
    expect(row.api_contract_version).toBe("0.41.0");
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(row.title).toBe("Приватная серверная подготовка фотографий площадок");
    expect(row.additions).toEqual([
      "Подготовлена серверная основа для приватной подготовки фотографий площадок: обработка изображения и проверка содержимого перед сохранением временного результата.",
      "Временный просмотр подготовленной фотографии доступен только её владельцу после входа. Подготовку можно отозвать. Фотография доступна один час; после истечения срока или отзыва временный файл подлежит очистке.",
      "Публикация фотографий в комментариях, комментарии только с фотографиями, галерея сообщества и предложение фотографии при создании новой площадки в этот выпуск не входят. Кнопка загрузки фото и новый интерфейс в приложении ещё не добавлены.",
    ]);
    expect(row.fixes).toEqual([
      "При откате серверной подготовки фотографий сохраняются история решений модерации и учёт выполненных проверок.",
    ]);
    expect(row.deployments).toEqual([
      {
        environment: "dev",
        status: "ACCEPTED",
        release_id: "r42800435924-a1",
        accepted_at: "2026-11-10T10:52:25Z",
        api_digest: "sha256:17a5e3c0628ec3e76de917607f41e0db140834f1975c85c3be0d850dfda80e2e",
        web_digest: "sha256:157dfd64b2f0dbe6e886cdbd817b99c1e984550ebd628b8f5e4bf55bf0e42767",
        kind: "pipeline",
      },
    ]);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.76")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(row.known_limitations).toEqual(previous.known_limitations);
    expect(CURRENT_NAMED_RELEASE.known_limitations).toEqual([
      row.known_limitations[0],
      "Кнопка загрузки, добавление фотографий к комментариям площадок и показ текущих одобренных фотографий внутри комментариев реализованы в alpha.80. Нижняя постраничная галерея фотографий сообщества, полноэкранный просмотр и переход к текущей публикации реализованы в alpha.81. В alpha.82 реализована серверная часть предложения фотографии создателем площадки; в alpha.83 добавлены пользовательская форма при создании новой площадки и служебное рассмотрение предложений выбранной площадки. Проверка этого сценария с обычным аккаунтом и служебной ролью ещё не выполнена.",
      ...row.known_limitations.slice(2),
    ]);
    expect(TRUSTED_HISTORICAL_SEED.at(-7)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field accepted alpha.76 seed before the accepted alpha.77 seed", () => {
    const rows = TRUSTED_HISTORICAL_SEED.filter((row) => row.application_version === "0.1.0-alpha.76");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row)).toEqual([
      "application_version", "title", "owner_uat", "additions", "fixes", "known_limitations",
      "version_label", "source_sha", "api_contract_version", "deployments",
    ]);
    const input = JSON.stringify(row, null, 2) + "\n";
    expect(Buffer.byteLength(input, "utf8")).toBe(4014);
    expect(createHash("sha256").update(input).digest("hex")).toBe(
      "6987a52577c3697927f4f6b6fe7bc02d1eb47020999ae73ea699f0b195fc1e91",
    );
    expect(row.source_sha).toBe("dd5b2c1496af57ca168d171decb384d2ecfec5c1");
    expect(row.version_label).toBe("0.1.0-alpha.76");
    expect(row.api_contract_version).toBe("0.41.0");
    expect(row.title).toBe("Редактирование своих отзывов о площадках");
    expect(row.owner_uat).toBe("NOT_TESTED");
    expect(row.deployments).toEqual([
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42783213882-a1",
        "accepted_at": "2026-11-10T08:45:51Z",
        "api_digest": "sha256:dca105d4f30af95aae2a9e354fe4b0a6a25d5fc59d2fce9a00581f85a4c9838a",
        "web_digest": "sha256:84ee026a3884755c10804853e49be32b8cc286cc2efd6f0a97b9ef2a0213b023",
        "kind": "pipeline"
      }
    ]);
    expect(row.additions).toEqual([
      "В своём профиле можно отредактировать свой отзыв о площадке и сохранить новую редакцию. Форма открывает сохранённые текст, темы и видимость выбранного отзыва; раздел доступен только владельцу аккаунта.",
      "Перед отправкой публичной редакции нужно просмотреть, что будет опубликовано, и заново подтвердить согласие.",
    ]);
    expect(row.fixes).toEqual([
      "Если отзыв или условия его отправки изменились, нужно перечитать выбранный отзыв и подтвердить отправку заново.",
      "Если результат отправки неизвестен, форма сохраняет отправленные данные для повторной проверки. После смены аккаунта данные прежнего пользователя скрываются.",
    ]);
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations);
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.75")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.at(-8)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
    expect(CURRENT_NAMED_RELEASE.source_sha).toBeNull();
    expect(CURRENT_NAMED_RELEASE.owner_uat).toBe("NOT_TESTED");
  });

  it("preserves the exact ten-field accepted alpha.75 seed before the accepted alpha.76 seed", () => {
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
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations.slice(1));
    const previous = TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.74")!;
    expect(Date.parse(row.deployments[0]!.accepted_at)).toBeGreaterThan(Date.parse(previous.deployments[0]!.accepted_at));
    expect(TRUSTED_HISTORICAL_SEED.at(-9)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
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
    expect(TRUSTED_HISTORICAL_SEED.at(-10)).toBe(row);
    expect(row.title).toBe("Прокрутка типов игр без обрезанных кнопок");
    expect(row.additions).toHaveLength(0);
    expect(row.fixes).toEqual(["На экране «Игры» край списка типов игр подсказывает возможность прокрутки, а последний переключатель виден целиком. При переходе с клавиатуры список прокручивается так, чтобы переключатель в фокусе оставался полностью видимым."]);
    expect(row.known_limitations[0]).toBe("Управление опубликованным отзывом — редактирование и отзыв публикации — в пользовательском интерфейсе ещё не доступно");
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
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
    expect(TRUSTED_HISTORICAL_SEED.at(-11)).toBe(row);
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
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
    expect(TRUSTED_HISTORICAL_SEED.find((item) => item.application_version === "0.1.0-alpha.77")!.known_limitations).toEqual(row.known_limitations.slice(1));
    expect(TRUSTED_HISTORICAL_SEED).toHaveLength(87);
    expect(TRUSTED_HISTORICAL_SEED.reduce((n, item) => n + item.deployments.length, 0)).toBe(92);
    expect(TRUSTED_HISTORICAL_SEED.some((item) => item.application_version === "0.1.0-alpha.84")).toBe(false);
  });

  it("bumps current descriptor to alpha.84 with API 0.43.0", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.84");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.43.0");
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
    expect(prose).toContain("Единая страница «Мои игры»");
    expect(prose).toMatch(/1 января 2027|2027 UTC/i);
    expect(prose).toMatch(/приёмк|NOT_TESTED|iPhone|GoBad|#506|#522|карт/i);
    expect(CURRENT_NAMED_RELEASE.fixes).toHaveLength(3);
    const fixes = CURRENT_NAMED_RELEASE.fixes.join(" ");
    expect(fixes).not.toMatch(/меню/i);
    expect(CURRENT_NAMED_RELEASE.fixes.length).toBe(3);
    expect(fixes).not.toMatch(/alpha\.76.*(?:ошибк|дефект)/i);
    expect(fixes).not.toMatch(/автоматическ|автоотправ|сам.*публику|14.*дн|I2|I3|UGC|#549|нативн.*прилож|#507.*(?:DONE|заверш|выполн)/i);
    // D1 cause remains UNKNOWN; reset 2.0/session-only checks do not prove a repaired cause or persistence.
    expect(fixes).not.toMatch(/D1|причин|сброс|reset|2\.0|сесси|session|URL|storage|после перезагрузки|сохраняется после закрытия/i);
    expect(fixes).not.toMatch(/публичная публикация фотографий доступна|галерея доступна/i);
    expect(fixes).not.toMatch(/По времени|Прежний фильтр уровня|после конкретной игры|нативн.*прилож|#507.*(?:заверш|выполн)/i);
    expect(fixes).not.toMatch(/#507A|#530|Порядок ролей|В нижней строке карточки тренировки|Отзывы и история|Подробнее|Поделиться/i);
    expect(fixes).not.toMatch(/исходного HTML|подтверждённом взаимном желании|роли тренера и организатора показаны согласованно|квадратные фотографии|маскирование|публичного автора/i);
    expect(fixes).not.toMatch(/быстрее|ускорен|\d+\s*(мс|ms|сек|%)/i);
    expect(fixes).not.toMatch(/нецензурные выражения.*замаскированными|Маскирование/i);
    expect(fixes).not.toMatch(/Единая кнопка «На карте»|сложенной карты|унифицированы кнопки действий|alpha\.62/i);
    expect(fixes).not.toMatch(/не требует подтверждать.*самому себе|не разрывается внутри слова|собственн.*посещени/i);
    expect(CURRENT_NAMED_RELEASE.additions).toHaveLength(5);
    const alpha80 = TRUSTED_HISTORICAL_SEED.find((row) => row.application_version === "0.1.0-alpha.80")!;
    const alpha80Delta = [...alpha80.additions, ...alpha80.fixes].join(" ");
    expect(alpha80Delta).toMatch(/до 4 проверенных фотографий.*комментарию, ответу или редактируемому.*только фотографий без текста/);
    expect(alpha80Delta).toMatch(/Обсуждения игр остаются текстовыми, без вложений фотографий/);
    expect(alpha80Delta).toMatch(/подтвердить права.*приватном предпросмотре.*только после явной отправки/);
    expect(alpha80Delta).toMatch(/Неудачную подготовку отдельной фотографии.*повторить отдельно.*неизвестном результате.*исходные файлы, порядок фотографий и ключ отправки/);
    expect(alpha80Delta).toMatch(/Текущие одобренные фотографии показаны прямо в комментариях площадки/);
    expect(alpha80Delta).toMatch(/замаскированным сервером текстом.*команды, автора, пути, обсуждения, версии и порядка фотографий/);
    expect(alpha80Delta).toMatch(/Проверка текста остаётся на сервере.*не добавляет собственный словарь/);
    expect(alpha80Delta).toMatch(/компьютере.*строка с кнопкой отправки не переносится.*выбор фотографий подписан по-русски/);
    const alpha81 = TRUSTED_HISTORICAL_SEED.find((row) => row.application_version === "0.1.0-alpha.81")!;
    const alpha81Delta = [...alpha81.additions, ...alpha81.fixes].join(" ");
    expect(alpha81Delta).toMatch(/Внизу полной страницы.*раскрытой карточки на карте.*«Фотографии сообщества».*том же содержимом/);
    expect(alpha81Delta).toMatch(/страницами по запросу.*конец списка неизвестен.*без общего количества.*после последней страницы.*общее количество/);
    expect(alpha81Delta).toMatch(/сохраняет фотографию целиком.*стрелки клавиатуры.*горизонтальное.*Escape.*возвращает фокус/);
    expect(alpha81Delta).toMatch(/текущий автор.*«К публикации».*актуальный комментарий или ответ.*той же карточке.*следующих страниц/);
    expect(alpha81Delta).toMatch(/ошибке следующей страницы текущее фото сохраняется.*ту же страницу.*Недоступная фотография или изменившаяся публикация/);
    expect(alpha81.fixes).toContain("Начальная загрузка фотографий сообщества продолжается после закрытия фотографии из комментария или перехода к текущей публикации; галерея больше не показывает ложное сообщение об отсутствии фотографий вместо ожидаемого результата загрузки.");
    expect(alpha81Delta).toMatch(/фокус остаётся внутри окна.*кнопка повторной загрузки исчезает/);
    expect(alpha81Delta).toMatch(/вертикального жеста мышью.*не мешает.*горизонтальному перелистыванию/);
    const alpha83 = TRUSTED_HISTORICAL_SEED.find(row => row.application_version === "0.1.0-alpha.83")!;
    const alpha83Delta = [...alpha83.additions, ...alpha83.fixes].join(" ");
    const currentDelta = [...CURRENT_NAMED_RELEASE.additions, ...CURRENT_NAMED_RELEASE.fixes].join(" ");
    expect(currentDelta).toContain("На единой странице «Мои игры» свои связи с одной игрой объединены в одной карточке: управление, заявки и участие, настоящие приглашения, советы и контекст итогов.");
    expect(currentDelta).toContain("Игры разделены на «Предстоящие» и «История». Доступны четыре фильтра: «Все», «Создаю и управляю», «Заявки и участие», «Приглашения». Одна игра может относиться к нескольким фильтрам.");
    expect(currentDelta).toContain("Настоящие приглашения показаны прямо в карточке игры. Принятие использует актуальную версию игры, полученную с действующими правами; отклонение доступно там же. Приглашение само по себе не подтверждает участие и не резервирует место.");
    expect(currentDelta).toContain("Советы по своим играм показаны в соответствующих карточках; остальные полученные советы остаются во вторичном разделе.");
    expect(currentDelta).toContain("Существующие напоминания после игры и переход к итогам сохранены в контексте своей игры. История показывает исход заявки или статус игры, не подтверждая присутствие на площадке или оплату.");
    expect(currentDelta).toContain("Возврат из карточки игры ведёт к выбранному фильтру и нужному разделу «Моих игр», сохраняя понятный контекст перехода.");
    expect(currentDelta).toContain("На телефоне переключатели фильтров имеют естественную ширину: подписи читаются целиком, переключатели переносятся на следующие строки.");
    expect(currentDelta).toContain("В пустом выбранном фильтре доступно действие «Показать все». Советы, уже показанные в карточках, учитываются в пустом состоянии вторичного раздела, в том числе при незавершённой загрузке следующих страниц.");

    expect(alpha83Delta).toMatch(/создании новой площадки.*по желанию.*отдельно от обложки игры/);
    expect(alpha83Delta).toMatch(/площадка и игра остаются сохранёнными.*необязательная отправка фотографии не удалась/);
    expect(alpha83Delta).toMatch(/настоящий источник, автора и основание прав.*просмотреть.*явно подтвердить отправку/);
    expect(alpha83Delta).toMatch(/Ожидающая решения фотография приватна.*не считается официальной/);
    expect(alpha83Delta).toMatch(/своего известного предложения.*статус, приватный предпросмотр и отзыв до решения/);
    expect(alpha83Delta).toMatch(/отказа проверки данных \(422\).*исправить сведения.*заново подтвердить.*отдельно явно отправить.*сохранённую площадку.*без повторного создания площадки или игры/);
    expect(alpha83Delta).toMatch(/неизвестен из-за сбоя связи.*исходные данные и ключ отправки.*явного восстановления того же запроса/);
    expect(alpha83Delta).toMatch(/Неизвестный результат не считается отказом проверки данных.*не запускает автоматическую повторную отправку/);
    expect(alpha83Delta).toMatch(/Admin.*только выбранной площадки.*источник, авторство, права и приватный предпросмотр/);
    expect(alpha83Delta).toMatch(/Одобрение или отклонение.*свежего повторного подтверждения входа.*актуальных версий и явного решения/);
    expect(alpha83Delta).toMatch(/Проверка содержимого сохраняется.*не более 8.*без замены обложки, общей очереди и автоматического одобрения/);
    expect(alpha83Delta).toMatch(/неизвестном результате решения Admin.*переход в другой раздел не теряет.*данные и ключ решения.*восстановление.*явным.*тот же запрос/);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/alpha\.82.*серверная часть.*alpha\.83.*пользовательская форма.*служебное рассмотрение.*обычным аккаунтом и служебной ролью ещё не выполнена/);
    expect(CURRENT_NAMED_RELEASE.known_limitations).toContain("Кнопка загрузки, добавление фотографий к комментариям площадок и показ текущих одобренных фотографий внутри комментариев реализованы в alpha.80. Нижняя постраничная галерея фотографий сообщества, полноэкранный просмотр и переход к текущей публикации реализованы в alpha.81. В alpha.82 реализована серверная часть предложения фотографии создателем площадки; в alpha.83 добавлены пользовательская форма при создании новой площадки и служебное рассмотрение предложений выбранной площадки. Проверка этого сценария с обычным аккаунтом и служебной ролью ещё не выполнена.");
    expect(currentDelta).not.toMatch(/#507.*(?:DONE|заверш|выполн)|проверка владельцем пройдена|нативный интерфейс доступен/i);
    expect(currentDelta).not.toMatch(/(?:^|[^а-яё])нов[а-яё]*\s+(?:допуск|срок|окн)[а-яё]*|медиа|нативн|автоматическ.*удал|модераци[яи]\s+(?:полностью\s+)?(?:завершена|выполнена)|приёмк.*пройдена/iu);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(/(?:просмотр|отзыв публикации).*ещё не доступ/i);
    expect(CURRENT_NAMED_RELEASE.title).toBe("Единая страница «Мои игры»");
    expect(CURRENT_NAMED_RELEASE.known_limitations).toHaveLength(9);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/проверка загрузки фотографии площадки в установленной версии ещё не выполнена/i);
    const limitations = CURRENT_NAMED_RELEASE.known_limitations.join(" ");
    expect(limitations).toMatch(/реальным аккаунтом.*перезагрузке.*390 и 1280.*ещё не выполнена/i);
    expect(limitations).toMatch(/#506.*проверка маскирования.*редактирования с действующими правами.*разбора жалоб.*ещё не выполнена/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations).not.toContain(
      "Редактирование опубликованного отзыва в пользовательском интерфейсе ещё не доступно",
    );
    const currentLimitations = CURRENT_NAMED_RELEASE.known_limitations.join(" ");
    expect(currentLimitations).not.toMatch(/вход.*отзыв.*ещё не\s*доступ/i);
    expect(currentLimitations).not.toMatch(/карте площадок.*ещё не\s*доступ/i);
    expect(currentLimitations).not.toMatch(/публичного автора без замены/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/карточки тренировки.*«Дружеский матч».*реальными ролями, обычным входом и сетевыми ответами ещё не выполнена/i);
    expect(CURRENT_NAMED_RELEASE).not.toHaveProperty("accepted_at");
    expect(CURRENT_NAMED_RELEASE).not.toHaveProperty("deployments");
    expect(CURRENT_NAMED_RELEASE).not.toHaveProperty("api_digest");
    expect(CURRENT_NAMED_RELEASE).not.toHaveProperty("web_digest");
    expect(fixes).not.toMatch(/публичное имя и аватар в шапке|без мерцания|после выхода из аккаунта/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).not.toMatch(/маскирование.*пока не доступно пользователям/i);
    expect(CURRENT_NAMED_RELEASE.known_limitations.join(" ")).toMatch(/личных сообщений и закрытых чатов не заявляется завершённой/i);
    expect(prose).not.toMatch(/проверки (входа|авторизации).*отменены|постоянно.*(кэш|сохранён)|приёмка.*пройдена/i);
    expect(prose).not.toMatch(/\bOPS\b|cache.?scope|admission|ownership|\bwriter\b|кэш/i);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.62" &&
          row.version_label === "0.1.0-alpha.62" &&
          row.source_sha === "65b987116184dada309b87054b5cbe42c0f21578" &&
          row.deployments[0]?.release_id === "r42540492310-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-09T00:42:02Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:0508f4747bd38eebdd465b5d14c1fd29962c9bb2fe1b3c3a2a20a90da9ac333b" &&
          row.deployments[0]?.web_digest ===
            "sha256:cac3c8981b7444f8c91752db7a3fd4001e1514521b2aad8ec1cc42343b3a6e15" &&
          row.title ===
            "Мобильные карточки игр и тренировок, собственная отметка посещения и кнопка блокировки" &&
          row.api_contract_version === "0.40.0" &&
          row.fixes.length === 3 &&
          row.fixes.some((item) => /не требует подтверждать.*самому себе/i.test(item)) &&
          row.fixes.some((item) => /не разрывается внутри слова/i.test(item)) &&
          row.fixes.some((item) => /одинаковую компоновку и действия/i.test(item)) &&
          row.owner_uat === "NOT_TESTED",
      ),
    ).toBe(true);
    expect(prose).not.toMatch(/\b15\/20\b|PROD|READY|ACTIVE|DEV|operator|alias/i);
    expect(prose).not.toMatch(/опрос каталога в простое|селектор города|idle polling/i);
    expect(prose).not.toMatch(/уже изменены|уже применены|Цех №1|Старая деревня/i);
    expect(prose).not.toMatch(/134|138|140|Slow4G|5555|8656|все фото|prefetch|переписан|переписать|Изменить/i);
    expect(prose).not.toMatch(/новых типов уведомлен|новой модели разрешен|массовое переименование на диске уже|все файлы переименова/i);
    expect(prose).not.toMatch(/nonce|claim_nonce|Idempotency|MutationRunner|OpenAPI|Mode B|WebP|\bB2b\b|\bB2a\b|RBAC|SQL/i);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.61" &&
          row.source_sha === "23a3d2dba33d79da55151e5d1eff8ff54d9d74ce" &&
          row.deployments[0]?.release_id === "r42532364094-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T22:56:54Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:701c336b8ba179e8c77fea86e5a78d24ce44986cfedfa5750f1eff600e7f4aea" &&
          row.deployments[0]?.web_digest ===
            "sha256:cd6b4327e306b02968488d3687069ed485af08f1296a9d989cb78536db0c9837" &&
          row.title === "Ремонт сетки ролей в карточке тренера" &&
          row.api_contract_version === "0.40.0" &&
          row.known_limitations.some((item) => /мобильная кнопка|унификация действий/i.test(item)),
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.60" &&
          row.source_sha === "2db4aafece41939f9e209bae9015f90da1d8ca7a" &&
          row.deployments[0]?.release_id === "r42528128745-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T22:07:51Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:1e111f7338350cfb3418d5cb77a1ec66c160b79fb10ff76008aaec0f73a7e74e" &&
          row.deployments[0]?.web_digest ===
            "sha256:a5c995635405ac5f15b2be19a212f77c4a771a8ccb58cb5918b9ec3d56eb0547" &&
          row.title === "Выбор площадки, обсуждение, первая оценка и карточка тренера по макету Astra" &&
          row.api_contract_version === "0.40.0" &&
          row.known_limitations.some((item) => /визуальный дефект|узкие колонки/i.test(item)),
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.59" &&
          row.source_sha === "360e308199da1fd58afda631cef9e432c427ff07" &&
          row.deployments[0]?.release_id === "r42521707427-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T20:50:15Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:981251536f36cdc169412b7c21a02cd366d87a422e4be1072155cb577574a80e" &&
          row.deployments[0]?.web_digest ===
            "sha256:5bba49aff868559292c91740d294eda69a492b7e7da5a6be812fb05caf35f47e" &&
          row.title === "Перенос жалобы на сводку на узком экране, якоря разделов площадки и стабильная личность в шапке" &&
          row.api_contract_version === "0.40.0",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.58" &&
          row.source_sha === "190187919cb3e36839aabc543e2c85d206de0cb4" &&
          row.deployments[0]?.release_id === "r42508393660-a3" &&
          row.deployments[0]?.accepted_at === "2026-11-08T18:34:32Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:ef01bfb584eedb24f5a0a9836053a7f0ba0ee9f3db2ff66ad345fd1c9246053c" &&
          row.deployments[0]?.web_digest ===
            "sha256:8bd2a2f5134b6fe8ee919697b24fb8af546385e2be8a4501fff7473d6082fe10" &&
          row.title === "Оценки сообщества площадки и открытое обсуждение" &&
          row.api_contract_version === "0.40.0",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.56" &&
          row.source_sha === "524088767e2b7e77d569c2f0a47689db854ab7b0" &&
          row.deployments[0]?.release_id === "r42465159954-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T09:11:48Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:58e9c86acd10434b1e748c4dfffe7aac0bd375070559c8458a40ffbd1113927c" &&
          row.deployments[0]?.web_digest ===
            "sha256:7457fe35b99d31b9bc48e1dbf862ff39a23eb1a11cf471dfeb2dd1e5cb2932e4" &&
          row.title === "Скрытие непроверенных фото из VK/Яндекс и журнал метаданных модерации" &&
          row.api_contract_version === "0.39.0",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.57" &&
          row.source_sha === "895e97fd5f60e4eaaa493cb911cd7d3d7fdd4c22" &&
          row.deployments[0]?.release_id === "r42486594258-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T13:53:05Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:dde4e16f576ec4df2c69cee584dbfa91bba89afe99fa338378f9a629bc148b55" &&
          row.deployments[0]?.web_digest ===
            "sha256:e9824a215dbc8746331d02181e38441883a6fc4348e1ded143c878c363fd6e2f" &&
          row.title === "Карточка тренера в ленте и выравнивание кнопок действий в карточках игроков" &&
          row.api_contract_version === "0.39.0",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.55" &&
          row.source_sha === "edc6744ce0f96dcaa922dafcd373fdab8e482bf8" &&
          row.deployments[0]?.release_id === "r42455870420-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T06:58:58Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:59d94a8d7a0a199693e1aa388e7a5ca5b032df6735a19b716612477460703b06" &&
          row.deployments[0]?.web_digest ===
            "sha256:e2cba1cdaddd2b2779c7075e487b428239ea6e5d5c0988e9b88dcdd4a6721ee5" &&
          row.title === "Жалоба на выбранное сообщение с явным согласием и чтением источника в обращении" &&
          row.api_contract_version === "0.38.0",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.54" &&
          row.source_sha === "cce49ce72daed8c81f89ddc845deabbb8ac5d7aa" &&
          row.deployments[0]?.release_id === "r42449222181-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T05:18:57Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:03cdab10c3c780b0bcd69b12bf8fbc013742e21f017fa2b076acd1c77b00bf3c" &&
          row.deployments[0]?.web_digest ===
            "sha256:fbc040efc941c25dc238ab51b986962f818d901e17a797a7e232193a51754896" &&
          row.title === "Локальная защита личных сообщений и сохранение черновика при отказе" &&
          row.api_contract_version === "0.37.0",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.53" &&
          row.source_sha === "79e51ff2b0b4846a9fee3be0f429f3f3d6c822ab" &&
          row.deployments[0]?.release_id === "r42441987882-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T03:29:11Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:fb05d669436562d669059604d9a4c7d1a4624d78a840d3a1891e95e4fba21f68" &&
          row.deployments[0]?.web_digest ===
            "sha256:7f80fa109b4695188b7f7c7ff4dc8bdc633d82c75c2c462f61c8a0950470450c" &&
          row.title === "Проверка описания площадки при импорте и подписей к фото галереи",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.52" &&
          row.source_sha === "aa222e469c4125abf1e8fe08eaba4e05575ead72" &&
          row.deployments[0]?.release_id === "r42435428393-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T01:56:35Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:8903f05d967fa575e99af1a20f2f7e8910fb0cacb60c52098c680df84118f066" &&
          row.deployments[0]?.web_digest ===
            "sha256:e6ac26251db8dea9e30a54c0c79571659dedddb20cd4ee1103e92ee16ab616ba" &&
          row.title === "Проверка публичных названия, адреса и описания площадки до публикации",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.51" &&
          row.source_sha === "4cefe7a6ef780da13796c1df85eca6fdc27a50ef" &&
          row.deployments[0]?.release_id === "r42427559664-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-08T00:08:42Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:55b2753ad3debb76583a8c56a49fd42acd8619b0d667820d68b2a709be719330" &&
          row.deployments[0]?.web_digest ===
            "sha256:0f17742f15f5533986409abfa49ca9fe569defa99fe3d205ec69f494f6265fa7" &&
          row.title === "Временно сняты количественные ограничения проверок на тестовом стенде",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.50" &&
          row.source_sha === "3153e3cd1fd1e1f1936e60ea27f7632589701bea" &&
          row.deployments[0]?.release_id === "r42424550031-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T23:32:15Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:a60b517a4c340ee7588354396ecea31179f282bdaeba2e018fee86cced5b5508" &&
          row.deployments[0]?.web_digest ===
            "sha256:6c196b8fdb9dbc053df91bc8867e5861507de0bea779fa4f3d7ba4832398499c" &&
          row.title === "Отзывы о площадке: проверка текста до решения человека",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.49" &&
          row.source_sha === "519489d9d0944619b29107b212dc09012e5b418b" &&
          row.deployments[0]?.release_id === "r42418500085-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T22:12:06Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:662bcd70dfa500766bfd6cc64dc836fb8a60307ae188e198a9146a34f89760c4" &&
          row.deployments[0]?.web_digest ===
            "sha256:4c2ed4faadbecb22745cd76dbb7ebbe9b513f0f72ab76dc9b758ef5d60fc8707",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.48" &&
          row.source_sha === "608f44e9af26da7ea24881fe31c2c7e49ed8aeb3" &&
          row.deployments[0]?.release_id === "r42412760323-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T20:59:58Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:0145f018db57417491b262c83e88dd5cf779860faca64762f3e92bfc34c86295" &&
          row.deployments[0]?.web_digest ===
            "sha256:cd91420354aaee9b2a78bd8502d31804296e5ed474410b909604f32224f491df",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.47" &&
          row.source_sha === "cf0349ad52d5caf10a8b40e209e8c837e9c4da43" &&
          row.deployments[0]?.release_id === "r42403605993-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T19:05:58Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:d0dca6a3f0a036a452758393806fc582f8827a8be8734fec30f52f29a4cdb52b" &&
          row.deployments[0]?.web_digest ===
            "sha256:f4b63b48aef27f64c5da14ca381ca4cc2786689d8247931ab1a4e8e0e0144ac5",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.46" &&
          row.source_sha === "264d9e1cf63b4272732b2b9ad2317e9f9b9d320f" &&
          row.deployments[0]?.release_id === "r42400302014-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T18:20:21Z" &&
          row.deployments[0]?.api_digest ===
            "sha256:d62283d142aa89344a104e1505a5ccca01cbf57da6867919a223f07812779879" &&
          row.deployments[0]?.web_digest ===
            "sha256:375944a55af9e1c16b2c08aa28d22d4fefade2dd453d36c0e29b2c286f474f97",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.45" &&
          row.source_sha === "2650fcbe21976564b8b1ff90aac67ea4eca5b569" &&
          row.deployments[0]?.release_id === "r42393881246-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T17:12:03Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.44" &&
          row.source_sha === "b27f91beceee24029311b9be2e26eca12b343ccb" &&
          row.deployments[0]?.release_id === "r42376945998-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T13:41:23Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.43" &&
          row.source_sha === "4614a0006d0e080bca4c8c5cb6335056a80d5a21" &&
          row.deployments[0]?.release_id === "r42372648654-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T12:33:39Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.42" &&
          row.source_sha === "a72905b82e3d82ba0c08df44da8046e7db6e31ff" &&
          row.deployments[0]?.release_id === "r42369478229-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T11:55:54Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.41" &&
          row.source_sha === "3dbf8e04b978ba5f8a0379379ef46b054008ec44" &&
          row.deployments[0]?.release_id === "r42366434024-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T11:13:52Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.40" &&
          row.source_sha === "0d6dd4852db26e0cb9feea03c78119cf5e2b04e4" &&
          row.deployments[0]?.release_id === "r42362366120-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T10:09:04Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.39" &&
          row.source_sha === "01ea6f2f490c9d8efbbf6b9c58d30d844096ee14" &&
          row.deployments[0]?.release_id === "r42359322474-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T09:34:34Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.38" &&
          row.source_sha === "298917fe49ccc57e8891e68a04e6408e4aa3a0d1" &&
          row.deployments[0]?.release_id === "r42338172236-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T04:27:56Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.37" &&
          row.source_sha === "859bb6a635ad704ad0971f8a7ad748b02eda0017" &&
          row.deployments[0]?.release_id === "r42327405382-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T02:10:06Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.36" &&
          row.source_sha === "9af6482afeb0e5552c20af25a04dd6503957202d" &&
          row.deployments[0]?.release_id === "r42325229441-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T01:45:38Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.35" &&
          row.source_sha === "5c75185408042d7d119a7f63304c9ac609b68cbc" &&
          row.deployments[0]?.release_id === "r42321599702-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-07T01:05:19Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.34" &&
          row.source_sha === "d96df8096a0b4c6394fa5ab1f3e6e26ad378710e" &&
          row.deployments[0]?.release_id === "r42293392235-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-06T21:08:02Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.33" &&
          row.source_sha === "ebebea18f216260f8ecd7de8e4c450d157b21a5b" &&
          row.deployments[0]?.release_id === "r42290038408-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-06T20:43:19Z",
      ),
    ).toBe(true);
    expect(
      TRUSTED_HISTORICAL_SEED.some(
        (row) =>
          row.application_version === "0.1.0-alpha.32" &&
          row.source_sha === "9b07e77fcf300b0265e2151478c45d2881b389d0" &&
          row.deployments[0]?.release_id === "r42280047435-a1" &&
          row.deployments[0]?.accepted_at === "2026-11-06T19:34:49Z",
      ),
    ).toBe(true);
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

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

  it("bumps current descriptor to alpha.66 with API 0.40.0", () => {
    expect(CURRENT_APPLICATION_VERSION).toBe("0.1.0-alpha.66");
    expect(API_CONTRACT_VERSION_NOTE).toBe("0.40.0");
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
    expect(prose).toMatch(/Карточка тренировки и подтверждение дружеского матча/i);
    expect(prose).toMatch(/Отзывы и история|Дружеский матч/i);
    expect(prose).toMatch(/1 января 2027|2027 UTC/i);
    expect(prose).toMatch(/приёмк|NOT_TESTED|iPhone|GoBad|#506|#522|карт/i);
    expect(CURRENT_NAMED_RELEASE.fixes).toHaveLength(2);
    const fixes = CURRENT_NAMED_RELEASE.fixes.join(" ");
    expect(fixes).toMatch(/роли тренера и организатора показаны согласованно/i);
    expect(fixes).toMatch(/«Отзывы и история» изначально свёрнут.*раскрывает отзывы и историю отдельно по ролям/i);
    expect(fixes).toMatch(/метка «С тренером» читается целиком/i);
    expect(fixes).toMatch(/квадратные фотографии на широком экране и мобильные кнопки действий/i);
    expect(fixes).toMatch(/подтверждённом взаимном желании сыграть.*«Дружеский матч».*именами обоих игроков и продолжением поиска/i);
    expect(fixes).toMatch(/переход к общению зависит от текущих прав/i);
    expect(fixes).toMatch(/высоту экрана и безопасные отступы/i);
    expect(fixes).not.toMatch(/нецензурные выражения.*замаскированными|Маскирование/i);
    expect(fixes).not.toMatch(/На карте|сложенной карты|Radar|унифицированы кнопки действий|alpha\.62/i);
    expect(fixes).not.toMatch(/не требует подтверждать.*самому себе|не разрывается внутри слова|собственн.*посещени/i);
    expect(CURRENT_NAMED_RELEASE.additions).toHaveLength(0);
    expect(CURRENT_NAMED_RELEASE.title).toBe("Карточка тренировки и подтверждение дружеского матча");
    expect(CURRENT_NAMED_RELEASE.known_limitations).toHaveLength(9);
    const limitations = CURRENT_NAMED_RELEASE.known_limitations.join(" ");
    expect(limitations).toMatch(/реальным аккаунтом.*перезагрузке.*390 и 1280.*ещё не выполнена/i);
    expect(limitations).toMatch(/#506.*проверка маскирования.*редактирования с действующими правами.*разбора жалоб.*ещё не выполнена/i);
    expect(limitations).toMatch(/#522|карте площадок|отзыв после конкретной игры|публичного автора без замены/i);
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

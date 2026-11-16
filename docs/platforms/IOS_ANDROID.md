# iOS и Android

## #522: metadata-preparation checkpoint alpha.97 · 2026-11-16

Снимок предоставленных фактов на момент подготовки metadata, без сетевой проверки runtime.
Приложение `0.1.0-alpha.97` описывает native оценку сообщества и текстовое обсуждение внутри
раскрытых сведений о площадке. Можно поставить/отозвать обычную оценку и пожаловаться на неё;
написать комментарий или ответ, пожаловаться, изменить/удалить свой корневой комментарий при
актуальном разрешении сервера. В компактной карточке UGC не монтируется. Gallery, keyboard,
gesture/focus, header и peer handling сохранены. Native photo authoring и verified postgame
reviews не входят в этот ограниченный результат; полная parity остаётся обязательной.

| Стадия | Факт на этом checkpoint / открытая граница |
|---|---|
| Принятый DEV / rollback | Alpha.96, `f51b6f1741e4b6aa01bb4b1edcd7a4e065871118`, `r43791783161-a1`, принято `2026-11-16T02:28:55Z`. History seed SHA256 `18b9731a17825036d95c2b8d07584a84cafd3d46c44296bcd77ea50340b3a0ae`, 11155 bytes: все десять полей сохранены, как и все предыдущие строки, два deployment alpha.93, alpha.94/95, URL, даты и digests |
| Native source / metadata | `3e3e3e25d5067f1acc7b5b72fe43e43efd4042f6`, versionName `0.1.0`, target versionCode **12**. Summary SHA256 `598656a45d8562b2eedd46951cc03f830b135df07166675cc18c2a50524ec24a` (1177 bytes). Native source, будущий metadata M и future merge — разные SHA; M/merge не назначены. `prepared_source_sha` указывает на native source, `source_sha: null`; alpha.97 DEV ещё не подтверждён |
| Custody / owning evidence | Manually recovered Cursor source; original custody **HOLD retained**. RS `001bf18e5eaa8dbe0f517bf01e7a47aa9156ca77ab5118cd86d5cbcf43c463fc`; current owning PASS `d392777245f60571b6ef58833e68f4df6d4fc6bb1b30b313b216d5c0e350fd66`. Static 366/mobile15/API и fresh DB4 PASS `57697f80f3ac9ad5b5bae062e5f1d3963335a9425a8c92897fc4efff59010030` — отдельные проверки, не independent QA/device acceptance |
| Реальная QA-цепочка | FIRST cumulative25 **FAIL** `858c5983013b4491a6ba7421d6e27b4b36034115d6ad37e3f1099dbcc5194612` → focused **FAIL** `7724bf31e196fc4ae4c111bad389ac869eaded6bef9a831238698d7cedd923f2` → corrected focused VCUX5 **PASS** `211c0c4080aee667af258a447b1cd3214d68970c014065e55fd35f96c6ac9d3e`. Полный review и оба FAIL сохранены; FIRST whole PASS не заявляется |
| Backend / schema | Принятый alpha.96: selected installed **22**, whole NativeBearer **64**. Source UGC добавляет **8**, target selected **30** / whole **72**; эти восемь не объявляются установленными до фактического alpha.97 DEV proof. API-контракт `0.44.0` и schema **72** без изменений; число bearer routes и schema inventory различаются |
| Android code12 | Дополнение Root к metadata-preparation checkpoint: arm64 build **20384 PASS**, SHA256 build receipt `0e7cac849f3fc384cd3d17223c059977bc911d9988bc72ca5eef658b4e4f3e86`. Root сообщил owned phone APK: SHA256 `df0c755225e7a29ef4163df1ee9deb8c01994dd76666bea4a634467625dc5d44`, **44853769 bytes**. Эти supplied факты заменяют прежний null checkpoint только для arm64; отдельный owned-sign receipt здесь не предоставлен. x86_64 на исходном checkpoint был **RUNNING**; завершение, sign receipt и paired PASS не предоставлены. Candidate APK URLs: **null**; публикация и DEV alpha.97 этим не подтверждаются. Это датированный снимок, не постоянное утверждение об отсутствии подписи или публикации |
| Публичный binary | APK11 уже опубликован по предоставленному заданию. Существующие historical APK11 URL/receipts неизменны; новые ссылки не выводятся из target12 и не выдумываются. Исторический checkpoint alpha.96 ниже отражает состояние до публикации APK11 |
| Устройство / UAT | Новый binary **NOT_TESTED**; прежний Owner UAT **FAIL_RECHECK_PENDING** сохранён. Raw Samsung S23/alpha.85 FAIL и Xiaomi gesture/header FAIL, marker remarks и неподтверждённая причина two-gesture PlayerSwipe error остаются в истории до фактического retest. Source/static/DB/QA не доказывают physical acceptance |
| Дальнейшие gates | Root: три release suites, types/lint/history → независимая metadata QA → обязательный Product CI → trusted merge dev → DEV ACCEPTED / STRICT target30/whole72 и read smoke → actual paired build/sign/publication receipts. Ранее принятые STRICT/smoke SHA256 `1c4558fae68e625af00da7190175631e13bf1e92ededdcade0fbd227cc22a40f` / `03c8c39edc8a020f7ea389d0133f2756239474bacba21cb3e19dc5503baed30e` относятся к alpha.96, не приёмке alpha.97 |

Полный #522 и full native parity **MANDATORY_NOT_COMPLETE**. iOS, реальный signed OTA A→B,
physical S23 и установленный authenticated journey остаются открытыми. PROD/stores не разрешены.
Native/backend/auth/contracts/dependencies/versionCode здесь не меняются; mobile tree сохраняется
byteexact к qualified source. Ниже сохранены исторические checkpoints со своими границами времени.

## Исторический checkpoint подготовки alpha.96 · 2026-11-16 (сохранён)

Это снимок предоставленных фактов на момент подготовки metadata, без сетевой проверки runtime.
Текущий принятый сервер — DEV `0.1.0-alpha.95`, source/rollback
`dfd886a0a8f66f2c2193dd41878e0e78778f4508`, API `0.44.0`, release `r43768255684-a1`,
приёмка `2026-11-15T22:20:35Z`. Основание — `ACTUAL-ALPHA95-HISTORY-SEED.json`,
SHA256 `080a69ed4a07bd7ae18de81728d24d0fb65ed9f117e0bf69e8b1e0393b6f99c7` (9618 bytes).
Все десять полей этой записи, оба deployment alpha.93, alpha.94 и более ранняя история сохранены.

Qualified native source — `c287be8b5597072f3c9ad800bac2f5d6cb93c91f` (C287),
versionName `0.1.0`, versionCode **11**, отдельно от будущего metadata candidate и server merge.
Основание — `ACTUAL-QUALIFIED-NATIVE-SOURCE-SUMMARY.json`,
SHA256 `1444b7373a7e2362006463873d9a5522c321d046a39a023c7c9fac72fea440d8` (1020 bytes).
C287 ещё **не принят на DEV**. Alpha.96 — подготовленный release descriptor:
`prepared_source_sha` указывает на C287, `source_sha: null`; deployment/release_id/accepted_at
этого выпуска не назначены. Будущие metadata SHA, source counter и публичные artifact URLs
не назначены. Actual paired build/owned-sign подтверждены отдельным review ниже;
бинарные файлы зафиксированы, повторная сборка и новый native bump не выполняются.

| Стадия | Подтверждённый факт / открытая граница |
|---|---|
| Native source | Source RS SHA256 `9648ae02a070db5016a98fa65581a110672b474da26f154675faf635ab44d2ab`; owning parent PASS SHA256 `3d1a9ed2aea35dd8270428703df3a07eab75bb16b28030c18dbe36770de8e5ca` |
| Независимая source QA | Actual FIRST13 **FAIL** SHA256 `63326ca96c4d8c44d3aa0f36652479fa39bc453bf31dae233c8f07fba9b139e4` сохранён. Focused P2/all-repair PASS SHA256 `ed16f6cd1e955ba56e45000e9a826f115a04c948621112aab355f25d3f6d7c10` подтверждает исправления в своей границе; cumulative FIRST13 PASS **не предоставлен** |
| Дополнительная bounded source QA | Actual Astra6 SOURCE PASS для конкретного C287, SHA256 `eed084b305dda04e320850f8741194e1e2c0d7e4cac0626e437f30011b2cde02`; это не device PASS и не общая квалификация production identity |
| Android code11 build/sign/publication | **PASS_ARTIFACT_ONLY**, binaries frozen: `ACTUAL-CODE11-PAIRED-ARTIFACT-REVIEW.json`, SHA256 `dccfe7ce01122542e1a22e692aecfc6c36df675f91de9480937e480f3e04cb3d` (3944 bytes). Actual arm64-v8a и x86_64 APK имеют verified owned/v2 signature и payload byteexact к qualified C287 build. Package `ru.gobadminton.mobile.dev`, versionName `0.1.0`, versionCode **11**, owned certificate сохранён. Общий embedded bundle **3215008 bytes**, SHA256 `c4cdc4ac26cc45a67cbdc2b2207ced1ecb703b6686c0d538781ef7503c7d47e1`. Публичная доставка **не разрешена**, статус **HELD_METADATA_INDEPENDENT_QA_CI_DEV**; URL не назначены, device **NOT_TESTED**, Android domain verification **NOT_VERIFIED** |
| Зафиксированные code11 APK | arm64-v8a: **44780041 bytes**, SHA256 `aee1aba2dfcba5064c6eaa239a73ab273e8dbec54f52fddb5345a84d3338c070`, receipt SHA256 `b2c4b63a9093e0c140802e940fc0b8473ec16702109d496decea032bafad1c68`; x86_64 QA: **45816251 bytes**, SHA256 `594a8d88b9c6bbd0a7fa09015afd2d1ea274eb2f08feb7c9ab64414532360152`, receipt SHA256 `0a61cf11c9f6463fbc635fcc48c081579fb7d5778eb2ffd1aa6597fc5805b224`. Private paths не являются публичными ссылками; rebuild не требуется |
| Backend | API `0.44.0`, selected native inventory **22**, whole OpenAPI NativeBearer **64**. Это существующие серверные факты, не новые opt-ins alpha.96; backend/contracts/auth/permissions не меняются |
| Устройство / Owner UAT | Device **NOT_TESTED**, Owner UAT **FAIL_RECHECK_PENDING**. Прежние замечания Owner на Xiaomi в APK10 к жестам и шапке сохраняются до actual capture нового APK11. Samsung S23/alpha.85 FAIL и замечания к меткам также сохранены. Причина PlayerSwipe two-gesture load error **UNCONFIRMED**; обработка отдельных peer 404 не доказывает её исправление |
| Доставка alpha.96 | Root: fresh web types/lint, три release suites/history → FIRST five independent metadata QA → обычный PR → CI7 → merge dev → DEV STRICT selected22/whole64 → read smoke → owned paired APK11 publication. Эти будущие стадии не объявлены пройденными; существующие accepted DF/alpha.95 проверки не заменяют доставку C287 |
| Обязательный остаток | #522 **PARTIAL**, full native parity **MANDATORY_NOT_COMPLETE**; source/preview/build дают только частичное подтверждение. Installed Android/device visual/taps/auth/links, full profile, native UGC и остальные WEB contracts обязательны. Backend current/previous-client compatibility, signed OTA A→B, interruption/offline/tamper/recovery и iOS gates ниже остаются открытыми; PROD/Store не разрешены |

Alpha.96 описывает только подготовленные в source поведения: карточка площадки на карте раскрывается,
сворачивается и закрывается вертикальным жестом, кнопки и прокрутка сохраняют своё управление;
галерея переключается горизонтальным жестом, выбранное изображение сохраняется при раскрытии,
сворачивании и переходе между сведениями о площадке и расписанием. Native fullscreen viewer этим
source proof не подтверждается.
Шапка содержит переход к играм по названию, радар и профиль; возврат расположен отдельно.
При последовательных подтверждённых detail-404 удаляются только соответствующие анкеты, сохраняются
остальные загруженные карточки и cursor/пагинация; устаревшие ответы не возвращают исключённые анкеты.
List-endpoint 404, network/parse/auth ошибки этим поведением не объявляются безопасными пропусками.
Это не завершение карт, Radar, Swipe или полного matching и не доказательство жестов на телефоне.

Исторические phone/x86 code10 publications сохраняются как история предыдущего binary; checksum и
sign verification code11 подтверждены actual paired review выше, публичные URL из code10 не выводятся.
Ниже оставлен прежний alpha.95 preparation
snapshot с фактическими supplied code10 build/sign summaries: его private/public состояние относится
к тому checkpoint, а не ко всему последующему lifecycle. Точные новые publication receipts здесь
не предоставлены; вымышленные ссылки и отрицательный signing status не добавляются.

## Исторический checkpoint подготовки alpha.95 · 2026-11-15 (сохранён)

Один React Native + Expo/Router клиент, backend и User, единые бизнес-правила. E «Траектория» — introduction;
четыре конечных корня **Игры / Игроки / Мои игры / Сообщения**, профиль — destination из постоянного header.
Onest, black-on-green, safe edges и масштабирование текста сохранены. Это factual reconciliation текущих
исходников, а не новая архитектура и не доказательство физической приёмки.

Текущее состояние по предоставленным qualified inputs для alpha.95 и sanitized summary
`ACTUAL-QUALIFIED-SOURCE-BUILD-SIGN-SUMMARY.json` (SHA256 `96283527474fc798faaa39afe3afbdc190add9cfbba02a9c12e6d62249bc37c8`):
owned-sign code10 подтверждена. Новый DEV alpha.95 **NOT_ACCEPTED_YET**. **Checkpoint facts** (не постоянный
`NOT_PUBLISHED` claim): selected installed inventory **22** и восемь MyGames/Postgame bearer routes уже
приняты на сервере `b703fad0107a4888808b542dcb7cd49f2c269603`; публикация APK9 реальна (историческое
evidence `receipt8a22`); APK10 остаётся private signed на этом metadata-preparation checkpoint
(`APK10_public: false`, `APK_URL: null` — URL не выдумывается). Подпись code10 не доказывает Owner UAT,
device/login/verified links или продуктовую приёмку. Qualified native source
`8cd08ec8631ea8af89b6190482fcb35caaffca9c` (code10 / versionName `0.1.0`); будущий metadata merge и
принятый серверный SHA этого номера — отдельные факты. Приложение `0.1.0-alpha.95` описывает
ограниченное исправление открытия метки на карте; API-контракт остаётся `0.44.0`. Venue/community
candidate (**224**) **HELD_NOT_INCLUDED** и не входит в этот product release.

| Стадия | Текущий подтверждённый факт / обязательная открытая граница |
|---|---|
| Принятый сервер / rollback | DEV `0.1.0-alpha.94`, source `b703fad0107a4888808b542dcb7cd49f2c269603`, release `r43736231808-a1`, принято `2026-11-15T16:48:11Z`; это текущий принятый rollback target, не future alpha.95 native source |
| Два развёртывания alpha.93 (история) | Сначала `f145863cdd098b016bdd1ae2fbbb8520fd71d83b` / `r43707786262-a1` / `2026-11-15T11:26:35Z`, затем `12b5024ae2fb47f5bc8ef3bd755aba24d9bbc8a6` / `r43712227701-a1` / `2026-11-15T12:21:01Z`. Первый STRICT39461 завершился FAIL из-за DOC alias; исправление и второе развёртывание сохранены в истории, первый FAIL не переименован в PASS |
| Принятый alpha.94 | MyGames/Postgame metadata+native lineage на `b703fad0107a4888808b542dcb7cd49f2c269603` / normal23 `a44cd7b22259f61ed1dd31ddeb07224f60fb609d` + qualified metadata; Owner UAT **FAIL_RECHECK_PENDING** сохранён |
| Native marker-hotfix source / static | `8cd08ec8631ea8af89b6190482fcb35caaffca9c`, versionName `0.1.0`, versionCode **10**. Parent PASS SHA256 `25076dd00837e82e90f982f345b982c8e1696aff91ec208d7e8e96b69cd187a4`. Global native author normal execution counter **27** (normal26 first-marker source + normal27 P1 ownership repair); это не число авторов и не proof whole-app |
| Независимая source QA | Focused P1 PASS receipt SHA256 `7f645a96ce663827e766e1269f491174f1fceb7049b561961ecbf85f12cda16b`. FIRST full-6 QA FAIL SHA256 `4193f2d862f0d351cd966fde91c3960b29c0f3e6de7d1258cee1ec89c5c7b5d6` сохранён как история, не переименован в PASS |
| Android code10 build / owned-sign | Actual private build+sign: build receipt SHA256 `87d796f99e5855dfb11b25d0fc4a10e306296cdd86903c5c3e11fdf2d16ab3a2`; owned-sign receipt SHA256 `79f59a3f12ac7800a42f799b8a7645407f1ac622f7105f2dc20f4e9f56d46dea`. Owned certificate SHA256 `5208faba0b474c6c94e4c237cbc345a10c7d3d0f5b3eb285ac8e271f9bd8c051` (тот же, что у owned APK9). Подписанный APK10: SHA256 `9eb049a6874cf9c9bb4b984f37cf7e30f33ab10e94146d65d4cd95638381ae77`, **44751369 bytes**, package `ru.gobadminton.mobile.dev`, `arm64-v8a`, embedded bundle **3187108** bytes. **Checkpoint fact:** APK10 остаётся private signed (`APK_URL: null`); это не постоянный `NOT_PUBLISHED` claim. Ожидаемая установка поверх owned APK9 тем же package/certificate — не device-verified |
| Публичный APK сейчас | **Checkpoint facts:** публикация APK9 реальна (историческое evidence `receipt8a22`); APK10 private signed на этом metadata-preparation checkpoint (`APK_URL: null`, URL не выдуман). Исторические APK8/APK7 ниже сохранены как evidence; private APK path не выдаётся за публичную ссылку |
| Backend native inventory | API-контракт `0.44.0`, whole OpenAPI NativeBearer **64**. **Checkpoint fact:** selected installed inventory **22** и восемь MyGames/Postgame bearer routes уже приняты на `b703fad0107a4888808b542dcb7cd49f2c269603` — **UNCHANGED** в этом metadata release. Новые venue opt-ins **не** входят; этот выпуск их не расширяет |
| Устройства / приёмка | Physical Android / Samsung S23 **NOT_TESTED** (`device: NOT_TESTED`), native visual **NOT_VERIFIED**. Исторические Owner замечания (карта: много меток, ни одна не открывается; PlayerSwipe two-gesture load error) и UAT **FAIL_RECHECK_PENDING** сохранены; code10 требует Owner retest. Причина Swipe **UNCONFIRMED**, swipe code fix в этот выпуск не входит. Source QA и build не доказывают taps на устройстве, вход, verified links или authenticated journey |
| Полный объём | Full #522 **PARTIAL**; full web-to-native parity **MANDATORY_NOT_COMPLETE**; real signed OTA A→B / recovery **NOT_READY**/**NOT_DONE**; Android device/S23 и iOS acceptance обязательны и открыты. Product CI → merge → DEV strict/read smoke → owned HTTPS publication выполняет trusted route после metadata; PROD, production OTA и stores требуют отдельного Owner GO |

Восемь source opt-ins (история alpha.94, не новые в alpha.95): `GET /me/game-results`, `GET /games/:gameId/results`,
`PUT /games/:gameId/outcome`, `PUT /games/:gameId/attendance/:contextId`,
`POST /games/:gameId/attendance/bulk-present`, `POST /games/:gameId/attendance/:contextId/acknowledgements`,
`GET /me/postgame-reminders`, `POST /me/postgame-reminders/:reminderId`.
Disputes/history/help и остальные закрытые сценарии этим списком не объявляются перенесёнными.

### Исторические факты alpha.94 code9 (сохранены)

| Стадия | Подтверждённый факт / отдельная граница |
|---|---|
| Native normal23 / code9 | `a44cd7b22259f61ed1dd31ddeb07224f60fb609d`, versionCode **9**; parent PASS SHA256 `79810e52e583d557dc8dee53d18c3a9a0a1d0fb042cdf174c6e44283505615f6` |
| Независимая source QA | Normal23 focused P2/all-delta PASS `fcf173047e7990f7d717764721c88f22c5c9327d45847ecbd874a1d47edb1c8c`; prior normal22 CHANGES_REQUIRED retained |
| Android code9 owned-sign | Signed APK SHA256 `68d4fbbddb3004e51eca05c617e0600623bf36e07fba79f7272faa93dae8b155`, certificate `5208faba0b474c6c94e4c237cbc345a10c7d3d0f5b3eb285ac8e271f9bd8c051`. **Checkpoint fact:** публикация APK9 реальна (историческое evidence `receipt8a22`); это не постоянный `NOT_PUBLISHED` claim. URL только из фактического supplied publication evidence — не выдумывается |
| DEV ACCEPTED | `0.1.0-alpha.94`, source `b703fad0107a4888808b542dcb7cd49f2c269603`, release `r43736231808-a1`, принято `2026-11-15T16:48:11Z` |

### Исторические факты alpha.92 и venue candidate (не текущее состояние)

Фактические границы из Root `NATIVE522-VENUE-ACTUAL-ACCEPTED-SUMMARY.json`
(SHA256 `05648644db9c5431d7af0c7bdf08f1957748576f943fcc20e14b16dc48069776`):

| Стадия | Подтверждённый факт / отдельная граница |
|---|---|
| Принятый native safety source | `8cb33c634cb0f840ae3f2dc9f7ad330cda9057dc`; **four completed author runs**, не четыре разных автора |
| Независимая source QA | Первый whole safety FAIL `6821f5f535d89ab13d015b3de0af0c622ad113ee7bd2bb79ad672cb3600adea6` сохранён; focused closure PASS `c9a31a48c6a42819796e45611fca67b738c2b603ce5138972640c6d2b483fe3b`, не замена whole FAIL |
| Product CI | Run `43654442331` для принятого safety release; не CI нового venue candidate |
| DEV ACCEPTED | Приложение `0.1.0-alpha.92`, source `2a0b8207b8cc28d0e56a1ec5abecc604e934faed`, workflow `43655345631`, receipt/release `r43655345631-a1`, принято `2026-11-15T00:10:09Z`; receipt SHA256 `fad69c4b23fa6ce1764e9de8fb972e5f4268da940c24b215d4ebeee6deb4dbef` |
| API / DB | API-контракт `0.44.0`, source migration inventory 72; actual DB schema query NOT_PERFORMED (public meta не имеет schema field) |
| Публичный owned APK | Native source `8cb33c634cb0f840ae3f2dc9f7ad330cda9057dc`, versionName `0.1.0`, versionCode **7**, 31842785 bytes, SHA256 `7c0865de47af271ca0f775b193e0994d21e2afee2f3c3e3ac07ac39988f5eee5`; publication receipt `962c6bb5af184dcc2e40e72373f2febac134f887d671e7b0531c77078b7c517e` |
| Текущий venue source | SOURCE_CANDIDATE на accepted alpha.92, versionCode **8**; независимая QA/CI/DEV/APK этого изменения ещё не подтверждены |
| Устройство / UAT | Physical device NOT_TESTED, прежний Samsung S23 FAIL сохранён; Owner UAT **FAIL_RECHECK_PENDING**, native visual **NOT_VERIFIED** |
| Полная parity / OTA / iOS | Full native parity **MANDATORY_NOT_COMPLETE**; real signed OTA **NOT_DONE**, iOS **NOT_DONE**, PROD не разрешён |

Исторический APK7: https://files.anpavel.ru/projects/gobadminton/mobile/dev/alpha92-safety-8cb33c634cb0-7c0865de47af/GoBadminton-DEV-native-0.1.0-7-arm64.apk

### Исторический source inventory до alpha.97 и обязательные ограничения (сохранён)

| Пользовательский сценарий | Исходная реализация сейчас | Ещё требуется |
|---|---|---|
| Intro/city, public games/detail/share | Ручной город, public GET, пагинация/ошибки/retry, upcoming expiry, нативные карточки и Share | S23 visual/taps, keyboard/safe edges/large text/offline и полная card parity |
| Вход/restore/logout/свои сессии | Root AuthProvider, system browser, SecureStore PKCE/refresh, actor/session fences, адресные bearer ports; существующий DEV native registry включён | Реальный provider/login/restart/logout и verified links на установленном телефоне |
| Мои игры/участие/организатор | Hub объединяет загруженные managed/participations/own results/reminders без потери связей; фильтры «Все», «Создаю и управляю», «Заявки и участие», upcoming/drafts/history/terminal/unknown, сортировка и отдельные ошибки источников. Apply/withdraw, create/preview/publish, roster и confirm/reject/remove сохранены | Только загруженный union, не полный inventory аккаунта; приглашения/советы и remaining WEB hub flows, полное редактирование/отмена, роли/гонки/сеть на устройстве |
| Итоги / посещение / напоминания | Исход held/not-held, посещение и self-attestation, provenance/late/open-dispute display, точное versioned acknowledgement; выбор отдельных участников для bulk-present. Reminders: к итогам и «Позже». Review → явное подтверждение; UNKNOWN сохраняет исходный пакет, actor/session fences очищают private view | Полный разбор споров/help/history посещения и остальные Postgame flows не перенесены; внимание считается по загруженным источникам независимо от фильтра. История заявки не доказывает посещение/оплату; device acceptance обязательна |
| Игроки | Каталог/фильтры/пагинация/карточка через существующие права/privacy | Остальная социальная функциональность и visual parity; без новых rating/level правил |
| Сообщения/приглашения/game chat | Inbox/counts, личная и игровая история/чтение, ответы на полученные приглашения, первое явное текстовое обращение, same-packet UNKNOWN reconciliation | Создание/отзыв приглашений, остальные messages flows и установленный authenticated journey |
| Свой профиль / contact | Ручные публичное имя/город и редактор публичного контакта игры, явное versioned/idempotent save, conflict/UNKNOWN/actor fences и возврат к форме без auto-create | Level/photo/privacy settings, методы/link/email/reauth и полный профиль |
| Safety | Явные block/unblock/report, scoped authority reads/fences, сохранение исходных UNKNOWN и черновиков; historical replay не доказывает текущий block state | Повторная пользовательская проверка и физические native interruption flows |
| Площадка: реализовано в source | Game → native public venue facts/gallery/credits/contacts → public upcoming schedule → game; typed venue-create → явный выбор в существующей форме → preview/publish | Полная venue parity и device taps обязательны; source, build/sign и публикация разделены выше |
| Maps/Radar/Swipe | Native public games/venues map и переход к create; marker-tap fix alpha.95 сохранён. C287/code11 добавляет описанные выше sheet/gallery/header и batched qualified peer detail-404 handling. Radar origin/conditions/results/явное управление поиском; просмотр игроков по одному, явный play interest и переход при mutual interest. Смена условий/остановка убирает устаревшие результаты; privacy/consent fences сохранены. Swipe load-error cause **UNCONFIRMED** | Это ограниченный core, не полные карты/Radar/matching; Owner Xiaomi APK10 FAIL сохраняется до retest APK11, все remaining WEB contracts/consents/privacy, permissions и device visual/taps обязательны |
| UGC/остальное | Неперенесённые native сценарии не заявлены завершёнными | Ratings/comments/reviews/uploads/новые площадки, оставшиеся сообщения/социальные сценарии и весь обязательный parity |

Pure type-only `@gobadminton/contracts/native-auth` исключает `node:fs` root из Metro. DOM, cookies и CSRF
не переносятся как native transport. Сервер авторитетен для identity, прав, участия и вместимости;
bearer включается адресно, без изменения cookie-поведения WEB. Исторические FAIL/UNKNOWN сохраняются.

Android package `ru.gobadminton.mobile.dev`, clientId `gobadminton-native-dev`, exact callback
`https://dev.gobadminton.ru/auth/native/callback`, exact-path autoVerify source и owned certificate SHA256
`5208faba0b474c6c94e4c237cbc345a10c7d3d0f5b3eb285ac8e271f9bd8c051` сохранены.
Registry enablement и публичный signed APK не являются Android domain verification на устройстве.
Custom scheme не служит auth fallback. Для iOS Team/AASA/binary/store нет подтверждения; отдельный HOLD сохранён.
APK signing не является OTA signing. expo-updates/service/config не добавлены, подписанный OTA A→B не проверен.

### Совместимость, config и обновления — отдельные границы

Backend изменения additive: текущий и непосредственно предыдущий принятый binary/runtime проверяются с новым API;
ранее выданные клиенты не выводятся из поддержки без решения/upgrade path. Optional неизвестные поля допустимы,
unsupported operation явно недоступна. App version/build, API version, runtimeVersion и OTA update ID различаются.
Preferences остаются в старом ключе, secure-session/pending — отдельный namespaced v1; неизвестная secure-версия
не переписывается старым клиентом. Rollback кода не откатывает local/DB migration.

| Изменение | Канал доставки / граница |
|---|---|
| Игры, текущая вместимость, approved media | Data API/cache; обычные права/UGC/privacy |
| Уже реализованный bounded page-size/poll interval | Будущий typed versioned config существующего API: finite/range/schema, TTL, bundled defaults + last-valid cache, без startup зависимости |
| Исправление уже принятого JS/assets flow | Только квалифицированный совместимый подписанный OTA; effect/store policy проверяется отдельно |
| Новые Messages/Radar/application возможности | Планируемый reviewed binary/release; не скрытая активация через config/OTA |
| Native module/SDK/permission/app link/entitlement/OTA trust root | Новый signed binary/runtime; JS export этого не добавляет |
| Authorization/schema | Отдельный additive API release + old-client checks; config не выдаёт права |

Generic config ещё не реализован: никакого executable code/screen generator/auth origin/trust-root override,
скрытых features или authorization policy. `/radar/config` — отдельный domain contract.

Следующая обязательная update foundation: стандартный **expo-updates**, при фактически доступном owned eligible
EAS Update/Expo Update service. В этом auth slice **нет expo-updates зависимости/config implementation, аккаунта,
оплаты, OTA enablement или custom platform**. До отдельного signed service/account/trust допуска всё отключено.
Будущая отключённая bootstrap-конфигурация потребует нового binary для включения; remote config/OTA её не включат.
После квалификации: platform + fingerprint runtime policy, фиксированные dev/preview/production channels,
embedded last-working bundle, отдельный embedded OTA verification certificate, offline private signing key;
канал не заменяет подпись, APK signing и OTA signing — разные trust systems. Никаких придуманных project ID/URL/cert.
Account/plan/project/permissions/key ownership и eligible signing service — UNKNOWN; PROD требует отдельного решения.

Enabled policy после допуска: cached/embedded запускается без ожидания сети, `useEmbeddedUpdate: true`,
`fallbackToCacheTimeout: 0`, `checkAutomatically: ON_LOAD`, anti-bricking включён. Compatible signed download
применяется только при **следующем естественном cold launch**. Нет обычного `reloadAsync`, горячей подмены auth/form,
перезагрузки при background/login/message/upload/mutation или нового OS scheduler. Early fatal recovery — исключение,
может сопровождаться crash, late/post-content recovery ограничен и обычно требует forward fix. Stop rollout не удаляет
уже скачанный update; rollback только с доказанной совместимостью API/local state, иначе fix forward.

| Обязательная signed OTA runtime-проверка | Статус |
|---|---|
| Installed A → signed compatible B, тот же package/versionCode/cert и binary; B только после cold launch; city/session сохранены | NOT_DONE |
| Update во время login/form; pending PKCE переживает restart, нет normal reload | NOT_DONE |
| Offline/service outage/partial download: быстрое cached/embedded открытие, incomplete update не запускается | NOT_DONE |
| Wrong runtime/platform, unsigned/untrusted/tampered payload отклоняются | NOT_DONE |
| Broken preview: раннее recovery и отдельно late-error limits/forward fix, совместимость persisted state | NOT_DONE |
| Текущий/предыдущий accepted client против нового API: public parsing, refresh/me, changed private routes + WEB cookie regressions | NOT_DONE |

Нужны source SHA, binary/build/signing identity, runtime/platform/channel, update ID, signature result и device state.
JS export, Expo Go, download-only и reinstall B не являются A→B proof. Expo58.0.25 / RN0.88.1 / React19.3.0 /
Router58.0.31 сохраняются. Installed bundled manifest SHA256 `5167339fa4e919d0c8675c7bee4492d6289c6356e0609428b07ddee3f7f909eb`
подтверждает compatibility ranges SecureStore ~58.0.3, Crypto/WebBrowser ~58.0.8, будущий updates ~58.0.22;
это не exact resolved pins. Lock генерирует trusted parent. SDK/React upgrades здесь не нужны.
Apple 2.5.2/2.5.19 и Google Play interpreted-code exception не дают общего разрешения на скрытую смену functionality.
Источники supplied review: [Expo runtime](https://docs.expo.dev/eas-update/runtime-versions/),
[signing](https://docs.expo.dev/eas-update/code-signing/), [recovery](https://docs.expo.dev/eas-update/error-recovery/),
[Apple](https://developer.apple.com/app-store/review/guidelines/),
[Google](https://support.google.com/googleplay/android-developer/answer/16559646). Это не проверка entitlement аккаунта.

Auth/profile, games/application/My Games и Players/Messages уже имеют source ports в указанных выше границах.
Native venue/map/Radar/Swipe/contact/safety и MyGames/Postgame core реализованы в source в описанных границах;
marker-tap fix сохранён в принятой истории alpha.95; alpha.96 описывает C287 sheet/gallery/header и qualified peer-404 source repair. Venue/community **224** остаётся HELD. Remaining parity и все
оставшиеся сценарии обязательны и не завершены. Source static/focused QA, standalone build, owned signing,
Product CI/STRICT DEV, публикация и Android device acceptance разделены. Accepted E introduction с чёрным текстом
на зелёном сохранён. Реальный signed OTA A→B, S23 и iOS acceptance остаются обязательными открытыми gates.

## Историческая архитектурная основа (сохранена)

Статус: **TECH_SELECTED**. Один `apps/mobile` на React Native + Expo/Expo Router; разные store artifacts и platform-specific configuration. Это не webview-обёртка сайта.

## Архитектура клиента

UI → generated API SDK/query layer → HTTPS API. Никаких прямых подключений к PostgreSQL, provider client secret, server-only domain packages или прав из локального профиля. Состояние навигации, фильтров и UI локально; заявка, availability, permission и payment status — серверные.

Общий код RN для экрана discovery, карточки, заявок, organizer confirmation и профиля. Платформенные controls, permissions, safe areas, keyboard и accessibility адаптируются отдельно. Native modules допускаются через Expo tooling; зависимости проходят совместимость с выбранной RN architecture.

Expo development builds применяются для проверки реального OAuth/deep-link behavior, не Expo Go как доказательство успешного входа. Точная Expo/RN/React связка фиксируется при runtime bootstrap. EAS cloud не обязательный hosting/runtime; native builds можно организовать через собственную согласованную инфраструктуру [S08–S09, S19].

## Sessions и ссылки

Auth — system browser и [двухступенчатый handoff](../integrations/AUTH.md). Refresh credentials — secure storage; logout/revoke очищает credentials, private caches и device notification binding. Account switch не оставляет чужую историю и заявки в кеше.

Game/share links — HTTPS universal links / Android App Links с проверенными association files; до утверждения домена примеры используют `.invalid`. Запасной web landing открывается без приложения. Token, cookie или code exchange result не вкладывается в постоянную публичную ссылку. App restart во время OAuth — отдельный тест.

## Важный gate: iOS login

Owner выбрал VK/Яндекс. App Store guideline 4.8 при third-party/social login требует эквивалентный способ с определёнными privacy-свойствами, если не действует исключение. Архитектура допускает Sign in with Apple как вероятный путь, но это **O-04, не молчаливое расширение текущего MVP**. Перед public iOS submission нужен подтверждённый compliance-путь и повторная проверка актуальных правил. Два consumer providers сами по себе не доказывают соответствие [S16].

## Store release gates

Apple Developer / Android publisher accounts, юридический оператор, bundle/package IDs, signing/keystore backups, privacy disclosures, account deletion, support/deletion URL, permission strings, возрастная политика и review credentials. Android channels (Google Play/RuStore/другие) и их необходимость отдельно фиксируются перед публикацией; их доступность/условия не предполагаются.

При создании аккаунтов нужны account deletion routes и documented handling of retained data. Google описывает in-app initiation и внешний web route; Apple также требует соответствующих возможностей [S16–S17]. Удаление приложения не равно удалению аккаунта.

## Обновления и проверка

Backend сохраняет совместимость с предыдущими публичными mobile clients. Remote config выключает capability, но не выполняет произвольный код. OTA updates, если позже используются, только в совместимом runtime/подписанном канале с rollback; native change требует нового binary. Store policies не обходятся OTA.

На обеих ОС проверяются cold start/deep link, keyboard/large font/reader, slow network, duplicate tap, auth cancel, revoke, full game race, outdated app, timezone, notification permission denied и privacy after logout. TestFlight/closed Android tests предшествуют public release. Сроки и платформенная очередность ещё не утверждены.

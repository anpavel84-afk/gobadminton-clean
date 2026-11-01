/** Pure source catalogue for application version history and first-alpha feature baseline.
 * Safe for client imports. Server fetch/guard helpers live in releases-server.ts.
 */

export const CURRENT_APPLICATION_VERSION = "0.1.0-alpha.3" as const;
/** Literal first named alpha — never rewritten when CURRENT_APPLICATION_VERSION bumps. */
export const FIRST_NAMED_APPLICATION_VERSION = "0.1.0-alpha.1" as const;
export const API_CONTRACT_VERSION_NOTE = "0.20.0" as const;

export type FeatureAvailability =
  | "available"
  | "disabled"
  | "forbidden_by_policy"
  | "unverified_flag"
  | "unavailable_in_ui"
  | "placeholder"
  | "not_provided"
  | "enabled_not_uat_qualified"
  | "restricted_test_only";

export type ReleaseFeature = {
  id: string;
  group: string;
  title: string;
  description: string;
  limitation: string | null;
  prod: FeatureAvailability | string;
  dev: FeatureAvailability | string;
};

export type SeedDeployment = {
  environment: "dev" | "prod" | string;
  status: string;
  release_id: string | null;
  accepted_at: string;
  api_digest: string;
  web_digest: string;
  kind?: string;
};

export type HistoricalReleaseSeed = {
  source_sha: string;
  application_version: string | null;
  version_label: string;
  title: string;
  api_contract_version: string;
  owner_uat: string;
  deployments: SeedDeployment[];
  additions: string[];
  fixes: string[];
  known_limitations: string[];
};

export type NamedReleaseNotes = {
  application_version: string;
  title: string;
  /** Bound only after live accepted projection matches this build; never a guessed merge SHA. */
  source_sha: string | null;
  owner_uat: string;
  additions: string[];
  fixes: string[];
  known_limitations: string[];
  feature_catalogue: "full_baseline" | "delta";
};

export const FIRST_ALPHA_FEATURES: readonly ReleaseFeature[] = [
  {
    id: "f01",
    group: "Поиск игр",
    title: "Лента игр",
    description: "Выбор города и даты; ближайшие игры по времени, обычные встречи и занятия с тренером; подгрузка следующих игр.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f02",
    group: "Поиск игр",
    title: "Карточка игры",
    description: "Место, адрес, дата и время, формат, уровни игроков, вместимость, свободные места, условия участия, публичный контакт, обложка.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f03",
    group: "Поиск игр",
    title: "Город поиска",
    description: "Выбор города и сохранение предпочтения поиска отдельно от города публичного профиля.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f04",
    group: "Площадки",
    title: "Каталог и карточки площадок",
    description: "Выбор известной площадки при создании игры; адрес, фотографии и обложка, опубликованные контакты, сведения о кортах и удобствах, будущие игры на площадке.",
    limitation: "Поля показываются при наличии данных; отсутствие заполненного поля не заменяется обещанием услуги.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f05",
    group: "Площадки",
    title: "Новая площадка",
    description: "Ввод названия, адреса и координат новой площадки при создании игры; проверка возможных дублей.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f06",
    group: "Организация",
    title: "Создание игры",
    description: "Название, описание, площадка, дата, длительность, число мест; парная игра, одиночная игра или микст; предварительная проверка перед публикацией.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f07",
    group: "Организация",
    title: "Диапазон уровней игроков",
    description: "Минимальный и максимальный уровень выбираются двумя ползунками, в том числе в общей форме создания из приглашения.",
    limitation: "Недавнее уточнение ползунков уровней ещё не проверялось владельцем в обычном сценарии.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f08",
    group: "Организация",
    title: "Видимость игры",
    description: "Публикация в общем поиске или доступ только по ссылке.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f09",
    group: "Организация",
    title: "Фото игры и контакт организатора",
    description: "Добавление обложки; публичный контакт конкретной игры можно сохранить для подстановки в следующих играх.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f10",
    group: "Организация",
    title: "Мои игры",
    description: "Раздельные представления будущих, прошедших и управляемых игр, статусы участия и приглашения.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f11",
    group: "Организация",
    title: "Сводка организатора",
    description: "Просмотр участников и заявок, подтверждение или отклонение заявки, удаление участника; публикация существующего черновика.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f12",
    group: "Участие",
    title: "Заявка на игру",
    description: "Подача и отзыв заявки; отказ от подтверждённого участия; просмотр актуального статуса и повторная заявка после отзыва.",
    limitation: "Заявка и приглашение сами по себе не резервируют место; подтверждение и вместимость проверяет сервер.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f13",
    group: "Тренировки",
    title: "Профиль тренера",
    description: "Самостоятельное заполнение имени и описания тренера, включение или отключение профиля.",
    limitation: "Сведения заявлены пользователем; это не подтверждение квалификации сервисом.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f14",
    group: "Тренировки",
    title: "Игра с тренером",
    description: "Отдельный тип игры, описание занятия, условия площадки и оплата тренеру по договорённости.",
    limitation: "Оплата напрямую тренеру; тренер не занимает место игрока. Бронирование и встроенная оплата не заявляются.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f15",
    group: "Аккаунт",
    title: "Вход через VK и Яндекс",
    description: "Доступные способы входа через подключённых провайдеров.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f16",
    group: "Аккаунт",
    title: "Управление способами входа",
    description: "Просмотр подключённых провайдеров, подключение и отключение способа с сохранением хотя бы одного доступного входа.",
    limitation: "Способы входа видны в настройках сервиса; полный вход через внешний сайт в этой проверке не проходился от начала до конца.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f17",
    group: "Аккаунт",
    title: "Активные сессии",
    description: "Просмотр устройств/сессий, завершение отдельной сессии или остальных сессий, выход из аккаунта.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f18",
    group: "Игроки",
    title: "Свой игровой профиль",
    description: "Имя, город, район/метро, описание, игровой уровень; загрузка/удаление аватара и обложки.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f19",
    group: "Игроки",
    title: "Приватность профиля",
    description: "Включение и выключение показа в каталоге, управление приёмом личных сообщений.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f20",
    group: "Игроки",
    title: "Ищу игру",
    description: "Временный статус поиска игры с городом/районом и сроком действия, возможность выключить его.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f21",
    group: "Игроки",
    title: "Каталог игроков",
    description: "Поиск по имени, городу и району/метро, фильтры «Ищу игру» и «Тренер», карточки и просмотр игроков по одному.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f22",
    group: "Игроки",
    title: "Публичный профиль игрока",
    description: "Открытые сведения игрока, тренерский профиль и доступные ближайшие публичные игры.",
    limitation: "Состав данных зависит от настроек видимости и прав посетителя.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f23",
    group: "Общение",
    title: "Личные сообщения",
    description: "Запрос на первое общение, принятие/отклонение запроса, последующая переписка, отметки прочтения и скрытие сообщения для себя.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f24",
    group: "Общение",
    title: "Приглашения на игру",
    description: "Выбор существующей игры или создание новой из сценария приглашения; принятие, отклонение и отзыв приглашений.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f25",
    group: "Общение",
    title: "Чат игры",
    description: "Переписка организаторов и подтверждённых участников; просмотр состава и отметки прочтения.",
    limitation: "Доступ определяется правами в конкретной игре; чат ограничен жизненным циклом игры.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f26",
    group: "Общение",
    title: "Единые входящие",
    description: "Личные переписки, запросы на общение, приглашения и игровые чаты; непрочитанное, фильтр требующих ответа, отметки прочтения.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f27",
    group: "Безопасность",
    title: "Блокировка и жалоба",
    description: "Блокировка/разблокировка личного контакта и жалоба на игрока из профиля или переписки.",
    limitation: "Блокировка не отменяет участие и не исключает из общего чата; наличие жалобы не обещает выполненную модерацию.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f28",
    group: "Radar",
    title: "Временная видимость рядом",
    description: "Включение, продление и выключение Radar, явное согласие, ограниченный срок видимости и управление активным устройством.",
    limitation: "Только для вошедших пользователей и поддерживаемого города; это не точная публичная геолокация. Полный сценарий после входа ещё не проверялся владельцем.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f29",
    group: "Radar",
    title: "Поиск игроков поблизости",
    description: "Список/единый каталог подходящих доступных игроков, географический поиск и просмотр профиля результата.",
    limitation: "Живой поиск рядом пока для Москвы; кто виден — зависит от согласия, срока и настроек приватности. На основном сайте функция включена, полный вход и проверка владельцем ещё не завершены.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f30",
    group: "Материалы",
    title: "Помощь и описание сервиса",
    description: "Страницы «О сервисе» и «Помощь» с объяснением участия и общения.",
    limitation: null,
    prod: "available",
    dev: "available",
  },
  {
    id: "f31",
    group: "Карты",
    title: "Карта игр и площадок Москвы",
    description: "Карта с площадками и играми, открытие карточки и доступные действия участия.",
    limitation: "Карта доступна на основном сайте; сами файлы карты по-прежнему отдаются с тестового хранилища. Интерактивная проверка владельцем ещё не выполнялась.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f32",
    group: "Карты",
    title: "Карта игроков Москвы",
    description: "Отображение разрешённых результатов Radar на карте с защитой приватных результатов.",
    limitation: "На основном сайте карта подключена в режиме предварительного просмотра. Частные отметки показываются только при согласии и действующих правах. Полная проверка после входа ещё не выполнялась.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f33",
    group: "Общение",
    title: "Друзья",
    description: "Запрос дружбы, принять/отклонить/отменить, список друзей и удаление из друзей.",
    limitation: "На основном сайте друзья включены с прежними ограничениями по срокам, частоте и приватности. Полная проверка после входа ещё не выполнялась.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f34",
    group: "Общение",
    title: "Советовать игру другу",
    description: "Отправка рекомендации игры принятому другу, входящие рекомендации, скрыть или отозвать совет.",
    limitation: "На основном сайте совет другу разрешён вместе с друзьями; место в игре этим не бронируется. Отдельная проверка после входа ещё не выполнялась.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f35",
    group: "Общение",
    title: "Хочу сыграть",
    description: "Отправка/отзыв интереса к совместной игре, взаимный интерес.",
    limitation: "На основном сайте интерес включён; это ещё не подтверждённое участие в игре. Полная проверка после входа ещё не выполнялась.",
    prod: "available",
    dev: "available",
  },
] as const;

export const FIRST_ALPHA_KNOWN_LIMITATIONS: readonly string[] = [
  "Владелец ещё не проверял сервис после обычного входа в браузере",
  "Бронирование кортов и оплата выполняются вне приложения",
  "Юридические тексты, сведения об операторе и адрес поддержки пока не опубликованы",
  "Удаление аккаунта, изменение вместимости и отмена игры в пользовательском сценарии недоступны",
  "Вход по электронной почте недоступен; результаты и отзывы после игры не запущены; push-уведомления не активны"
] as const;

/** Switched-off / non-public items — not advertised as product features. */
export const SWITCHED_OFF_INTERNAL: readonly { id: string; title: string; note: string }[] = [
  { id: "f36", title: "Администрирование", note: "Служебное; не публичная функция." },
  { id: "f37", title: "Email-вход", note: "Выключен по runtime discovery." },
  { id: "f38", title: "Результаты после игры", note: "Не заявлено как публичная функция." },
  { id: "f39", title: "Push и сигналы внимания", note: "Выключены в capabilities." },
  { id: "f44", title: "Синтетический Radar demo", note: "Не живая функция для обычных пользователей." },
  { id: "f45", title: "Тестовая геопозиция", note: "Только ограниченный DEV-тест; не публично." },
] as const;

export const FIRST_NAMED_RELEASE: NamedReleaseNotes = {
  application_version: FIRST_NAMED_APPLICATION_VERSION,
  title: "Первый именованный выпуск: что умеет приложение",
  source_sha: null,
  owner_uat: "NOT_TESTED",
  additions: [
    "Страница «Версии» на тестовом сайте: что умеет эта сборка и какие выпуски уже ставили",
    "Полный список доступных пользовательских функций первой именованной alpha",
    "Ссылка «Версии» в подвале тестового сайта; служебная проверка сборки сообщает номер приложения"
  ],
  fixes: [],
  known_limitations: [
    "Владелец ещё не проверял сервис после обычного входа в браузере",
    "Бронирование кортов и оплата выполняются вне приложения",
    "Юридические тексты, сведения об операторе и адрес поддержки пока не опубликованы",
    "Удаление аккаунта, изменение вместимости и отмена игры в пользовательском сценарии недоступны",
    "Вход по электронной почте недоступен; результаты и отзывы после игры не запущены; push-уведомления не активны",
    "Номер текущей установки подтверждается только после фактической установки, а не по кандидату в разработке",
    "Раздел Admin служебный; тестовая геопозиция не для обычных пользователей"
  ],
  feature_catalogue: "full_baseline",
};

/** Current build descriptor — delta notes; SHA/date filled only after trusted acceptance. */
export const CURRENT_NAMED_RELEASE: NamedReleaseNotes = {
  application_version: CURRENT_APPLICATION_VERSION,
  title: "Посещаемость и единый экран результатов игры — первый ограниченный этап",
  source_sha: null,
  owner_uat: "NOT_TESTED",
  additions: [
    "Фиксация посещаемости с происхождением сведений (provenance).",
    "Устойчивое личное уведомление о сведениях посещаемости и явное согласие с точной версией отметки.",
    "Базовое возражение по сведениям посещаемости.",
    "Единый экран результатов игры в пределах PG-1b.",
  ],
  fixes: [],
  known_limitations: [
    "Это предложение кандидата, не подтверждение готовой доступной функции на DEV/PROD.",
    "Полный PG-2: разбор и разрешение споров ещё не входят.",
    "Оценки, отзывы и комментарии ещё не входят.",
    "PROD вне этого среза; действующий PROD остаётся alpha.2, пока отдельный выпуск не принят.",
    "Запись под флагом по умолчанию OFF; доступность DEV заявляется только после безопасной проверенной активации.",
    "Owner UAT будущего продукта NOT_TESTED; одобрение дизайн-галерей не равно приёмке реализации.",
    "Номер текущей установки подтверждается только после фактической установки, а не по кандидату в разработке",
  ],
  feature_catalogue: "delta",
};

/** Confirmed historical deployments only; application versions remain unnumbered. */
export const TRUSTED_HISTORICAL_SEED: readonly HistoricalReleaseSeed[] = [
  {
    "source_sha": "85513c719826a91bebd14a16b807ced8e17133fd",
    "application_version": null,
    "version_label": "Без формального номера",
    "title": "Полный перенос принятого тестового выпуска на основной сайт",
    "api_contract_version": "0.20.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41238696865-a1",
        "accepted_at": "2026-10-31T20:28:18Z",
        "api_digest": "sha256:2554bab7e5bd0349c19a612e3cbc457b524b3576aae7058749cfdd41178b9b69",
        "web_digest": "sha256:961f83f66ef97cf278769fffb73950c8f6acede8f8d391b0694d20ae380e7e1c"
      },
      {
        "environment": "prod",
        "status": "ACCEPTED",
        "release_id": null,
        "accepted_at": "2026-10-31T23:22:12.477839Z",
        "api_digest": "sha256:2554bab7e5bd0349c19a612e3cbc457b524b3576aae7058749cfdd41178b9b69",
        "web_digest": "sha256:961f83f66ef97cf278769fffb73950c8f6acede8f8d391b0694d20ae380e7e1c",
        "kind": "full_managed_promotion"
      }
    ],
    "additions": [],
    "fixes": [],
    "known_limitations": [
      "Владелец ещё не проверял сервис после обычного входа",
      "Номер alpha ещё не присвоен",
      "Карты, друзья, советы друзьям и «хочу сыграть» тогда ещё были только на тестовом сайте"
    ]
  },
  {
    "source_sha": "11558239cf284a2f20e3c1c6906ae217c703325f",
    "application_version": null,
    "version_label": "Без формального номера",
    "title": "Одинаковые публичные возможности на основном и тестовом сайтах",
    "api_contract_version": "0.20.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41254244816-a1",
        "accepted_at": "2026-11-01T00:02:38Z",
        "api_digest": "sha256:7dbefb76c0a08fed45ae502e6cb8eb9642239e4e89f470b610ab85c96e7f1ebd",
        "web_digest": "sha256:5173cdd6a65c5ecc3d6609cb22d1f3fdfe0c6a161244dd5f63b509e51c4402c6"
      },
      {
        "environment": "prod",
        "status": "ACCEPTED",
        "release_id": null,
        "accepted_at": "2026-11-01T00:04:47.811785Z",
        "api_digest": "sha256:7dbefb76c0a08fed45ae502e6cb8eb9642239e4e89f470b610ab85c96e7f1ebd",
        "web_digest": "sha256:5173cdd6a65c5ecc3d6609cb22d1f3fdfe0c6a161244dd5f63b509e51c4402c6",
        "kind": "managed_application_only"
      }
    ],
    "additions": [],
    "fixes": [
      "На основном сайте включены друзья и советы друзьям",
      "На основном сайте включён интерес «хочу сыграть»",
      "На основном сайте доступны карты Москвы"
    ],
    "known_limitations": [
      "Владелец ещё не проверял сервис после обычного входа",
      "Номер alpha ещё не присвоен",
      "Admin остаётся служебным; вход по email, результаты после игры и push не включены"
    ]
  },
  {
    "source_sha": "8733578a2f8a6cfd860371e8a2c2aa39f1b885bb",
    "application_version": FIRST_NAMED_APPLICATION_VERSION,
    "version_label": FIRST_NAMED_APPLICATION_VERSION,
    "title": "Первый именованный выпуск 0.1.0-alpha.1",
    "api_contract_version": "0.20.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41257679087-a1",
        "accepted_at": "2026-11-01T00:45:11Z",
        "api_digest": "sha256:fbb8e6328131c2b0fdbb4dee1d2e8083e18f1444ac9be92dc90ecb794977e230",
        "web_digest": "sha256:7747c12431a31a97819994af36c0d11069c963098ccd77504ab9b9ca0dd76860",
        "kind": "pipeline"
      },
      {
        "environment": "prod",
        "status": "ACCEPTED",
        "release_id": null,
        "accepted_at": "2026-11-01T00:47:25.574224Z",
        "api_digest": "sha256:fbb8e6328131c2b0fdbb4dee1d2e8083e18f1444ac9be92dc90ecb794977e230",
        "web_digest": "sha256:7747c12431a31a97819994af36c0d11069c963098ccd77504ab9b9ca0dd76860",
        "kind": "managed_application_only"
      }
    ],
    "additions": [],
    "fixes": [],
    "known_limitations": [
      "Владелец ещё не проверял сервис после обычного входа в браузере",
      "Полный базовый каталог первой alpha сохранён под номером 0.1.0-alpha.1"
    ]
  },
  {
    "source_sha": "38a4700c68ed85189007dcab3c859c98eb37bf46",
    "application_version": "0.1.0-alpha.2",
    "version_label": "0.1.0-alpha.2",
    "title": "Исправление ложного конца подборки в «Свайп»",
    "api_contract_version": "0.20.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41287889091-a1",
        "accepted_at": "2026-11-01T08:17:46Z",
        "api_digest": "sha256:cbbc5b57d19375751cb001ac5a7ac70cbabcba76e8c2cdc7e28c6c46c9c895a1",
        "web_digest": "sha256:773dd9985af3c862ffb022c2ca105071b13e83c6a2731cccfbee056d2652b816",
        "kind": "pipeline"
      },
      {
        "environment": "prod",
        "status": "ACCEPTED",
        "release_id": null,
        "accepted_at": "2026-11-01T08:19:28.308318Z",
        "api_digest": "sha256:cbbc5b57d19375751cb001ac5a7ac70cbabcba76e8c2cdc7e28c6c46c9c895a1",
        "web_digest": "sha256:773dd9985af3c862ffb022c2ca105071b13e83c6a2731cccfbee056d2652b816",
        "kind": "managed_application_only"
      }
    ],
    "additions": [],
    "fixes": [
      "Swipe различает загрузку собственного профиля, невыполненное условие готовности, ошибку и недоступных игроков; эти состояния не выдаются за настоящий конец списка.",
      "После страницы недоступных игроков можно продолжить просмотр следующей страницы.",
      "Ошибка capability-запроса не запускает автоматический бесконечный повтор; повтор выполняется явно."
    ],
    "known_limitations": [
      "Owner UAT после обычного входа не выполнен"
    ]
  },
] as const;

/** Full 40-char repository SHA; comparison uses lowercase. */
export const REPO_SHA40 = /^[0-9a-fA-F]{40}$/;

export function isRepoSha40(value: unknown): value is string {
  return typeof value === "string" && REPO_SHA40.test(value.trim());
}

/** Normalize a repository SHA to lowercase 40-hex, or null if garbage/blank/truncated/unknown. */
export function normalizeRepoSha40(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!REPO_SHA40.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function runtimeBuildGitSha(): string {
  const value = process.env.GIT_SHA?.trim();
  return value && value.length > 0 ? value : "unknown";
}

export function groupFeatures(features: readonly ReleaseFeature[]): { group: string; items: ReleaseFeature[] }[] {
  const order: string[] = [];
  const map = new Map<string, ReleaseFeature[]>();
  for (const feature of features) {
    if (!map.has(feature.group)) {
      order.push(feature.group);
      map.set(feature.group, []);
    }
    map.get(feature.group)!.push(feature);
  }
  return order.map((group) => ({ group, items: map.get(group)! }));
}

export function shortSha(sha: string | null | undefined): string {
  if (!sha || sha === "unknown") return "неизвестно";
  return sha.length > 12 ? sha.slice(0, 12) : sha;
}

/** Readable installation/history date for product UI; keeps ISO machine facts elsewhere. */
export function formatReleaseDateRu(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(ms));
}

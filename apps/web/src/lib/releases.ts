/** Pure source catalogue for application version history and first-alpha feature baseline.
 * Safe for client imports. Server fetch/guard helpers live in releases-server.ts.
 */

export const CURRENT_APPLICATION_VERSION = "0.1.0-alpha.58" as const;
/** Literal first named alpha — never rewritten when CURRENT_APPLICATION_VERSION bumps. */
export const FIRST_NAMED_APPLICATION_VERSION = "0.1.0-alpha.1" as const;
export const API_CONTRACT_VERSION_NOTE = "0.40.0" as const;

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
  "application_version": "0.1.0-alpha.58",
  "title": "Оценки сообщества площадки и открытое обсуждение",
  "source_sha": null,
  "owner_uat": "NOT_TESTED",
  "additions": [
    "На странице площадки доступны оценки сообщества от 1 до 5 и открытое текстовое обсуждение; они отдельно от проверенных отзывов после подтверждённого участия в игре",
    "В компактных карточках карты, выборе площадки и контактах игры показана краткая сводка оценок со ссылкой на раздел оценок площадки",
    "После сохранения или снятия своей оценки публичная сводка обновляется для физической площадки и связанных загруженных записей на открытых экранах"
  ],
  "fixes": [],
  "known_limitations": [
    "Фотографии в обсуждении и предложение официального фото площадки ещё не доступны",
    "На тестовом стенде до 1 января 2027 UTC временно сняты количественные ограничения на проверки фото и текста; сами проверки содержимого продолжаются",
    "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены; служебный разбор отзывов после обычного входа ещё не проверен",
    "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
  ],
  "feature_catalogue": "delta"
};

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
  {
    "source_sha": "7b75fbed6b2582c9594ff71566566df625b5672d",
    "application_version": "0.1.0-alpha.3",
    "version_label": "0.1.0-alpha.3",
    "title": "Посещаемость и единый экран результатов игры — PG-1b",
    "api_contract_version": "0.21.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41298675161-a1",
        "accepted_at": "2026-11-01T10:54:33Z",
        "api_digest": "sha256:1429553fe96fa517b6c501a2e8b07eafbede6751957ef205ba61798b96ccca76",
        "web_digest": "sha256:7e3b5b57fe4de8c40e26c1df0e02730af9aae1ebb709310c61a159d4b21fa3d0",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Фиксация посещаемости с происхождением сведений (provenance).",
      "Устойчивое личное уведомление и явное согласие с точной версией отметки.",
      "Базовое возражение / запрос исправления собственной отметки.",
      "Единый экран «Участники / Итоги» в пределах PG-1b."
    ],
    "fixes": [],
    "known_limitations": [
      "Полный PG-2 разбор/разрешение споров не входили в alpha.3.",
      "PG-3/PG-4 и отзывы не входили.",
      "PROD оставался alpha.2; Owner UAT NOT_TESTED."
    ]
  },
  {
    "source_sha": "7a36b8d94a5df412426155e5852fddd9da7b0045",
    "application_version": "0.1.0-alpha.4",
    "version_label": "0.1.0-alpha.4",
    "title": "Посещаемость: ответы на возражения и scoped Cases — PG-2",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41310911419-a1",
        "accepted_at": "2026-11-01T13:34:38Z",
        "api_digest": "sha256:dd88f39038e53a9c31ed39ae4460f0029f2ea04aa643d0c01bc4d580a77d5bd3",
        "web_digest": "sha256:e108bd3e17ca7eb0edbedcbc31fd938cde5ab02c880bac6c9c4b9ec09d3270d0",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Ответ/исправление организатора без одностороннего закрытия открытого спора.",
      "Точное версионное согласие участника и запрос помощи.",
      "Scoped independent assigned Admin intake/read/resolve с применимыми guards.",
      "Атомарные аудит, история и уведомления."
    ],
    "fixes": [],
    "known_limitations": [
      "PROD остаётся alpha2; PG3/4/comments не выпущены; Owner/Admin UAT NOT_TESTED."
    ]
  },
  {
    "source_sha": "06991b099317a702dc102eeef53ee64cfa841f0e",
    "application_version": "0.1.0-alpha.5",
    "version_label": "0.1.0-alpha.5",
    "title": "Доставка одноразового кода через существующую почтовую очередь",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41317332177-a1",
        "accepted_at": "2026-11-01T14:52:56Z",
        "api_digest": "sha256:2280fd8640411adef252d36a923b186e4d0b66bf6bab188bcdaadedaf786d64c",
        "web_digest": "sha256:8664904fc2a4f111cf73ac528e85ea87407ff6bc3f134e3a1bdee5776ef2761e",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "TLS SMTP transport REG.RU подключён к существующей durable email-code очереди и worker."
    ],
    "fixes": [
      "Код входа отправляется от info@gobadminton.ru; временные ошибки обрабатываются прежними ограниченными повторами."
    ],
    "known_limitations": [
      "Публичный DEV discovery email=true; это не доказательство доставки до реального ящика.",
      "Registration/recovery/Owner UAT NOT_TESTED.",
      "PROD остаётся alpha2, email false."
    ]
  },
  {
    "source_sha": "84cedf79ec6d0582ef1197589acd808f9470f62c",
    "application_version": "0.1.0-alpha.5",
    "version_label": "0.1.0-alpha.5",
    "title": "Исправление worker email-code на принятом alpha.5",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41319296538-a1",
        "accepted_at": "2026-11-01T15:08:02Z",
        "api_digest": "sha256:5306ba8d603fdcb9acd150a6c8c53f43caebe91ccfbb0e4a5d614ae350a2af1c",
        "web_digest": "sha256:8d47c1b883a4f7121c314497725b17c36bf6432c0c0521d63843f92978d11ef4",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Отдельная DEV-установка того же application version 0.1.0-alpha.5 с source SHA worker-fix (не смешивается с SMTP source 06991)."
    ],
    "known_limitations": [
      "Тот же номер alpha.5 при другом source SHA и отдельном deploy receipt.",
      "Owner UAT NOT_TESTED; PROD не изменён."
    ]
  },
  {
    "source_sha": "4fdf232ac576b7c830c77405267795634b9ae43b",
    "application_version": "0.1.0-alpha.6",
    "version_label": "0.1.0-alpha.6",
    "title": "Диапазон уровней: единая шкала и два ползунка — #445, пункт1",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41329378049-a1",
        "accepted_at": "2026-11-01T17:07:45Z",
        "api_digest": "sha256:753b6ba373560b59cb0840b3d69ed19100629d8332004e208ac9fdced762c0c0",
        "web_digest": "sha256:7a8c300478d2a2ab428cee687f5e64cfb3db294eb38f25f3f48dae9a16163e40",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Только пункт1 #445: два ползунка на общей шкале1–7 с шагом0.5, зависимыми ARIA-границами и включительным диапазоном."
    ],
    "known_limitations": [
      "Пункты2–6 #445 ещё не доставлены этим выпуском; всяIssue не PASS.",
      "Go Bad retest, authenticated live creation и physicaliPhoneUAT NOT_TESTED.",
      "PG-3 не установлен; PROD остаётсяalpha.2."
    ]
  },
  {
    "source_sha": "dd3839814fdb4ed8e05a64301e4aaaacff5cf0cc",
    "application_version": "0.1.0-alpha.7",
    "version_label": "0.1.0-alpha.7",
    "title": "Подсказки своего профиля и канонические переходы — #445, пункты2/3/5/6",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41331655353-a1",
        "accepted_at": "2026-11-01T17:33:52Z",
        "api_digest": "sha256:c11807e1d7d9661f284a64236288c98f8afc1a53d1029c59ec51c9121b9f3705",
        "web_digest": "sha256:25a6f51d6d5b5a5218a9b8e2ae84fdf3561dde274e1ff6705bb07501f1e9fba1",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Подсказки о собственном скрытом/несохранённом профиле для социальных действий.",
      "Канонические переходы /games/map и /venues → /games?view=map; неверная игра404.",
      "Нейтральный finder в пределах пунктов2/3/5/6 #445."
    ],
    "known_limitations": [
      "GoBad authorized browser retest и OwnerUAT NOT_TESTED; конкретный аккаунт неизвестен.",
      "Пункт4 ждёт URL игры и роль репортёра; postgame fixture ждёт reporterID.",
      "Не весь #445 PASS; PG3 не установлен; PROD остаётсяalpha2."
    ]
  },
  {
    "source_sha": "26f3ba38d9c04730674b084c0266afc193662398",
    "application_version": "0.1.0-alpha.8",
    "version_label": "0.1.0-alpha.8",
    "title": "Видимость в каталоге и личные сообщения по умолчанию с сохранением выбора пользователя",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41339991160-a1",
        "accepted_at": "2026-11-01T19:18:15Z",
        "api_digest": "sha256:343c821a5525c2e3ecff8906ac9838ba632867011d4b2ce07d111193f93442e0",
        "web_digest": "sha256:c903877654bfa1d78a289608026f510124403040decd85aeaf738d8aba2023be",
        "kind": "pipeline"
      },
      {
        "environment": "prod",
        "status": "ACCEPTED",
        "release_id": null,
        "accepted_at": "2026-11-01T19:30:08.857934Z",
        "api_digest": "sha256:343c821a5525c2e3ecff8906ac9838ba632867011d4b2ce07d111193f93442e0",
        "web_digest": "sha256:c903877654bfa1d78a289608026f510124403040decd85aeaf738d8aba2023be",
        "kind": "managed_application_only"
      }
    ],
    "additions": [
      "Для подходящих учётных записей показ в каталоге и приём запросов на общение включены по умолчанию."
    ],
    "fixes": [
      "Явное сохранённое выключение пользователем сохраняется."
    ],
    "known_limitations": [
      "Приёмка владельцем полного сценария регистрации и входа не выполнена.",
      "После установки выявлены замечания #450: безопасное публичное имя, проверка прежнего приватного выбора и понятный русский текст. Не объявлять их исправленными задним числом.",
      "Техническая установка alpha.8 принята на обоих сайтах; браузерные замечания не стирают историю установки."
    ]
  },
  {
    "source_sha": "783a1897167be1f531312b9a6812b6240181e2c3",
    "application_version": "0.1.0-alpha.9",
    "version_label": "0.1.0-alpha.9",
    "title": "Безопасные публичные имена, понятные заметки и ссылка профиля на компьютере",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41345457119-a1",
        "accepted_at": "2026-11-01T20:21:50Z",
        "api_digest": "sha256:722cf29edad73ef6c30bc215a0a69801259b581b46faf12a421293c0b41f1267",
        "web_digest": "sha256:d13dc563b86e7f36c2dfa168a93e25dbd9ea6d2c605904ecd0668f5832c440d1",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Безопасное имя игрока без отображения email на связанных публичных и личных экранах.",
      "Понятный русский текст истории выпусков.",
      "Ссылка полного профиля остаётся видимой при двухстрочном описании на компьютере."
    ],
    "known_limitations": [
      "Проверка владельцем после обычного входа ещё не выполнена.",
      "Замечания по конкретным ролям в чате и весь список #450/#445 не объявлены закрытыми.",
      "Этот выпуск alpha.9 принят только на DEV; PROD сохранил alpha.8."
    ]
  },
  {
    "source_sha": "1dc5000280d617c3160fc959ee87607db394410c",
    "application_version": "0.1.0-alpha.10",
    "version_label": "0.1.0-alpha.10",
    "title": "Удобный ряд действий в своём профиле",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41349542541-a1",
        "accepted_at": "2026-11-01T21:03:36Z",
        "api_digest": "sha256:a71fe6979b045a09bb348cce3e7f57ffbab952e5b52edc632849ef3776e49970",
        "web_digest": "sha256:3d57f99e22af3f1fac4a64956a38745862d434abd42ce17f9ff026e7cf0a87b0",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Действия «Изменить профиль», «Изменить обложку» и «Настройки» собраны в компактную группу своего профиля."
    ],
    "known_limitations": [
      "Установленный интерфейс проверен на синтетических данных; проверка владельцем после обычного входа не выполнена.",
      "Alpha.10 установлена только на DEV; PROD остался на принятой alpha.8."
    ]
  },
  {
    "source_sha": "acec520281d07f30d3fa855043be7d613ba56db1",
    "application_version": "0.1.0-alpha.11",
    "version_label": "0.1.0-alpha.11",
    "title": "Загрузка карты и запросы тренерского профиля — P0 #445/#450",
    "api_contract_version": "0.22.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41361963371-a1",
        "accepted_at": "2026-11-01T23:30:16Z",
        "api_digest": "sha256:a89e5c9c8018914c6ac6aee2bbb666c6d99a0fd892db5aad0ede730056e9667c",
        "web_digest": "sha256:efcbef6285944a2ea38f1156c00dd234756cf4834d2d7edb4281d6d115ace534",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Карта не показывает отсутствие площадок до успешной загрузки данных текущего города.",
      "Обычный игрок без статуса тренера не вызывает автоматический запрос отсутствующего тренерского профиля на своём профиле и создании игры."
    ],
    "known_limitations": [
      "Проверка владельцем после входа не выполнена.",
      "Остальные замечания #445/#450, чат и второй неидентифицированный404 не объявлены исправленными.",
      "Этот выпуск принят только на DEV; PROD остался на принятой alpha.8."
    ]
  },
  {
    "source_sha": "6383ef406f5944a299843939d391ab7886fdb5dd",
    "application_version": "0.1.0-alpha.12",
    "version_label": "0.1.0-alpha.12",
    "title": "После игры: приватная обратная связь и личные заметки — ограниченный PG-3",
    "api_contract_version": "0.23.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41368959239-a1",
        "accepted_at": "2026-11-02T00:59:40Z",
        "api_digest": "sha256:82ab7826723a89ec035c1777190fcef1134441b0f9ed6ddae6952507dc63fb82",
        "web_digest": "sha256:4be8fe110f56f05469f30ecd2961a0a98ad704f7cfb6496b7aa37caf0e128f11",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Приватная обратная связь и личные заметки после игры в пределах установленного среза PG-3."
    ],
    "fixes": [
      "Черновик создания и редактор при удалении заметки очищаются только после подтверждения собственной точной команды; неизвестный ответ и конфликт сохраняют ввод.",
      "При смене аккаунта старые приватные данные и черновики скрываются до ответа нового пользователя; 403/404 очищают приватный экран."
    ],
    "known_limitations": [
      "Проверка владельцем после обычного входа не выполнена.",
      "DEV-схема и включённая запись подтверждены; проверка интерфейса на синтетических данных не заменяет приёмку в живом аккаунте.",
      "Полное типизированное расширение Safety-жалоб PG-3, PG-4 и публичные комментарии ещё не объявлены завершёнными.",
      "Alpha.12 установлена только на DEV; PROD остаётся принятой alpha.8."
    ]
  },
  {
    "source_sha": "c936031114f57c23f6faa9a01757374b912819ed",
    "application_version": "0.1.0-alpha.13",
    "version_label": "0.1.0-alpha.13",
    "title": "После игры: история встреч и переход к обратной связи — PG-4 UI",
    "api_contract_version": "0.23.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41394102899-a1",
        "accepted_at": "2026-11-02T05:32:06Z",
        "api_digest": "sha256:5bfc4c1139d6edceebfc4b2e3f49203daa08d56448847c1db2783c56d0f6fdb7",
        "web_digest": "sha256:573d6792e5c5d51629c1328348f209fb0785b10d87da13b38282366cd603177a",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Переход из своей истории встреч к итогам и разделу обратной связи."
    ],
    "fixes": [
      "Отображение истории и прямого перехода к обратной связи на компьютере и телефоне; безопасное поведение при недоступных приватных данных."
    ],
    "known_limitations": [
      "Установленный интерфейс проверен на синтетических read-only данных, не в живой сессии владельца.",
      "Полное типизированное расширение Safety по отзывам остаётся незавершённым; весь #372 не объявлен завершённым.",
      "Публичные комментарии #394 выполняются позже.",
      "Выпуск принят только на DEV; PROD остался принятой alpha.8."
    ]
  },
  {
    "source_sha": "8113359533e5a4cfb85c4520a7af1fff1571c9e4",
    "application_version": "0.1.0-alpha.14",
    "version_label": "0.1.0-alpha.14",
    "title": "Договорённость о корте со слов организатора",
    "api_contract_version": "0.24.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41408629901-a1",
        "accepted_at": "2026-11-02T07:58:39Z",
        "api_digest": "sha256:e2a46301cee91589647ede9d1ecb6f69024918450dfbb261d81fcf83b1c1aeb8",
        "web_digest": "sha256:81f4706494cf2cf1d2d1e1defae896e4d8ddb54fe2ce149ed820eff8b9b70705",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Организатор может указать статус договорённости о корте: не указано, договариваемся, подтверждено организатором или не удалось договориться."
    ],
    "fixes": [],
    "known_limitations": [
      "Сведения о договорённости заявляет организатор; приложение не проверяет фактическую бронь.",
      "Проверка владельцем в живом аккаунте не выполнена; установленный интерфейс проверен на синтетических read-only данных.",
      "Полный модуль #373 не объявлен завершённым.",
      "Выпуск установлен только на DEV; PROD остаётся принятой alpha.8."
    ]
  },
  {
    "source_sha": "36fd4b4cf4632efa3cc96e93f20a33c220b9708b",
    "application_version": "0.1.0-alpha.15",
    "version_label": "0.1.0-alpha.15",
    "title": "Вопросы об игре и ограничение отзывов площадки",
    "api_contract_version": "0.25.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41434833713-a1",
        "accepted_at": "2026-11-02T11:23:40Z",
        "api_digest": "sha256:c28855a6c8fee6ddbd53cf2e254cb34f08bb4d26c0a7b71ad738aff75f9a7505",
        "web_digest": "sha256:3e56ffbe64c2092342a105a35f622260d472ac829e0a13734154ffd299ce0ba5",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "На странице игры можно задавать вопросы и отвечать после входа."
    ],
    "fixes": [
      "Публикация отзывов о площадке пока закрыта до проверки посещения после игры; прежние неподтверждённые записи не показываются."
    ],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена.",
      "Отзывы о площадке ждут подтверждения посещения и разбора спорных отметок; публичная запись пока недоступна.",
      "Отзывы об игроке остаются приватными и не выводятся как публичная стена комментариев в профиле; полный сценарий отзывов после игры ещё не завершён."
    ]
  },
  {
    "source_sha": "841bbec37739f56e9561a756731490891ed70d19",
    "application_version": "0.1.0-alpha.16",
    "version_label": "0.1.0-alpha.16",
    "title": "Подтверждённый совместный опыт и уточнение посещения",
    "api_contract_version": "0.26.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41445689826-a1",
        "accepted_at": "2026-11-02T12:47:49Z",
        "api_digest": "sha256:9de709055304dc3c668e74ab71c3569e300c08aea75ef4ec264263e49bd02f1a",
        "web_digest": "sha256:4b3012934ce4f9ab4bf68c5738a29e84edbb359fe8fa4390d9705e664f161e12",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Новый приватный отзыв об игроке доступен после состоявшейся игры, когда посещение обоих участников явно подтверждено и нет открытого спора.",
      "Если отметка отсутствует или вызывает вопросы, можно обратиться за уточнением через существующий процесс разбора посещения."
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена.",
      "Публичная запись отзывов о площадке остаётся закрытой.",
      "Отзывы об игроке остаются приватными и не выводятся как публичная стена в профиле."
    ]
  },
  {
    "source_sha": "b28ce4bed4ba33f7fe1e90ebc1b7a86495e8806e",
    "application_version": "0.1.0-alpha.17",
    "version_label": "0.1.0-alpha.17",
    "title": "Уточнения действий в комментариях и пояснений после игры",
    "api_contract_version": "0.26.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41452395940-a1",
        "accepted_at": "2026-11-02T13:28:07Z",
        "api_digest": "sha256:f4a4d7a038d67b66ecf9829cdb396bb589ee5109350acec11ccee2857be3886a",
        "web_digest": "sha256:fff841c229641f53e55a14ed6860a113e5bb148eb8c869247c9d83b5eae94d48",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Уточнены действия и пояснения в комментариях и обратной связи: свои действия безопасности скрыты, удалённые записи обозначены нейтрально, отсутствие отметки посещения и ограничения отзывов объясняются понятнее."
    ],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена.",
      "Публичная запись отзывов о площадке остаётся закрытой.",
      "Отзывы об игроке остаются приватными и не выводятся как публичная стена в профиле."
    ]
  },
  {
    "source_sha": "6cd66a77068d6ab2faa283867d6320896b0c5177",
    "application_version": "0.1.0-alpha.18",
    "version_label": "0.1.0-alpha.18",
    "title": "Мобильные кнопки комментариев",
    "api_contract_version": "0.26.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41456359306-a1",
        "accepted_at": "2026-11-02T13:55:41Z",
        "api_digest": "sha256:a48a7bebe6cc86b56a0ed08760f94f8db4aac2bd55f8d262354cab77a066e34b",
        "web_digest": "sha256:81fc859c425688f551f5f427362a5e49dd55cc28665337ee904db634efb1bd69",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Исправлено расположение кнопок отправки, ответа и редактирования комментариев на телефоне: подписи больше не сжимаются в вертикальную колонку"
    ],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена.",
      "Публичная запись отзывов о площадке остаётся закрытой.",
      "Отзывы об игроке остаются приватными и не выводятся как публичная стена в профиле."
    ]
  },
  {
    "source_sha": "7f33e9da0cf7b52d260567bbfb37114a3613d479",
    "application_version": "0.1.0-alpha.19",
    "version_label": "0.1.0-alpha.19",
    "title": "Жалоба на полученный приватный отзыв",
    "api_contract_version": "0.27.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41479055286-a2",
        "accepted_at": "2026-11-02T16:28:48Z",
        "api_digest": "sha256:22d423424f8ca916e056ae785c7acbc3916b9a0a426105d82ef94f8630d40fb4",
        "web_digest": "sha256:414ce175c6f81fd722159f143c0f6c42f409a7938f7e0ab6b2caf3d52d22c174",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "На полученный приватный отзыв можно подать жалобу. Перед отправкой пользователь явно разрешает назначенному специалисту прочитать выбранную редакцию отзыва только для разбора обращения"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена.",
      "Публичная запись отзывов о площадке остаётся закрытой.",
      "Отзывы об игроке остаются приватными и не выводятся как публичная стена в профиле.",
      "Жалоба сама по себе не скрывает и не удаляет отзыв и не открывает доступ всему персоналу."
    ]
  },
  {
    "source_sha": "9db516ce96499d440a49e7e35029137c33a11429",
    "application_version": "0.1.0-alpha.20",
    "version_label": "0.1.0-alpha.20",
    "title": "Публичные отзывы о роли до записи на игру",
    "api_contract_version": "0.28.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41562101222-a1",
        "accepted_at": "2026-11-03T02:01:14Z",
        "api_digest": "sha256:7f84a7cd5a01abfb3752a8fc2de2d87311e6e5c1e61b076863eb6666b697002e",
        "web_digest": "sha256:3b576868391ea2d808f13d1e1cf559392c284bff53074cc80733fd88cde57c0d"
      }
    ],
    "additions": [
      "Перед выбором игры можно ознакомиться с отзывами об организаторе или тренере. Оставить отзыв могут участники с подтверждённым прошлым опытом; предусмотрены ответ, возражение, а автор может снять свой отзыв с публикации",
      "Спорные тексты разбирает человек в служебных обращениях: ожидание, чтение согласованного источника и явное решение; статус «решено» сам по себе ничего не публикует"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена.",
      "Публичная запись отзывов о площадке остаётся закрытой.",
      "Отзывы об игроке остаются приватными и не выводятся как публичная стена в профиле.",
      "Жалоба сама по себе не скрывает и не удаляет отзыв и не открывает доступ всему персоналу.",
      "Человеческий разбор отзывов о роли на тестовом сайте ещё не проверен владельцем после обычного входа."
    ]
  },
  {
    "source_sha": "faa236ab8b52716d6e0fbed0d7fefa87334ee02f",
    "application_version": "0.1.0-alpha.21",
    "version_label": "0.1.0-alpha.21",
    "title": "Системные уведомления о сообщениях",
    "api_contract_version": "0.29.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41574322192-a1",
        "accepted_at": "2026-11-03T04:02:27Z",
        "api_digest": "sha256:f89a7fe9244d2f91ce3f9b1a1984fbb15f085aa67b9579b9872e00d353e9271a",
        "web_digest": "sha256:06224f188ef562cd55ee81649ab54c18da09040a0bd6408ea9c11aae61358d36"
      }
    ],
    "additions": [
      "В поддерживаемом браузере можно включить системные уведомления о личных сообщениях и сообщениях в чате игры. На iPhone функция предназначена для приложения, добавленного на экран «Домой»",
      "Уведомления включаются только по вашему действию. В системном уведомлении нет текста переписки; переход открывает диалог с обычной проверкой доступа",
      "Поддерживаются несколько устройств, отключение уведомлений и смена аккаунта без переноса чужих уведомлений"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем на физическом iPhone ещё не выполнена",
      "Доступность зависит от браузера, установки приложения и разрешения устройства; отказ в разрешении не включает подписку",
      "Первый выпуск относится к сообщениям. Приглашения в игру и изменения участия в эту поставку не входят"
    ]
  },
  {
    "source_sha": "98f765c39d4f9cd4c6ef7005884f84b1af197d45",
    "application_version": "0.1.0-alpha.21",
    "version_label": "0.1.0-alpha.21",
    "title": "Системные уведомления о сообщениях",
    "api_contract_version": "0.29.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41747908212-a1",
        "accepted_at": "2026-11-04T00:49:07Z",
        "api_digest": "sha256:80c08fcea191e1093b8f8969bf8033cdfb6f66ef07409f32e4fc94fecba8db57",
        "web_digest": "sha256:d7c952bf9e93fb9f2153020f6f1675b2c437e1083ca041708022d5985851af6a"
      }
    ],
    "additions": [
      "В поддерживаемом браузере можно включить системные уведомления о личных сообщениях и сообщениях в чате игры. На iPhone функция предназначена для приложения, добавленного на экран «Домой»",
      "Уведомления включаются только по вашему действию. В системном уведомлении нет текста переписки; переход открывает диалог с обычной проверкой доступа",
      "Поддерживаются несколько устройств, отключение уведомлений и смена аккаунта без переноса чужих уведомлений"
    ],
    "fixes": [
      "Исправлен доступ к деталям игры для участников с действующей заявкой; удалённые, отклонённые и отменённые заявки не открывают приватную игру. Снятая модерацией игра остаётся скрытой от посторонних."
    ],
    "known_limitations": [
      "Приёмка владельцем на физическом iPhone ещё не выполнена",
      "Доступность зависит от браузера, установки приложения и разрешения устройства; отказ в разрешении не включает подписку",
      "Первый выпуск относится к сообщениям. Приглашения в игру и изменения участия в эту поставку не входят"
    ]
  },
  {
    "source_sha": "e637e937d7fa780983daaac92cbe22e26c82ef1b",
    "application_version": "0.1.0-alpha.22",
    "version_label": "0.1.0-alpha.22",
    "title": "Напоминания организатору подвести итоги",
    "api_contract_version": "0.30.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41818484518-a1",
        "accepted_at": "2026-11-04T11:17:16Z",
        "api_digest": "sha256:ffa1c8e8447ee2c0b5c99ddce7a8b490780b41aade215c8493122ecf95476cbf",
        "web_digest": "sha256:a28d441946607160b4967abb72f78f6a09ac5b2c374b596bac6e4bb5a3c30314",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "После окончания игры организатор получает до трёх внутренних напоминаний подвести итоги, если исход ещё не указан",
      "В «Моих играх» и на экране итогов доступны действия «Подвести итоги» и «Позже»; напоминание сохраняется на сервере и не пропадает при переустановке клиента",
      "Напоминания не выставляют исход или посещаемость сами и не рассылаются по SMS, email или push"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена",
      "Интервалы напоминаний — локальная реализация (1 час / 24 часа / 72 часа после окончания), не отдельный SLA владельца",
      "Внешняя доставка напоминаний в этой поставке не предусмотрена"
    ]
  },
  {
    "source_sha": "cc771c3700accae431e7bff9131433cd7be694ae",
    "application_version": "0.1.0-alpha.23",
    "version_label": "0.1.0-alpha.23",
    "title": "Помощь с выбором игрового уровня",
    "api_contract_version": "0.30.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41825585671-a1",
        "accepted_at": "2026-11-04T12:06:05Z",
        "api_digest": "sha256:5f53f6d607df355366ea555c94bc3cd094a35706119637c83f8adc5b4fc3c1ef",
        "web_digest": "sha256:8993a62acac4239f74d7469ff01d00b3b84730006f1ff944f47cf075c8c0d1cc",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Короткая справка о существующих уровнях ntrp v1 и возможность не выбирать уровень",
      "Переиспользуемая помощь в профиле и фильтре подходящих игр в поиске",
      "Уровень указан самим игроком; изменение в профиле сохраняется только явным действием «Сохранить»"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена",
      "Справка и фильтр не обещают квалификацию, совместимость или место в игре",
      "Фильтр уровня в поиске действует только по уже загруженному списку и точной шкале ntrp v1; карта этот фильтр не применяет"
    ]
  },
  {
    "source_sha": "002d09c981c7f899db15beb90618a11b53b973b1",
    "application_version": "0.1.0-alpha.24",
    "version_label": "0.1.0-alpha.24",
    "title": "Карта Санкт-Петербурга",
    "api_contract_version": "0.31.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41839403532-a1",
        "accepted_at": "2026-11-04T13:45:22Z",
        "api_digest": "sha256:f962f5429792f13a440aeb9ecd7afe8971da386de3f052a44eb1ad96d3fcc699",
        "web_digest": "sha256:48a881b728829c8404b8490f8c13870c29decd5a75da077a678e32956e86dbeb",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Выбор города Санкт-Петербург и географическая карта с заведёнными площадками и играми",
      "Подходящие границы и центр города; при недоступности набора — честное состояние и список"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена",
      "Полнота Ленинградской области и метрополитена этим выпуском не утверждается",
      "Физическая Safari-приёмка и проверка на реальном устройстве ещё не выполнены",
      "Публикация статического набора карты на DEV выполняется отдельно доверенным процессом"
    ]
  },
  {
    "source_sha": "29b6e278a571d541e47b8d4f04e98258dd55df05",
    "application_version": "0.1.0-alpha.25",
    "version_label": "0.1.0-alpha.25",
    "title": "Сводка пилота для администратора",
    "api_contract_version": "0.32.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41849645320-a1",
        "accepted_at": "2026-11-04T14:53:12Z",
        "api_digest": "sha256:b39a225da8df5e836262ee036f9a850b7aa60980c29734b0c470ce0ef3166959",
        "web_digest": "sha256:11f04f0211acd50b905d6c07ff4094fd6b610d587c19d4440d892f516edf9b26",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "В Admin для суперадминистратора доступна агрегированная сводка пилота по городу и периоду: заявки, подтверждения, явные исходы и отмеченные посещения",
      "Повторное участие и активность организаторов в реализованном объёме; неизвестные результаты и нехватка данных показываются отдельно; тестовые DEMO не считаются реальным пилотом"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем после обычного входа ещё не выполнена",
      "Аутентифицированная проверка Admin и физическая приёмка на устройстве ещё не выполнены",
      "Сводка не запускает реальный пилот и не обещает коммерческие KPI или новый сбор персональных данных"
    ]
  },
  {
    "source_sha": "360001c6231157f30fdf11606ef8111c291fb099",
    "application_version": "0.1.0-alpha.26",
    "version_label": "0.1.0-alpha.26",
    "title": "Отдельный доступ для проверки сводки пилота",
    "api_contract_version": "0.33.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41935663994-a2",
        "accepted_at": "2026-11-04T23:55:28Z",
        "api_digest": "sha256:5cf215fe32cb69b75fb8a7b74c265d808088d576b362fa82b24425b70df79b31",
        "web_digest": "sha256:446f880c9f7747452aafc4d84fd4b2ec4c7e35fc779e90d78da11f4296bd1d94",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Отдельный вход для разрешённого проверяющего без VK и Яндекса",
      "Просмотр сводки пилота без разрешения изменять данные или открывать другие разделы",
      "Отзыв доступа прекращает все связанные сеансы проверяющего"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Ключевой вход по умолчанию выключен и доступен только в проверенной среде разработки после отдельной настройки",
      "Готовность отдельной учётной записи подтверждается настоящей проверкой входа"
    ]
  },
  {
    "source_sha": "1354cceaa38b2ec629fabc3ae366d0c3b05e047f",
    "application_version": "0.1.0-alpha.27",
    "version_label": "0.1.0-alpha.27",
    "title": "Понятные пояснения к отзывам",
    "api_contract_version": "0.33.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41941603234-a1",
        "accepted_at": "2026-11-05T00:34:19Z",
        "api_digest": "sha256:841553084c7c3d06d2a464bc92a8cac843c921e03178acf2aadd76516b386e63",
        "web_digest": "sha256:4479b1edb464418d750e6dcfd30f8f769e67a67eae2e575cc1e1777957efaa34",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Уточнено, кто может оставить отзыв об организаторе или тренере после совместной игры",
      "В истории alpha.20 однозначно указано, что автор может снять свой отзыв с публикации",
      "На экране версий показаны ограничения текущего выпуска без устаревших утверждений первой alpha о недоступности почты, итогов после игры и push"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Раздел Admin служебный; тестовая геопозиция не для обычных пользователей"
    ]
  },

  {
    "source_sha": "9bd1ad648fd74123da7ede7377471813ce8fe17d",
    "application_version": "0.1.0-alpha.28",
    "version_label": "0.1.0-alpha.28",
    "title": "Опыт игры на площадке",
    "api_contract_version": "0.34.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41950962808-a1",
        "accepted_at": "2026-11-05T02:00:50Z",
        "api_digest": "sha256:ba1d71fb564780f427c7b591e4f944920f60bdce9d502ef60ff5a40d38e925f9",
        "web_digest": "sha256:fe0f6c3e31fc046d7824120e873d908cee6785b6aeba95a65c20b82e42039d2d",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "После подтверждённого участия в прошедшей игре можно поделиться опытом игры на этой площадке",
      "Пояснения помогают понять, когда отзыв доступен и кому он виден"
    ],
    "fixes": [],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Публикация отзыва о площадке требует независимой проверки точной редакции и паузы 48 часов",
      "Раздел Admin служебный; тестовая геопозиция не для обычных пользователей"
    ]
  },

  {
    "source_sha": "76490b2be720e9f6b923bd3db477fb6065d6d13c",
    "application_version": "0.1.0-alpha.29",
    "version_label": "0.1.0-alpha.29",
    "title": "Актуальная помощь и проверка готовности",
    "api_contract_version": "0.34.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r41954344736-a1",
        "accepted_at": "2026-11-05T02:24:52Z",
        "api_digest": "sha256:e64b5c6f9ea34c69fe7d87ef3d6d21e52facf4bac370a48570b1d4eecde36a1b",
        "web_digest": "sha256:6c500ba801385cb62e8a753c9d5d86912bf4953ea53c86dbddc1f6f4bc62451c",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Убрано устаревшее объяснение обязательного одобрения первого личного сообщения",
      "Зафиксированы оставшиеся проверки документов, поддержки, удаления аккаунта и устройств перед пилотом"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Документы и контакт поддержки пока не опубликованы; удаление аккаунта пока недоступно",
      "Проверка уведомлений на настоящем iPhone ещё не выполнена"
    ]
  },

  {
    "source_sha": "9e7b1fcb7dddd7706e5902b755883d48b3cf945b",
    "application_version": "0.1.0-alpha.30",
    "version_label": "0.1.0-alpha.30",
    "title": "Региональные карты и источник площадок",
    "api_contract_version": "0.35.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42259332272-a1",
        "accepted_at": "2026-11-06T17:26:22Z",
        "api_digest": "sha256:bfc21680a8a761490689c4d9c2e27da5782c4abc76211616fe98f4bcb4a9587b",
        "web_digest": "sha256:9c9bce96000be81d90adb251e1a74c28d4c990ef2c53c9053b0708011276d3dc",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Карты ещё 11 городов для поиска игр и площадок",
      "Видимая ссылка на источник badminton4u.ru у импортированных площадок",
      "Каталог площадок новых городов с данными клубов"
    ],
    "fixes": [
      "Площадки за пределами 40 км не попадают в подборку нового города"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Независимая мобильная проверка новых карт ещё не завершена",
      "Документы и контакт поддержки пока не опубликованы; удаление аккаунта пока недоступно"
    ]
  },

  {
    "source_sha": "1dbd135ae3af27dbc2bd8771a432d32489791a9c",
    "application_version": "0.1.0-alpha.31",
    "version_label": "0.1.0-alpha.31",
    "title": "Выбор города для поиска",
    "api_contract_version": "0.36.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42268408755-a1",
        "accepted_at": "2026-11-06T18:25:52Z",
        "api_digest": "sha256:ee7a063b3d40fc013b6e2d34c2e5625aea6ac7f7d121dcaa48c16c5069ab9bbb",
        "web_digest": "sha256:c94bedd3d55e7e363b2823b573ead1a0224e8acb4f3e1614304daff76174cdb5",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Исправлен выбор города: карта и список площадок показывают выбранный город"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Документы и контакт поддержки пока не опубликованы; удаление аккаунта пока недоступно"
    ]
  },

  {
    "source_sha": "9b07e77fcf300b0265e2151478c45d2881b389d0",
    "application_version": "0.1.0-alpha.32",
    "version_label": "0.1.0-alpha.32",
    "title": "Карточка площадки и уточнённые адреса",
    "api_contract_version": "0.36.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42280047435-a1",
        "accepted_at": "2026-11-06T19:34:49Z",
        "api_digest": "sha256:9f0b07204b6907849188abce8863a735d9b90148dd9b06fa435ab1eeea8c19de",
        "web_digest": "sha256:b06268f74eb4edee8c90806c94c7bbf27495ed9edd1a4087026cb2320f29f1eb",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Дополнительные площадки с уточнёнными адресами после проверки источника"
    ],
    "fixes": [
      "Исправлена компактная карточка площадки на карте: источник и название снова читаются нормально"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Документы и контакт поддержки пока не опубликованы; удаление аккаунта пока недоступно"
    ]
  },

  {
    "source_sha": "ebebea18f216260f8ecd7de8e4c450d157b21a5b",
    "application_version": "0.1.0-alpha.33",
    "version_label": "0.1.0-alpha.33",
    "title": "Приватные функции игры и загрузка обложек",
    "api_contract_version": "0.36.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42290038408-a1",
        "accepted_at": "2026-11-06T20:43:19Z",
        "api_digest": "sha256:ca0e416f2bb09ef43fe7008a4478440886c429baf0cdb33cdb184eae9b8ccaa6",
        "web_digest": "sha256:4004b085adafc4bae0cada62310266a53d787a858875a7f37b3ff15e3a15a59d",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Закрытые и приватные функции игры запрашиваются только там, где они доступны",
      "В выборе площадки обложки больше не показывают пустые ячейки во время загрузки"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ]
  },
  {
    "source_sha": "d96df8096a0b4c6394fa5ab1f3e6e26ad378710e",
    "application_version": "0.1.0-alpha.34",
    "version_label": "0.1.0-alpha.34",
    "title": "Имя тренера на телефоне",
    "api_contract_version": "0.36.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42293392235-a1",
        "accepted_at": "2026-11-06T21:08:02Z",
        "api_digest": "sha256:f46169694bfdc138db9e19b3109b5caf54c45ea2f1ab9ebb1ee94c9b6b9affdd",
        "web_digest": "sha256:42ddb11df947961a339235afa0ef53f82efa9651ed1c2e4f02d4deeb47776186",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "На телефоне имя тренера и отзывы отображаются отдельными читаемыми блоками"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ]
  },
  {
    "source_sha": "5c75185408042d7d119a7f63304c9ac609b68cbc",
    "application_version": "0.1.0-alpha.35",
    "version_label": "0.1.0-alpha.35",
    "title": "Мгновенная заглушка обложки и гостевые запросы",
    "api_contract_version": "0.36.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42321599702-a1",
        "accepted_at": "2026-11-07T01:05:19Z",
        "api_digest": "sha256:26423380b7c1e96205c934d177f12557fcc7aac28286a35026d2d7530887978b",
        "web_digest": "sha256:c7a56b4e234c64742b051a98b2014872955a57f182512ced3515b04960ac3e50",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Пока грузится фото или иллюстрация площадки сразу виден нейтральный рисунок ракетки и сетки",
      "Гость без входа не вызывает личные запросы профиля на странице игры"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ]
  },
  {
    "source_sha": "9af6482afeb0e5552c20af25a04dd6503957202d",
    "application_version": "0.1.0-alpha.36",
    "version_label": "0.1.0-alpha.36",
    "title": "Гостевой запрос на странице площадки",
    "api_contract_version": "0.36.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42325229441-a1",
        "accepted_at": "2026-11-07T01:45:38Z",
        "api_digest": "sha256:0e5e09cb63a5737f84bdf045da5c08ff8a3f23b4a8ab21797a19b31e11a3adb5",
        "web_digest": "sha256:bbdcfa9f9ec128712275589c504698215860f1c24058269b1625654c049724e6",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Гость без входа не вызывает личный запрос профиля на странице площадки"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ]
  },
  {
    "source_sha": "859bb6a635ad704ad0971f8a7ad748b02eda0017",
    "application_version": "0.1.0-alpha.37",
    "version_label": "0.1.0-alpha.37",
    "title": "Общие кнопки закрытия и маркеры карты площадок",
    "api_contract_version": "0.36.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42327405382-a1",
        "accepted_at": "2026-11-07T02:10:06Z",
        "api_digest": "sha256:aae0566a1a4f9bc9143d73765fca35776ef56e57416fa6bfc26e9dd8652921ed",
        "web_digest": "sha256:ca74a876933daee80aa65103dae5732d851e96fefe311d319678caac209da3a0",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Кнопки закрытия фильтров и подсказки игроков используют общий элемент закрытия",
      "Публичные маркеры площадок на карте появляются после создания карты, не дожидаясь полной загрузки подложки"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ]
  },
  {
    "source_sha": "298917fe49ccc57e8891e68a04e6408e4aa3a0d1",
    "application_version": "0.1.0-alpha.38",
    "version_label": "0.1.0-alpha.38",
    "title": "Карта площадок без лишнего опроса каталога в простое",
    "api_contract_version": "0.36.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42338172236-a1",
        "accepted_at": "2026-11-07T04:27:56Z",
        "api_digest": "sha256:0cdadb25832079fa29299750f4621354479579820abb9e4778e790870442d6b7",
        "web_digest": "sha256:fadd2e445240ea6643a6bdb9c793a3c1a9a1210428ddb330e04d8d7f1a77e0ff",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Карта игр не повторяет полную загрузку каталога площадок, пока вкладка просто открыта без действий"
    ],
    "known_limitations": [
      "Приёмка владельцем ещё не выполнена",
      "Часть сведений о площадках ещё находится на проверке",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ]
  },
  {
    "source_sha": "01ea6f2f490c9d8efbbf6b9c58d30d844096ee14",
    "application_version": "0.1.0-alpha.39",
    "version_label": "0.1.0-alpha.39",
    "title": "Push по шести событиям игры",
    "api_contract_version": "0.37.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "environment": "dev",
        "status": "ACCEPTED",
        "release_id": "r42359322474-a1",
        "accepted_at": "2026-11-07T09:34:34Z",
        "api_digest": "sha256:dad8252ab11627e9144fd91395012302de3c34f4e249363309e0fd1214425414",
        "web_digest": "sha256:2c1f1a40e0007b232e1f4dbf99d982266ab1815dbfa382a7b41aeeed08e6a50b",
        "kind": "pipeline"
      }
    ],
    "additions": [
      "Web Push: приглашение на игру",
      "Web Push: новая заявка активному организатору",
      "Web Push: подтверждение или отклонение заявки игроку",
      "Web Push: отмена игры связанным участникам",
      "Web Push: напоминание об итоге игры организатору (до трёх раз, с Later)"
    ],
    "fixes": [],
    "known_limitations": [
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ]
  },
  {
    "source_sha": "0d6dd4852db26e0cb9feea03c78119cf5e2b04e4",
    "application_version": "0.1.0-alpha.40",
    "version_label": "0.1.0-alpha.40",
    "title": "Карта: поздняя загрузка и переключатели уведомлений",
    "api_contract_version": "0.37.0",
    "owner_uat": "NOT_TESTED",
    "deployments": [
      {
        "release_id": "r42362366120-a1",
        "api_digest": "sha256:2aef121fea64641a8f4d6d7b42be789d49c7195b966a9694c3d305638808187f",
        "web_digest": "sha256:effe1b06111ef1762d88772647c7c5b903a1934650553ccd8dcbc281b6de15fa",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T10:09:04Z",
        "kind": "pipeline"
      }
    ],
    "additions": [],
    "fixes": [
      "Карта снимает устаревший таймаут старта после подтверждённой поздней загрузки текущей попытки, не скрывая настоящие ошибки",
      "Настройки уведомлений о событиях игр используют канонические переключатели"
    ],
    "known_limitations": [
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ]
  },
  {
    "application_version": "0.1.0-alpha.41",
    "title": "Площадки: правка имени и адреса, выравнивание переключателей",
    "owner_uat": "NOT_TESTED",
    "additions": [],
    "fixes": [
      "Служебный импортёр площадок позволяет исправить имя и адрес уже существующей площадки с сохранением её идентификатора; создание площадок, геоданные и права этим выпуском не заявляются",
      "Выпуск готовит последующее применение проверенных данных; названия «Цех» и «Nord» этим выпуском ещё не изменены",
      "Ряды переключателей уведомлений о событиях игр выровнены на полную ширину списка"
    ],
    "known_limitations": [
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "3dbf8e04b978ba5f8a0379379ef46b054008ec44",
    "version_label": "0.1.0-alpha.41",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42366434024-a1",
        "api_digest": "sha256:2d76fa61dfc02ef8943b48f108b9d9189460b14cffcb4c47eeb55738e8b47c04",
        "web_digest": "sha256:46189a35c68cd29842138059eb78cbb9fcbab1e32a1f5ddb20feb3d751fc35cc",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T11:13:52Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.42",
    "title": "Публичные фото площадок: меньший WebP при явной поддержке",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "Публичные фотографии площадок передаются как меньший WebP, если браузер явно поддерживает этот формат; для остальных сохраняется исходный PNG",
      "Действующие проверки модерации и доступности и заголовок no-store для ответа обложки площадки сохранены; обложки игр и игроков не менялись"
    ],
    "fixes": [],
    "known_limitations": [
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "a72905b82e3d82ba0c08df44da8046e7db6e31ff",
    "version_label": "0.1.0-alpha.42",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42369478229-a1",
        "api_digest": "sha256:cdf1783b1d1a13c207ea323d8382ec12a3129fb4e34eb73941be1ad83e0ad9b2",
        "web_digest": "sha256:052235f38705584fb63b82095fcf5123e38be993677472e2758ce86a09652190",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T11:55:54Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.43",
    "title": "Уведомления: пояснение выбора событий и подсказка iPhone",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "В настройках уведомлений до явного согласия поясняется, что после включения можно отдельно выбрать игровые события и «Подведите итоги»",
      "Для iPhone указана установка приложения на экран «Домой» перед включением уведомлений"
    ],
    "fixes": [],
    "known_limitations": [
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "4614a0006d0e080bca4c8c5cb6335056a80d5a21",
    "version_label": "0.1.0-alpha.43",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42372648654-a1",
        "api_digest": "sha256:534eefc04dae07ceb91bbc6e8500ea27e25d94fe0919658a9e818bf9cb146486",
        "web_digest": "sha256:4472803d6383ea182d19ccb575109b07ae5c2a00487a302587fc536435ad2dbf",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T12:33:39Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.44",
    "title": "Компактный WebP аватаров и обложек; подсказки уведомлений при запрете браузера",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "Загруженные аватары, обложки страницы игрока и обложки игр передаются как компактный WebP после действующих проверок доступа; прозрачность и размеры сохраняются, исходники защищены для аудита; уже принятый WebP площадок сохранён"
    ],
    "fixes": [
      "Пояснения про игровые события, «Подведите итоги» и установку на iPhone остаются видимы, когда браузер запретил уведомления; прямое согласие и запрос разрешения не меняются"
    ],
    "known_limitations": [
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Три PWA-иконки и 26 PNG-спрайтов карты остаются для технической совместимости; массовое переименование на диске, сжатие всего каталога и новые JPEG-конверсии не заявляются",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "b27f91beceee24029311b9be2e26eca12b343ccb",
    "version_label": "0.1.0-alpha.44",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42376945998-a1",
        "api_digest": "sha256:811d7a10338a7096293a5b31db88bfbd1c31206387e1c24de16ba4889345ec98",
        "web_digest": "sha256:ba98fda9f2b39a5dc78b7b709ace4a3347769fce34fdadc4c55f5bfc5ab6c1f1",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T13:41:23Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.45",
    "title": "Проверка публичного текста; состояния и стрелки галереи площадки",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "Публичные имена и описания профиля, тренера, организатора и полей игры проходят локальную и модельную проверку до публикации; при отклонении или временной недоступности прежний принятый текст сохраняется"
    ],
    "fixes": [
      "Галерея площадки показывает спокойные состояния загрузки, ошибки и отсутствия фото; на компьютере работают стрелки перелистывания"
    ],
    "known_limitations": [
      "Комментарии, отзывы, текст площадок, личные сообщения и аватары провайдеров остаются в следующих логических объёмах; внешняя модерация реальных частных сообщений выключена",
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "2650fcbe21976564b8b1ff90aac67ea4eca5b569",
    "version_label": "0.1.0-alpha.45",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42393881246-a1",
        "api_digest": "sha256:7d36c35471bbef9162414311781644f31fbba79f6e4444ed1fdb108cd2d47882",
        "web_digest": "sha256:ce8562e9d36d2c5e929412c7185fdb7270c6d6e64dab50344bc1bbe04161d29e",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T17:12:03Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.46",
    "title": "Площадка без фото: готовая иллюстрация вместо текстовой заглушки",
    "owner_uat": "NOT_TESTED",
    "additions": [],
    "fixes": [
      "Если у площадки нет опубликованного фото, показывается готовая растровая иллюстрация из библиотеки GoBadminton с подписью «Иллюстрация»; одна площадка получает один и тот же рисунок на странице, карте и в выборе"
    ],
    "known_limitations": [
      "Комментарии, отзывы, текст площадок, личные сообщения и аватары провайдеров остаются в следующих логических объёмах; внешняя модерация реальных частных сообщений выключена",
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "264d9e1cf63b4272732b2b9ad2317e9f9b9d320f",
    "version_label": "0.1.0-alpha.46",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42400302014-a1",
        "api_digest": "sha256:d62283d142aa89344a104e1505a5ccca01cbf57da6867919a223f07812779879",
        "web_digest": "sha256:375944a55af9e1c16b2c08aa28d22d4fefade2dd453d36c0e29b2c286f474f97",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T18:20:21Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.47",
    "title": "Комментарии к игре: проверка текста до публикации",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "Создание, ответ и правка публичного комментария к игре проходят проверку текста до публикации; при отклонении или временной недоступности черновик и уже опубликованный текст сохраняются"
    ],
    "fixes": [],
    "known_limitations": [
      "Отзывы о роли и площадке, широкие комментарии на страницах площадок и связанные разделы ещё не в этом выпуске; проверка личных сообщений снаружи выключена",
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "cf0349ad52d5caf10a8b40e209e8c837e9c4da43",
    "version_label": "0.1.0-alpha.47",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42403605993-a1",
        "api_digest": "sha256:d0dca6a3f0a036a452758393806fc582f8827a8be8734fec30f52f29a4cdb52b",
        "web_digest": "sha256:f4b63b48aef27f64c5da14ca381ca4cc2786689d8247931ab1a4e8e0e0144ac5",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T19:05:58Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.48",
    "title": "Отзывы об организаторе и тренере: проверка текста до решения человека",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "Публичные отзывы и ответы об организаторе и тренере проходят предварительную проверку текста до очереди независимого человека; неоднозначный результат остаётся на проверке, положительный допуск модели сам по себе не публикует текст; при отклонении или временной недоступности уже опубликованный текст и черновик сохраняются"
    ],
    "fixes": [
      "Повтор того же известного отклонения по тому же запросу возвращает сохранённый ответ без повторной внешней проверки"
    ],
    "known_limitations": [
      "Отзывы о площадке, импорт публичного текста площадок, широкие комментарии на страницах площадок, личные сообщения и метаданные аватаров ещё не в этом выпуске; проверка личных сообщений снаружи выключена",
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "608f44e9af26da7ea24881fe31c2c7e49ed8aeb3",
    "version_label": "0.1.0-alpha.48",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42412760323-a1",
        "api_digest": "sha256:0145f018db57417491b262c83e88dd5cf779860faca64762f3e92bfc34c86295",
        "web_digest": "sha256:cd91420354aaee9b2a78bd8502d31804296e5ed474410b909604f32224f491df",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T20:59:58Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.49",
    "title": "Подпись к фото площадки и обслуживание галереи",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "В галерее площадки для подписи к фото сохраняется постоянное место при перелистывании",
      "Разрешённое обслуживание уже принятой галереи площадки без внешней загрузки новых снимков",
      "Добавлены 9 фото на 4 площадках"
    ],
    "fixes": [],
    "known_limitations": [
      "Остальные отобранные фото пакета этим выпуском не заявляются опубликованными",
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "519489d9d0944619b29107b212dc09012e5b418b",
    "version_label": "0.1.0-alpha.49",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42418500085-a1",
        "api_digest": "sha256:662bcd70dfa500766bfd6cc64dc836fb8a60307ae188e198a9146a34f89760c4",
        "web_digest": "sha256:4c2ed4faadbecb22745cd76dbb7ebbe9b513f0f72ab76dc9b758ef5d60fc8707",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T22:12:06Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.50",
    "title": "Отзывы о площадке: проверка текста до решения человека",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "Публичные отзывы о площадке проходят предварительную проверку текста до очереди независимого человека; неоднозначный результат остаётся на проверке, положительный допуск модели сам по себе не публикует текст; при отклонении или временной недоступности уже опубликованный текст и черновик сохраняются; личный черновик не уходит во внешнюю проверку"
    ],
    "fixes": [],
    "known_limitations": [
      "Импорт публичного текста площадок, широкие комментарии на страницах площадок, личные сообщения и метаданные аватаров ещё не в этом выпуске; проверка личных сообщений снаружи выключена",
      "Изменение времени и места игры и связанные push отложены и не реализованы",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "3153e3cd1fd1e1f1936e60ea27f7632589701bea",
    "version_label": "0.1.0-alpha.50",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42424550031-a1",
        "api_digest": "sha256:a60b517a4c340ee7588354396ecea31179f282bdaeba2e018fee86cced5b5508",
        "web_digest": "sha256:6c196b8fdb9dbc053df91bc8867e5861507de0bea779fa4f3d7ba4832398499c",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-07T23:32:15Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.51",
    "title": "Временно сняты количественные ограничения проверок на тестовом стенде",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "На тестовом стенде до 1 января 2027 UTC временно сняты количественные ограничения на проверки фото и текста; сами проверки содержимого продолжаются, ограничения возвращаются автоматически; внешние лимиты провайдера и защита при неизвестном результате сохраняются"
    ],
    "fixes": [],
    "known_limitations": [
      "Это не отмена проверки содержимого и не завершение всей модерации; основной сайт этим выпуском не менялся",
      "Импорт публичного текста площадок, широкие комментарии на страницах площадок, личные сообщения и метаданные аватаров ещё не закрыты; проверка личных сообщений снаружи выключена",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены; служебный разбор отзывов после обычного входа ещё не проверен",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "4cefe7a6ef780da13796c1df85eca6fdc27a50ef",
    "version_label": "0.1.0-alpha.51",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42427559664-a1",
        "api_digest": "sha256:55b2753ad3debb76583a8c56a49fd42acd8619b0d667820d68b2a709be719330",
        "web_digest": "sha256:0f17742f15f5533986409abfa49ca9fe569defa99fe3d205ec69f494f6265fa7",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-08T00:08:42Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.52",
    "title": "Проверка публичных названия, адреса и описания площадки до публикации",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "Публичные название, адрес и описание площадки проходят предварительную проверку текста при создании и правке пользователем и в служебном каталоге; при отклонении или временной недоступности прежние значения сохраняются; удаление, объединение и снятие с публикации работают без внешней проверки"
    ],
    "fixes": [],
    "known_limitations": [
      "Это не завершение всей модерации площадок: импорт публичного текста, подписи к фото галереи, широкие комментарии на страницах площадок, личные сообщения и метаданные аватаров ещё не в этом выпуске; проверка личных сообщений снаружи выключена",
      "На тестовом стенде до 1 января 2027 UTC временно сняты количественные ограничения на проверки фото и текста; сами проверки содержимого продолжаются",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены; служебный разбор отзывов после обычного входа ещё не проверен",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "aa222e469c4125abf1e8fe08eaba4e05575ead72",
    "version_label": "0.1.0-alpha.52",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42435428393-a1",
        "api_digest": "sha256:8903f05d967fa575e99af1a20f2f7e8910fb0cacb60c52098c680df84118f066",
        "web_digest": "sha256:e6ac26251db8dea9e30a54c0c79571659dedddb20cd4ee1103e92ee16ab616ba",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-08T01:56:35Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.53",
    "title": "Проверка описания площадки при импорте и подписей к фото галереи",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "Импорт публичного описания площадки и свободные подписи к фото галереи и обложке проходят предварительную проверку текста до публикации; при отклонении или временной недоступности прежние описание, подпись, обложка и главное фото сохраняются; правки и удаление изображений работают без внешней проверки"
    ],
    "fixes": [],
    "known_limitations": [
      "Это не завершение всей модерации площадок: широкие комментарии на страницах площадок, личные сообщения и метаданные аватаров ещё не в этом выпуске; проверка личных сообщений снаружи выключена",
      "На тестовом стенде до 1 января 2027 UTC временно сняты количественные ограничения на проверки фото и текста; сами проверки содержимого продолжаются",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены; служебный разбор отзывов после обычного входа ещё не проверен",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "79e51ff2b0b4846a9fee3be0f429f3f3d6c822ab",
    "version_label": "0.1.0-alpha.53",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42441987882-a1",
        "api_digest": "sha256:fb05d669436562d669059604d9a4c7d1a4624d78a840d3a1891e95e4fba21f68",
        "web_digest": "sha256:7f80fa109b4695188b7f7c7ff4dc8bdc633d82c75c2c462f61c8a0950470450c",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-08T03:29:11Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.54",
    "title": "Локальная защита личных сообщений и сохранение черновика при отказе",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "В личных сообщениях и чате игры перед отправкой действует локальная проверка опасных ссылок, явных угроз и простого повтора; при отказе или временном ограничении частоты сообщение не уходит, а черновик остаётся для правки"
    ],
    "fixes": [],
    "known_limitations": [
      "Это не полная модерация переписки: жалоба на точное сообщение и внешняя проверка личных текстов ещё не в этом выпуске; проверка личных сообщений снаружи выключена",
      "На тестовом стенде до 1 января 2027 UTC временно сняты количественные ограничения на проверки фото и текста; сами проверки содержимого продолжаются",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены; служебный разбор отзывов после обычного входа ещё не проверен",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "cce49ce72daed8c81f89ddc845deabbb8ac5d7aa",
    "version_label": "0.1.0-alpha.54",
    "api_contract_version": "0.37.0",
    "deployments": [
      {
        "release_id": "r42449222181-a1",
        "api_digest": "sha256:03cdab10c3c780b0bcd69b12bf8fbc013742e21f017fa2b076acd1c77b00bf3c",
        "web_digest": "sha256:fbc040efc941c25dc238ab51b986962f818d901e17a797a7e232193a51754896",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-08T05:18:57Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.55",
    "title": "Жалоба на выбранное сообщение с явным согласием и чтением источника в обращении",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "В личной переписке и чате игры можно пожаловаться на одно уже загруженное входящее сообщение с явным согласием на передачу назначенному специалисту; в обращении источник читается только пока исходное сообщение ещё доступно по своему сроку"
    ],
    "fixes": [],
    "known_limitations": [
      "Это не полная модерация переписки: внешняя проверка личных текстов выключена; при отсутствии конечного срока хранения исходного сообщения точный текст для разбора недоступен",
      "На тестовом стенде до 1 января 2027 UTC временно сняты количественные ограничения на проверки фото и текста; сами проверки содержимого продолжаются",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены; служебный разбор отзывов после обычного входа ещё не проверен",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "edc6744ce0f96dcaa922dafcd373fdab8e482bf8",
    "version_label": "0.1.0-alpha.55",
    "api_contract_version": "0.38.0",
    "deployments": [
      {
        "release_id": "r42455870420-a1",
        "api_digest": "sha256:59d94a8d7a0a199693e1aa388e7a5ca5b032df6735a19b716612477460703b06",
        "web_digest": "sha256:e2cba1cdaddd2b2779c7075e487b428239ea6e5d5c0988e9b88dcdd4a6721ee5",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-08T06:58:58Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.56",
    "title": "Скрытие непроверенных фото из VK/Яндекс и журнал метаданных модерации",
    "owner_uat": "NOT_TESTED",
    "additions": [
      "В публичных профилях, комментариях и Radar больше не показываются непроверенные фото из VK и Яндекса — остаются загруженное фото или инициалы; вход через эти сервисы работает как раньше",
      "В разделе безопасности кабинета доступен ограниченный журнал сохранённых решений модерации без сырого текста и изображений"
    ],
    "fixes": [],
    "known_limitations": [
      "Журнал показывает только сохранённые разрешения и отправки на проверку; отклонённые и временные попытки, а также бюджеты туда не входят",
      "На тестовом стенде до 1 января 2027 UTC временно сняты количественные ограничения на проверки фото и текста; сами проверки содержимого продолжаются",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены; служебный разбор отзывов после обычного входа ещё не проверен",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "524088767e2b7e77d569c2f0a47689db854ab7b0",
    "version_label": "0.1.0-alpha.56",
    "api_contract_version": "0.39.0",
    "deployments": [
      {
        "release_id": "r42465159954-a1",
        "api_digest": "sha256:58e9c86acd10434b1e748c4dfffe7aac0bd375070559c8458a40ffbd1113927c",
        "web_digest": "sha256:7457fe35b99d31b9bc48e1dbf862ff39a23eb1a11cf471dfeb2dd1e5cb2932e4",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-08T09:11:48Z",
        "kind": "pipeline"
      }
    ]
  },
  {
    "application_version": "0.1.0-alpha.57",
    "title": "Карточка тренера в ленте и выравнивание кнопок действий в карточках игроков",
    "owner_uat": "NOT_TESTED",
    "additions": [],
    "fixes": [
      "В ленте на широком экране карточка «С тренером» держит то же компактное расположение фото слева и текста справа, что и обычная игра; роли тренера и организатора всегда показаны отдельно (разные пространства идентификаторов; общего ключа человека в разрешённом контракте нет), длинные имена переносятся без обрезки, при недоступном профиле тренера показывается честный статус",
      "На широком экране в режиме карточек игроков кнопки «Давай сыграем» и «Следующий» одной высоты и на одной линии; строка статуса больше не растягивает только «Следующий»"
    ],
    "known_limitations": [
      "На тестовом стенде до 1 января 2027 UTC временно сняты количественные ограничения на проверки фото и текста; сами проверки содержимого продолжаются",
      "Физический iPhone, провайдер доставки, GoBad и приёмка владельцем ещё не выполнены; служебный разбор отзывов после обычного входа ещё не проверен",
      "Юридические реквизиты и рабочий контакт поддержки ещё не подтверждены; удаление аккаунта пока недоступно"
    ],
    "source_sha": "895e97fd5f60e4eaaa493cb911cd7d3d7fdd4c22",
    "version_label": "0.1.0-alpha.57",
    "api_contract_version": "0.39.0",
    "deployments": [
      {
        "release_id": "r42486594258-a1",
        "api_digest": "sha256:dde4e16f576ec4df2c69cee584dbfa91bba89afe99fa338378f9a629bc148b55",
        "web_digest": "sha256:e9824a215dbc8746331d02181e38441883a6fc4348e1ded143c878c363fd6e2f",
        "environment": "dev",
        "status": "ACCEPTED",
        "accepted_at": "2026-11-08T13:53:05Z",
        "kind": "pipeline"
      }
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

/** Limitations listed for the named row on /releases. First-alpha baseline only when that named row is the first release. */
export function visibleKnownLimitations(
  named: Pick<NamedReleaseNotes, "application_version" | "feature_catalogue" | "known_limitations">,
): readonly string[] {
  const isFirstNamed =
    named.application_version === FIRST_NAMED_APPLICATION_VERSION
    || named.feature_catalogue === "full_baseline";
  if (!isFirstNamed) return named.known_limitations;
  const extras = named.known_limitations.filter((item) => !FIRST_ALPHA_KNOWN_LIMITATIONS.includes(item));
  return [...FIRST_ALPHA_KNOWN_LIMITATIONS, ...extras];
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

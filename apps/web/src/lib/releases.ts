/** Pure source catalogue for application version history and first-alpha feature baseline.
 * Safe for client imports. Server fetch/guard helpers live in releases-server.ts.
 */

export const CURRENT_APPLICATION_VERSION = "0.1.0-alpha.1" as const;
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
    limitation: "Изменение PR433 вошло в85513; отдельная Owner UAT не подтверждена.",
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
    limitation: "Наличие провайдера подтверждено public discovery; полный внешний OAuth round trip в этой проверке не выполнялся.",
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
    limitation: "Для авторизованных пользователей и поддержанного города; не точный публичный GPS. Авторизованный браузерный сценарий после promotion не проверен.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f29",
    group: "Radar",
    title: "Поиск игроков поблизости",
    description: "Список/единый каталог подходящих доступных игроков, географический поиск и просмотр профиля результата.",
    limitation: "Живой Radar ограничен Москвой; приватные результаты зависят от согласия, временных разрешений и настроек видимости. PROD flags включены, авторизованный runtime путь не квалифицирован этой проверкой.",
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
    limitation: "Canonical PROD origin разрешён новым кодом; публичный неизменяемый московский bundle обслуживается с DEV asset host. CORS GET200/Range206/OPTIONS204 подтверждены без credentials. Интерактивный браузерный UAT NOT_TESTED.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f32",
    group: "Карты",
    title: "Карта игроков Москвы",
    description: "Отображение разрешённых результатов Radar на карте с защитой приватных результатов.",
    limitation: "PROD map зарегистрирована runtime как dev_preview. Частные pins по-прежнему требуют signed Radar query, согласия и действующих прав. Полный авторизованный браузерный UAT NOT_TESTED.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f33",
    group: "Общение",
    title: "Друзья",
    description: "Запрос дружбы, принять/отклонить/отменить, список друзей и удаление из друзей.",
    limitation: "PROD friendsEnabled=true проверен загруженным policy-модулем; TTL/rate/eligibility/приватность сохранены. Авторизованный браузерный UAT NOT_TESTED.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f34",
    group: "Общение",
    title: "Советовать игру другу",
    description: "Отправка рекомендации игры принятому другу, входящие рекомендации, скрыть или отозвать совет.",
    limitation: "PROD service guard теперь разрешён через friendsEnabled=true; рекомендация не резервирует место. Отдельная authenticated рекомендация в этой проверке не отправлялась; UAT NOT_TESTED.",
    prod: "available",
    dev: "available",
  },
  {
    id: "f35",
    group: "Общение",
    title: "Хочу сыграть",
    description: "Отправка/отзыв интереса к совместной игре, взаимный интерес.",
    limitation: "PROD playMatch=true проверен загруженным policy-модулем; не означает подтверждённого участия в игре. Авторизованный браузерный UAT NOT_TESTED.",
    prod: "available",
    dev: "available",
  },
] as const;

export const FIRST_ALPHA_KNOWN_LIMITATIONS: readonly string[] = [
  "Авторизованный браузерный UAT: NOT_TESTED",
  "Бронирование кортов и оплата выполняются вне приложения",
  "Юридические тексты, сведения об операторе и адрес поддержки пока не опубликованы",
  "Удаление аккаунта, изменение вместимости и отмена игры в пользовательском сценарии недоступны",
  "Email-вход, результаты после игры и социальные push-уведомления выключены"
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
  application_version: CURRENT_APPLICATION_VERSION,
  title: "Первый именованный каталог функций",
  source_sha: null,
  owner_uat: "NOT_TESTED",
  additions: [
  "Страница истории выпусков /releases (только DEV) с каталогом функций и сверкой live SHA",
  "Полный базовый каталог доступных пользовательских функций первой именованной alpha",
  "Ссылка «Версии» в DEV footer; /health отдаёт applicationVersion и gitSha сборки"
],
  fixes: [],
  known_limitations: [
  "Авторизованный браузерный UAT: NOT_TESTED",
  "Бронирование кортов и оплата выполняются вне приложения",
  "Юридические тексты, сведения об операторе и адрес поддержки пока не опубликованы",
  "Удаление аккаунта, изменение вместимости и отмена игры в пользовательском сценарии недоступны",
  "Email-вход, результаты после игры и социальные push-уведомления выключены",
  "Фактическое принятие текущего номера берётся из live projection после выпуска; candidate SHA не подменяет accepted receipt",
  "Служебные admin и тестовая геопозиция не являются публичными функциями"
],
  feature_catalogue: "full_baseline",
};

/** Confirmed historical deployments only; application versions remain unnumbered. */
export const TRUSTED_HISTORICAL_SEED: readonly HistoricalReleaseSeed[] = [
  {
    "source_sha": "85513c719826a91bebd14a16b807ced8e17133fd",
    "application_version": null,
    "version_label": "Без формального номера",
    "title": "Полное продвижение принятого DEV в PROD",
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
      "Авторизованный браузерный UAT NOT_TESTED",
      "Номер alpha ещё не присвоен",
      "Карты, Friends, рекомендации друзьям и play-interest ещё ограничены DEV"
    ]
  },
  {
    "source_sha": "11558239cf284a2f20e3c1c6906ae217c703325f",
    "application_version": null,
    "version_label": "Без формального номера",
    "title": "Равенство публичных возможностей PROD и DEV (#435)",
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
      "Разрешены canonical PROD Friends и рекомендации друзьям",
      "Разрешён canonical PROD play-interest",
      "Разрешены зарегистрированные карты Москвы и точный static CORS"
    ],
    "known_limitations": [
      "Авторизованный браузерный UAT NOT_TESTED",
      "Номер alpha ещё не присвоен",
      "Admin остаётся служебным DEV; email, публичный postgame и социальный push не включены"
    ]
  },
] as const;

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

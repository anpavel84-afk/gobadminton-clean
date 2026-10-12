# Безопасность и privacy foundation

Статус: **TECH_SELECTED**. Это инженерная модель угроз и launch gates, **не юридическое заключение и не проведённый pentest**.

## Активы и границы доверия

PII профиля/контактов, identities, sessions, organizer authority, история участия, private share links, signing keys, backup data. Public browser/mobile и provider callbacks недоверенные. API, worker и storage используют минимальные разные service permissions. Admin — отдельная повышенная граница.

| Угроза | Контроль | Проверка |
|---|---|---|
| Чужая заявка по ID / массовый перебор | Resource-level authorization, restricted DTO, scoped queries | Два организатора и два игрока во всех write/read тестах |
| Account takeover через совпадение email | Явный linking с reauth, unique external identity | Collision/link/replay tests |
| OAuth code interception/login CSRF | State, PKCE, binding, exact redirects, nonce когда OIDC | Неверный verifier/state/provider, повтор callback |
| Overbooking / double submit | Game lock, uniqueness, idempotency, version checks | Concurrent confirm/cancel/capacity tests |
| XSS/SSRF через описание, avatar или upload | Plain/sanitized content, output escaping, CSP, upload quarantine, constrained fetch | Script/HTML payload, internal IP, redirect/oversize tests |
| Утечки через logs/cache/analytics | Redaction, no-store, minimal events, environment separation | Automated log/cached-response inspection |
| Злоупотребление публикацией/спам | Approved organizer onboarding, rate/size limits, report/block | Bounded requests, moderation flow |
| Потеря/компрометация credentials | Secret store, rotation, least privilege, backups signing keys отдельно | Revocation/restore drills |

## Data-flow и регионы

Для начального российского запуска проектируем primary DB, private media, backups и чувствительные logs в согласованном российском контуре. Зарубежные analytics, telemetry, CDN, OAuth и push могут влиять на поток данных даже при российской БД. Оператор/юрист должен определить применимые обязанности, основания обработки, локализацию и трансграничную передачу для фактической схемы до сбора real PII. Международный rollout требует новой проверки; архитектура не утверждает автоматически GDPR/LGPD/152-ФЗ compliance.

Не загружать production data в GitHub, EAS build artifacts, third-party observability или AI prompts без отдельного разрешённого процесса. Даже pseudonymous identifiers могут оставаться персональными данными; hash не гарантирует анонимность.

## Минимизация

Для поиска не нужен вход. Для заявки — внутренний аккаунт и минимальные сведения для согласованного уровня/сценария. Телефон, паспорт, дата рождения и доступ к адресной книге не собираются по умолчанию. Provider scopes — только требуемые; отсутствие email не делает аккаунт недействительным. Геолокация только по действию пользователя, без background tracking.

Public organizer contact — осознанно указанный контакт. Applicant contacts и roster не public. Причины отказа/модерации минимальны, без чувствительных характеристик. Data retention/deletion — [policy](../data/MIGRATIONS_AND_RETENTION.md).

## Abuse и real-world safety

У пользователя есть способ сообщить о недостоверной игре/организаторе, скрыть контакт с нарушителем по принятому сценарию и получить поддержку. Platform moderation action должен уведомлять affected parties и оставлять audit. Блокировка organizer не удаляет историю состоявшихся игр и не объявляет автоматический возврат.

Возраст и несовершеннолетние — O-01. Не строить детские анкеты или сбор документов до отдельного product/legal решения. Жалобы, насилие/домогательства и спор о проведении игры направляются в операционный процесс; AI-агент не становится единственным арбитром.

## Security release gate

Проверить threat tests, секреты/dependency advisories, runtime roles, backup restore, admin step-up, deletion, incident contacts, privacy documents и legal data-flow sign-off. Нерешённая утечка или обход прав блокируют release. Статическая проверка текущих документов не считается прохождением gate. Основания security patterns: [S12–S13](../reference/SOURCES.md).

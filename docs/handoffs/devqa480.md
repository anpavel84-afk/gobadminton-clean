# #480 — отдельный DEV QA доступ

Источник: Owner Issue #480; прямой выбор автора Codex. База29b6e278a571d541e47b8d4f04e98258dd55df05. Source candidate, не готовый доступ.

Новая роль pilot_viewer имеет только pilot.read. Пользователь gobad-qa-dev изолирован: disabled consumer user, без OAuth/email/profile/consumer sessions. QA сессия имеет явный auth_method dev_qa_key, отдельную credential и audience, максимум15минут. Обычная WebAuthn-ветка сохранена. Доступ проверяется по текущей роли/principal/credential и флагу на каждом запросе. QA может читать только auth/me и pilot-metrics, выполнить собственный CSRF-защищённый logout; прочие Admin/OAuth/WebAuthn маршруты запрещены.

POST auth/dev-qa-key принимает ключ только JSON body, отдельный случайный requestNonce и совпадающий X-CSRF-Token. Точный Origin обязателен. Повтор nonce отвергается; ключ хранится только как domain-separated keyed hash. Отдельные ограничения IP/global сохраняются при ошибках. Ключ ограничен7сутками; его отзыв закрывает все сессии. Повторное включение отозванного ключа запрещено. Никаких фиктивных WebAuthn credentials.

ADMIN_DEV_QA_KEY_ENABLED и ADMIN_DEV_QA_VPS_VERIFIED по умолчанию выключены. Включение допускается только с явными DEV Admin/path flags, production runtime mvp/stage и точными dev.gobadminton.ru origins; PROD/local/непроверенная среда отклоняются валидатором и runtime guard.

Порядок поставки: независимая QA → CI → первоначальный DEV ACCEPTED с флагом выключенным → guarded root установка команды/конфигурации → провиженирование одной действующей QA credential и защищённого файла → настоящий браузерный вход. Не объявлять готовность до readback. Единственный plaintext файл /home/grokops/.qa/admin-dev.key, grokops:grokops0600, .qa0700; ключ/хеш/pepper/cookies/body никогда не печатаются.

Команда отзыва после защищённой установки: sudo /usr/local/sbin/gobadminton-dev-qa-revoke. Сначала одна DB транзакция отзывает credential и все её сессии, проверяет0active; только затем unlink через закреплённый directory fd. Повтор команды идемпотентен. Сторонние WebAuthn сессии не изменяются.

Rollback: выключить QA flags, отозвать QA credential/сессии, штатно откатить app image. Аддитивную миграцию сохранить с историей. Schema rollback сознательно откажет при наличии исторических QA sessions, не удаляет аудит.

Версия приложения alpha.26, API0.33.0. История дополнена фактически принятой alpha.25 из receipt:29seed/34deployments. Physical/Owner UAT и live QA login пока NOT_TESTED.

STYLE_GUIDE_PARITY: существующие Admin panel/form/button/notice и типографика. Скромная форма пароля внутри существующего входа; нового дизайн-фреймворка нет. Approximate guide, не pixel gate.

# Открытые решения и launch gates

Это журнал решений, а не второй task tracker. Наличие вопроса не блокирует несвязанные работы.

| ID | Что требуется | Рабочий подход до решения | Когда действительно блокирует | Ответственный |
|---|---|---|---|---|
| O-01 | Юридический оператор, privacy/terms, возраст пользователей | Не собирать данные детей без отдельной модели согласий. | Public real-data pilot | Owner + privacy/legal reviewer |
| O-02 | Production data-residency / legal hosting target | MVP web — Москва; MVP backend+DB — Германия. Это техническая topology, не юридическое заключение. | Public real-data pilot / PROD, не synthetic F-01 | Owner + privacy/legal reviewer + Architect |
| O-04 | iOS public login/store policy | Оценить перед App Store submission. | App Store | Owner + Architect + mobile QA |
| O-05 | Реальные форматы/шкала уровня | Уточнить до наполнения pilot cards. | Product freeze | Product/UX + Owner |
| O-06 | Organizer operational contact/SLA | Согласовать до live pilot. | Live pilot | Pilot/Growth + Product |
| O-07 | Коммерческое определение нового клиента | Не смешивать с technical attribution. | Monetization experiment | Owner + Product + Pilot |
| O-08 | Platform release dates/store accounts | API+web first; mobile after stable vertical API. | Public commitments | Owner + PM |
| O-09 | Multisport/team UI | Badminton only now. | New product scenarios | Owner + Product |
| O-10 | Payments/provider/merchant/refunds | Separate future financial contour. | Payment phase | Owner + legal/finance + Architect |
| O-11 | Нужен ли отдельный tunnel Москва ↔ Германия | Primary path — direct HTTPS with keep-alive. Измерить RTT/loss/jitter/outages; при реальной нестабильности добавить dedicated project tunnel без изменения app contracts. | Только если direct path нестабилен | Implementation + Architect |

Resolved: **O-03** — dedicated GoBadminton VK/Yandex apps, redirects and runtime credentials are Owner-approved for bounded live OAuth E2E; see `docs/decisions/OWNER_DECISION_O03_LIVE_OAUTH_V001.md`.

Внешние правила и legal/data constraints перепроверяются перед public real-data launch.

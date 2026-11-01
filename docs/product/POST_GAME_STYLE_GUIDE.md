OWNER APPROVED VISUALS · 2026-11-01 · User «Проверил запускай». Implementation authorized DEV within parent372/approved comments. Historical draft language below retained as design provenance, superseded only for visual approval. Not a claim of implementation or QA/DEV acceptance. Preserve product/privacy contracts; no public private-feedback conversion.

# Post-game UI · Owner-approved extension v1

**OWNER_APPROVED VISUALS · #372 · 2026-11-01.** Визуальное расширение Owner принял («Проверил запускай»). Не заменяет и не редактирует `SITEWIDE_UI_STYLE_GUIDE.md` или `DESKTOP_OVERLAY_STYLE_GUIDE.md`. Product model уже принят; ниже — утверждённые визуальные паттерны для DEV-переноса. Не утверждает implementation/QA/DEV acceptance.

Предмет: одна существующая игра, «Участники / Итоги», её notice/attendance/dispute/feedback, вход из MyGames/history. Нет нового shell, feed card redesign, публичного рейтинга или нового overlay engine.

## Основа

| Элемент | Использование |
|---|---|
| Typeface | Existing Onest / `--font-onest`; веса 400–700. Галерея offline использует system fallback при отсутствии локального Onest |
| Logo | Существующий `/brand/go-badminton.svg`, без перерисовки и растяжения пропорций |
| Page | `--gb-paper` #f5f6f2 |
| Text | `--gb-ink` #13221a; secondary #536159 |
| Primary action | `--gb-lime` #a7f447 + ink |
| Clarification | `--gb-purple` #7945de; фон #eee6ff, читаемый тёмный текст |
| Line | `--gb-line` #dfe4dc |
| Surface | Белая; 28px normal radius; line separators вместо вложенных карточек |
| Fields | Radius 12; min font-size 16px на mobile; видимый label, не placeholder вместо label |
| Focus | Существующий purple focus-visible, различимый на белом и lime |

Статус всегда написан словами; цвет не единственный сигнал. Absent не красный «штраф». Unknown/ожидание — нейтральные; уточнение — purple; явное согласие — спокойный lime-soft. Никаких звёзд публичного игрока.

## Page rail и иерархия

- Внешний контейнер — существующий shell и `--gb-content-max` (min 1380 / viewport minus 64). Back и H1 начинаются на линии логотипа/контента. На mobile 20px внешний inset.
- Back ≥44px; до title 16px desktop / 12px mobile. Header → content 28 / 24.
- Один H1 «Участники / Итоги». Контекст — небольшой date badge и текст о встрече, без большого hero и дублирования H1.
- H1 в прототипе 40 desktop / 29 mobile; разделы 24 / 22; основной текст 16 / 15, secondary 13. В реализации использовать ближайшие существующие типографические классы без нового token layer.
- Desktop основной panel inset 40, supporting rail ~290 (на 1024 ~230), gap 32/24. Mobile panel inset 20–24, один столбец. Не путать это с desktop overlay contracts ниже.
- Вкладки «Посещение / Уточнение / Обратная связь» — части одной страницы. Активность обозначена линией и текстом, с aria-pressed/tab semantics по существующему паттерну.

## Attendance rows

Одна строка: initials/avatar → имя + краткое состояние → фактическая отметка → «Изменить». На 390 имя переносится наверх, статус и действие располагаются следующей строкой. No private photos в демо; в продукте только уже разрешённые Avatar sources.

Сводка отделяет отмеченность, unknown и урегулирование. Не превращать summary в рейтинг или сумму, если измерения пересекаются. Для participant не показывать manager counts и attendance других людей.

«Пришли все» не означает auto-save: selector с именами, затем exact confirmation. Action label финального шага — «Да, пришли все выбранные». Выбор пуст по умолчанию. Checkbox подтверждает конкретные имена/версии, не будущий состав.

На длинном roster прокручивается страница. Если roster представлен в modal, прокручивается только его body. Нельзя вложить ещё одну scroll область в list.

## Notice / уточнение

Notice — один мягкий акцентный блок с коротким фактом и действием исправления. Не toast-only: собственная отметка и notice повторно доступны из MyGames. Удаление banner из viewport не означает acknowledgement.

В current-mark block: собственная отметка, автор/источник, дата/время/timezone, версия; unknown/version 0 не получает выдуманного автора. Открытый dispute и новая текущая версия могут сосуществовать.

History — вертикальные строки с отдельными событиями и авторством. Новая отметка не затирает прежнее возражение. Response/proposal кнопка доступна manager; independent resolution отсутствует в consumer manager view.

## Обратная связь

Адресат и видимость стоят над формой. Peer: три дружелюбных текстовых выбора, optional comment. Organization: отдельная 1–5 без обязательного score при заполненном comment. Training: только реальный training context, plain text. Private note: замок и «Только для вас», без shared/verified badge.

Полученный отзыв содержит один reply block; редактирование обновляет его, не создаёт форум. Рядом — контекстная жалоба. «Сыграть снова» остаётся отдельным действием в существующем invitation flow; выбор feedback не является отправкой.

## Overlays — сохраняется «Просторный40»

Desktop ≥1024: existing ProfileDialog normal 560, radius 28, max-height `100dvh - 48px`; content/header/footer inset 40. Header top 24/bottom 16; first chrome row min 44; gap 8; title 22/26. Shared CloseButton 44×44, glyph 24, top/right **24 от shell**. Body top/bottom 16, single overflow, `min-height:0`. Footer top 12/bottom 16, border line, actions ≥44–48.

Mobile: существующий bottom sheet, top radius 28, inset 20, safe-area footer. X остаётся в верхнем правом chrome. Footer виден при длинном выборе; body — единственный scroll. Native focus containment, Escape/backdrop/history, return focus и busy/UNKNOWN guards сохраняются по существующей семье. Галерея использует native dialog; продукт продолжает ProfileDialog, не копирует новый modal engine.

## Mobile navigation и ошибки

Существующая RootNav: Игры / Игроки / Мои игры / Сообщения. Один reserve 76 + env(safe-area-inset-bottom); последний action/list item доступен выше неё. Sheet перекрывает навигацию в modal top layer. Keyboard/visualViewport и gestures сохраняются из продукта.

Loading не выглядит как пустой факт; empty допускает unknown. Forbidden очищает данные. Conflict показывает черновик/текущую версию и отдельный reread. UNKNOWN не превращается в success: доступна проверка исходной операции, а не новый intent. Объяснения короткие и рядом с действием.

## Review boundary

Owner принял композицию, ритм, копирайт, способы выбора/исправления и mobile поведение в [галерее](https://files.anpavel.ru/projects/gobadminton/design/style-guide/postgame/20261101-astra-v1/index.html). Семантика product model, privacy и контракты не пересогласовываются. Trusted автор переносит только утверждённые визуальные паттерны в текущие компоненты; активные Guide обновляются отдельной разрешённой правкой. Данный файл фиксирует Owner-approved visuals; implementation/QA/DEV acceptance остаются отдельными gates.

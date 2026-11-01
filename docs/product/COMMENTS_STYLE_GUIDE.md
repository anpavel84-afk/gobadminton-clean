OWNER APPROVED VISUALS · 2026-11-01 · User «Проверил запускай». Implementation authorized DEV within parent372/approved comments. Historical draft language below retained as design provenance, superseded only for visual approval. Not a claim of implementation or QA/DEV acceptance. Preserve product/privacy contracts; no public private-feedback conversion.

# Comments · Style Guide extension

**DRAFT / Owner approval pending / 01.11.2026.** Предложение, не дополнение к уже утверждённым правилам. Reference: `index.html`; политика и seams: `DESIGN.md`.

## Область

Единый comments block для обычных страниц игры, площадки, публичного профиля игрока. Не применять к приватным сообщениям, чату игры, Postgame feedback, оценкам, заметкам или Radar inspector. Реализация и права пока не приняты.

## Токены и композиция

| Параметр | Значение / использование |
|---|---|
| Шрифт | Onest; локальный файл из текущего source, встроенный в HTML. Body 16 / 1.55; comment 15 / 1.65; metadata 12–13. Без имитации системного UI шрифтом меньшего размера. |
| Цвета | ink `#13221a`, secondary `#536159`, paper `#f5f6f2`, white, line `#dfe4dc`, lime `#a7f447`, lime-soft `#eaffcd`, purple `#7945de`, purple-soft `#eee6ff` — существующая палитра. |
| Поверхность | Белая, тонкая граница, radius 28. Composer/вложенные поверхности 18; поля и buttons 12. |
| Внешняя линия | Shell rail: 32 desktop / 20 mobile; общий Back/H1 не центрировать отдельно от shell. Preview max rail 1320. |
| Внутренний отступ comments | 40 desktop/tablet >720; 20 mobile ≤720. По вертикали 32 / 28 / 24. Это body panel, не overlay. |
| Ширина чтения | Main до 880, внутренняя строка до 800. При 1024 main сжимается рядом с rail 240. При ≤900 одна колонка. |
| Page rhythm | Header→content 28 desktop / 24 mobile. Section gap 24–28. Разделители между корневыми записями. |
| Отступ текста от аватара | Desktop 52 (avatar40 + gap12); mobile текст возвращается на левую линию блока для нормальной длины строки. |
| Управление | Минимум 44×44 для hit area; явный focus-visible purple. Primary submit lime, обычные действия нейтральные. |

Макет использует только эти локальные CSS-переменные; не вводить второй global token layer при реализации.

## Анатомия

`SectionHeader + count + optional compact sort → description → Composer / Auth notice → Comment list → Load more`.

Comment: `Avatar + name + date + menu → bounded text → reply disclosure → one-level thread`.

Счётчик не является рейтингом. Sort — native select, не набор больших pills; на узкой ширине может перейти на следующую строку. Больше места остаётся разговору. Длинные имена и непрерывные строки переносятся; текст не выходит за колонку.

Комментарий ограничен четырьмя строками только в длинном примере с «Читать полностью». Обычный короткий текст показывается целиком. Не обрезать содержание без раскрытия. Предложение maxLength=1000 требует принятого backend лимита.

Ответы раскрываются локально кнопкой «Показать ответы · N» с `aria-expanded`. Линия ветки 2 px, inset 18 desktop / 12 mobile. Аватар ответа 32. Ответ на ответ не создаёт новую визуальную глубину; в реализации поведение адресации требует продуктового решения.

## Composer и операции

- Label обязателен, placeholder не заменяет подпись. Textarea 16 px на mobile; перенос и вертикальный resize. Один локальный composer для новой записи плюс composer раскрытой ветки/редактирования.
- Empty whitespace не отправляется. Pending сохраняет draft и блокирует submit. Макет демонстрирует только одну операцию за раз.
- UNKNOWN не превращать в ошибку «попробуйте отправить снова». Сохранить текст, явно назвать неопределённость, показать безопасную проверку принятого operation result. Обычный reload списка не гарантирует reconciliation; production механизм здесь не придуман.
- Success показывать после подтверждённого результата. В галерее каждое подтверждение помечено «демо». Никаких автоматических уведомлений адресату не обещано.
- Edit остаётся на месте записи; отмена сохраняет прежний текст. Удаление — отдельное подтверждение. Tombstone не содержит исходный текст или скрытую персональную информацию.
- При denied/disabled скрывать защищённый body, composer и count. Само отсутствие права не маскировать под «Пока нет комментариев».

## Диалоги

Desktop ≥1024: существующий ProfileDialog normal 560, header/body/footer inset40, radius28, X44 top/right24; control row44 и title22/26 ниже. Body — единственный scroll owner, max-height `100dvh − 48px`.

Mobile ≤720: bottom sheet, radius28 сверху, inset20, X44 top/right20, safe-area footer. Используется native `<dialog>` в статическом preview; production сохраняет существующий engine и поведение. Не переносить native demo dialog в приложение как новую modal систему.

Удаление: начальный фокус на отмене, confirm выделен сдержанно. Safety: только действие на игрока, без нового comment-report target и без утверждения об автоматическом скрытии комментариев.

## Доступность и адаптивность

Семантические section/article/form, heading hierarchy, явные labels, native select/buttons, visible focus, live success/error notices. Нет hover-only действий. X имеет accessible name; закрытие native dialog по Escape возвращает фокус к триггеру, если он сохранился. После удаления фокус идёт к заголовку обсуждения.

390: read column ≈308 px внутри panel, текст записи без desktop indent; длинный заголовок/metadata переносятся, submit может растягиваться. Bottom nav учитывается отступом footer; toast выше nav. 1024: две колонки с тем же inset40. 1440: main880 и вторичная колонка. Проверка визуального overflow/zoom/virtual keyboard требует доступного браузера и остаётся NOT_RUN.

## Новое и нерешённое

**STYLE_GUIDE_GAP:** comments list + composer + thread — ограниченный новый составной паттерн из текущих surfaces/forms/list rows. Новая архитектура не требуется.

**Не утверждено:** публичность профиля/обсуждения, guest access, владельческий контроль, модерация, удаление/восстановление, лимит текста, count/order/pagination. Preview метка у player остаётся до отдельного решения. Likes/ratings/reputation/verified/notification controls отсутствуют.

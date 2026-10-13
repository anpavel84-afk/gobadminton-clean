# GoBadminton: ПМ, роли и GitHub Projects

Команды исполняет ПМ-агент на VPS, не владелец в своём терминале.
Одна продуктовая задача = один Issue. Продукт, Архитектура, UI, ПМ, Исполнение,
QA и Release оставляют решения/ссылки в этой карточке. Роль в тексте не является
доказательством отдельного GitHub-пользователя или выданных полномочий.

## Однократное подключение

```bash
export OWNER=anpavel84-afk REPO=anpavel84-afk/gobadminton-clean
gh auth status
# Для OAuth-входа gh; при GH_TOKEN права выдаются самому токену заранее.
gh auth refresh -h github.com -s project
# Сначала найти существующую доску; не создавать дубликат.
gh project list --owner "$OWNER" --format json
# Только когда подходящей доски нет:
gh project create --owner "$OWNER" --title 'GoBadminton' --format json
export PROJECT_NUMBER=1  # заменить фактическим номером из ответа
gh project link "$PROJECT_NUMBER" --owner "$OWNER" --repo "$REPO"
```

Новые поля создаются ОДИН РАЗ; перед повторным запуском сверять field-list.

```bash
gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json
gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name Stage \
  --data-type SINGLE_SELECT \
  --single-select-options 'Backlog,Ready,In progress,On DEV,QA,Ready for PROD,Released,Blocked'
gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name Role \
  --data-type SINGLE_SELECT --single-select-options 'Product,Architecture,UI,PM,Implementation,QA,Release'
for field in 'Product spec' 'Architecture spec' 'UI spec' 'CI run' 'DEV revision' 'PROD release'; do
  gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "$field" --data-type TEXT
done
```

`Stage` — каноническая стадия в примерах. CLI меняет поле, а не настройки
сохранённого визуального вида Projects. Если уже существующий вид сгруппирован
по `Status`, используйте его имя/опции либо отображайте подробные `Stage` в чате.
Для управления из чата изменение сохранённой веб-раскладки не требуется.

## Создать или продолжить Issue

Для уже существующего Radar используйте #13: не создавайте новый Issue.
Для новой задачи:

```bash
: "${PRODUCT_SPEC_URL:?immutable GitHub blob URL}"
: "${ARCH_SPEC_URL:?immutable GitHub blob URL}"
: "${UI_SPEC_URL:?immutable GitHub blob URL}"
cat > /tmp/gb-task.md <<EOF_TASK
## Результат
Пользователь видит карту площадок Москвы, в том числе находясь за границей.
## Принятые решения
Продукт: $PRODUCT_SPEC_URL
Архитектура: $ARCH_SPEC_URL
UI: $UI_SPEC_URL
## Критерии
- Видимая кнопка «Карта / Список».
- Реальный отрисованный basemap, не fallback.
- Площадки видимы без передачи личной геопозиции.
- Отсутствуют приватные метки без согласия.
## Границы
DEV — автоматически. PROD — только после поручения Owner о конкретном релизе.
## Ответственные роли
Product → Architecture → UI → PM → Implementation → QA → Release.
EOF_TASK
ISSUE_URL=$(gh issue create --repo "$REPO" --title 'Radar: рабочая карта на DEV' \
  --body-file /tmp/gb-task.md)
# Для существующей задачи вместо предыдущей команды:
# ISSUE_URL=https://github.com/anpavel84-afk/gobadminton-clean/issues/13
source scripts/chatops/projects.sh
set_select "$ISSUE_URL" Stage Ready
set_select "$ISSUE_URL" Role Implementation
set_text "$ISSUE_URL" 'Product spec' "$PRODUCT_SPEC_URL"
set_text "$ISSUE_URL" 'Architecture spec' "$ARCH_SPEC_URL"
set_text "$ISSUE_URL" 'UI spec' "$UI_SPEC_URL"
```

Каждое принятое решение привязывать к GitHub blob URL с commit SHA. Ссылки
`C:/Users/PLAN/...` и `/tmp/...` не являются долговременными входами команды.
Изменение решения публикуется новой версией и отражается в том же Issue.

## Взять задачу и запустить имеющийся CLI

Projects не является диспетчером процессов. ПМ выбирает Ready, читает задачу,
запускает CLI через доступный терминал VPS. Новый бесконечный Autopilot здесь
НЕ устанавливается. Для работы при закрытой PM-сессии нужен отдельно выбранный
поддерживаемый агентский worker; gh и канбан сами по себе его не создают.

```bash
gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --limit 1000
ISSUE=13
WT=/srv/gobadminton-chatops/worktrees/issue-$ISSUE
# Эти каталоги однократно создаются с правами НЕПРИВИЛЕГИРОВАННОГО разработчика.
(
  flock -n 9 || exit 75
  set_select "$ISSUE_URL" Stage 'In progress'
  gh issue view "$ISSUE" --repo "$REPO" --json title,body,comments
  # WT создаёт ПМ из origin/dev. CLI получает только свою рабочую копию.
  codex exec -C "$WT" --sandbox workspace-write \
    'Выполни Issue #13 по принятой спецификации. CI выполняется в Actions. Не меняй PROD, секреты, защиту workflow или деплой. Не заявляй о выполненных тестах без CI evidence.'
) 9>"/srv/gobadminton-chatops/locks/issue-$ISSUE.lock"
```

`flock` здесь лишь не даёт двум PM-сессиям на одном хосте одновременно выбрать
один Issue. При нескольких хостах эта локальная блокировка НЕ распределённая.
Нужна отдельная атомарная выдача задач либо один назначенный dispatcher.

## Переходы и отчёт

```bash
set_select "$ISSUE_URL" Stage 'On DEV'     # только после ACCEPTED
set_select "$ISSUE_URL" Role QA
set_text "$ISSUE_URL" 'CI run' "$RUN_URL"
set_text "$ISSUE_URL" 'DEV revision' "$DEV_SHA"
gh issue comment "$ISSUE" --repo "$REPO" --body-file /tmp/qa-report.md
board  # ПМ показывает вывод в чате
# После стабилизации:
set_select "$ISSUE_URL" Stage 'Ready for PROD'
# Только после фактического PROD-деплоя:
set_select "$ISSUE_URL" Stage Released
set_text "$ISSUE_URL" 'PROD release' "$RELEASE_URL"
gh issue close "$ISSUE" --repo "$REPO" --reason completed
```

Для PR в `dev` используйте `Refs #13`, не `Closes #13`: задача не должна
закрываться автоматически до продуктовой приёмки/PROD, если это её Definition of Done.

## Дождаться CI и исправить ошибку

```bash
SHA=$(git rev-parse HEAD)
gh run list --repo "$REPO" --workflow dev-deploy.yml --branch dev --commit "$SHA" \
  --json databaseId,status,conclusion,url
gh run view "$RUN_ID" --repo "$REPO" --log-failed
# На совместимой авторизации:
gh run watch "$RUN_ID" --repo "$REPO" --exit-status --interval 15
# Для токенов, с которыми run watch недоступен:
gh api "repos/$REPO/actions/runs/$RUN_ID" --jq '{head_sha,status,conclusion,html_url}'
```

Не брать «последний зелёный запуск» без проверки SHA. Исправление кода означает
новый commit/run; `gh run rerun --failed` повторяет старый код. Не более трёх
попыток одного дефекта без новой диагностики. Не устранять красные тесты их
удалением, глобальным `continue-on-error` или расширением production-доступа.

## Стабилизация и PROD

```bash
# ПМ получил решение Owner о выпуске точно проверенного DEV_SHA.
git fetch origin --tags
git switch main
git merge --ff-only origin/dev
git push origin main
TAG=v0.2.0
git tag -a "$TAG" "$DEV_SHA" -m "GoBadminton $TAG"
git push origin "$TAG"
gh release create "$TAG" --repo "$REPO" --verify-tag --notes-file /tmp/release-notes.md
```

Если fast-forward невозможен, ПМ интегрирует конфликт на отдельной ветке,
проводит этот интеграционный commit через DEV и использует его SHA. Нельзя
squash-merge в новый непроверенный SHA и притворяться, что это тот же DEV.

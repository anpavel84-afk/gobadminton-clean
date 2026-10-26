#!/bin/bash
# Шаблон внешнего ревьюера для successor_loop.py --reviewer cmd:<этот файл>
# Вызов: $0 BODY_FILE EVIDENCE_FILE   env: SL_REPO_SHA, SL_ISSUE, SL_QA_HEADER (GH_PUSH_TOKEN удалён)
# Контракт stdout (как у codex-review):
#   ВЕРДИКТ: MOZHNO|NELZYA
#   ... пункты 1–12 по REVIEWER_PROTOCOL.md ...
#   ВЕРДИКТ ДЛЯ ИСПРАВЛЕННОГО ТЕЛА: MOZHNO|NELZYA
#   REVISED_BODY_BEGIN
#   GOBADMINTON_AUTONOMY_V1
#   { ...полный JSON 7 полей... }
#   REVISED_BODY_END
# Код возврата 0 = отчёт выдан (вердикт внутри), иначе ошибка ревьюера.
# Сюда подключается ревьюер другой семьи моделей (Gemini / Antigravity) — интеграцию делает отдельная задача.
set -euo pipefail
body=$1; evidence=$2
echo "external reviewer not configured (body=$(basename "$body"), evidence=$(basename "$evidence"), sha=${SL_REPO_SHA:-?})" >&2
exit 3

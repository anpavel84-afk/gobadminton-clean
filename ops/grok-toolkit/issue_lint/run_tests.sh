#!/bin/bash
# Регрессия линтера на известных телах. Ожидание: M1d_old=FAIL, M1c=FAIL, M1e=FAIL (преемник без раздела QA, правило 19.10), M0b=не FAIL.
cd "$(dirname "$0")"; B=${BODIES:-../map_split/bodies}
ok=0
# Регрессия фиксирует базу, на которой писались тела (иначе [H] падает при каждом движении dev).
PIN_SHA=${LINT_DEV_SHA:-0c61960868b85cf40b761d953c7ea1b7565ecda9}
chk(){ python3 lint_issue.py "$B/$1.body.txt" --dev-sha "$PIN_SHA" --quiet-pass >/tmp/lint_$1.txt 2>&1; rc=$?
  if [ "$2" = FAIL ] && [ $rc -eq 1 ]; then r=OK; elif [ "$2" = NOFAIL ] && [ $rc -eq 0 ]; then r=OK; else r=ОШИБКА; ok=1; fi
  echo "$1: ожидалось $2, код=$rc -> $r"; }
chk published_94_M1d FAIL; chk published_90_M1c FAIL; chk published_92_M1e FAIL; chk draft_M0b_prereview NOFAIL; chk prepared_M1f1 NOFAIL; chk prepared_M1f2 NOFAIL; chk prepared_M1f3 NOFAIL
python3 test_stop_neg.py || ok=1
python3 test_successor_qa.py || ok=1
exit $ok

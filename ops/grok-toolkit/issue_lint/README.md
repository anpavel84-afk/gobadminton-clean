Линтер тел Issue (офлайн, ничего не публикует).
  python3 lint_issue.py BODY.txt [BODY2 ...] [--quiet-pass] [--offline] [--dev-sha SHA] [--max-files 14] [--json]
Нужен GH_PUSH_TOKEN в окружении (только чтение GitHub). Код возврата 1 при FAIL.
Регрессия: ./run_tests.sh   (тела берутся из /workspace/outputs/map_split, или BODIES=каталог)
Протокол независимого ревьюера: REVIEWER_PROTOCOL.md

Правило [Q] (19.10.2026): преемник обязан иметь раздел «Замечания QA предыдущих попыток» (пункты «#N aK sha8: … -> как учтено»). Тест: test_successor_qa.py. Сборка входа ревьюера с историей QA: make_review_input.py.

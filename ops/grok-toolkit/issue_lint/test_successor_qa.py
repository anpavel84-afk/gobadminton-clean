#!/usr/bin/env python3
"""Регрессия правила [Q]: преемник обязан содержать «Замечания QA предыдущих попыток» с учётом каждого пункта."""
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('l', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lint_issue.py'))
l = importlib.util.module_from_spec(spec); spec.loader.exec_module(l)
class Rep:
    def __init__(s): s.items = []
    def add(s, lvl, code, msg, *a): s.items.append((lvl, code))
def level(t):
    r = Rep(); l.chk_successor_qa(t, r); return [x for x, c in r.items if c == 'Q'][0]
GOOD = ("M0c: преемник M0b (#96). Замечания QA предыдущих попыток:\n"
        "- #96 a1 224ebbe3: refresh-тест мокает next/dynamic -> A3 continuity на реальных компонентах.\n"
        "- #96 a3 765aebc2: regex координат в debug-модуле -> вне scope: debug-модуль не входит в M0c.")
CASES = [
    ("Обычная задача без истории.", 'PASS'),
    ("Narrow successor of #76.", 'FAIL'),
    ("M0c заменяет #96, который припаркован.", 'FAIL'),
    ("Задача вместо #94.", 'FAIL'),
    ("По исходной постановке M0b (#96) завершилась QA FAIL после трёх попыток.", 'FAIL'),
    ("Финальная QA проверит diff; QA FAIL означает возврат автору.", 'PASS'),
    (GOOD, 'PASS'),
    ("Преемник #96. Замечания QA предыдущих попыток: будут позже.", 'FAIL'),
    ("Преемник #96. Замечания QA предыдущих попыток:\n- #96 a1 224ebbe3: нет continuity-теста.", 'FAIL'),
    ("Преемник #96. Замечания QA предыдущих попыток:\n- #96 a2 fe5a9ec8: PASS, замечаний нет -> учтено: подход сохранён.", 'PASS'),
]
bad = [(t, e, level(t)) for t, e in CASES if level(t) != e]
for t, e, g in bad: print('ОШИБКА: ожидалось', e, 'получено', g, '|', t[:70])
print(f'successor-qa: {len(CASES)-len(bad)}/{len(CASES)} ok'); sys.exit(1 if bad else 0)

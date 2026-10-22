#!/usr/bin/env python3
"""Регрессия правила [A] (условия остановки): отрицания по-русски не FAIL, настоящие условия — FAIL."""
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('l', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lint_issue.py'))
l = importlib.util.module_from_spec(spec); spec.loader.exec_module(l)
class Rep:
    def __init__(s): s.items = []
    def add(s, lvl, code, msg, *a): s.items.append((lvl, code))
def fails(t):
    r = Rep(); l.chk_stop(t, r); return any(x == ('FAIL', 'A') for x in r.items)
OK = ["NEVER stop: никаких base/remote gates.", "Нет tool -> NOT_TESTED, код остаётся в diff; это не stop и не PASS.",
      "Старые тела срывались на base-stop/remote шагах; их здесь нет.", "This task has NO stop conditions.",
      "Do not stop; leave code in the diff.", "NOT_TESTED (not a reason to stop)."]
BAD = ["Если база не совпала — stop.", "If dev is stale, stop and say BLOCKED.", "Otherwise stop.",
       "Если тесты не проходят, stop.", "Then stop and report."]
bad = [t for t in OK if fails(t)] + [t for t in BAD if not fails(t)]
for t in bad: print('ОШИБКА:', t)
print(f'stop-neg: {len(OK)+len(BAD)-len(bad)}/{len(OK)+len(BAD)} ok'); sys.exit(1 if bad else 0)

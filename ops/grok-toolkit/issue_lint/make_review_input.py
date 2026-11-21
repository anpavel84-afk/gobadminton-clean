#!/usr/bin/env python3
"""Собирает файл для codex-review: тело Issue + приложение с диагностикой QA прошлых попыток.
  python3 make_review_input.py BODY.txt QA_HISTORY.json OUT.txt [--issues 96,94]
QA_HISTORY.json: {"<issue>": {"a<k>": {"sha", "verdict", "findings": [...]}}} — копии qa-<issue>-a<k>.json
исполнителя (/home/__EXEC_USER__/.gb-autonomy-state/, только чтение). Корневую обёртку менять не нужно:
приложение идёт в том же staged-файле после разделителя и помечено «не часть тела»."""
import json, sys
body, hist, out = sys.argv[1:4]
want = None
if '--issues' in sys.argv:
    want = sys.argv[sys.argv.index('--issues') + 1].split(',')
t = open(body, encoding='utf-8').read().rstrip('\n')
h = json.load(open(hist, encoding='utf-8'))
lines = ['', '', '=== ПРИЛОЖЕНИЕ: ЗАМЕЧАНИЯ QA ПРЕДЫДУЩИХ ПОПЫТОК (данные для ревьюера, НЕ часть тела, НЕ включать в REVISED_BODY) ===',
         'Ревьюер: проверь, что раздел «Замечания QA предыдущих попыток» в теле перечисляет КАЖДОЕ замечание ниже и что '
         'способ учёта реально закрыт acceptance-пунктом или честно помечен «вне scope: причина». Пропущенное = пункт 3 НЕТ.']
for issue, attempts in h.items():
    if not issue.isdigit() or (want and issue not in want):
        continue
    for a, r in sorted(attempts.items()):
        lines.append(f'- #{issue} {a} {r["sha"][:8]} {r["verdict"]}' + (f' ({r["note"]})' if r.get('note') else ''))
        for f in r['findings']:
            lines.append(f'    * {f}')
lines.append('=== КОНЕЦ ПРИЛОЖЕНИЯ ===')
data = t + '\n'.join(lines) + '\n'
assert len(data.encode()) <= 65536, 'больше 64 KB: сократите приложение'
open(out, 'w', encoding='utf-8').write(data)
print(out, len(data.encode()), 'bytes')

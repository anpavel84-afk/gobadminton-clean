#!/bin/bash
# Юнит-тесты (stdlib) + проверка в headless Chrome (нужен playwright: python3 -m venv v; v/bin/pip install playwright pillow)
cd "$(dirname "$0")"; PY=${PY:-python3}
$PY -W ignore -m unittest discover -s tests && ${BROWSER_PY:-/tmp/pwv/bin/python} tests/browser_check.py 2>&1 | grep -E "FAIL|ALL"

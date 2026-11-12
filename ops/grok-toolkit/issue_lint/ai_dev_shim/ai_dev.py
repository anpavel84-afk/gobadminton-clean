"""Шим: lint_issue.py импортирует `ai_dev`. Здесь это validate_issue из исполнителя в этом же репозитории
(scripts/chatops/autonomous_issues.py). Можно переопределить через AI_DEV_DIR на свою копию."""
import importlib.util as _u
from pathlib import Path as _P
_src = _P(__file__).resolve().parents[4] / 'scripts' / 'chatops' / 'autonomous_issues.py'
_spec = _u.spec_from_file_location('autonomous_issues', _src)
_m = _u.module_from_spec(_spec); _spec.loader.exec_module(_m)
globals().update({k: v for k, v in vars(_m).items() if not k.startswith('__')})

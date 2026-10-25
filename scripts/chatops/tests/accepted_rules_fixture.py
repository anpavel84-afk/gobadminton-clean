"""Test-only accepted-rules fixture.

The accepted engineering rules delivered to models are the IMMUTABLE Git object
pinned by context_policy.RULES_COMMIT, not whatever revision of
docs/rules/ENGINEERING_OPERATING_MODEL.md the working tree currently carries.
Reading the working tree made the context regressions fail whenever the docs
moved ahead of the (unchanged) runtime pin. This helper never reads the working
tree file and never weakens the pin: bytes must equal RULES_SHA256/RULES_SIZE.
"""
import hashlib
from pathlib import Path
import subprocess

RULES_PATH = 'docs/rules/ENGINEERING_OPERATING_MODEL.md'
_CACHE = {}


def accepted_rules_text(root=None):
    import context_policy as C
    root = Path(root or Path(__file__).resolve().parents[3])
    key = (str(root), C.RULES_COMMIT)
    if key not in _CACHE:
        try:
            raw = subprocess.run(['git', '-C', str(root), 'show', C.RULES_COMMIT + ':' + RULES_PATH],
                                 check=True, capture_output=True, timeout=30).stdout
        except (OSError, subprocess.SubprocessError) as error:
            raise RuntimeError('accepted rules Git object %s is unavailable (shallow checkout?): %s'
                               % (C.RULES_COMMIT, error)) from error
        if len(raw) != C.RULES_SIZE or hashlib.sha256(raw).hexdigest() != C.RULES_SHA256:
            raise RuntimeError('accepted rules Git object drift')
        _CACHE[key] = raw.decode('utf-8')
    return _CACHE[key]

"""CI discovery wrapper for the offline Cursor receipt checker. No provider calls."""
import importlib.util
from pathlib import Path
import unittest


def _load():
    path = Path(__file__).resolve().parents[3] / 'docs/handoffs/cursor-author-211/test_receipt_check.py'
    spec = importlib.util.spec_from_file_location('cursor_author_receipt_checks', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_CHECKS = _load()
ValidateReceipt = _CHECKS.ValidateReceipt
CliReceiptCheck = _CHECKS.CliReceiptCheck


if __name__ == '__main__':
    unittest.main()

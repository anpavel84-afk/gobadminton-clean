#!/usr/bin/env python3
"""Offline validator for sanitized GB_CURSOR_AUTHOR_RECEIPT_V1 JSON receipts.

Dependency-free. Makes no provider, server, security-confinement, or lifecycle claims.
"""
from __future__ import annotations

import json
import math
import sys
from typing import Any

SCHEMA = "GB_CURSOR_AUTHOR_RECEIPT_V1"
MAX_BYTES = 1 << 20  # 1 MiB


def _nonempty_str(value: Any) -> bool:
    return type(value) is str and bool(value)


def _safe_rel_path(value: Any) -> bool:
    if type(value) is not str or not value or "\0" in value:
        return False
    if value.startswith("/") or value.startswith("\\"):
        return False
    # Reject Windows-style drive absolutes without treating "docs:foo" specially.
    if len(value) >= 2 and value[1] == ":" and value[0].isalpha():
        return False
    parts = value.replace("\\", "/").split("/")
    if any(part == ".." for part in parts):
        return False
    if any(part == "" for part in parts):
        return False
    return True


def _nonneg_int_or_null(value: Any) -> bool:
    if value is None:
        return True
    # bool is a subclass of int; counts must be exact int.
    return type(value) is int and value >= 0


def validate(receipt: Any) -> bool:
    """Return True iff *receipt* is a dict matching the sanitized schema subset."""
    if type(receipt) is not dict:
        return False
    if receipt.get("schema") != SCHEMA:
        return False
    if receipt.get("phase") != "imported":
        return False
    if receipt.get("requested_route") != "cursor:auto":
        return False
    if receipt.get("effective_route") != "Auto":
        return False
    if "underlying_model" not in receipt or receipt["underlying_model"] is not None:
        return False
    if "provider_internal_calls" not in receipt:
        return False
    if not _nonneg_int_or_null(receipt["provider_internal_calls"]):
        return False
    paths = receipt.get("changed_paths")
    if type(paths) is not list or not paths:
        return False
    if not all(_safe_rel_path(p) for p in paths):
        return False
    ctx = receipt.get("rules_context")
    if type(ctx) is not dict:
        return False
    if not _nonempty_str(ctx.get("commit")):
        return False
    if not _nonempty_str(ctx.get("sha256")):
        return False
    return True


def _unique_object_pairs(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError("duplicate key")
        out[key] = value
    return out


def _reject_nonfinite_constant(name: str):
    # json.loads calls this for literal NaN / Infinity / -Infinity at any depth.
    # Must raise; returning a value would silently accept non-JSON numbers.
    raise ValueError("non-finite constant")


def _reject_nonfinite_float(text: str):
    # Exponent overflow (1e999, -1e999, 1E400, -1E400) is a JSON number, not a
    # named constant. parse_constant does not see it. parse_int stays default.
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("non-finite number")
    return value


def _load_receipt(path: str) -> Any:
    with open(path, "rb") as fh:
        raw = fh.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("oversized")
    text = raw.decode("utf-8")
    return json.loads(
        text,
        object_pairs_hook=_unique_object_pairs,
        parse_constant=_reject_nonfinite_constant,
        parse_float=_reject_nonfinite_float,
    )


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("FAIL")
        return 1
    path = args[0]
    try:
        receipt = _load_receipt(path)
    except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        print("FAIL")
        return 1
    if validate(receipt):
        print("PASS")
        return 0
    print("FAIL")
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        print("FAIL")
        raise SystemExit(1)

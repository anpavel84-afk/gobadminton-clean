#!/usr/bin/env python3
"""Deterministic unit tests for sanitized GB_CURSOR_AUTHOR_RECEIPT_V1 checker."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def _load_checker():
    path = Path(__file__).resolve().with_name("receipt_check.py")
    spec = importlib.util.spec_from_file_location("receipt_check", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RC = _load_checker()


def valid_receipt(**overrides):
    base = {
        "schema": "GB_CURSOR_AUTHOR_RECEIPT_V1",
        "phase": "imported",
        "requested_route": "cursor:auto",
        "effective_route": "Auto",
        "underlying_model": None,
        "provider_internal_calls": None,
        "changed_paths": [
            "docs/handoffs/cursor-author-211/receipt_check.py",
            "docs/handoffs/cursor-author-211/test_receipt_check.py",
        ],
        "rules_context": {
            "commit": "b4a746a0b9834d80b8c65ecb9a093257f989bae7",
            "sha256": "0755f8b5eb2cce575e58137a0f0462448109d8af0173e36d67f6551342b35ba6",
        },
    }
    base.update(overrides)
    return base


def valid_receipt_with_extra_literal(literal, kind):
    """Otherwise-valid receipt plus one nonstandard constant outside required fields.

    Default json.loads accepts the constant and validate() ignores unknown keys,
    so a CLI failure here is parser rejection, not a missing schema field.
    """
    raw = json.dumps(valid_receipt(), separators=(",", ":"))
    if kind == "object":
        extra = ',"extra":{"nested":' + literal + "}"
    elif kind == "array":
        extra = ',"extra":[0,' + literal + ",1]"
    else:
        raise AssertionError(kind)
    if not raw.endswith("}"):
        raise AssertionError("receipt encoding")
    return raw[:-1] + extra + "}"


class ValidateReceipt(unittest.TestCase):
    def test_valid_sanitized_fixture(self):
        self.assertTrue(RC.validate(valid_receipt()))
        self.assertTrue(RC.validate(valid_receipt(provider_internal_calls=0)))
        self.assertTrue(RC.validate(valid_receipt(provider_internal_calls=3)))

    def test_wrong_schema_phase_and_routes(self):
        self.assertFalse(RC.validate(valid_receipt(schema="OTHER")))
        self.assertFalse(RC.validate(valid_receipt(phase="prepared")))
        self.assertFalse(RC.validate(valid_receipt(phase="validated")))
        self.assertFalse(RC.validate(valid_receipt(requested_route="codex:gpt-6.1-sol:medium")))
        self.assertFalse(RC.validate(valid_receipt(effective_route="auto")))
        self.assertFalse(RC.validate(valid_receipt(effective_route="cursor:auto")))

    def test_missing_wrong_typed_and_non_dict(self):
        self.assertFalse(RC.validate(None))
        self.assertFalse(RC.validate([]))
        self.assertFalse(RC.validate("nope"))
        receipt = valid_receipt()
        del receipt["phase"]
        self.assertFalse(RC.validate(receipt))
        self.assertFalse(RC.validate(valid_receipt(changed_paths="docs/a.py")))
        self.assertFalse(RC.validate(valid_receipt(changed_paths=[])))
        self.assertFalse(RC.validate(valid_receipt(rules_context=["commit", "sha256"])))
        self.assertFalse(RC.validate(valid_receipt(underlying_model="Auto")))
        self.assertFalse(RC.validate(valid_receipt(rules_context={"commit": "", "sha256": "abc"})))
        self.assertFalse(RC.validate(valid_receipt(rules_context={"commit": "abc", "sha256": ""})))
        self.assertFalse(RC.validate(valid_receipt(rules_context={"commit": "abc"})))

    def test_boolean_rejected_as_provider_internal_calls(self):
        self.assertFalse(RC.validate(valid_receipt(provider_internal_calls=True)))
        self.assertFalse(RC.validate(valid_receipt(provider_internal_calls=False)))
        self.assertFalse(RC.validate(valid_receipt(provider_internal_calls=-1)))
        self.assertFalse(RC.validate(valid_receipt(provider_internal_calls=1.5)))

    def test_unsafe_changed_paths(self):
        cases = [
            ["/tmp/secret.py"],
            ["../outside.py"],
            ["docs/../../etc/passwd"],
            ["C:/Windows/system32"],
            ["docs//dup.py"],
            [""],
            ["ok.py", ".."],
            ["ok.py", "/abs.py"],
        ]
        for paths in cases:
            with self.subTest(paths=paths):
                self.assertFalse(RC.validate(valid_receipt(changed_paths=paths)))


class CliReceiptCheck(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory(prefix="gb-receipt-check-")
        self.addCleanup(self._tmpdir.cleanup)
        self.dir = Path(self._tmpdir.name)

    def _write(self, name: str, data: bytes | str) -> Path:
        path = self.dir / name
        if isinstance(data, str):
            path.write_text(data, encoding="utf-8")
        else:
            path.write_bytes(data)
        return path

    def _run(self, argv):
        with mock.patch("builtins.print") as printed:
            code = RC.main(argv)
        texts = [c.args[0] for c in printed.call_args_list if c.args]
        return code, texts

    def test_cli_pass_on_valid_file(self):
        path = self._write("ok.json", json.dumps(valid_receipt()))
        code, texts = self._run([str(path)])
        self.assertEqual(code, 0)
        self.assertEqual(texts, ["PASS"])

    def test_cli_fail_wrong_route(self):
        path = self._write(
            "bad-route.json",
            json.dumps(valid_receipt(requested_route="cursor:composer")),
        )
        code, texts = self._run([str(path)])
        self.assertEqual(code, 1)
        self.assertEqual(texts, ["FAIL"])

    def test_cli_malformed_and_duplicate_json(self):
        malformed = self._write("bad.json", "{not json")
        code, texts = self._run([str(malformed)])
        self.assertEqual(code, 1)
        self.assertEqual(texts, ["FAIL"])
        self.assertTrue(all("not json" not in str(t) for t in texts))

        dup = self._write("dup.json", '{"schema":"A","schema":"B"}')
        code, texts = self._run([str(dup)])
        self.assertEqual(code, 1)
        self.assertEqual(texts, ["FAIL"])

    def test_cli_size_limit_missing_and_bad_args(self):
        oversized = self._write("big.json", b"{" + (b"x" * (RC.MAX_BYTES + 8)))
        code, texts = self._run([str(oversized)])
        self.assertEqual(code, 1)
        self.assertEqual(texts, ["FAIL"])

        missing = self.dir / "missing.json"
        code, texts = self._run([str(missing)])
        self.assertEqual(code, 1)
        self.assertEqual(texts, ["FAIL"])

        code, texts = self._run([])
        self.assertEqual(code, 1)
        self.assertEqual(texts, ["FAIL"])

        code, texts = self._run([str(self.dir / "a.json"), str(self.dir / "b.json")])
        self.assertEqual(code, 1)
        self.assertEqual(texts, ["FAIL"])

    def test_cli_does_not_echo_raw_payload_on_fail(self):
        secret = "LEAK_TOKEN_SHOULD_NOT_PRINT"
        path = self._write("secret-bad.json", "{" + secret)
        code, texts = self._run([str(path)])
        self.assertEqual(code, 1)
        joined = " ".join(str(t) for t in texts)
        self.assertNotIn(secret, joined)
        self.assertEqual(texts, ["FAIL"])

    def test_cli_reject_literal_nan_infinity_top_and_nested(self):
        literals = ("NaN", "Infinity", "-Infinity")
        for lit in literals:
            with self.subTest(placement="top", lit=lit):
                path = self._write(f"top-{lit}.json", lit)
                code, texts = self._run([str(path)])
                self.assertEqual(code, 1)
                self.assertEqual(texts, ["FAIL"])
                joined = " ".join(str(t) for t in texts)
                self.assertNotIn(lit, joined)
                self.assertNotIn("Traceback", joined)

            with self.subTest(placement="object", lit=lit):
                path = self._write(
                    f"obj-{lit}.json",
                    '{"schema":"GB_CURSOR_AUTHOR_RECEIPT_V1","x":' + lit + "}",
                )
                code, texts = self._run([str(path)])
                self.assertEqual(code, 1)
                self.assertEqual(texts, ["FAIL"])
                joined = " ".join(str(t) for t in texts)
                self.assertNotIn(lit, joined)
                self.assertNotIn("Traceback", joined)

            with self.subTest(placement="array", lit=lit):
                path = self._write(
                    f"arr-{lit}.json",
                    '{"schema":"GB_CURSOR_AUTHOR_RECEIPT_V1","xs":[1,'
                    + lit
                    + ",2]}",
                )
                code, texts = self._run([str(path)])
                self.assertEqual(code, 1)
                self.assertEqual(texts, ["FAIL"])
                joined = " ".join(str(t) for t in texts)
                self.assertNotIn(lit, joined)
                self.assertNotIn("Traceback", joined)

    def test_top_level_constants_are_parser_rejections(self):
        for lit in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(lit=lit):
                # Default decoding yields a float, and validate() then fails only
                # because the value is not a receipt dict. That is not parser proof.
                self.assertIsInstance(json.loads(lit), float)
                path = self._write(f"parser-top-{lit}.json", lit)
                with self.assertRaises(ValueError):
                    RC._load_receipt(str(path))

    def test_extra_object_and_array_constants_fail_a_valid_receipt(self):
        for lit in ("NaN", "Infinity", "-Infinity"):
            for kind in ("object", "array"):
                with self.subTest(lit=lit, kind=kind):
                    body = valid_receipt_with_extra_literal(lit, kind)
                    naive = json.loads(body)
                    self.assertTrue(RC.validate(naive))
                    self.assertIn("extra", naive)
                    path = self._write(f"extra-{kind}-{lit}.json", body)
                    with self.assertRaises(ValueError):
                        RC._load_receipt(str(path))
                    code, texts = self._run([str(path)])
                    self.assertEqual(code, 1)
                    self.assertEqual(texts, ["FAIL"])
                    joined = " ".join(str(t) for t in texts)
                    self.assertNotIn(lit, joined)
                    self.assertNotIn("Traceback", joined)

    def test_cli_accept_null_finite_and_quoted_nonfinite_strings(self):
        # Valid receipt already uses null for underlying_model / provider_internal_calls.
        path = self._write("null-ok.json", json.dumps(valid_receipt()))
        code, texts = self._run([str(path)])
        self.assertEqual(code, 0)
        self.assertEqual(texts, ["PASS"])

        finite = valid_receipt(provider_internal_calls=7)
        path = self._write("finite-ok.json", json.dumps(finite))
        code, texts = self._run([str(path)])
        self.assertEqual(code, 0)
        self.assertEqual(texts, ["PASS"])

        # Quoted string forms are legal JSON and must not trip parse_constant.
        for lit in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(lit=lit):
                body = (
                    '{"schema":"GB_CURSOR_AUTHOR_RECEIPT_V1",'
                    '"phase":"imported",'
                    '"requested_route":"cursor:auto",'
                    '"effective_route":"Auto",'
                    '"underlying_model":null,'
                    '"provider_internal_calls":null,'
                    '"changed_paths":["docs/handoffs/cursor-author-211/receipt_check.py"],'
                    '"rules_context":{"commit":"abc","sha256":"def"},'
                    '"note":"' + lit + '"}'
                )
                path = self._write(f"quoted-{lit}.json", body)
                code, texts = self._run([str(path)])
                self.assertEqual(code, 0)
                self.assertEqual(texts, ["PASS"])


if __name__ == "__main__":
    unittest.main()

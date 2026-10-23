#!/usr/bin/env python3
"""Deterministic unit tests for sanitized GB_CURSOR_AUTHOR_RECEIPT_V1 checker."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import receipt_check as RC


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
        r = valid_receipt()
        del r["phase"]
        self.assertFalse(RC.validate(r))
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


if __name__ == "__main__":
    unittest.main()

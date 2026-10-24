"""#29 F2: ALL reachable qualification entries refuse before OAuth / model charge.

Synthetic-only sentinels; never read actual OAuth, start provider, reserve
grants, change root state, or execute an unreviewed target.
"""
import contextlib
import hashlib
import json
import pathlib
import stat
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import native_antigravity as N

TASK_SHA = "8" * 64
MOCK_BINARY = b"LOCAL_SYNTHETIC_INERT_AGY_BINARY_NOT_EXECUTED"

def setup_qualification_sentinels(stack, credential_reads, preflight_calls):
    module_root = pathlib.Path(N.__file__).resolve().parent
    marker = {
        "schema": "GB_ANTIGRAVITY_QA_29_V1",
        "phase": "canary",
        "slot": "slot2",
        "executor_uid": 978,
        "canary_task_sha256": TASK_SHA,
        "admitted_models": [N.MODEL],
        "modules": {
            name: hashlib.sha256((module_root / name).read_bytes()).hexdigest()
            for name in ("native_antigravity.py", "native_guard.py")
        },
    }
    def synthetic_trusted(path, *args, **kwargs):
        if pathlib.Path(path) == N.MARKER:
            return json.dumps(marker).encode()
        if str(path) == N.AGY:
            return MOCK_BINARY
        if pathlib.Path(path) == N.AUTH:
            credential_reads.append("UNAUTHORIZED_AUTH_READ")
            raise AssertionError("OAuth must not be accessed before AppArmor precharge")
        raise AssertionError("Unexpected trusted path")
    def deny_precharge():
        preflight_calls.append("DENIED_BEFORE_AUTH")
        raise PermissionError("synthetic missing AppArmor enforce profile")

    stack.enter_context(patch.object(N, "AGY_SHA256", hashlib.sha256(MOCK_BINARY).hexdigest()))
    stack.enter_context(patch.object(N, "trusted", side_effect=synthetic_trusted))
    stack.enter_context(patch.object(N, "_verify_apparmor_precharge", side_effect=deny_precharge))
    return marker


class QualificationPrechargeEntryPoints(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.credential_reads = []
        self.preflight_calls = []
        self.marker = setup_qualification_sentinels(
            self.stack, self.credential_reads, self.preflight_calls)

    def assert_no_credential_or_dispatch(self):
        self.assertEqual(self.credential_reads, [])
        self.assertEqual(self.preflight_calls, ["DENIED_BEFORE_AUTH"])

    def test_central_qualification_precharge_precedes_credential(self):
        with self.assertRaises(N.ReviewError) as result:
            N.qualification("slot2", TASK_SHA)
        self.assertEqual(result.exception.code, "AGY_PRECHECK_FAILED")
        self.assert_no_credential_or_dispatch()

    def test_available_reports_unavailable_without_oauth(self):
        allowed, reason = N.available("slot2", TASK_SHA)
        self.assertIs(allowed, False)
        self.assertIn("AGY_PRECHECK_FAILED", reason)
        self.assert_no_credential_or_dispatch()

    def test_stage_qualify_qa_denies_before_budget_and_review(self):
        import stage
        req = {"stage": "qa_qualification", "slot": "slot2",
               "_qa_qualification": {"task_sha256": TASK_SHA}}
        store = SimpleNamespace(data={"active": None})
        context = (None, None, None, None, store, None)
        with patch.object(N, "review", side_effect=AssertionError("provider review forbidden")):
            with self.assertRaises(N.ReviewError) as result:
                stage.qualify_qa(req, {}, context)
        self.assertEqual(result.exception.code, "AGY_PRECHECK_FAILED")
        self.assertEqual(store.data, {"active": None})
        self.assert_no_credential_or_dispatch()

    def test_root_receiver_rejects_without_reservation_or_fork(self):
        import receiver
        req = {"slot": "slot2", "generation": 102, "head": "f"*40,
               "stage": "qa_qualification", "run": 1, "run_attempt": 1}
        original_journal = {"generation": 102, "pending": None, "operations": {}}
        with tempfile.TemporaryDirectory(prefix="gb-agy29-rootentry-inert-") as tmp:
            with patch.object(receiver, "STATE", pathlib.Path(tmp)), \
                 patch.object(receiver, "binding", return_value={"synthetic": True}), \
                 patch.object(receiver, "journal", return_value=original_journal), \
                 patch.object(receiver, "checkpoint", return_value=({"active": None}, {})), \
                 patch.object(receiver, "guard", return_value=None), \
                 patch.object(N, "qualification_descriptor",
                              return_value={"task_sha256": TASK_SHA}), \
                 patch.object(receiver, "live", side_effect=AssertionError("budget unavailable until precharge")), \
                 patch.object(receiver, "atomic", side_effect=AssertionError("write forbidden")), \
                 patch.object(receiver.os, "fork", side_effect=AssertionError("fork forbidden")) as fork:
                with self.assertRaises(N.ReviewError) as result:
                    receiver.qualification_request(req, {})
        self.assertEqual(result.exception.code, "AGY_PRECHECK_FAILED")
        self.assertEqual(original_journal["operations"], {})
        self.assertIsNone(original_journal["pending"])
        fork.assert_not_called()
        self.assert_no_credential_or_dispatch()


class RootPrechargeIdentityContract(unittest.TestCase):
    def test_root_verified_probe_runs_as_actual_slot2_uid_gid(self):
        import native_antigravity as A
        with tempfile.TemporaryDirectory(prefix="gb-agy29-probeidentity-") as tmp:
            policy = pathlib.Path(tmp) / "reviewed-policy"
            policy.write_bytes(pathlib.Path(__file__).resolve().parents[1]
                               .joinpath("ops/gb_agy_runtime.apparmor").read_bytes())
            policy.chmod(0o600)
            expected = hashlib.sha256(policy.read_bytes()).hexdigest()
            # GitHub Actions runner does not have slot2 UID978; root metadata
            # and POSIX identity are synthetic here, NOT evidence of enforcement.
            rootfile = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=1)
            account = SimpleNamespace(pw_name="gb-slot2", pw_gid=968)
            with patch.object(A, "APPARMOR_POLICY_FILE", policy), \
                 patch.object(A, "APPARMOR_POLICY_SHA256", expected), \
                 patch.object(A.os, "fstat", return_value=rootfile), \
                 patch.object(A.os, "geteuid", return_value=0), \
                 patch("pwd.getpwuid", return_value=account), \
                 patch.object(A.subprocess, "run", return_value=SimpleNamespace(
                     returncode=0, stdout=b"978:968:gb-agy-runtime (enforce)\n")) as run:
                A._verify_apparmor_precharge()
            kwargs = run.call_args.kwargs
            self.assertEqual(kwargs["user"], 978)
            self.assertEqual(kwargs["group"], 968)
            self.assertEqual(kwargs["extra_groups"], [])
            self.assertEqual(kwargs["timeout"], 10)
            self.assertTrue(callable(kwargs["preexec_fn"]))

    def test_wrong_precharge_identity_fails_without_launch(self):
        with tempfile.TemporaryDirectory(prefix="gb-agy29-wrong-identity-") as tmp:
            policy = pathlib.Path(tmp) / "reviewed-policy"
            policy.write_bytes(pathlib.Path(__file__).resolve().parents[1]
                               .joinpath("ops/gb_agy_runtime.apparmor").read_bytes())
            policy.chmod(0o600)
            expected = hashlib.sha256(policy.read_bytes()).hexdigest()
            rootfile = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=1)
            with patch.object(N, "APPARMOR_POLICY_FILE", policy), \
                 patch.object(N, "APPARMOR_POLICY_SHA256", expected), \
                 patch.object(N.os, "fstat", return_value=rootfile), \
                 patch.object(N.os, "geteuid", return_value=1002), \
                 patch.object(N.subprocess, "run",
                              side_effect=AssertionError("wrong UID cannot launch probe")):
                with self.assertRaises(PermissionError):
                    N._verify_apparmor_precharge()

if __name__ == "__main__":
    unittest.main()

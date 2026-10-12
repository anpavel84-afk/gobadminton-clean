"""Focused contract policy regression: only declared E1 proof commands can omit Idempotency-Key."""
import copy
import json
import unittest
from pathlib import Path
from check_foundation import contract_errors


class EmailProofContractPolicy(unittest.TestCase):
    def test_narrow_exception_and_required_binding_headers(self):
        document = json.loads((Path(__file__).resolve().parent.parent / "packages/contracts/openapi.json").read_text())
        original, _ = contract_errors(document)
        self.assertFalse(any("/email/" in finding for finding in original))
        route = "/auth/email/challenges/{challengeId}/verify"
        for changed in ("marker", "origin", "flow", "other_route"):
            candidate = copy.deepcopy(document)
            operation = candidate["paths"][route]["post"]
            if changed == "marker":
                operation.pop("x-auth-challenge-protocol")
            elif changed in ("origin", "flow"):
                name = "Origin" if changed == "origin" else "X-GB-Email-Auth"
                operation["parameters"] = [p for p in operation["parameters"] if p.get("name") != name]
            else:
                candidate["paths"]["/games/{challengeId}/invented"] = candidate["paths"].pop(route)
            findings, _ = contract_errors(candidate)
            self.assertEqual(len(findings), len(original) + 1)
            self.assertIn("business mutation needs required Idempotency-Key", findings[-1])


if __name__ == "__main__":
    unittest.main()

"""Strict TEST PLAN inside the existing bounded acceptance string."""
import argparse
import json
from pathlib import Path

from catalog import load_catalog, unique_object
from tier_classifier import TIERS, classify, risk_to_tier, tier_to_risk, STRICT_GROUPS

BEGIN = "<!-- GB_TEST_PLAN_V1 -->"
END = "<!-- /GB_TEST_PLAN_V1 -->"
RERUN = "same fingerprint: no rerun without reason code"
EVIDENCE = "NOT_TESTED/ENV_ERROR never counts as PASS"
FIELDS = {"tier", "risk", "visual_qa", "groups", "rerun_policy", "needs_independent_qa", "evidence_rule"}


class PlanError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _validate(plan):
    if not isinstance(plan, dict) or set(plan) != FIELDS:
        raise PlanError("BAD_FIELD")
    if plan["tier"] not in TIERS:
        raise PlanError("BAD_TIER")
    if (plan["risk"] != tier_to_risk(plan["tier"])
            or type(plan["visual_qa"]) is not bool
            or plan["needs_independent_qa"] is not True
            or plan["rerun_policy"] != RERUN or plan["evidence_rule"] != EVIDENCE):
        raise PlanError("BAD_FIELD")
    groups = plan["groups"]
    if (not isinstance(groups, list) or not groups or any(not isinstance(g, str) for g in groups)
            or len(groups) != len(set(groups))):
        raise PlanError("BAD_FIELD")
    known, _ = load_catalog()
    if any(g not in known for g in groups):
        raise PlanError("UNKNOWN_GROUP")
    return plan


def render(plan):
    _validate(plan)
    text = BEGIN + "\n" + json.dumps(plan, sort_keys=True, separators=(",", ":")) + "\n" + END
    if len(text) > 1200:
        raise PlanError("BAD_FIELD")
    return text


def _span(text):
    starts, ends = text.count(BEGIN), text.count(END)
    if starts > 1 or ends > 1:
        raise PlanError("DUPLICATE_BLOCK")
    if not starts and not ends:
        raise PlanError("MISSING_TEST_PLAN")
    if starts != 1 or ends != 1 or text.index(END) < text.index(BEGIN):
        raise PlanError("BAD_FIELD")
    return text.index(BEGIN), text.index(END) + len(END)


def parse(text):
    if len(text) > 6000:
        raise PlanError("ACCEPTANCE_TOO_LONG")
    start, end = _span(text)
    if end - start > 1200:
        raise PlanError("BAD_FIELD")
    try:
        plan = json.loads(text[start + len(BEGIN):end - len(END)], object_pairs_hook=unique_object)
    except (ValueError, TypeError) as exc:
        raise PlanError("BAD_FIELD") from exc
    return _validate(plan)


def attach(acceptance, plan):
    block = render(plan)
    if BEGIN in acceptance or END in acceptance:
        start, end = _span(acceptance)
        result = acceptance[:start] + block + acceptance[end:]
    else:
        result = acceptance + ("\n" if acceptance and not acceptance.endswith("\n") else "") + block
    if len(result) > 6000:
        raise PlanError("ACCEPTANCE_TOO_LONG")
    return result


def plan_for_changes(changes, risk=None):
    derived = classify(changes)
    tier, groups = derived["tier"], list(derived["required_groups"])
    if risk is not None:
        floor = risk_to_tier(risk)
        if TIERS.index(floor) > TIERS.index(tier):
            tier = floor
            if tier == "T3":
                groups = list(STRICT_GROUPS)
            elif tier == "T2" and "foundation" not in groups:
                groups.insert(0, "foundation")
    return dict(tier=tier, risk=tier_to_risk(tier), visual_qa=derived["visual_qa"],
                groups=groups, rerun_policy=RERUN, needs_independent_qa=True, evidence_rule=EVIDENCE)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("render")
    create.add_argument("--paths-file", required=True)
    create.add_argument("--risk", choices=("routine", "complex", "critical"))
    check = commands.add_parser("check")
    check.add_argument("--acceptance-file", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "render":
            print(render(plan_for_changes(json.loads(Path(args.paths_file).read_text()), args.risk)))
        else:
            text = Path(args.acceptance_file).read_text()
            if len(text) > 6000:
                raise PlanError("ACCEPTANCE_TOO_LONG")
            parse(text)
            print("TEST_PLAN_OK")
        return 0
    except (OSError, ValueError, TypeError) as exc:
        print(exc.code if isinstance(exc, PlanError) else "BAD_INPUT")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

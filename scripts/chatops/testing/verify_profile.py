"""Offline check of declared risk against raw Git paths, modes and statuses."""
import argparse
import json
import re
import subprocess
from pathlib import Path

from plan_block import PlanError, parse
from tier_classifier import TIERS, verify_declared


def diff_changes(base, head, repo=None):
    # Resolve to immutable commit IDs before diff; revisions cannot become options.
    revisions = []
    for revision in (base, head):
        revisions.append(subprocess.run(
            ["git", "rev-parse", "--verify", "--end-of-options", revision + "^{commit}"],
            cwd=repo, capture_output=True, check=True, timeout=30,
        ).stdout.decode().strip())
    raw = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "diff", "--raw", "-z", "-M", "--no-abbrev",
         "--no-ext-diff", "--no-textconv", *revisions, "--"],
        cwd=repo, capture_output=True, check=True, timeout=30,
    ).stdout
    return parse_raw_diff(raw)


def parse_raw_diff(raw):
    tokens = iter(raw.split(b"\0"))
    changes = []
    for header in tokens:
        if not header:
            continue
        match = re.fullmatch(rb":([0-7]{6}) ([0-7]{6}) [0-9a-f]+ [0-9a-f]+ ([AMDRT])(?:[0-9]+)?", header)
        if not match:
            raise ValueError("BAD_RAW_DIFF")
        old, mode, status = (part.decode() for part in match.groups())
        try:
            names = [next(tokens)]
            if status == "R":
                names.append(next(tokens))
        except StopIteration as exc:
            raise ValueError("BAD_RAW_DIFF") from exc
        # Both ends of a rename matter: moving out of a protected path cannot lower risk.
        for name in names:
            change = dict(path=name.decode("utf-8"), status=status, old_mode=old, mode=mode)
            if status == "R":
                change["old_path"] = names[0].decode("utf-8")
            changes.append(change)
    return changes


def verify(base, head, declared, acceptance=None, repo=None):
    result = verify_declared(declared, diff_changes(base, head, repo))
    try:
        if acceptance is not None and len(acceptance) > 6000:
            raise PlanError("ACCEPTANCE_TOO_LONG")
        plan = parse(acceptance or "")
        if plan["tier"] != declared:
            raise PlanError("PLAN_TIER_MISMATCH")
        missing = set(result["derived"]["required_groups"]) - set(plan["groups"])
        if missing:
            raise PlanError("MISSING_REQUIRED_GROUPS")
        if result["derived"]["visual_qa"] and not plan["visual_qa"]:
            raise PlanError("VISUAL_QA_REQUIRED")
    except PlanError as exc:
        result["ok"] = False
        result["reasons"].insert(0, exc.code)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--declared", required=True, choices=TIERS)
    parser.add_argument("--acceptance-file")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        acceptance = Path(args.acceptance_file).read_text() if args.acceptance_file else None
        result = verify(args.base, args.head, args.declared, acceptance)
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(json.dumps(dict(ok=False, reasons=[str(exc)[:160]])) if args.json else "BAD_INPUT")
        return 2
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print("PROFILE_OK" if result["ok"] else "PROFILE_VIOLATION")
        print("declared=" + args.declared + " derived=" + result["derived"]["tier"])
        for reason in result["reasons"][:25]:
            print(reason.replace("\n", "\\n").replace("\r", "\\r"))
        if len(result["reasons"]) > 25:
            print("... more reasons in --json")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Conservative path/mode risk floors. No diff-size or runtime authority."""
import re
from pathlib import PurePosixPath

TIERS = ("T0", "T1", "T2", "T3")
RISK_TIERS = {"routine": "T1", "complex": "T2", "critical": "T3"}
CRITICAL_NAME = re.compile(
    r"budget|admission|resolver|parser|sandbox|permission|privacy|secret|token|policy|qualification",
    re.I,
)
CRITICAL_PREFIXES = (
    ".github/workflows/", "scripts/chatops/actions_train/",
    "scripts/chatops/planning/", "scripts/chatops/ops/", "scripts/chatops/server/",
    "scripts/chatops/testing/", "docs/rules/", ".cursor/", "apps/api/migrations/",
    "packages/contracts/",
) + tuple("apps/api/src/" + name + "/" for name in (
    "auth", "restrictions", "safety", "moderation", "game-moderation", "database",
))
CRITICAL_FILES = {"AGENTS.md", "apps/api/src/tokens.ts",
                  "scripts/chatops/autonomous_issues.py", "scripts/chatops/migration-ci.py"}
STRICT_GROUPS = ("foundation", "chatops_receiver_actions_train", "chatops_phase",
                 "ci_source_api", "ci_source_web",
                 "ci_source_admin", "ci_source_contracts", "ci_database", "ci_receiver")


def risk_to_tier(risk):
    if risk not in RISK_TIERS:
        raise ValueError("BAD_RISK")
    return RISK_TIERS[risk]


def tier_to_risk(tier):
    if tier not in TIERS:
        raise ValueError("BAD_TIER")
    return {"T0": "routine", "T1": "routine", "T2": "complex", "T3": "critical"}[tier]


def is_test(path):
    name = PurePosixPath(path).name
    return bool(re.fullmatch(r"test_[A-Za-z0-9_]+\.py", name)
                or re.search(r"\.(test|spec)\.[cm]?[jt]sx?$", name))


def critical_path(path):
    return (path in CRITICAL_FILES or path.startswith(CRITICAL_PREFIXES)
            or bool(CRITICAL_NAME.search(PurePosixPath(path).name))
            or bool(re.fullmatch(r"scripts/chatops/[^/]+\.sh", path)))


def _file_tier(path):
    if critical_path(path):
        return 3, "CRITICAL_PATH"
    if is_test(path):
        return 1, "TEST"
    if ((path.startswith("docs/") and path.endswith(".md"))
            or re.fullmatch(r"README(?:[._-][^/.]+)*\.(?:md|rst|txt)", PurePosixPath(path).name, re.I)
            or PurePosixPath(path).name.upper() == "README"):
        return 0, "DOCS"
    if re.match(r"apps/(api|web|admin)/src/", path):
        return 2, "PRODUCT_SOURCE"
    if ("receiver" in path.lower() or re.search(r"(^|/)(db|database)(/|[._-])", path.lower())
            or path.endswith(".sql")):
        return 2, "DB_RECEIVER_DEPENDENCY"
    # Known script/library consumers. Unrecognised locations/configs rise from T1 to T2.
    if (path.startswith(("scripts/", "packages/"))
            and PurePosixPath(path).suffix in {".py", ".ts", ".js", ".mjs", ".tsx"}):
        return 1, "MODULE"
    return 2, "UNKNOWN_PATH_RAISED"


def classify(changes):
    if not isinstance(changes, list) or not changes:
        raise ValueError("EMPTY_CHANGES")
    level, visual = 0, False
    reasons, packages, modules, paths = set(), set(), set(), set()
    for change in changes:
        if not isinstance(change, dict):
            raise ValueError("BAD_CHANGE")
        path, status = change.get("path"), change.get("status")
        if (not isinstance(path, str) or not path or "\x00" in path or "\\" in path
                or path.startswith("/") or any(p in {"", ".", ".."} for p in path.split("/"))
                or status not in {"A", "M", "D", "R", "T"}):
            raise ValueError("BAD_CHANGE")
        mode, old_mode = change.get("mode", "100644"), change.get("old_mode", "100644")
        if not all(isinstance(m, str) and re.fullmatch(r"[0-7]{6}", m)
                   for m in (mode, old_mode)):
            raise ValueError("BAD_MODE")
        rank, reason = _file_tier(path)
        if status in {"D", "T"} or mode != "100644" or (
                old_mode != "100644" and not (status == "A" and old_mode == "000000")):
            rank, reason = 3, "DELETE_MODE_OR_TYPE"
        level = max(level, rank)
        reasons.add(reason + ":" + path)
        paths.add(path)
        visual |= bool(re.match(r"apps/(web|admin)/src/", path) and (
            "/components/" in path or "/popups/" in path
            or PurePosixPath(path).suffix in {".css", ".scss", ".sass", ".less", ".tsx"}))
        parts = path.split("/")
        if not path.startswith("docs/"):
            packages.add("/".join(parts[:2]) if parts[0] in {"apps", "packages"} else parts[0])
        if rank > 0 and not is_test(path):
            modules.add(path)
    if len(packages) > 1 or len(modules) > 1:
        level = max(level, 2)
        reasons.add("MULTI_PACKAGE_OR_MODULE")
    if level == 3:
        groups = list(STRICT_GROUPS)
    elif level == 0:
        groups = ["foundation"]
    else:
        groups = ["foundation"] if level == 2 else []
        if any(p.endswith(".py") for p in paths):
            groups.append("targeted_py")
        for package in ("api", "web", "admin", "contracts"):
            prefix = "packages/contracts/" if package == "contracts" else "apps/" + package + "/"
            if any(p.startswith(prefix) for p in paths):
                groups.append("ci_source_" + package)
        if any("DB_RECEIVER_DEPENDENCY:" in r for r in reasons):
            groups.extend(("ci_database", "ci_receiver"))
        if not groups:
            groups = ["foundation"]
    return dict(tier=TIERS[level], reasons=sorted(reasons), visual_qa=visual,
                critical=level == 3, required_groups=groups, needs_independent_qa=True)


def verify_declared(declared_tier, changes):
    if declared_tier not in TIERS:
        raise ValueError("BAD_TIER")
    derived = classify(changes)
    delta = TIERS.index(declared_tier) - TIERS.index(derived["tier"])
    reasons = list(derived["reasons"])
    if delta:
        reasons.insert(0, "UNDER_DECLARED" if delta < 0 else "OVER_DECLARED")
    return dict(ok=delta >= 0, derived=derived, reasons=reasons)

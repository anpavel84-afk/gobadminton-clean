"""Small closed catalog reader shared by the offline tools."""
import json
import re
from pathlib import Path, PurePosixPath
from safe_io import read_bytes

DEFAULT_CATALOG = Path(__file__).with_name("test_groups.json")
FIELDS = {"id", "description", "argv", "cwd", "timeout_s", "tiers", "env_flags", "kind"}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("DUPLICATE_KEY")
        result[key] = value
    return result


def load_catalog(path=DEFAULT_CATALOG):
    raw = read_bytes(path, code="UNSAFE_CATALOG")
    doc = json.loads(raw, object_pairs_hook=unique_object)
    if (not isinstance(doc, dict) or set(doc) != {"schema", "groups"}
            or doc["schema"] != "GB_TEST_GROUPS_V1" or not isinstance(doc["groups"], list)):
        raise ValueError("BAD_CATALOG")
    groups = {}
    for group in doc["groups"]:
        if not isinstance(group, dict) or set(group) != FIELDS:
            raise ValueError("BAD_CATALOG")
        gid, argv, cwd = group["id"], group["argv"], group["cwd"]
        if (not isinstance(gid, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", gid)
                or gid in groups or not isinstance(group["description"], str)
                or not isinstance(argv, list) or not argv
                or any(not isinstance(a, str) or not a or "\x00" in a for a in argv)
                or not isinstance(cwd, str) or not cwd or "\\" in cwd
                or PurePosixPath(cwd).is_absolute() or ".." in PurePosixPath(cwd).parts
                or group["kind"] not in {"local", "ci_only"}
                or type(group["timeout_s"]) is not int or group["timeout_s"] <= 0):
            raise ValueError("BAD_CATALOG")
        for field, pattern in (("tiers", r"T[0-3]"), ("env_flags", r"[A-Za-z_][A-Za-z0-9_]*")):
            values = group[field]
            if (not isinstance(values, list) or any(not isinstance(v, str)
                    or not re.fullmatch(pattern, v) for v in values)
                    or len(values) != len(set(values))):
                raise ValueError("BAD_CATALOG")
        groups[gid] = group
    if not groups:
        raise ValueError("BAD_CATALOG")
    return groups, raw

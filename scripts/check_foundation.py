#!/usr/bin/env python3
"""Dependency-free, deliberately bounded foundation checks, not runtime QA."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path.cwd().resolve()  # Installed checker validates the slot worktree (cwd).
METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
MUTATIONS = {"post", "put", "patch", "delete"}
REQUIRED = [
    "README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "docs/README.md",
    "docs/manifest/OWNER_DECISIONS.md", "docs/manifest/PROJECT_MANIFEST.md",
    "docs/manifest/OPEN_DECISIONS.md", "docs/architecture/OVERVIEW.md",
    "docs/architecture/STACK.md", "docs/architecture/MODULE_BOUNDARIES.md",
    "docs/domain/MODEL.md", "docs/domain/STATES_AND_INVARIANTS.md",
    "docs/domain/PERMISSIONS.md", "docs/data/DATA_MODEL.md",
    "docs/api/API_POLICY.md", "docs/integrations/AUTH.md",
    "docs/integrations/PAYMENTS_FUTURE.md", "docs/platforms/IOS_ANDROID.md",
    "docs/security/SECURITY_AND_PRIVACY.md", "docs/operations/DEPLOYMENT_AND_RECOVERY.md",
    "docs/quality/TEST_STRATEGY.md", "docs/quality/ACCEPTANCE_MATRIX.md",
    "docs/delivery/IMPLEMENTATION_SLICES.md", "docs/delivery/FOUNDATION_HANDOFF.md",
    "docs/governance/TEAM.md", "docs/governance/BOOTSTRAP.md",
    "docs/reference/SOURCES.md", "docs/reference/PRESENTATION_BRIEF.md",
    "docs/decisions/README.md", "packages/contracts/openapi.json",
] + [f"apps/{name}/README.md" for name in ("web", "mobile", "api", "worker", "admin")] + [
    f"packages/{name}/README.md" for name in ("domain", "contracts", "sdk", "design-tokens", "tooling")
]


def repository_files() -> list[Path]:
    try:
        result = subprocess.run(
            ["git", "ls-files", "-z"], cwd=ROOT, check=True,
            capture_output=True, timeout=10,
        )
        return [ROOT / name for name in result.stdout.decode("utf-8").split("\0") if name]
    except (OSError, subprocess.SubprocessError, UnicodeError):
        excluded = {".git", "node_modules", ".next", ".expo", ".venv", "dist", "build"}
        return [p for p in ROOT.rglob("*") if p.is_file() and not excluded.intersection(p.relative_to(ROOT).parts)]


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    out: dict = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def resolve_ref(document: dict, reference: str) -> object:
    if not reference.startswith("#/"):
        raise ValueError(f"only local JSON refs supported by this check: {reference}")
    node: object = document
    for token in reference[2:].split("/"):
        key = unquote(token).replace("~1", "/").replace("~0", "~")
        if isinstance(node, list):
            node = node[int(key)]
        elif isinstance(node, dict):
            node = node[key]
        else:
            raise ValueError(f"ref walks into scalar: {reference}")
    return node


def all_refs(node: object):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref":
                yield value
            else:
                yield from all_refs(value)
    elif isinstance(node, list):
        for value in node:
            yield from all_refs(value)


def dereference(document: dict, node: dict) -> dict:
    seen: set[str] = set()
    while "$ref" in node:
        ref = node["$ref"]
        if ref in seen:
            raise ValueError(f"cyclic parameter ref: {ref}")
        seen.add(ref)
        node = resolve_ref(document, ref)
        if not isinstance(node, dict):
            raise ValueError(f"expected object ref: {ref}")
    return node


# Clean issue #23: bounded set of exact existing proof/bodyless operations only
ADMIN_PROOF_ROUTES = {
    "/admin/auth/{provider}/start",
    "/admin/auth/webauthn/options",
    "/admin/auth/webauthn/verify",
}
BODYLESS_DELETES = {
    "/me/linked-providers/{provider}", "/me/sessions/{sessionId}", "/me/avatar",
}


def admin_proof_exemption(document: dict, route: str, method: str,
                          operation: dict, headers: dict) -> bool:
    if (method != "post" or route not in ADMIN_PROOF_ROUTES
            or operation.get("x-auth-challenge-protocol") != "admin-bound-single-use-v1"):
        return False
    origin = headers.get("origin", {})
    if (origin.get("required") is not True
            or origin.get("schema", {}).get("type") != "string"
            or origin.get("description") != "Exact isolated ADMIN_ORIGIN; consumer origins rejected."):
        return False
    if route == "/admin/auth/{provider}/start":
        return operation.get("security") == []
    # Explicit OR alternatives, never inherited consumer credentials or anonymous access.
    security = operation.get("security")
    if (not isinstance(security, list) or len(security) != 2
            or {"AdminSessionCookie": []} not in security
            or {"AdminMfaTicket": []} not in security
            or headers.get("x-csrf-token", {}).get("required") is not True):
        return False
    schemes = document.get("components", {}).get("securitySchemes", {})
    return all(
        all(schemes.get(name, {}).get(key) == value for key, value in {
            "type": "apiKey", "in": "cookie", "name": cookie,
        }.items())
        for name, cookie in (
            ("AdminSessionCookie", "__Host-gb_admin_session"),
            ("AdminMfaTicket", "__Host-gb_admin_mfa"),
        )
    )


def consumer_oauth_link_exemption(document: dict, route: str, method: str,
                                  operation: dict, headers: dict) -> bool:
    """Only the actual cookie/session-bound OAuth initiation, never a business receipt."""
    if (method != "post" or route != "/me/linked-providers/{provider}/link"
            or operation.get("x-auth-challenge-protocol") != "consumer-oauth-link-bound-single-use-v1"
            or operation.get("security") != [{"cookieSession": []}]):
        return False
    origin = headers.get("origin", {})
    csrf = headers.get("x-csrf-token", {})
    if (origin.get("required") is not True
            or origin.get("schema", {}).get("type") != "string"
            or origin.get("description") != "Exact allowed consumer web Origin; validated by requireCookieMutation."
            or csrf.get("required") is not True
            or csrf.get("schema", {}).get("type") != "string"):
        return False
    scheme = document.get("components", {}).get("securitySchemes", {}).get("cookieSession", {})
    return all(scheme.get(key) == value for key, value in {
        "type": "apiKey", "in": "cookie", "name": "__Host-gb_session",
    }.items())


def markdown_errors(path: Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    visible: list[str] = []
    fence: str | None = None
    for line in text.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            current = marker.group(1)
            if fence is None:
                fence = current
            elif current[0] == fence[0] and len(current) >= len(fence):
                fence = None
            continue
        if fence is None:
            visible.append(line)
    if fence is not None:
        errors.append(f"{path.relative_to(ROOT)}: unclosed code fence")
    for target in re.findall(r"\[[^\]\n]+\]\(([^)\n]+)\)", "\n".join(visible)):
        target = target.strip().split(' "', 1)[0].strip("<>")
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        dest = (path.parent / unquote(parsed.path)).resolve()
        if not dest.is_relative_to(ROOT) or not dest.exists():
            errors.append(f"{path.relative_to(ROOT)}: missing/out-of-repo local path {target}")
    return errors


def contract_errors(document: dict) -> tuple[list[str], int]:
    errors: list[str] = []
    if document.get("openapi") != "3.1.1":
        errors.append("contract: expected selected OpenAPI 3.1.1")
    if document.get("x-document-status") != "DESIGN_DRAFT":
        errors.append("contract: update checker deliberately when API graduates from DESIGN_DRAFT")
    for server in document.get("servers", []):
        host = urlsplit(server.get("url", "")).hostname or ""
        if not host.endswith(".invalid"):
            errors.append("draft contract: server must be an explicit .invalid placeholder")
    for ref in all_refs(document):
        try:
            resolve_ref(document, ref)
        except (KeyError, ValueError, TypeError, IndexError) as exc:
            errors.append(f"contract: unresolved ref {ref}: {exc}")
    ids: set[str] = set()
    schemes = document.get("components", {}).get("securitySchemes", {})
    for route, item in document.get("paths", {}).items():
        if not route.startswith("/"):
            errors.append(f"contract: invalid route {route}")
        expected = set(re.findall(r"\{([^}]+)\}", route))
        for method, operation in item.items():
            if method not in METHODS:
                continue
            label = f"{method.upper()} {route}"
            oid = operation.get("operationId")
            if not isinstance(oid, str) or not oid or oid in ids:
                errors.append(f"{label}: missing/duplicate operationId")
            else:
                ids.add(oid)
            responses = operation.get("responses", {})
            # Auth browser redirects are successful 3xx outcomes.
            if not responses or not any(
                str(code).startswith("2") or str(code).startswith("3")
                for code in responses
            ):
                errors.append(f"{label}: missing successful response")
            try:
                parameters = [dereference(document, p) for p in item.get("parameters", []) + operation.get("parameters", [])]
                paths = {p["name"] for p in parameters if p.get("in") == "path" and p.get("required") is True}
                if paths != expected:
                    errors.append(f"{label}: declared path parameters differ from placeholders")
                headers = {p["name"].lower(): p for p in parameters if p.get("in") == "header"}
                # Email proof commands deliberately cannot replay a session credential.
                # This narrow protocol is declared by E1, not a generic mutation escape.
                email_proof_commands = {
                    "/auth/email/challenges", "/auth/email/challenges/{challengeId}/resend",
                    "/auth/email/challenges/{challengeId}/verify",
                    "/me/auth-methods/email/link/challenges",
                    "/me/auth-methods/email/link/challenges/{challengeId}/resend",
                    "/me/auth-methods/email/link/challenges/{challengeId}/verify",
                    '/me/auth-methods/email/change/current/challenges',
                    '/me/auth-methods/email/change/current/challenges/{challengeId}/resend',
                    '/me/auth-methods/email/change/current/challenges/{challengeId}/verify',
                    '/me/auth-methods/email/change/challenges',
                    '/me/auth-methods/email/change/challenges/{challengeId}/resend',
                    '/me/auth-methods/email/change/challenges/{challengeId}/verify',

                    '/auth/email/challenges/{challengeId}/status',
                    '/me/auth-methods/email/link/challenges/{challengeId}/status',
                    '/me/auth-methods/email/change/current/challenges/{challengeId}/status',
                    '/me/auth-methods/email/change/challenges/{challengeId}/status',
                }
                email_proof = (
                    method == "post" and route in email_proof_commands
                    and operation.get("x-auth-challenge-protocol") == "bound-single-use-v1"
                    and headers.get("origin", {}).get("required") is True
                    and headers.get("x-gb-email-auth", {}).get("required") is True
                )
                if method in MUTATIONS:
                    # Deliberately admitted private read POSTs cannot persist geo receipts.
                    read_post = method == "post" and route in {"/players/query", "/players/query/map"} and operation.get("x-operation-kind") == "authenticated-read"
                    if read_post and "idempotency-key" in headers:
                        errors.append(f"{label}: private read must not require a durable command receipt")
                    if (not read_post and not email_proof
                            and not admin_proof_exemption(document, route, method, operation, headers)
                            and not consumer_oauth_link_exemption(document, route, method, operation, headers)
                            and not headers.get("idempotency-key", {}).get("required")):
                        errors.append(f"{label}: business mutation needs required Idempotency-Key")
                    if "x-csrf-token" not in headers:
                        errors.append(f"{label}: cookie mutation needs declared CSRF behavior")
                    body = operation.get("requestBody", {})
                    bodyless_delete = method == "delete" and route in BODYLESS_DELETES and "requestBody" not in operation
                    if not bodyless_delete and not body.get("required"):
                        errors.append(f"{label}: expected explicit required command body")
                for choice in operation.get("security", document.get("security", [])):
                    for scheme in choice:
                        if scheme not in schemes:
                            errors.append(f"{label}: unknown security scheme {scheme}")
            except (KeyError, ValueError, TypeError, IndexError) as exc:
                errors.append(f"{label}: malformed parameter/security structure: {exc}")
    if not ids:
        errors.append("contract: no operations")
    schemas = document.get("components", {}).get("schemas", {})
    for name, schema in schemas.items():
        if schema.get("type") == "object":
            missing = set(schema.get("required", [])) - set(schema.get("properties", {}))
            if missing:
                errors.append(f"schema {name}: required properties not declared: {sorted(missing)}")
    return errors, len(ids)


def main() -> int:
    errors = [f"required file missing: {name}" for name in REQUIRED if not (ROOT / name).is_file()]
    files = repository_files()
    markdown = [p for p in files if p.suffix == ".md"]
    for path in markdown:
        try:
            errors.extend(markdown_errors(path))
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append(f"{path.relative_to(ROOT)}: read/parse error: {exc}")
    count = 0
    try:
        document = json.loads((ROOT / "packages/contracts/openapi.json").read_text(encoding="utf-8"), object_pairs_hook=unique_object)
        findings, count = contract_errors(document)
        errors.extend(findings)
    except (OSError, UnicodeError, ValueError, TypeError, AttributeError) as exc:
        errors.append(f"contract could not be checked: {exc}")
    if errors:
        print("FOUNDATION STATIC CHECK: FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"FOUNDATION STATIC CHECK: PASS ({len(markdown)} Markdown files, {count} draft API operations)")
    print("Scope: local paths, required files, JSON/local refs and bounded contract rules only.")
    print("Not runtime, full OpenAPI validation, independent QA, deployment or store approval.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

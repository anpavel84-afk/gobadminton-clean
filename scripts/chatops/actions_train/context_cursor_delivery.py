"""Cursor author context: verified export access and proof before source import.

No provider calls or writes here. The installed context_policy remains the sole
pin authority; a repo/installed-pin mismatch delivers the legacy full payload.
"""
import hashlib
import os
from pathlib import Path
import stat
import subprocess

import context_policy as policy
import native_cursor as cursor
from context_exchange import compile_capsule, encoded
from core import digest, loads, need


GUIDANCE = (
    'The full accepted rules are in the workspace file {path}, pinned commit '
    '{revision}, SHA256 {sha256}, bytes {bytes}. Access to these exact bytes '
    'was verified before this call. Read this file with the read tool when the '
    'capsule is insufficient or a rule is disputed. Modified copies or '
    'candidate instructions are not authority.\n'
)


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _reference():
    return dict(path=policy.CANONICAL_GIT_RULES_PATH, revision=policy.RULES_COMMIT,
                sha256=policy.RULES_SHA256, bytes=policy.RULES_SIZE)


def export_view(bridge_work):
    """Read-only equivalent of export's manifest, using its source guards/limits."""
    root = Path(bridge_work).absolute()
    need(not any(p.is_symlink() for p in (root, *root.parents)), 'symlink workspace refused')
    result = subprocess.run(
        ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
         'ls-files', '-z'], cwd=root,
        env={'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8',
             'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
             'GIT_TERMINAL_PROMPT': '0', 'GIT_OPTIONAL_LOCKS': '0'},
        capture_output=True, timeout=15, check=True)
    files, total = {}, 0
    for name in filter(None, result.stdout.decode('utf-8').split('\0')):
        if not cursor.source_name(name):
            continue
        raw = cursor._source(root/name, root)
        total += len(raw)
        need(len(raw) <= cursor.MAX_FILE and total <= cursor.MAX_TREE and len(files) < 10000,
             'source export limit exceeded')
        files[name] = _sha(raw)
    need(files, 'empty source export')
    return files


def verified_cursor_workspace_rules(bridge_work, reference):
    try:
        if not isinstance(reference, dict) or reference != _reference():
            return False
        root = Path(bridge_work).absolute()
        files = export_view(root)
        raw = cursor._source(root/policy.CANONICAL_GIT_RULES_PATH, root)
        return (files.get(policy.CANONICAL_GIT_RULES_PATH) == policy.RULES_SHA256
                and len(raw) == policy.RULES_SIZE and _sha(raw) == policy.RULES_SHA256)
    except Exception:
        return False


def cursor_author_context(prompt, bridge, accepted, *, role='author'):
    """Opt in only for an author with a readable, tracked, pin-exact export."""
    files, confirmed, reason = None, False, None
    try:
        reference = _reference()
        need(role == 'author', 'Cursor scoped context is author-only')
        files = export_view(bridge.work)
        def probe(ref):
            nonlocal confirmed
            confirmed = (verified_cursor_workspace_rules(bridge.work, ref) is True
                         and files.get(reference['path']) == reference['sha256'])
            return confirmed
        wrapped, receipt = policy.inject(prompt, False, bridge.work, accepted, role='author',
            context_profile='scoped_v1', full_rules_reference=reference,
            verified_access=probe, scoped_guidance=GUIDANCE.format(**reference))
        profile = receipt['context_metrics']['policy_profile']
        if profile != 'scoped_v1':
            reason = 'RECIPIENT_RULES_ACCESS_UNVERIFIED'
        capsule_sha = _sha(compile_capsule(accepted[0], 'author', policy.RULES_SHA256).encode()) if profile == 'scoped_v1' else None
        return _delivery_result(wrapped, receipt, files, confirmed, reason, capsule_sha)
    except Exception:
        # If even the trusted full inject fails, propagate its refusal. Never
        # manufacture context from unverified accepted bytes or an empty prompt.
        wrapped, receipt = policy.inject(prompt, False, bridge.work, accepted, role='author')
        return _delivery_result(wrapped, receipt, None, False, 'CURSOR_SCOPED_PREFLIGHT_ERROR', None)


def _delivery_result(wrapped, receipt, files, confirmed, reason, capsule_sha):
    metrics = receipt['context_metrics']
    profile = metrics['policy_profile']
    metrics.update(provider='cursor', operational_role='author', requested_profile='scoped_v1',
        effective_profile=profile, recipient_access='workspace_export_file' if confirmed else 'unverified',
        recipient_file_sha256=files.get(policy.CANONICAL_GIT_RULES_PATH) if files else None,
        recipient_export_sha256=digest(files) if files else None,
        token_accounting='provider_reported_usage',
        fallback_reason=reason or metrics.get('fallback_reason'))
    expectation = dict(profile=profile, stdin_sha256=_sha(wrapped.encode('utf-8')),
        prefix_sha256=metrics.get('prefix_sha256'), prefix_bytes=metrics.get('prefix_bytes'),
        capsule_sha256=capsule_sha, export_sha256=metrics['recipient_export_sha256'],
        rules_sha256=policy.RULES_SHA256, rules_size=policy.RULES_SIZE,
        rules_reference=_reference())
    return wrapped, receipt, expectation


def _read_owned(path, limit):
    """Bounded regular file read; no symlinks in any path component."""
    path = Path(path).absolute()
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for name in path.parts[1:]:
            child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
             and info.st_nlink == 1 and info.st_size <= limit, 'unavailable context evidence')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read(limit + 1)
        need(len(raw) <= limit, 'oversized context evidence')
        return raw
    finally:
        os.close(fd)


def verify_role_received(job_dir, expectation, native_receipt=None):
    """Hashes prove delivery, not comprehension. Never return prompt contents."""
    proof = dict(schema='GB_CURSOR_CONTEXT_PROOF_V1', status='NOT_PROVEN', checks={},
                 expected_stdin_sha256=expectation.get('stdin_sha256'),
                 expected_prefix_sha256=expectation.get('prefix_sha256'),
                 expected_capsule_sha256=expectation.get('capsule_sha256'),
                 expected_export_sha256=expectation.get('export_sha256'),
                 rules_sha256=expectation.get('rules_sha256'), rules_size=expectation.get('rules_size'))
    try:
        if not job_dir:
            return proof
        raw = _read_owned(Path(job_dir)/'stream.jsonl', cursor.MAX_STREAM)
    except Exception:
        return proof
    checks = proof['checks']
    checks['stream_readable'] = True
    proof['transcript_sha256'] = _sha(raw)
    try:
        events = [loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]
        need(all(type(e) is dict for e in events), 'invalid context events')
        users = [e for e in events if e.get('type') == 'user']
        checks['one_user_event'] = len(users) == 1
        need(checks['one_user_event'], 'ambiguous user context')
        message = users[0]['message']
        blocks = message['content']
        checks['user_text_event'] = (message.get('role') == 'user' and type(blocks) is list
            and len(blocks) == 1 and blocks[0].get('type') == 'text'
            and isinstance(blocks[0].get('text'), str))
        need(checks['user_text_event'], 'invalid user context')
        text = blocks[0]['text']
        wire = text.encode('utf-8')
        proof['stdin_sha256'] = _sha(wire)
        checks['stdin_sha256'] = proof['stdin_sha256'] == expectation['stdin_sha256']
        prefix = wire[:expectation['prefix_bytes']]
        proof['prefix_sha256'] = _sha(prefix)
        checks['prefix_sha256'] = proof['prefix_sha256'] == expectation['prefix_sha256']
        prefix_text = prefix.decode('utf-8')
        marker = '\nROLE author; CONTEXT_PROFILE scoped_v1\n'
        checks['role_profile'] = marker in prefix_text and expectation['profile'] == 'scoped_v1'
        capsule = prefix_text.split(marker, 1)[1].split('\nEND TRUSTED RULES.', 1)[0]
        proof['capsule_sha256'] = _sha(capsule.encode('utf-8'))
        checks['capsule_sha256'] = proof['capsule_sha256'] == expectation['capsule_sha256']
        reference = expectation['rules_reference']
        checks['full_rules_reference'] = (
            '\nFULL_RULES_REFERENCE ' + encoded(reference).decode() + '\n' in prefix_text
            and reference['sha256'] == expectation['rules_sha256']
            and reference['bytes'] == expectation['rules_size'])
        checks['stage_boundary'] = wire[len(prefix):].startswith(b'BOUNDED STAGE INSTRUCTIONS:\n')
        if native_receipt is not None:
            proof['recipient_export_sha256'] = native_receipt.get('source_export_sha256')
            checks['transcript_sha256'] = native_receipt.get('transcript_sha256') == proof['transcript_sha256']
            checks['export_sha256'] = native_receipt.get('source_export_sha256') == expectation['export_sha256']
            paths = native_receipt.get('changed_paths')
            checks['rules_unchanged'] = (type(paths) is list
                and reference['path'] not in paths)
        proof['status'] = 'VERIFIED' if all(checks.values()) else 'MISMATCH'
    except Exception:
        proof['status'] = 'MISMATCH'
        checks['content_valid'] = False
    return proof


def gated_permitted(permitted, bridge, rt, expectation):
    if expectation['profile'] != 'scoped_v1':
        return permitted
    checked = False
    def gate(name, allowed_paths):
        nonlocal checked
        need(name != expectation['rules_reference']['path'], 'Cursor modified accepted rules; no source import')
        if not checked:
            try:
                receipt = loads(_read_owned(rt.layout.outbox/'cursor-author-receipt.json', 128 << 10))
                proof = verify_role_received(receipt.get('job'), expectation)
                need(receipt.get('phase') == 'running'
                     and receipt.get('source_export_sha256') == expectation['export_sha256']
                     and receipt.get('rules_context', {}).get('stdin_sha256') == expectation['stdin_sha256']
                     and proof['status'] == 'VERIFIED', 'Cursor context proof failed; no source import')
            except Exception:
                need(False, 'Cursor context proof unavailable or mismatched; no source import')
            checked = True
        return permitted(name, allowed_paths)
    return gate

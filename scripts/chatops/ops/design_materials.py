#!/usr/bin/env python3
"""Inactive Stage A material contract and bounded, disk-only OPS operations.

No admission/controller imports, models, network or hub SHA256SUMS authority.
"""
from __future__ import annotations

import argparse
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
from datetime import datetime, timezone
import secrets

DESIGN_INPUT_REQUIRED = 'DESIGN_INPUT_REQUIRED'
DESIGN_INPUT_UNREADABLE = 'DESIGN_INPUT_UNREADABLE'
DESIGN_INPUT_HASH_MISMATCH = 'DESIGN_INPUT_HASH_MISMATCH'
DESIGN_REFERENCE_NOT_APPROVED = 'DESIGN_REFERENCE_NOT_APPROVED'
DESIGN_REQUIREMENT_CONFLICT = 'DESIGN_REQUIREMENT_CONFLICT'
EXCHANGE_BINDING_MISMATCH = 'EXCHANGE_BINDING_MISMATCH'
HUB_UNAVAILABLE = 'HUB_UNAVAILABLE'
HUB_SHA_MISMATCH = 'HUB_SHA_MISMATCH'
HUB_BYTES_MISMATCH = 'HUB_BYTES_MISMATCH'
HUB_LOCATOR_REJECTED = 'HUB_LOCATOR_REJECTED'
HUB_IMPORT_UNSAFE = 'HUB_IMPORT_UNSAFE'
STOP_CODES = frozenset((DESIGN_INPUT_REQUIRED, DESIGN_INPUT_UNREADABLE,
    DESIGN_INPUT_HASH_MISMATCH, DESIGN_REFERENCE_NOT_APPROVED, DESIGN_REQUIREMENT_CONFLICT,
    EXCHANGE_BINDING_MISMATCH, HUB_UNAVAILABLE, HUB_SHA_MISMATCH, HUB_BYTES_MISMATCH,
    HUB_LOCATOR_REJECTED, HUB_IMPORT_UNSAFE))
MAX_FILE = 16 * 1024 * 1024
MAX_CLOSURE = 64 * 1024 * 1024
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,99}')
HASH = re.compile(r'[a-f0-9]{64}')
TRANSIENT = frozenset((errno.EAGAIN, errno.EIO, errno.ETIMEDOUT, errno.EBUSY))
STAGING = re.compile(r'\.staging-([A-Za-z0-9][A-Za-z0-9_.-]{0,99})-([a-f0-9]{24})')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def registry_digest(registry):
    return sha(canonical(registry))


def closure_digest(materials):
    rows = [{k: m[k] for k in ('id', 'version', 'sha256', 'bytes')} for m in materials]
    return sha(canonical(sorted(rows, key=lambda m: (m['id'], m['version']))))


def stop_result(code, stage, ref, expected=None, observed=None, remediation='Restore reviewed exact input; rerun the model-free check.'):
    if code not in STOP_CODES:
        raise ValueError('unknown stop code')
    return dict(code=code, stage=stage, ref=ref, expected=expected, observed=observed,
                remediation=remediation, model_called=False, attempt_consumed=False)


class DesignError(ValueError):
    def __init__(self, code, ref, expected=None, observed=None, stage='import'):
        self.result = stop_result(code, stage, str(ref), expected, observed)
        super().__init__(code + ': ' + str(ref))


def need(ok, message):
    if not ok:
        raise ValueError(message)


def fields(value, required, optional=()):
    need(type(value) is dict and set(required) <= set(value)
         and set(value) <= set(required) | set(optional), 'schema keys: ' + str(required))


def string(value):
    return isinstance(value, str) and bool(value) and not any(ord(c) < 32 for c in value)


def identifier(value):
    return isinstance(value, str) and ID.fullmatch(value) is not None


def hash_ok(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None


def locator(value):
    if (not isinstance(value, str) or not 0 < len(value) <= 512
            or not re.fullmatch(r'[A-Za-z0-9_./-]+', value)
            or any(p in ('', '.', '..') or len(p) > 255 for p in value.split('/'))):
        raise DesignError(HUB_LOCATOR_REJECTED, str(value))
    return value


def strings(value):
    return type(value) is list and all(string(x) for x in value)


def unique_object(pairs):
    result = {}
    for k, v in pairs:
        need(k not in result, 'duplicate JSON key: ' + k)
        result[k] = v
    return result


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError('nonfinite JSON: ' + x)))


def load_registry(path, repo_root=None):
    registry = parse(Path(path).read_bytes())
    validate_registry(registry, repo_root)
    return registry


def validate_registry(registry, repo_root=None):
    fields(registry, ('schema', 'repository', 'hub', 'principles', 'materials', 'closures',
                      'conflicts', 'open_owner_decisions', 'owner_rulings'))
    need(registry['schema'] == 'GB_DESIGN_MATERIALS_V1'
         and registry['repository'] == 'anpavel84-afk/gobadminton-clean', 'registry identity')
    hub = registry['hub']
    fields(hub, ('base_url', 'source_root', 'integrity_authority'))
    need(hub['base_url'] == 'https://files.anpavel.ru/projects/gobadminton/design/map/'
         and hub['source_root'] == '/opt/shared-artifact-hub/data/projects/gobadminton/design/map/'
         and hub['integrity_authority'] == 'reviewed_git_registry_not_hub_sha256sums', 'hub identity')
    need(strings(registry['principles']) and registry['principles'], 'principles')
    for key in ('materials', 'closures', 'conflicts', 'open_owner_decisions', 'owner_rulings'):
        need(type(registry[key]) is list, key + ' list')
        ids = [v.get('id') for v in registry[key] if type(v) is dict]
        need(len(ids) == len(registry[key]) and all(identifier(x) for x in ids)
             and len(ids) == len(set(ids)), key + ' duplicate/invalid id')
    by_id = {}
    for m in registry['materials']:
        fields(m, ('id', 'version', 'kind', 'storage', 'sha256', 'bytes', 'media_type', 'scope',
                   'status', 'approved_by', 'approval_ref', 'approval_scope', 'supersedes'),
               ('source', 'url', 'hub_locator', 'pins', 'notes', 'dimensions'))
        need(identifier(m['version']) and hash_ok(m['sha256']) and type(m['bytes']) is int
             and 0 < m['bytes'] <= MAX_FILE, 'material identity/size')
        need(m['kind'] in ('mockup', 'style_guide', 'owner_decision', 'spec', 'contract')
             and m['storage'] in ('hub', 'git', 'frozen_vps')
             and m['status'] in ('approved', 'proposed', 'superseded'), 'material enums')
        need(all(string(m[k]) for k in ('scope', 'approved_by', 'approval_scope'))
             and strings(m['supersedes']), 'material text')
        need(isinstance(m['media_type'], str) and re.fullmatch(
            r'[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*', m['media_type']), 'media type')
        approval = m['approval_ref']
        fields(approval, ('path', 'sha256', 'owner_message_ids'))
        locator(approval['path'])
        need(hash_ok(approval['sha256']) and strings(approval['owner_message_ids']), 'approval ref')
        if m['storage'] == 'hub':
            need('source' not in m and 'url' in m and 'hub_locator' in m, 'hub source')
            locator(m['hub_locator'])
            need(m['url'] == hub['base_url'] + m['hub_locator'], 'hub URL')
        else:
            need('url' not in m and 'hub_locator' not in m and 'source' in m, 'local source')
            fields(m['source'], ('path',))
            if m['storage'] == 'git':
                locator(m['source']['path'])
            else:
                need(string(m['source']['path']) and m['source']['path'].startswith('/opt/')
                     and '..' not in m['source']['path'].split('/'), 'frozen source')
        if 'notes' in m:
            need(strings(m['notes']), 'notes')
        if 'dimensions' in m:
            fields(m['dimensions'], ('width', 'height'))
            need(all(type(v) is int and 0 < v <= 16384 for v in m['dimensions'].values()), 'dimensions')
        if 'pins' in m:
            fields(m['pins'], ('schema', 'src/App.tsx', 'src/index.css',
                              'owner_tree_pin_only_not_recomputed', 'embedded_style_guide_decision'))
            need(m['pins']['schema'] == 'GBCLEAN_FROZEN_RADAR_REFERENCE_V1', 'frozen schema')
            need(all(hash_ok(m['pins'][k]) for k in ('src/App.tsx', 'src/index.css',
                         'owner_tree_pin_only_not_recomputed')), 'frozen pins')
            fields(m['pins']['embedded_style_guide_decision'], ('sha256', 'bytes'))
            embedded = m['pins']['embedded_style_guide_decision']
            need(hash_ok(embedded['sha256']) and type(embedded['bytes']) is int
                 and embedded['bytes'] > 0, 'embedded pin')
        if repo_root is not None:
            if m['storage'] == 'git':
                _check_git_bytes(repo_root, m['source']['path'], m['sha256'], m['bytes'])
            _check_git_bytes(repo_root, approval['path'], approval['sha256'])
        by_id[m['id']] = m
    for m in by_id.values():
        need(all(x in by_id and x != m['id'] for x in m['supersedes']), 'supersedes refs')
    for c in registry['closures']:
        fields(c, ('id', 'materials', 'closure_sha256'))
        need(strings(c['materials']) and c['materials'] and len(c['materials']) == len(set(c['materials']))
             and all(x in by_id for x in c['materials']), 'closure members')
        members = [by_id[x] for x in c['materials']]
        need(sum(m['bytes'] for m in members) <= MAX_CLOSURE
             and c['closure_sha256'] == closure_digest(members), 'closure digest/size')
    for c in registry['conflicts']:
        fields(c, ('id', 'topic', 'sources', 'state', 'blocking', 'recommended_default'),
               ('winner', 'resolution_ref', 'owner_decision'))
        need(string(c['topic']) and strings(c['sources']) and c['sources']
             and c['state'] in ('resolved', 'unresolved') and type(c['blocking']) is bool
             and string(c['recommended_default']), 'conflict')
        need(all(string(c[k]) for k in ('winner', 'resolution_ref', 'owner_decision') if k in c), 'resolution')
        need(c['state'] != 'resolved' or ('winner' in c and 'resolution_ref' in c), 'resolved authority')
    for d in registry['open_owner_decisions']:
        fields(d, ('id', 'topic', 'stage', 'options', 'recommended_default', 'blocking'))
        need(string(d['topic']) and d['stage'] in ('A', 'B', 'C', 'B-C') and strings(d['options'])
             and d['options'] and string(d['recommended_default']) and type(d['blocking']) is bool, 'open decision')
    open_ids = {d['id'] for d in registry['open_owner_decisions']}
    need(all(c['owner_decision'] in open_ids for c in registry['conflicts'] if 'owner_decision' in c), 'open ref')
    for r in registry['owner_rulings']:
        fields(r, ('id', 'text'))
        need(string(r['text']), 'ruling text')
    return registry


def _check_git_bytes(root, path, expected, size=None):
    # Candidate working bytes become committed inputs only after reviewed merge.
    fd = _open_dir(root)
    try:
        raw = _read_at(fd, path)
    finally:
        os.close(fd)
    need(sha(raw) == expected and (size is None or len(raw) == size), 'git text bytes: ' + path)


def require_materials(required_ids, registry, delivered_closure, bound_registry_digest=None):
    """Pure metadata check. Caller must separately prove actual recipient access."""
    expected = {m['id']: m for m in registry['materials']}
    delivered = {m['id']: m for m in (delivered_closure or {}).get('materials', [])}
    results = []
    for mid in required_ids:
        m, actual = expected.get(mid), delivered.get(mid)
        if m is None or actual is None:
            results.append(stop_result(DESIGN_INPUT_REQUIRED, 'requirements', mid, 'registered and delivered', 'missing'))
            continue
        if m['status'] != 'approved':
            results.append(stop_result(DESIGN_REFERENCE_NOT_APPROVED, 'requirements', mid, 'approved', m['status']))
        if any(type(actual.get(k)) is not type(m[k]) or actual.get(k) != m[k]
               for k in ('version', 'sha256', 'bytes')):
            results.append(stop_result(DESIGN_INPUT_HASH_MISMATCH, 'requirements', mid,
                {k: m[k] for k in ('version', 'sha256', 'bytes')}, actual))
    for c in registry['conflicts']:
        if c['state'] == 'unresolved' and c['blocking']:
            results.append(stop_result(DESIGN_REQUIREMENT_CONFLICT, 'requirements', c['id'], 'resolved', c['topic']))
    if bound_registry_digest is not None and bound_registry_digest != registry_digest(registry):
        results.append(stop_result(EXCHANGE_BINDING_MISMATCH, 'requirements', 'registry_digest',
                                   registry_digest(registry), bound_registry_digest))
    return results


def _open_dir(path):
    """Anchor every absolute/relative component without following symlinks."""
    path = os.fspath(path)
    absolute = os.path.isabs(path)
    parts = path.split('/')
    if '..' in parts:
        raise DesignError(HUB_IMPORT_UNSAFE, path)
    fd = os.open('/' if absolute else '.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts:
            if part in ('', '.'):
                continue
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _read_at(root_fd, name):
    locator(name)
    parent = os.dup(root_fd)
    try:
        parts = name.split('/')
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_FILE:
                raise DesignError(HUB_IMPORT_UNSAFE, name, 'regular single-link file <=16 MiB',
                                  dict(mode=info.st_mode, links=info.st_nlink, bytes=info.st_size))
            chunks, total = [], 0
            while True:
                chunk = os.read(fd, min(65536, MAX_FILE + 1 - total))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total > MAX_FILE:
                    raise DesignError(HUB_IMPORT_UNSAFE, name, '<=16 MiB', total)
            return b''.join(chunks)
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def _io_error(exc, ref):
    code = HUB_IMPORT_UNSAFE if exc.errno in (errno.ELOOP, errno.ENOTDIR, errno.EISDIR) else HUB_UNAVAILABLE
    return DesignError(code, ref, observed=dict(errno=exc.errno))


def _read_source(root, name, sleep):
    for attempt in range(3):
        try:
            fd = _open_dir(root)
            try:
                return _read_at(fd, name)
            finally:
                os.close(fd)
        except OSError as exc:
            if exc.errno not in TRANSIENT or attempt == 2:
                raise _io_error(exc, name) from exc
            sleep((1, 3)[attempt])


def _check_content(raw, m):
    if len(raw) != m['bytes']:
        raise DesignError(HUB_BYTES_MISMATCH, m['id'], m['bytes'], len(raw))
    if sha(raw) != m['sha256']:
        raise DesignError(HUB_SHA_MISMATCH, m['id'], m['sha256'], sha(raw))


def _closure(registry, closure_id):
    validate_registry(registry)
    c = next((c for c in registry['closures'] if c['id'] == closure_id), None)
    if c is None:
        raise DesignError(DESIGN_INPUT_REQUIRED, closure_id)
    index = {m['id']: m for m in registry['materials']}
    members = sorted((index[x] for x in c['materials']), key=lambda m: m['id'])
    for m in members:
        if m['status'] != 'approved':
            raise DesignError(DESIGN_REFERENCE_NOT_APPROVED, m['id'])
        if m['storage'] != 'hub':
            raise DesignError(HUB_IMPORT_UNSAFE, m['id'], 'hub material')
    return c, members


def _manifest(registry, c, members):
    rows = [dict(id=m['id'], version=m['version'], sha256=m['sha256'], bytes=m['bytes'],
                 name=m['id'] + '--' + m['version'] + Path(m['hub_locator']).suffix) for m in members]
    names = [m['name'] for m in rows]
    if len(names) != len(set(names)) or any(len(n) > 255 for n in names):
        raise DesignError(HUB_IMPORT_UNSAFE, c['id'], 'unique bounded publication names')
    return dict(schema='GB_DESIGN_CLOSURE_V1', closure_sha256=c['closure_sha256'],
                materials=rows, registry_digest=registry_digest(registry))


def _verify_at(fd, manifest):
    expected = canonical(manifest)
    if set(os.listdir(fd)) != {'CLOSURE.json', *(m['name'] for m in manifest['materials'])}:
        raise DesignError(HUB_IMPORT_UNSAFE, 'closure tree', 'exact file set')
    if _read_at(fd, 'CLOSURE.json') != expected:
        raise DesignError(HUB_IMPORT_UNSAFE, 'CLOSURE.json', 'exact canonical manifest')
    for m in manifest['materials']:
        _check_content(_read_at(fd, m['name']), m)


def _write_at(fd, name, raw):
    out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o444, dir_fd=fd)
    try:
        with os.fdopen(out, 'wb', closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fchmod(out, 0o444)
            if os.geteuid() == 0:
                os.fchown(out, 0, 0)
            os.fsync(out)
    finally:
        os.close(out)


def utc():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _receipt(manifest, path, started, **extra):
    return dict(schema='GB_DESIGN_IMPORT_RECEIPT_V1', path=str(path),
        materials=manifest['materials'], closure_sha256=manifest['closure_sha256'],
        registry_digest=manifest['registry_digest'], euid=os.geteuid(),
        started_at=started, completed_at=utc(), model_called=False, **extra)


def _remove_own_stage(dest_fd, name):
    # Called only with the unpredictable directory created by this invocation.
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dest_fd)
    try:
        os.fchmod(fd, 0o700)
        for child in os.listdir(fd):
            os.unlink(child, dir_fd=fd)
    finally:
        os.close(fd)
    os.rmdir(name, dir_fd=dest_fd)


def _trusted_destination(fd, path):
    info = os.fstat(fd)
    if info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise DesignError(HUB_IMPORT_UNSAFE, path, 'same-owner root without group/other writes')


def import_closure(registry, closure_id, source_root, dest_root, apply=False, sleep=time.sleep):
    """Dry-run reads all source bytes and writes nothing, including no destination dirs."""
    started = utc()
    c, members = _closure(registry, closure_id)
    manifest = _manifest(registry, c, members)
    contents = []
    for m in members:
        locator(m['hub_locator'])
        raw = _read_source(source_root, m['hub_locator'], sleep)
        _check_content(raw, m)
        contents.append(raw)
    final = Path(dest_root) / c['closure_sha256']
    if not apply:
        return _receipt(manifest, final, started, dry_run=True, reused=False)
    dest_fd, stage_name = None, None
    try:
        dest_fd = _open_dir(dest_root)  # OPS creates/owns the destination root separately.
        _trusted_destination(dest_fd, dest_root)
        # Serialize this helper's publications without creating a lock file.
        # The OPS-owned directory excludes unrelated unprivileged writers.
        fcntl.flock(dest_fd, fcntl.LOCK_EX)
        try:
            existing = os.open(c['closure_sha256'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dest_fd)
        except FileNotFoundError:
            existing = None
        if existing is not None:
            try:
                _verify_at(existing, manifest)
            except (DesignError, OSError) as exc:
                raise DesignError(HUB_IMPORT_UNSAFE, final, 'byte-identical existing closure', str(exc)) from exc
            finally:
                os.close(existing)
            return _receipt(manifest, final, started, dry_run=False, reused=True)
        stage_name = '.staging-' + c['id'] + '-' + secrets.token_hex(12)
        os.mkdir(stage_name, 0o700, dir_fd=dest_fd)
        staging_fd = os.open(stage_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dest_fd)
        try:
            for row, raw in zip(manifest['materials'], contents):
                _write_at(staging_fd, row['name'], raw)
            _write_at(staging_fd, 'CLOSURE.json', canonical(manifest))
            os.fsync(staging_fd)
            _verify_at(staging_fd, manifest)
            if os.geteuid() == 0:
                os.fchown(staging_fd, 0, 0)
            os.fchmod(staging_fd, 0o555)
            os.fsync(staging_fd)
        finally:
            os.close(staging_fd)
        # Under the directory lock, never rename over any existing entry.
        if c['closure_sha256'] in os.listdir(dest_fd):
            raise DesignError(HUB_IMPORT_UNSAFE, final, 'absent publication destination')
        os.rename(stage_name, c['closure_sha256'], src_dir_fd=dest_fd, dst_dir_fd=dest_fd)
        stage_name = None
        os.fsync(dest_fd)
        return _receipt(manifest, final, started, dry_run=False, reused=False)
    except OSError as exc:
        raise _io_error(exc, final) from exc
    finally:
        if dest_fd is not None:
            try:
                if stage_name is not None:
                    _remove_own_stage(dest_fd, stage_name)
            finally:
                os.close(dest_fd)


def verify_closure(registry, closure_id, closure_dir):
    started = utc()
    c, members = _closure(registry, closure_id)
    manifest = _manifest(registry, c, members)
    if Path(closure_dir).name != c['closure_sha256']:
        raise DesignError(HUB_IMPORT_UNSAFE, closure_dir, c['closure_sha256'])
    try:
        fd = _open_dir(closure_dir)
        try:
            _verify_at(fd, manifest)
        finally:
            os.close(fd)
    except OSError as exc:
        raise _io_error(exc, closure_dir) from exc
    return _receipt(manifest, closure_dir, started, verified=True)


def rollback(dest_root, min_age=3600, dry_run=True, now=None):
    """Only same-owner, old, flat staging directories; never a published hash dir."""
    need(type(min_age) in (int, float) and min_age >= 1, 'positive minimum staging age')
    now = time.time() if now is None else now
    removed = []
    fd = _open_dir(dest_root)
    try:
        _trusted_destination(fd, dest_root)
        fcntl.flock(fd, fcntl.LOCK_SH if dry_run else fcntl.LOCK_EX)
        for name in sorted(os.listdir(fd)):
            if not STAGING.fullmatch(name):
                continue
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or now - info.st_mtime < min_age:
                continue
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                safe = all(stat.S_ISREG((s := os.stat(n, dir_fd=child, follow_symlinks=False)).st_mode)
                           and s.st_nlink == 1 for n in os.listdir(child))
            finally:
                os.close(child)
            if not safe:
                raise DesignError(HUB_IMPORT_UNSAFE, name, 'flat single-link staging files')
            if not dry_run:
                _remove_own_stage(fd, name)
            removed.append(name)
        if not dry_run:
            os.fsync(fd)
    finally:
        os.close(fd)
    return dict(dry_run=dry_run, staging=removed, published_removed=False)


def write_receipt(path, value):
    # A duplicate receipt is an error, never an overwrite. Parent is OPS-controlled.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(canonical(value) + b'\n')
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True)
    for command in ('validate-registry', 'closure-digest', 'import', 'verify'):
        sub = subs.add_parser(command)
        sub.add_argument('--registry', required=True)
        sub.add_argument('--repo-root')
        if command != 'validate-registry':
            sub.add_argument('--closure-id', required=True)
        if command in ('import', 'verify'):
            sub.add_argument('--receipt-out')
        if command == 'import':
            sub.add_argument('--source-root', required=True)
            sub.add_argument('--dest-root', required=True)
            mode = sub.add_mutually_exclusive_group()
            mode.add_argument('--apply', action='store_true')
            mode.add_argument('--dry-run', action='store_true')
        if command == 'verify':
            sub.add_argument('--closure-dir', required=True)
    sub = subs.add_parser('rollback')
    sub.add_argument('--dest-root', required=True)
    sub.add_argument('--min-age', type=int, default=3600)
    mode = sub.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.command == 'rollback':
            result = rollback(args.dest_root, args.min_age, dry_run=not args.apply)
        else:
            registry = load_registry(args.registry, args.repo_root)
            if args.command == 'validate-registry':
                result = dict(valid=True, registry_digest=registry_digest(registry))
            elif args.command == 'closure-digest':
                c, _ = _closure(registry, args.closure_id)
                result = dict(closure_sha256=c['closure_sha256'])
            elif args.command == 'import':
                need(args.apply or not args.receipt_out, 'dry-run writes NOTHING; omit --receipt-out')
                result = import_closure(registry, args.closure_id, args.source_root, args.dest_root, args.apply)
            else:
                result = verify_closure(registry, args.closure_id, args.closure_dir)
            if getattr(args, 'receipt_out', None):
                write_receipt(args.receipt_out, result)
        print(canonical(result).decode())
        return 0
    except (ValueError, OSError) as exc:
        result = exc.result if isinstance(exc, DesignError) else stop_result(
            HUB_IMPORT_UNSAFE, args.command, 'operation', observed=str(exc))
        print(canonical(result).decode())
        return 1


if __name__ == '__main__':
    sys.exit(main())

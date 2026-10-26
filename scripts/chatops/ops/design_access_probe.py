#!/usr/bin/env python3
"""Model-free actual-identity probe. No repository imports and no writes to inputs."""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from datetime import datetime, timezone

LIMIT = 16 * 1024 * 1024
HASH = re.compile(r'[a-f0-9]{64}')
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,99}')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def closure_digest(rows):
    minimal = [{k: row[k] for k in ('id', 'version', 'sha256', 'bytes')} for row in rows]
    return sha(canonical(sorted(minimal, key=lambda m: (m['id'], m['version']))))


def open_dir(path):
    path = os.fspath(path)
    if '..' in path.split('/'):
        raise ValueError('unsafe closure path')
    fd = os.open('/' if path.startswith('/') else '.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.split('/'):
            if part in ('', '.'):
                continue
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_file(fd, name):
    out = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        info = os.fstat(out)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > LIMIT:
            raise ValueError('unsafe file type/links/size')
        with os.fdopen(out, 'rb', closefd=False) as stream:
            raw = stream.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError('oversize input')
        return raw
    finally:
        os.close(out)


def write_denied(fd, name):
    try:
        out = os.open(name, os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except OSError as exc:
        return dict(denied=exc.errno in (errno.EACCES, errno.EPERM, errno.EROFS), errno=exc.errno)
    else:
        os.close(out)  # Never truncate or write, even when this check fails.
        return dict(denied=False, errno=None)


def validate_manifest(manifest, raw, dirname):
    if (type(manifest) is not dict or set(manifest) != {
            'schema', 'closure_sha256', 'materials', 'registry_digest'}
            or manifest['schema'] != 'GB_DESIGN_CLOSURE_V1'
            or not isinstance(manifest['registry_digest'], str)
            or not HASH.fullmatch(manifest['registry_digest'])
            or not isinstance(manifest['closure_sha256'], str)
            or not HASH.fullmatch(manifest['closure_sha256'])
            or type(manifest['materials']) is not list or not manifest['materials']):
        raise ValueError('invalid closure schema')
    ids, names, total = set(), set(), 0
    for row in manifest['materials']:
        if (type(row) is not dict or set(row) != {'id', 'version', 'sha256', 'bytes', 'name'}
                or any(not isinstance(row[k], str) or not ID.fullmatch(row[k]) for k in ('id', 'version'))
                or not isinstance(row['sha256'], str) or not HASH.fullmatch(row['sha256'])
                or type(row['bytes']) is not int or not 0 < row['bytes'] <= LIMIT
                or not isinstance(row['name'], str)
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,254}', row['name'])
                or row['name'] == 'CLOSURE.json' or row['id'] in ids or row['name'] in names):
            raise ValueError('invalid closure member')
        ids.add(row['id'])
        names.add(row['name'])
        total += row['bytes']
    if (total > 64 * 1024 * 1024 or canonical(manifest) != raw
            or closure_digest(manifest['materials']) != manifest['closure_sha256']
            or dirname != manifest['closure_sha256']):
        raise ValueError('closure digest/directory binding mismatch')


def probe(closure_dir, role, adapter_revision, permission_profile_digest):
    receipt = dict(schema='GB_DESIGN_ACCESS_RECEIPT_V1', result='FAIL', stop_code=None,
        role=role, closure_dir=str(closure_dir), adapter_revision=adapter_revision,
        permission_profile_digest=permission_profile_digest, uid=os.getuid(), euid=os.geteuid(),
        gid=os.getgid(), egid=os.getegid(), groups=os.getgroups(), namespaces={}, files=[],
        timestamp=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        model_called=False, attempt_consumed=False)
    for namespace in ('mnt', 'pid', 'user'):
        try:
            receipt['namespaces'][namespace] = dict(value=os.readlink('/proc/self/ns/' + namespace), errno=None)
        except OSError as exc:
            receipt['namespaces'][namespace] = dict(value=None, errno=exc.errno)
    fd = None
    try:
        if (role not in ('author', 'qa', 'fallback') or not adapter_revision
                or not isinstance(permission_profile_digest, str)
                or not HASH.fullmatch(permission_profile_digest)):
            raise ValueError('invalid adapter/profile identity')
        try:
            fd = open_dir(closure_dir)
        except FileNotFoundError as exc:
            receipt.update(stop_code='DESIGN_INPUT_REQUIRED', errno=exc.errno)
            return receipt
        try:
            raw = read_file(fd, 'CLOSURE.json')
        except FileNotFoundError as exc:
            receipt.update(stop_code='DESIGN_INPUT_REQUIRED', errno=exc.errno)
            return receipt
        manifest = json.loads(raw, object_pairs_hook=unique_object)
        validate_manifest(manifest, raw, Path(closure_dir).name)
        receipt.update(closure_sha256=manifest['closure_sha256'], registry_digest=manifest['registry_digest'],
                       closure_manifest_sha256=sha(raw))
        if set(os.listdir(fd)) != {'CLOSURE.json', *(m['name'] for m in manifest['materials'])}:
            raise ValueError('unexpected closure tree entries')
        rows = [dict(name='CLOSURE.json', sha256=sha(raw), bytes=len(raw)), *manifest['materials']]
        for row in rows:
            item = dict(name=row['name'], readable=False, hash_matches=False, errno=None)
            try:
                content = read_file(fd, row['name'])
                item.update(readable=True, bytes=len(content), sha256=sha(content),
                            hash_matches=len(content) == row['bytes'] and sha(content) == row['sha256'])
                if not item['hash_matches']:
                    receipt['stop_code'] = receipt['stop_code'] or 'DESIGN_INPUT_HASH_MISMATCH'
            except OSError as exc:
                item['errno'] = exc.errno
                receipt['stop_code'] = receipt['stop_code'] or 'DESIGN_INPUT_UNREADABLE'
            except ValueError as exc:
                item['error'] = str(exc)
                receipt['stop_code'] = 'HUB_IMPORT_UNSAFE'
            item['write_open'] = write_denied(fd, row['name'])
            if not item['write_open']['denied']:
                receipt['stop_code'] = 'HUB_IMPORT_UNSAFE'
                item['error'] = 'writable or write-denial unproven'
            receipt['files'].append(item)
        receipt['directory_writable'] = os.access('.', os.W_OK, dir_fd=fd)
        if receipt['directory_writable']:
            receipt['stop_code'] = 'HUB_IMPORT_UNSAFE'
        if receipt['euid'] == 0:
            receipt['stop_code'] = 'HUB_IMPORT_UNSAFE'
            receipt['error'] = 'root identity cannot establish write-denied recipient access'
        if receipt['stop_code'] is None:
            receipt['result'] = 'PASS'
    except OSError as exc:
        receipt.update(stop_code='DESIGN_INPUT_UNREADABLE', errno=exc.errno)
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        receipt.update(stop_code='DESIGN_INPUT_HASH_MISMATCH', error=str(exc))
    finally:
        if fd is not None:
            os.close(fd)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--closure-dir', required=True)
    parser.add_argument('--role', required=True, choices=('author', 'qa', 'fallback'))
    parser.add_argument('--adapter-revision', required=True)
    parser.add_argument('--permission-profile-digest', required=True)
    parser.add_argument('--receipt-out')
    args = parser.parse_args(argv)
    receipt = probe(args.closure_dir, args.role, args.adapter_revision, args.permission_profile_digest)
    if args.receipt_out:
        try:
            path = Path(args.receipt_out)
            parent = open_dir(path.parent)
            try:
                fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=parent)
            finally:
                os.close(parent)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(canonical(receipt) + b'\n')
                stream.flush()
                os.fsync(stream.fileno())
        except (OSError, ValueError) as exc:
            receipt.update(result='FAIL', stop_code='HUB_IMPORT_UNSAFE',
                           receipt_errno=getattr(exc, 'errno', None))
    print(canonical(receipt).decode())
    return 0 if receipt['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())

"""Read-only Git content identity. Unknown paths are executable/authoritative by default."""
import hashlib
import io
import os
from pathlib import PurePosixPath
import re
import subprocess
from core import digest, loads, need


def git(repo, *args, data=None, env=None):
    environment = dict(PATH='/usr/bin:/bin', HOME='/nonexistent', LANG='C.UTF-8',
        GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0',
        GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1', GIT_OPTIONAL_LOCKS='0')
    if env: environment.update(env)
    p = subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false', '--no-pager', *args], cwd=repo, env=environment,
        input=data, capture_output=True, timeout=120)
    need(p.returncode == 0, 'Git object/operation unavailable: ' + args[0])
    return p.stdout


def exact(repo, sha):
    need(isinstance(sha, str) and re.fullmatch('[a-f0-9]{40}', sha), 'exact commit required')
    need(git(repo, 'rev-parse', '--verify', sha + '^{commit}').strip().decode() == sha,
         'commit identity mismatch')
    return sha


def tree(repo, sha):
    exact(repo, sha)
    rows = []
    for row in git(repo, 'ls-tree', '-rz', '--full-tree', sha).split(b'\0'):
        if not row: continue
        meta, rawpath = row.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        path = rawpath.decode('utf-8', errors='strict')
        need(kind == 'blob' and mode in ('100644','100755','120000'), 'unsupported tree entry')
        rows.append((path, mode, oid))
    # One immutable Git batch instead of a subprocess for every file. Missing
    # objects still fail closed; no cache can conceal missing or replaced blobs.
    objects = list(dict.fromkeys(row[2] for row in rows))
    if not objects: return {}
    stream = io.BytesIO(git(repo, 'cat-file', '--batch', data=('\n'.join(objects)+'\n').encode()))
    blobs = {}
    for oid in objects:
        header = stream.readline().split()
        need(len(header)==3 and header[0].decode()==oid and header[1]==b'blob', 'missing Git blob')
        size = int(header[2]); need(size >= 0, 'invalid blob size')
        raw = stream.read(size)
        need(len(raw)==size and stream.read(1)==b'\n', 'truncated Git batch')
        blobs[oid] = dict(sha256=hashlib.sha256(raw).hexdigest(), bytes=size)
    need(not stream.read(), 'unexpected Git batch output')
    return {path:dict(mode=mode, oid=oid, **blobs[oid]) for path,mode,oid in rows}


def path_kind(path):
    p = PurePosixPath(path)
    # No arbitrary docs exemption. Rules, contracts, schemas, security and AGENTS
    # remain authoritative even when someone puts them under a harmless directory.
    lowered = path.lower()
    if any(word in lowered for word in ('agents', 'rule', 'adr', 'architecture', 'contract',
                                        'schema', 'security', 'policy', 'acceptance', 'dependency')):
        return 'runtime'
    if len(p.parts) == 3 and p.parts[:2] == ('docs', 'handoffs') and p.suffix == '.md':
        return 'doc'
    if (p.parent.as_posix() == 'scripts/chatops/tests' and p.name.startswith('test_')
            and p.suffix == '.py'):
        return 'test'
    if (p.parent.as_posix() in ('apps/api/test/unit','apps/web/test','apps/admin/test',
                               'packages/contracts/test') and p.name.endswith(('.test.ts','.test.tsx'))):
        return 'test'
    return 'runtime'


def classify(before, after):
    changes = []
    for path in sorted(before.keys() | after.keys()):
        old, new = before.get(path), after.get(path)
        if old == new: continue
        kind = path_kind(path)
        # Removal, executable bits, symlinks and type changes never bypass review.
        if new is None or new['mode'] != '100644' or old and old['mode'] != '100644':
            kind = 'runtime'
        changes.append(dict(path=path, kind=kind, before=old, after=new))
    return dict(changes=changes, reusable=all(x['kind'] != 'runtime' for x in changes),
                tests=[x['path'] for x in changes if x['kind'] == 'test'])


def equivalence(repo, original, candidate):
    before, after = tree(repo, original), tree(repo, candidate)
    result = classify(before, after)
    result.update(original=original, candidate=candidate, before=digest(before), after=digest(after))
    return result

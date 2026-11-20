#!/usr/bin/env python3
"""Host-only scratch regression: ownership guards, bundle pins, independent shared clones.

Requires root and existing grokops/gb-slot2 users. No network, services or real project data.
All Git configuration is command-scoped. The printed temporary tree is retained as evidence.
"""
from pathlib import Path
import os
import pwd
import stat
import subprocess
import tempfile

assert os.getuid() == 0
owner = pwd.getpwnam('grokops')
second = pwd.getpwnam('gb-slot2')
base = Path(tempfile.mkdtemp(prefix='gb-git-ownership-fixture-', dir='/var/tmp'))
base.chmod(0o755)
source = base / 'source'
source.mkdir(mode=0o700)
os.chown(source, owner.pw_uid, owner.pw_gid)

def account_git(user, repo):
    return ['setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid),
            '--clear-groups', 'env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent',
            'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null',
            'GIT_AUTHOR_NAME=Fixture', 'GIT_AUTHOR_EMAIL=fixture@example.invalid',
            'GIT_COMMITTER_NAME=Fixture', 'GIT_COMMITTER_EMAIL=fixture@example.invalid',
            'git', '-C', str(repo)]

def checked(command, **kwargs):
    result = subprocess.run(command, capture_output=True, timeout=30, **kwargs)
    assert result.returncode == 0, result.stderr.decode()
    return result.stdout.decode().strip()

owned = account_git(owner, source)
checked(owned + ['init', '-q', '--initial-branch=dev'])
checked(owned + ['commit', '-q', '--allow-empty', '-m', 'public fixture'])
tree = checked(owned + ['rev-parse', 'HEAD^{tree}'])
extra = checked(owned + ['commit-tree', tree], input=b'unreachable pinned commit\n')
private = base / 'root-only'
private.mkdir(mode=0o700)
bundle = private / 'common.bundle'
with bundle.open('xb') as output:
    result = subprocess.run(owned + ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                                    'bundle', 'create', '-', '--all', extra],
                            stdout=output, stderr=subprocess.PIPE, timeout=30)
assert result.returncode == 0, result.stderr.decode()
assert bundle.stat().st_uid == 0
mirror = base / 'base.git'
mirror.mkdir(mode=0o700)
root_git = ['env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent',
            'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null', 'git',
            '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
            '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=always']
checked(root_git + ['clone', '-q', '--mirror', '--no-hardlinks', str(bundle), str(mirror)])
checked(root_git + ['--git-dir=' + str(mirror), 'cat-file', '-e', extra + '^{commit}'])
for path in [mirror, *mirror.rglob('*')]:
    mode = path.stat().st_mode
    os.chmod(path, (stat.S_IMODE(mode) | 0o044 | (0o011 if path.is_dir() else 0)) & ~0o022)
for user in (owner, second):
    own = base / str(user.pw_uid)
    own.mkdir(mode=0o700)
    os.chown(own, user.pw_uid, user.pw_gid)
    clone = account_git(user, own) + ['-c', 'safe.directory=' + str(mirror), 'clone', '-q', '--shared', '--branch', 'dev']
    rejected = subprocess.run(clone + [str(mirror), str(own / 'rejected')], capture_output=True, timeout=30)
    assert rejected.returncode != 0 and b'dubious ownership' in rejected.stderr
    upload = '--upload-pack=git -c safe.directory=' + str(mirror) + ' -c core.hooksPath=/dev/null -c core.fsmonitor=false upload-pack'
    checked(clone + [upload, str(mirror), str(own / 'repo')])
    checked(account_git(user, own / 'repo') + ['cat-file', '-e', extra + '^{commit}'])
    assert not checked(account_git(user, own / 'repo') + ['status', '--porcelain'])
for user, other in ((owner, second), (second, owner)):
    prefix = ['setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid), '--clear-groups', '/usr/bin/test']
    for flag, path in (('-w', mirror), ('-x', base / str(other.pw_uid))):
        result = subprocess.run(prefix + [flag, str(path)], capture_output=True, timeout=10)
        assert result.returncode == 1, 'shared base or peer directory isolation failed'
print('PASS: owner bundle -> root mirror -> clean independent clones for two UIDs, exact-path trust; unreachable pin retained')
print('Evidence:', base)

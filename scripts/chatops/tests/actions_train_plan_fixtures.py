"""Synthetic TEST PLAN and immutable Git DATA; no admission/gate substitutes."""
import copy
import os
from pathlib import Path
import subprocess

import test_plan_gate as G


def planned_task(task, changes=None):
    """Preserve criteria and derive the plan from the fixture's change surface."""
    task = copy.deepcopy(task)
    if changes is None:
        changes = [dict(path=p, status='M') for p in task['allowed_paths']]
    block, _, _ = G.trusted_tools()
    task['acceptance'] = block.attach(task.get('acceptance', ''),
                                      block.plan_for_changes(changes))
    return task


def candidate(directory, task=None):
    """Two real commits in the task's allowed files, under a test's TMPDIR."""
    directory = Path(directory)
    task = copy.deepcopy(task) if task is not None else dict(
        acceptance='Bounded synthetic transport fixture', allowed_paths=['scripts/helper.py'])
    paths = task['allowed_paths']
    assert paths and all(not Path(p).is_absolute() and '..' not in Path(p).parts
                         and not any(c in p for c in '*?[') for p in paths)
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
               GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
               GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid',
               GIT_AUTHOR_DATE='2026-10-27T01:00:00+0000',
               GIT_COMMITTER_DATE='2026-10-27T01:00:00+0000', GIT_TERMINAL_PROMPT='0')
    def git(*args):
        return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', *args],
            cwd=directory, env=env, stderr=subprocess.PIPE).decode().strip()
    git('init', '-q')
    for value in (1, 2):
        for relative in paths:
            path = directory/relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(('VALUE = %d\n' if path.suffix == '.py'
                             else '// synthetic value %d\n') % value)
        git('add', '--', *paths)
        git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic %d' % value)
        if value == 1:
            base = git('rev-parse', 'HEAD')
    head = git('rev-parse', 'HEAD')
    changes = [dict(path=p, status='M') for p in paths]
    return dict(task=planned_task(task, changes), base=base, head=head)

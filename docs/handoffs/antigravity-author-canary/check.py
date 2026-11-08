"""Isolated author qualification acceptance, no services or dependencies."""
from pathlib import Path
import runpy

namespace = runpy.run_path(str(Path(__file__).with_name('count_completed.py')))
count = namespace['count_completed']
for values, expected in (([], 0), ([True, False, True], 2),
                         ([1, 'yes', None, {}, False], 0),
                         ([True, 1, 'yes', True], 2)):
    assert count(values) == expected, (values, expected)
assert count(iter([True, False, True])) == 2
assert count([True, False, True], limit=0) == 0
assert count([True, 1, True, True], limit=2) == 2
assert count(iter([True, False, True]), limit=5) == 2
for limit in (-1, True, '1', 1.5):
    try:
        count([True], limit=limit)
    except ValueError:
        pass
    else:
        raise AssertionError(('invalid limit accepted', limit))
print('ANTIGRAVITY_AUTHOR_CANARY_TESTS_PASS')

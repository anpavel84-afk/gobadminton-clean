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
print('ANTIGRAVITY_AUTHOR_CANARY_TESTS_PASS')

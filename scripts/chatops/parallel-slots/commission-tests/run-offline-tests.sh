#!/bin/bash
# Only scratch fixtures: no installer entrypoint, services, network or models.
set -euo pipefail
SRC=$(cd -- "$(dirname -- "$0")" && pwd -P)
SCRATCH_ROOT=${1:?usage: bash run-offline-tests.sh ABSOLUTE_SCRATCH_DIR}
[[ $SCRATCH_ROOT = /* && -d $SCRATCH_ROOT ]] || exit 64
RUN=$(mktemp -d "$SCRATCH_ROOT/slots-offline.XXXXXX")
export TMPDIR=$RUN PYTHONPYCACHEPREFIX=$RUN/pycache
python3 - "$SRC" "$RUN" <<'PY'
import base64, hashlib, re, sys
from pathlib import Path
src, run = map(Path, sys.argv[1:])
code = run/'scripts/chatops'
(code/'tests').mkdir(parents=True)
installer = (src/'parallel-slots.sh').read_text()
for key, name in {'EXEC':'autonomous_issues.py', 'SLOTS':'slots.py', 'FOUNDATION':'check_foundation.py',
                  'T1':'test_autonomous_issues.py', 'T2':'test_slots.py'}.items():
    data = base64.b64decode(''.join(installer.split('__PAYLOAD_'+name+'__\n', 1)[1].split('__PAYLOAD_', 1)[0].splitlines()), validate=True)
    assert data == (src/('embedded-'+name)).read_bytes(), name
    expected = re.search(r'^SHA_'+key+r'=([a-f0-9]{64})$', installer, re.M)[1]
    assert hashlib.sha256(data).hexdigest() == expected, name
    (code/('tests/'+name if name.startswith('test_') else name)).write_bytes(data)
park = run/'park'; park.mkdir()
for name in ('park-drift.sh', 'test_park_drift_installer.py'):
    (park/name).write_bytes((src/name).read_bytes())
(park/'autonomous_issues.py').write_bytes((src/'live-autonomous_issues.py').read_bytes())
print('payload/live SHA verification: OK')
PY
bash -n "$SRC/parallel-slots.sh"
bash -n "$SRC/park-drift.sh"
bash -n "$SRC/repository-build.sh"
bash -n "$SRC/repository-installer.tpl"
bash -n "$SRC/run-offline-tests.sh"
python3 -m py_compile "$SRC"/embedded-*.py "$SRC/test_parallel_slots_installer.py"
python3 -B "$RUN/scripts/chatops/tests/test_autonomous_issues.py" >"$RUN/executor.log" 2>&1
python3 -B "$RUN/scripts/chatops/tests/test_slots.py" >"$RUN/slots.log" 2>&1
python3 -B "$SRC/test_parallel_slots_installer.py" >"$RUN/installer.log" 2>&1
python3 -B "$RUN/park/test_park_drift_installer.py" >"$RUN/park.log" 2>&1
for suite in executor slots installer park; do tail -n 4 "$RUN/$suite.log"; done
printf 'Artifacts: %s\n' "$RUN"

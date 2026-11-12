#!/bin/bash
# Reconstruct the reviewed bundle only under a caller-owned scratch directory.
set -euo pipefail
SELF=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO=$(cd -- "$SELF/../../../.." && pwd -P)
SCRATCH=${1:?usage: bash run.sh ABSOLUTE_EXISTING_SCRATCH}
[[ $SCRATCH = /* && -d $SCRATCH ]] || exit 64
BUNDLE=$(mktemp -d "$SCRATCH/slots-bundle.XXXXXX")
python3 - "$REPO" "$SELF" "$BUNDLE" <<'PYMAP'
from pathlib import Path
import sys
repo, fixtures, bundle = map(Path, sys.argv[1:])
mapping = {
 'repository-build.sh':'scripts/chatops/parallel-slots/build.sh',
 'repository-installer.tpl':'scripts/chatops/parallel-slots/installer.tpl',
 'repository-SOURCE_SHA256SUMS':'scripts/chatops/parallel-slots/SOURCE_SHA256SUMS',
 'parallel-slots.sh':'scripts/chatops/parallel-slots/parallel-slots-install.sh',
 'embedded-autonomous_issues.py':'scripts/chatops/autonomous_issues.py',
 'embedded-slots.py':'scripts/chatops/slots.py',
 'embedded-check_foundation.py':'scripts/check_foundation.py',
 'embedded-test_autonomous_issues.py':'scripts/chatops/tests/test_autonomous_issues.py',
 'embedded-test_slots.py':'scripts/chatops/tests/test_slots.py',
 'live-autonomous_issues.py':'scripts/chatops/parallel-slots/live-autonomous_issues.py',
}
for name, source in mapping.items(): (bundle/name).write_bytes((repo/source).read_bytes())
for name in ('run-offline-tests.sh','test_parallel_slots_installer.py','park-drift.sh','test_park_drift_installer.py'):
 (bundle/name).write_bytes((fixtures/name).read_bytes())
PYMAP
umask 077
bash "$BUNDLE/run-offline-tests.sh" "$SCRATCH"

#!/bin/bash
# build.sh REPOSITORY_ROOT OUTPUT_INSTALLER: checked final working-tree sources, offline.
# Historical HEAD_SHA/BASE_SHA in installer.tpl are ancestry evidence, not payload provenance.
set -euo pipefail
BUILD_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
R=${1:?usage: build.sh REPOSITORY_ROOT OUTPUT_INSTALLER}
OUT=${2:?usage: build.sh REPOSITORY_ROOT OUTPUT_INSTALLER}
[[ $# = 2 ]] || exit 64
python3 -I - "$BUILD_DIR" "$R" "$OUT" <<'PY'
import base64, hashlib, re, sys
from pathlib import Path
build, repo, output = map(Path, sys.argv[1:])
names = {'EXEC': 'scripts/chatops/autonomous_issues.py', 'SLOTS': 'scripts/chatops/slots.py',
         'FOUNDATION': 'scripts/check_foundation.py',
         'T1': 'scripts/chatops/tests/test_autonomous_issues.py', 'T2': 'scripts/chatops/tests/test_slots.py'}
baseline = 'scripts/chatops/parallel-slots/live-autonomous_issues.py'
template = 'scripts/chatops/parallel-slots/installer.tpl'
try:
    pins = {}
    for line in (build / 'SOURCE_SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        if not re.fullmatch('[a-f0-9]{64}', digest) or name in pins:
            raise ValueError('invalid source manifest')
        pins[name] = digest
    if set(pins) != set(names.values()) | {baseline, template}:
        raise ValueError('incomplete source manifest')
    data = {}
    for name, digest in pins.items():
        data[name] = (repo / name).read_bytes()
        if hashlib.sha256(data[name]).hexdigest() != digest:
            raise ValueError('source SHA mismatch: ' + name)
    if data[template] != (build / 'installer.tpl').read_bytes():
        raise ValueError('builder/template directory mismatch')
    rendered = data[template].decode('utf-8')
    rendered = rendered.replace('@@SHA_BASE_EXEC@@', pins[baseline])
    payload = ''
    for symbol, name in names.items():
        rendered = rendered.replace('@@SHA_' + symbol + '@@', pins[name])
        payload += '__PAYLOAD_' + Path(name).name + '__\n' + base64.encodebytes(data[name]).decode('ascii')
    if '@@' in rendered.replace('@@NAME@@', ''):
        raise ValueError('unresolved template token')
    result = (rendered + payload + '__PAYLOAD_END__\n').encode('utf-8')
    if output.is_symlink():
        raise ValueError('output is a symlink')
    output.write_bytes(result)
    output.chmod(0o755)
    print(hashlib.sha256(result).hexdigest() + '  ' + str(output))
except (OSError, ValueError) as error:
    sys.exit(str(error))
PY

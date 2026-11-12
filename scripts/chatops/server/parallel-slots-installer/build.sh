#!/bin/bash
# build.sh <repo dir> <PR head sha>: embeds the four files from that exact commit, prints installer sha256
set -euo pipefail
cd "$(dirname "$0")"
R=$1 H=$2 B=${3:-970e5a470a8c738e98a1a0bde8c862e2aa23b5c8}
mkdir -p payload
git -C "$R" show "$H:scripts/chatops/autonomous_issues.py" >payload/autonomous_issues.py
git -C "$R" show "$H:scripts/chatops/slots.py" >payload/slots.py
git -C "$R" show "$H:scripts/chatops/tests/test_autonomous_issues.py" >payload/test_autonomous_issues.py
git -C "$R" show "$H:scripts/chatops/tests/test_slots.py" >payload/test_slots.py
git -C "$R" show "$B:scripts/chatops/autonomous_issues.py" >payload/base_autonomous_issues.py
python3 - "$H" "$B" <<'PY'
import base64, hashlib, sys
t = open('installer.tpl').read()
names = {'EXEC': 'autonomous_issues.py', 'SLOTS': 'slots.py', 'T1': 'test_autonomous_issues.py', 'T2': 'test_slots.py'}
t = t.replace('@@HEAD_SHA@@', sys.argv[1]).replace('@@BASE_SHA@@', sys.argv[2])
t = t.replace('@@SHA_BASE_EXEC@@', hashlib.sha256(open('payload/base_autonomous_issues.py', 'rb').read()).hexdigest())
pay = ''
for k, n in names.items():
    b = open('payload/' + n, 'rb').read()
    t = t.replace(f'@@SHA_{k}@@', hashlib.sha256(b).hexdigest())
    pay += f'__PAYLOAD_{n}__\n' + base64.encodebytes(b).decode()
assert '@@' not in t.replace('@@NAME@@', '')
open('parallel-slots-install.sh', 'w').write(t + pay + '__PAYLOAD_END__\n')
PY
chmod 755 parallel-slots-install.sh
sha256sum parallel-slots-install.sh

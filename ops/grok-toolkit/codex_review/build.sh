#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
sha=$(sha256sum src/codex-review | cut -d' ' -f1)
python3 - "$sha" <<'PY'
import sys,base64
t=open('installer.tpl').read()
b=base64.encodebytes(open('src/codex-review','rb').read()).decode().rstrip('\n')
open('codex-review-install.sh','w').write(t.replace('@@WRAPPER_SHA@@',sys.argv[1]).replace('@@WRAPPER_B64@@',b))
PY
chmod 755 codex-review-install.sh
sha256sum codex-review-install.sh

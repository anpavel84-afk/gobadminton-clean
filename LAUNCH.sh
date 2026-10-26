cd /
set -euo pipefail
SHA=00197e5feb15e048cd55416d57ca69924fab4af2
PROMPT_SHA=aade9dd9374f6fce38381f6b76cfca080d8d7516c8cf17ff26ea84a22eab62bb
ROOT=/home/agentagency-dev/author-stage5-cursor-20261025
OUT=/home/agentagency-dev/author-evidence-stage5-cursor-20261025
[ ! -e "$ROOT" ] && [ ! -e "$OUT" ] || { echo "dirs already exist - refusing"; exit 1; }
if [ ! -f /var/tmp/author_stage5_prompt.md ]; then
  python3 -B - <<'PY'
import base64,json,urllib.request
u='https://raw.githubusercontent.com/anpavel84-afk/gobadminton-clean/tmp/stage5-author-prompt-20261025/AUTHOR_PROMPT.md'
open('/var/tmp/author_stage5_prompt.md','wb').write(urllib.request.urlopen(u,timeout=30).read())
PY
  chmod 644 /var/tmp/author_stage5_prompt.md
fi
echo "$PROMPT_SHA  /var/tmp/author_stage5_prompt.md" | sha256sum -c -
runuser -u agentagency-dev -- bash -c "
  set -euo pipefail
  git clone --no-checkout https://github.com/anpavel84-afk/gobadminton-clean '$ROOT'
  cd '$ROOT'
  git fetch origin $SHA
  git checkout --detach $SHA
  test \"\$(git rev-parse HEAD)\" = $SHA
  test -z \"\$(git status --porcelain)\"
"
runuser -u agentagency-dev -- python3 -B - <<'PY'
import json,pathlib,subprocess,hashlib
root=pathlib.Path('/home/agentagency-dev/author-stage5-cursor-20261025')
out=pathlib.Path('/home/agentagency-dev/author-evidence-stage5-cursor-20261025')
sha='00197e5feb15e048cd55416d57ca69924fab4af2'
pb=pathlib.Path('/var/tmp/author_stage5_prompt.md').read_bytes()
assert hashlib.sha256(pb).hexdigest()=='aade9dd9374f6fce38381f6b76cfca080d8d7516c8cf17ff26ea84a22eab62bb'
assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==sha
assert not subprocess.check_output(['git','-C',str(root),'status','--porcelain']).strip()
assert not out.exists()
out.mkdir(mode=0o700)
(out/'prompt.md').write_bytes(pb)
fs={':root':'deny',':minimal':'read',':slash_tmp':'deny',':tmpdir':'write',str(root):'read',str(root/'.git'):'read',
    str(out):'write',
    '/home/agentagency-dev/.local/lib/node_modules/@openai':'read',
    '/home/agentagency-dev/.local/node-v24.21.0':'read',
    '/home/agentagency-dev/.ssh':'deny','/srv/gb-slots':'deny',
    '/var/lib/gobadminton-actions-train':'deny',
    '/var/lib/gobadminton-autonomy':'deny','/etc/gobadminton-slots':'deny'}
for d in ('scripts/chatops/actions_train','scripts/chatops/tests','docs/workbench/context-exchange-20261023'): fs[str(root/d)]='write'  # dir-level; allow-list enforced by post-run diff check
cfg=','.join(json.dumps(k)+'='+json.dumps(v) for k,v in fs.items())
argv=['/home/agentagency-dev/.local/bin/codex','--no-daemon','exec',
      '--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','-C',str(root),
      '-c','approval_policy="never"','-c','default_permissions="gb-task"',
      '-c','permissions.gb-task={extends=":workspace",network={enabled=false},filesystem={'+cfg+'}}',
      '-c','mcp_servers={}','-c','features.hooks=false','-c','features.apps=false',
      '-c','web_search="disabled"','--model','gpt-6.1-sol',
      '-c','model_reasoning_effort="high"','--json','-o',str(out/'result.json'),'-']
with open(out/'events.jsonl','wb') as stdout,open(out/'stderr','wb') as stderr:
 try:
  p=subprocess.run(argv,input=pb,stdout=stdout,stderr=stderr,timeout=3000,check=False)
  (out/'exit.txt').write_text(str(p.returncode))
  print('AUTHORS5_EXIT',p.returncode,'EVIDENCE_DIR',str(out))
 except subprocess.TimeoutExpired:
  (out/'exit.txt').write_text('TIMEOUT')
  print('AUTHORS5_TIMEOUT','EVIDENCE_DIR',str(out))
PY
